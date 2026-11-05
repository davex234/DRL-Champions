"use client";

/**
 * PROGRESO — pase de temporada, objetivos y logros (Fase 9E, recompuesta en 9.6).
 *
 * Todo lo decide y lo paga el servidor (`/api/game/progression`); esta pantalla solo lo
 * presenta. No se calcula aquí ni un nivel, ni un progreso de misión, ni si un logro está
 * completo. Eso no cambia.
 *
 * ───────────────────────── QUÉ SE RECOMPONE Y POR QUÉ ─────────────────────────
 *
 * **El pase era una tabla.** Treinta celdas iguales en fila, cada una diciendo «NIVEL 7 ·
 * 320 · te faltan 7 niveles». No había recorrido, ni hitos, ni forma de ver dónde estabas,
 * ni —lo que de verdad importa— cuál es el próximo premio. Ahora cada carril es una VÍA
 * (`PassRail`) con su próximo premio destacado fuera (`NextReward`).
 *
 * **Los objetivos eran una lista plana.** Las misiones llegan del servidor con su `kind`
 * (diaria, semanal, de temporada, de evento…), que es exactamente el eje por el que un
 * jugador las lee —«¿qué puedo hacer HOY?»— y estaba sin usar: se pintaban las quince
 * seguidas con una etiqueta pequeña en la esquina.
 *
 * **Y los logros eran una lista finita.** El encargo pedía explícitamente que la pantalla
 * admita objetivos nuevos —de temporada, de evento, temporales— sin rediseñarla. Por eso
 * la sección de objetivos **se agrupa por lo que llegue**: los `kind` conocidos salen en su
 * orden y cualquiera que aparezca mañana cae en su propio grupo con su nombre, sin tocar
 * esta pantalla. La extensibilidad no es un hueco reservado: es no cerrar la lista.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { syncFromServer } from "@/lib/game/sync";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchProgression, claimPassLevel, claimMission, claimAchievement,
  equipCosmetic,
  type ProgressionView, type PassTrack,
} from "@/lib/progression/client";
import type { PassMissionView } from "@/server/services/progression";
import { PASS_PRODUCT, PAYMENTS_ENABLED, formatPrice } from "@/config/monetization";
import { PassRail, NextReward } from "@/components/progression/PassRail";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { Meter } from "@/components/ui/Meter";
import { Readout } from "@/components/ui/Readout";
import { NxButton } from "@/components/ui/NxButton";
import { useToast } from "@/lib/useToast";
import { formatCredits, cn } from "@/lib/format";
import { CreditGlyph, GameGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("logros");

const TRACK_INFO: Record<PassTrack, { label: string; blurb: string; tint: string }> = {
  free: {
    label: "Libre",
    blurb: "Para todo el mundo, sin condiciones.",
    tint: "25,227,255",
  },
  competitive: {
    label: "Competitivo",
    blurb: "Se abre al llegar a Oro. No se compra: se juega.",
    tint: "255,46,99",
  },
  premium: {
    label: "Aspecto",
    blurb: "Solo cosmética. Nada que afecte a un duelo.",
    tint: "255,211,92",
  },
};

/**
 * Familias de objetivo CONOCIDAS, en el orden en que un jugador las mira: lo que caduca
 * hoy primero y lo permanente al final.
 *
 * Esta tabla NO cierra la lista. Un `kind` que no esté aquí se agrupa igualmente, al final,
 * con su propio nombre. Es lo que permite que entren objetivos nuevos —de evento, de
 * temporada, temporales— sin volver a tocar esta pantalla.
 */
const KIND_ORDER = [
  "daily", "weekly", "event", "seasonal", "progressive",
  "repeatable", "special", "community", "hidden",
] as const;

const KIND_LABEL: Record<string, string> = {
  daily: "Diarias",
  weekly: "Semanales",
  seasonal: "De temporada",
  progressive: "Hitos",
  event: "Evento",
  special: "Especiales",
  repeatable: "Repetibles",
  hidden: "Ocultas",
  community: "Comunidad",
};

const KIND_HINT: Record<string, string> = {
  daily: "Se renuevan cada día.",
  weekly: "Se renuevan cada semana.",
  seasonal: "Duran toda la temporada.",
  event: "Solo mientras el evento esté activo.",
  progressive: "Se completan una vez y no vuelven.",
};

/** Nombre presentable de un `kind` que todavía no conocemos. */
const labelForKind = (kind: string) =>
  KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[-_]/g, " ");

export default function LogrosPage() {
  useLocale();
  const { user, loading } = useAuth();
  const online = isSupabaseConfigured();

  if (loading) return <Loading kind="hub" label={t("Cargando tu progreso…")} />;
  if (!online || !user) return <NeedsAccount what={t("el pase y los logros")} />;
  return <Progression />;
}

function Progression() {
  useLocale();
  const { toast, notify } = useToast();
  const [view, setView] = useState<ProgressionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setView(await fetchProgression());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo cargar tu progreso"));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Ejecuta una acción del servidor y vuelve a leer el estado: el servidor manda. */
  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      notify(okMsg, true);
      await load();
      await syncFromServer().catch(() => undefined); // F68 · el HUD (store de juego) enseña el saldo cobrado sin recargar
    } catch (e) {
      notify(e instanceof Error ? e.message : t("No se pudo completar"), false);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Agrupa las misiones por familia. Los `kind` conocidos salen en su orden; los que no
   * conocemos, detrás y por orden alfabético — pero SALEN. Un objetivo que el servidor
   * envía y la pantalla no sabe pintar es un objetivo que el jugador no puede completar.
   */
  const groups = useMemo(() => {
    if (!view) return [];
    const by = new Map<string, PassMissionView[]>();
    for (const m of view.missions) {
      const arr = by.get(m.kind) ?? [];
      arr.push(m);
      by.set(m.kind, arr);
    }
    const known = KIND_ORDER.filter((k) => by.has(k));
    const unknown = [...by.keys()].filter((k) => !(KIND_ORDER as readonly string[]).includes(k)).sort();
    return [...known, ...unknown].map((kind) => ({ kind, items: by.get(kind)! }));
  }, [view]);

  if (error && !view) return <ErrorState message={td(error)} onRetry={load} />;
  if (!view) return <Loading kind="hub" label={t("Cargando tu progreso…")} />;

  const claimedAchievements = view.achievements.filter((a) => a.claimed).length;
  /** En curso primero: lo que se puede terminar hoy va por delante de lo ya cerrado. */
  const achievements = [...view.achievements].sort(
    (a, b) =>
      Number(b.complete && !b.claimed) - Number(a.complete && !a.claimed) ||
      Number(a.claimed) - Number(b.claimed) ||
      b.current / Math.max(1, b.goal) - a.current / Math.max(1, a.goal),
  );

  return (
    <div className="space-y-9">
      {/* ═══════════════ CABECERA DE TEMPORADA ═══════════════ */}
      <section className="nx-stage nx-stage-grid nx-clip relative overflow-hidden px-5 py-7 sm:px-9 sm:py-9">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(720px 340px at 10% 118%, rgba(25,227,255,0.28), transparent 66%), radial-gradient(560px 320px at 92% -10%, rgba(123,92,255,0.16), transparent 62%)",
          }}
        />
        <span className="nx-label">{t("Pase de temporada")}</span>
        <h1 className="mt-1 font-display text-[clamp(30px,6vw,54px)] font-bold uppercase leading-none text-white">
          {td(view.season.name)}
        </h1>

        <div className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-5">
          {/*
            EL NIVEL, COMO MEDALLA. Antes era una cifra grande junto a la palabra «Nivel».
            El nivel del pase es la unidad de progreso de toda la temporada: si se dibuja
            como un dato más, la pantalla no tiene sujeto.
          */}
          <div className="relative shrink-0">
            <span
              aria-hidden
              className="nx-bloom"
              style={{ left: -18, top: -18, width: 140, height: 140, background: "#19e3ff" }}
            />
            <div
              className="nx-plate nx-clip-sm relative grid h-[104px] w-[104px] place-items-center"
              style={{ borderColor: "rgba(25,227,255,0.55)", ["--nx-chamfer-sm" as string]: "16px" }}
            >
              <span className="nx-label absolute top-3">{t("Nivel")}</span>
              <Readout size="lg" className="mt-3" align="center" tone="var(--nx-cyan)" value={view.level} />
              <span className="absolute bottom-2.5 font-display text-[10px] tabular-nums text-white/35">
                / {view.season.maxLevel}
              </span>
            </div>
          </div>

          <div className="min-w-[220px] flex-1">
            <div className="flex justify-between">
              <span className="nx-label">{t("Experiencia")}</span>
              <Readout size="xs" align="right" value={`${view.xpIntoLevel} / ${view.xpForNext}`} unit={t("XP")} />
            </div>
            <Meter className="mt-2" height={10} tone="info" value={view.progress * 100} label={t("Experiencia del pase")} />
            <p className="nx-label mt-2">
              {view.level >= view.season.maxLevel
                ? t("Pase completado")
                : t("{v} XP para el nivel {v2}", { v: view.xpForNext - view.xpIntoLevel, v2: view.level + 1 })}
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════ LOS TRES CARRILES ═══════════════ */}
      <section aria-label={t("Carriles del pase")} className="space-y-5">
        {(["free", "competitive", "premium"] as PassTrack[]).map((track) => {
          const info = TRACK_INFO[track];
          const levels = view.tracks[track];
          const open =
            track === "free" ? true
            : track === "competitive" ? view.competitiveUnlocked
            : view.premium;

          // El próximo premio: lo primero reclamable y, si no hay nada, el primero por venir.
          const next =
            levels.find((l) => l.claimable) ??
            levels.find((l) => !l.claimed && l.level > view.level) ??
            null;

          return (
            <div
              key={track}
              className="nx-clip relative overflow-hidden border p-4 sm:p-5"
              style={{
                borderColor: open ? `rgba(${info.tint},0.35)` : "rgba(255,255,255,0.08)",
                background: open
                  ? `linear-gradient(160deg, rgba(${info.tint},0.09), rgba(255,255,255,0.015) 60%)`
                  : "rgba(255,255,255,0.015)",
              }}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2
                    className="font-display text-xl font-bold uppercase tracking-[0.06em]"
                    style={{ color: open ? `rgb(${info.tint})` : "rgba(255,255,255,0.4)" }}
                  >
                    {td(info.label)}
                    {!open && <span className="ml-2 text-[11px] tracking-normal text-white/35">{t("· bloqueado")}</span>}
                  </h2>
                  <p className="text-[13px] text-white/45">{td(info.blurb)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {open && next && (
                    <NextReward level={next} tint={info.tint} currentLevel={view.level} />
                  )}

                  {track === "competitive" && !open && (
                    <p className="text-[13px] text-white/60">
                      {fill(t("Te faltan {puntos} puntos · {enlace}", slots("puntos", "enlace")), {
                        puntos: (
                          <b className="tabular-nums text-drl">
                            {Math.max(0, view.competitiveMinPoints - view.points)}
                          </b>
                        ),
                        enlace: (
                          <Link href="/pickems" className="text-drl underline-offset-2 hover:underline">
                            {t("súmalos aquí")}
                          </Link>
                        ),
                      })}
                    </p>
                  )}

                  {track === "premium" && !open && <PremiumOffer />}
                </div>
              </div>

              <PassRail
                levels={levels}
                currentLevel={view.level}
                open={open}
                tint={info.tint}
                busy={busy !== null}
                onClaim={(level) =>
                  run(`lvl-${track}-${level}`, () => claimPassLevel(level, track), t("Recompensa reclamada"))
                }
              />
            </div>
          );
        })}
      </section>

      {/* ═══════════════ OBJETIVOS ═══════════════ */}
      <section aria-label={t("Objetivos")} className="space-y-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-bold uppercase tracking-[0.06em] text-white">{t("Objetivos")}</h2>
          <span className="nx-label">{view.missions.length} {t("activos")}</span>
        </div>

        {groups.length === 0 ? (
          <p className="nx-clip border border-dashed border-white/12 px-5 py-6 text-center text-[13px] text-white/50">
            {t("No hay objetivos activos ahora mismo. Vuelve cuando empiece la siguiente tanda.")}
          </p>
        ) : (
          groups.map(({ kind, items }) => (
            <div key={kind}>
              <div className="mb-2.5 flex items-baseline gap-3">
                <h3 className="nx-label !text-white/70">{tdIn("logros", labelForKind(kind))}</h3>
                {KIND_HINT[kind] && <span className="text-[11px] text-white/30">{td(KIND_HINT[kind])}</span>}
                <span className="ml-auto nx-label">
                  {items.filter((m) => m.claimed).length} / {items.length}
                </span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((m) => (
                  <MissionCard
                    key={m.id}
                    mission={m}
                    busy={busy !== null}
                    onClaim={() => run(`m-${m.id}`, () => claimMission(m.id), t("Misión reclamada"))}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* ═══════════════ ASPECTO ═══════════════ */}
      {/*
        Los cosméticos se concedían y desaparecían: un id en `user_cosmetics` que ninguna
        pantalla leía (Fase 11). Aquí se ven y se equipan, que es lo que convierte una
        recompensa de aspecto en algo que existe. Se agrupan por FAMILIA —el prefijo del
        id— porque es lo que el jugador lleva de uno en uno.
      */}
      {view.cosmetics.length > 0 && (
        <section aria-label={t("Aspecto")}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold uppercase tracking-[0.06em] text-white">{t("Aspecto")}</h2>
              <p className="text-[13px] text-white/45">
                {t("Lo que has desbloqueado. Solo cambia cómo se te ve: nada de esto afecta a un duelo.")}
              </p>
            </div>
            <span className="nx-label">{view.cosmetics.length} {t("desbloqueados")}</span>
          </div>

          <div className="space-y-4">
            {[...new Set(view.cosmetics.map((c) => c.split(":")[0]))].sort().map((family) => {
              const items = view.cosmetics.filter((c) => c.startsWith(`${family}:`));
              const current = view.equipped?.[family] ?? null;
              return (
                <div key={family}>
                  <h3 className="nx-label mb-2 !text-white/70">{td(family)}</h3>
                  <div className="flex flex-wrap gap-2">
                    {items.map((id) => {
                      const on = current === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`cos-${id}`, () => equipCosmetic(family, on ? null : id),
                              on ? t("Retirado") : t("Equipado"))
                          }
                          aria-pressed={on}
                          className={cn(
                            "nx-clip-sm border px-3.5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.08em] transition duration-fast",
                            on
                              ? "border-drl-gold/60 bg-drl-gold/[0.12] text-drl-gold"
                              : "border-white/12 text-white/60 hover:border-white/30 hover:text-white",
                          )}
                        >
                          {on && <span aria-hidden className="mr-1.5">✦</span>}
                          {id.split(":")[1]?.replace(/-/g, " ") ?? id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ LOGROS ═══════════════ */}
      <section aria-label={t("Logros")}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.06em] text-white">{t("Logros")}</h2>
            <p className="text-[13px] text-white/45">{t("Permanentes. No caducan y no se reinician con la temporada.")}</p>
          </div>
          <span className="nx-label">
            {t("{n} de {total} reclamados", { n: claimedAchievements, total: view.achievements.length })}
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {achievements.map((a) => {
            const pct = a.goal > 0 ? Math.min(100, (a.current / a.goal) * 100) : 0;
            return (
              <div
                key={a.id}
                className={cn(
                  "nx-clip-sm flex items-start gap-3 border p-4 transition duration-fast",
                  a.complete && !a.claimed
                    ? "border-drl-gold/45 bg-drl-gold/[0.07]"
                    : "border-white/[0.09] bg-white/[0.025]",
                  a.claimed && "opacity-55",
                )}
              >
                <span
                  className="nx-plate nx-clip-sm grid h-11 w-11 shrink-0 place-items-center text-xl"
                  style={{ borderColor: a.complete ? "rgba(255,211,92,0.5)" : undefined }}
                  aria-hidden
                >
                  <GameGlyph symbol={a.icon} className="h-7 w-7" />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block font-display text-[15px] font-bold text-white">{td(a.name)}</b>
                  <p className="text-[12.5px] leading-snug text-white/45">{td(a.description)}</p>
                  <Meter className="mt-2" height={6} tone="gold" value={pct} label={td(a.name)} />
                  <span className="nx-readout mt-1.5 block text-[12px] text-white/45">
                    {a.current} / {a.goal} · <CreditGlyph className="align-[-2px]" /> {formatCredits(a.reward)}
                  </span>
                </div>
                <NxButton
                  size="sm"
                  variant={a.complete && !a.claimed ? "primary" : "secondary"}
                  accent="gold"
                  disabled={!a.complete || a.claimed || busy !== null}
                  onClick={() => run(`a-${a.id}`, () => claimAchievement(a.id), t("+{reward} créditos", { reward: formatCredits(a.reward) }))}
                  className="shrink-0 self-center"
                >
                  {a.claimed ? "✓" : a.complete ? t("Reclamar") : "—"}
                </NxButton>
              </div>
            );
          })}
        </div>
      </section>

      <Toast toast={toast} />
    </div>
  );
}

/** Un objetivo. Barra, cifras y un solo botón que dice en qué estado está. */
function MissionCard({
  mission: m, busy, onClaim,
}: {
  mission: PassMissionView;
  busy: boolean;
  onClaim: () => void;
}) {
  useLocale();
  const pct = m.goal > 0 ? Math.min(100, (m.current / m.goal) * 100) : 0;
  return (
    <div
      className={cn(
        "nx-clip-sm flex flex-col border p-4 transition duration-fast",
        m.complete && !m.claimed
          ? "border-ok/45 bg-ok/[0.07]"
          : "border-white/[0.09] bg-white/[0.025]",
        m.claimed && "opacity-55",
      )}
    >
      <b className="font-display text-[15px] font-bold text-white">{td(m.label)}</b>

      <Meter className="mt-2.5" height={6} tone="info" value={pct} label={td(m.label)} />
      <span className="nx-readout mt-1.5 text-[12px] text-white/45">
        {m.current} / {m.goal}
        {m.rewardCredits > 0 && <> · <CreditGlyph className="align-[-2px]" /> {formatCredits(m.rewardCredits)}</>}
        {m.xp > 0 && t(" · {xp} XP", { xp: m.xp })}
      </span>

      <NxButton
        size="sm"
        variant={m.complete && !m.claimed ? "primary" : "secondary"}
        accent="cyan"
        disabled={!m.complete || m.claimed || busy}
        onClick={onClaim}
        className="mt-3"
      >
        {m.claimed ? t("Reclamada") : m.complete ? t("Reclamar") : t("En curso")}
      </NxButton>
    </div>
  );
}

/**
 * Oferta del carril de pago.
 *
 * Hasta la F18.2 este bloque tenía DOS botones: el precio en dinero real, deshabilitado
 * porque no hay pasarela (§12), y al lado «🎟️ 1.200 fichas», que era la vía que se
 * anunciaba como la que sí funcionaba.
 *
 * No funcionaba. El servidor llamaba a `app_adjust_credits` con un parámetro `p_tokens`
 * que esa función nunca ha tenido, así que la compra fallaba siempre con un 409. Y con la
 * retirada de las fichas de evento tampoco existe ya la moneda.
 *
 * Así que el segundo botón se ha ido. Queda el precio anunciado y el motivo escrito: es
 * más honesto un «próximamente» que un botón que cobra en una moneda que no existe.
 */
function PremiumOffer() {
  useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled
        title={t("Todavía no hay pasarela de pago.")}
        className="nx-clip-sm cursor-not-allowed border border-drl-gold/25 px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-drl-gold/50"
      >
        {formatPrice(PASS_PRODUCT.price)}
        {!PAYMENTS_ENABLED && <span className="ml-2 tracking-normal">{t("· próximamente")}</span>}
      </button>
    </div>
  );
}
