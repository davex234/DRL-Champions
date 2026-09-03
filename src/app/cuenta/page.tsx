"use client";

/**
 * PERFIL — la FICHA DE JUGADOR (recompuesta en 9.6).
 *
 * Todas las cifras vienen del servidor: `profiles` (rango, puntos, saldo, XP),
 * `user_cards`, `user_packs` y `pickem_scores`. Nada de esto se puede modificar desde el
 * navegador, y eso no cambia: lo que cambia es cómo se presenta.
 *
 * EL PROBLEMA (captura `18-perfil`). El perfil era un cuadro de mando: una tarjeta de
 * identidad con doce emoji de avatar desplegados a la vista, una tarjeta de rango, cuatro
 * botones de región y **ocho celdas con una cifra cada una**. Ocho módulos pequeños del
 * mismo tamaño, ninguno más importante que otro. Ninguna respuesta a la pregunta de un
 * jugador que abre su perfil: *¿quién soy en este juego?*
 *
 * LA RECOMPOSICIÓN
 *
 *   1. **Una ficha, no tres tarjetas.** Identidad, rango y progreso viven en el mismo
 *      escenario, teñido por el color del rango. El emblema es la pieza grande.
 *   2. **Las cifras salen de sus cajas.** Las ocho celdas pasan a ser una tira de datos de
 *      HUD sobre la ficha. Mismos ocho datos, mismos destinos, cero cajas.
 *   3. **Se enseñan tus cartas.** Un perfil de un juego de cartas que no enseña ni una
 *      carta habla de todo menos de lo que has conseguido. Sale del store que ya estaba
 *      cargado: ni una lectura nueva.
 *   4. **Los ajustes, al final.** Avatar y región son configuración. Estaban por delante
 *      de las estadísticas y por eso el perfil parecía un formulario de cuenta.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { AuthForms } from "@/components/auth/AuthForms";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { formatCredits, cn } from "@/lib/format";
import { equippedDefs } from "@/domain/cosmetics/catalog";
import { fetchPrestige, type PrestigeView } from "@/lib/game/prestige";
import { RankEmblem } from "@/components/progression/RankEmblem";
import { rankProgress, rankDisplay } from "@/domain/progression/rank";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { Loading, EmptyState } from "@/components/ui/States";
import {
  fetchMyRankPosition, fetchMyRegionalPosition, setMyRegion, fetchLedger, fetchMyPacks,
} from "@/lib/game/client";
import { RANK_REGIONS, REGION_LABEL, type RankRegion } from "@/domain/progression/rank";
import { isReward } from "@/domain/pickems/ledger";
import { groupCollection } from "@/store/selectors";
import { TOTAL_CARDS } from "@/data/catalog";

const AVATARS = ["🎮", "🦅", "🐉", "🔥", "👑", "⚡", "🎯", "🦊", "🐺", "🌟", "💎", "🃏"];

interface PickemSummary { events: number; points: number; correct: number; total: number }

export default function CuentaPage() {
  const { configured, loading, user, profile, signOut, refreshProfile } = useAuth();
  const { toast, notify } = useToast();
  const [savingAvatar, setSavingAvatar] = useState<string | null>(null);

  const ownedCards = useGameStore((s) => s.ownedCards);

  const [position, setPosition] = useState<number | null>(null);
  const [regionPosition, setRegionPosition] = useState<number | null>(null);
  const [savingRegion, setSavingRegion] = useState(false);
  const [rewards, setRewards] = useState(0);
  const [packs, setPacks] = useState(0);
  const [pickems, setPickems] = useState<PickemSummary>({ events: 0, points: 0, correct: 0, total: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  /*
   * LA VITRINA DE PRESTIGIO (Fase 14). Es lo que convierte la ficha en identidad: el rango
   * dice lo bien que juegas y la coleccion lo mucho que tienes, pero el prestigio dice a QUE
   * le has dedicado creditos, que es una eleccion y no un numero.
   *
   * Falla en silencio y no bloquea nada: el perfil no puede quedarse en blanco porque una
   * vitrina no haya llegado.
   */
  const [prestige, setPrestige] = useState<PrestigeView | null>(null);
  useEffect(() => {
    if (!user) { setPrestige(null); return; }
    let alive = true;
    fetchPrestige()
      .then((v) => { if (alive) setPrestige(v); })
      .catch(() => { if (alive) setPrestige(null); });
    return () => { alive = false; };
  }, [user]);

  const loadStats = useCallback(async () => {
    if (!user) return;
    setStatsLoading(true);
    try {
      const sb = getSupabase();
      const [pos, regPos, ledger, myPacks] = await Promise.all([
        fetchMyRankPosition(profile?.points ?? 0),
        fetchMyRegionalPosition(profile?.points ?? 0, profile?.region ?? null),
        fetchLedger(100),
        fetchMyPacks(),
      ]);
      setPosition(pos);
      setRegionPosition(regPos);
      setRewards(ledger.filter((r) => isReward(r.reason)).length);
      setPacks(Object.values(myPacks).reduce((s, n) => s + n, 0));

      if (sb) {
        const { data } = await sb.from("pickem_scores")
          .select("points, correct, total").eq("user_id", user.id);
        const rows = (data as { points: number; correct: number; total: number }[]) ?? [];
        setPickems({
          events: rows.length,
          points: rows.reduce((s, r) => s + r.points, 0),
          correct: rows.reduce((s, r) => s + r.correct, 0),
          total: rows.reduce((s, r) => s + r.total, 0),
        });
      }
    } finally {
      setStatsLoading(false);
    }
  }, [user, profile?.points]);

  useEffect(() => { if (user) loadStats(); }, [user, loadStats]);

  async function setAvatar(avatar: string) {
    if (!user) return;
    setSavingAvatar(avatar);
    const { error } = await getSupabase()!.from("profiles").update({ avatar }).eq("id", user.id);
    await refreshProfile();
    setSavingAvatar(null);
    notify(error ? "No se pudo cambiar el avatar" : "Avatar actualizado", !error);
  }

  if (!configured) {
    return (
      <section className="animate-rise">
        <Header />
        <EmptyState
          icon="📦"
          title="Modo local"
          hint="Estás jugando con tu progreso guardado en este dispositivo. Para competir en torneos, Pick'ems y clasificación hace falta una cuenta online."
        />
      </section>
    );
  }

  if (loading) return <><Header /><Loading label="Cargando tu perfil" /></>;

  if (!user || !profile) {
    return (
      <section className="animate-rise">
        <Header />
        <AuthForms />
      </section>
    );
  }

  const distinct = groupCollection(ownedCards).size;
  const accuracy = pickems.total > 0 ? Math.round((pickems.correct / pickems.total) * 100) : null;

  const points = profile.points ?? 0;
  const rank = rankProgress(points);
  const display = rankDisplay(points, position);

  /*
   * Lo que el jugador lleva puesto. `profiles.equipped` lo escribe SOLO el servidor
   * (`app_equip_cosmetic`, migracion 0022) y el trigger guardian lo cierra al cliente, asi
   * que aqui basta con leerlo y traducirlo a algo que se pueda ver.
   */
  const look = equippedDefs(
    (profile as unknown as { equipped?: Record<string, string> } | null)?.equipped,
  );

  /*
   * Las cuatro mejores cartas: mayor rareza y, a igualdad, mayor media. Sale del store que
   * la pantalla ya tenia cargado -`ownedCards`-, asi que no hay ni una lectura nueva.
   */
  const showcase = (() => {
    const seen = new Set<string>();
    return ownedCards
      .map((o) => ({ owned: o, def: getCard(o.cardId) }))
      .filter((x): x is { owned: typeof ownedCards[number]; def: NonNullable<ReturnType<typeof getCard>> } => !!x.def)
      .filter((x) => (seen.has(x.def.id) ? false : (seen.add(x.def.id), true)))
      .sort((a, b) =>
        getVariant(b.def.variantId).rank - getVariant(a.def.variantId).rank || b.def.ovr - a.def.ovr)
      .slice(0, 4);
  })();

  return (
    <section className="animate-rise space-y-8">
      {/* ═══════════════ LA FICHA ═══════════════ */}
      <div
        className="nx-stage nx-stage-grid nx-clip relative overflow-hidden"
        style={{ ["--nx-tint" as string]: hexToRgbTriplet(display.color) }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(680px 340px at 12% 116%, ${display.color}3a, transparent 66%)`,
          }}
        />

        <div className="relative flex flex-wrap items-center gap-x-7 gap-y-5 px-5 py-7 sm:px-9 sm:py-9">
          {/* Emblema de rango: la pieza grande de la ficha. */}
          <RankEmblem
            tierId={display.champion ? "nexus" : rank.tier.id}
            color={display.color}
            champion={display.champion}
            division={rank.division}
            divisions={rank.tier.divisions}
            size={112}
            className="shrink-0 drop-shadow-[0_10px_28px_rgba(0,0,0,0.75)]"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="nx-clip-sm px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{ background: `${display.color}22`, color: display.color }}
              >
                {display.label}
              </span>
              {profile.region && (
                <span className="nx-label">{REGION_LABEL[profile.region as RankRegion]}</span>
              )}
            </div>

            <h1 className="mt-2 flex flex-wrap items-center gap-3 break-words font-display text-[clamp(28px,6vw,52px)] font-bold uppercase leading-none text-white">
              {profile.username}
              {/*
                EL BANDERIN EQUIPADO (Fase 12). La Fase 11 dejo equipar cosmeticos y no
                habia donde verlos: un aspecto invisible es un producto que no existe, y el
                carril de pago del pase reparte exclusivamente aspecto.
              */}
              {look.banderin && (
                <span
                  className="nx-clip-sm inline-flex items-center gap-1.5 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ background: `${look.banderin.color}22`, color: look.banderin.color }}
                  title={`Banderín: ${look.banderin.label}`}
                >
                  <span aria-hidden>{look.banderin.glyph ?? "⬢"}</span>
                  {look.banderin.label}
                </span>
              )}
            </h1>

            {/* El titulo equipado, justo debajo del nombre: es donde se lee un titulo. */}
            {(look.titulo || look.insignia) && (
              <p className="mt-1 flex flex-wrap items-center gap-2.5">
                {look.titulo && (
                  <span
                    className="font-display text-[13px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: look.titulo.color }}
                  >
                    {look.titulo.label}
                  </span>
                )}
                {/*
                  LA INSIGNIA DE MAESTRIA (Fase 13). Es lo unico del perfil que dice algo
                  sobre la COLECCION y no sobre el rango: «tengo el equipo entero» es un
                  logro distinto de «he subido a Platino», y merece verse al lado.
                */}
                {look.insignia && (
                  <span
                    className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: look.insignia.color }}
                    title={`Insignia: ${look.insignia.label}`}
                  >
                    <span aria-hidden>{look.insignia.glyph ?? "◆"}</span>
                    {look.insignia.label}
                  </span>
                )}
              </p>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[13px] text-white/50">
              <span>Nivel {profile.level}</span>
              <span aria-hidden>·</span>
              <span>{formatCredits(profile.xp)} XP</span>
              {position != null && (<><span aria-hidden>·</span><span>#{position} del mundo</span></>)}
              {regionPosition != null && profile.region && (
                <><span aria-hidden>·</span><span>#{regionPosition} de {REGION_LABEL[profile.region as RankRegion]}</span></>
              )}
            </p>

            {/* Progreso de rango, dentro de la ficha y no en una tarjeta aparte. */}
            {rank.unranked ? (
              <p className="mt-4 max-w-md text-[13px] text-white/55">
                Todavía no has puntuado. Acierta una predicción y entras en la escalera.
              </p>
            ) : (
              <div className="mt-4 max-w-lg">
                <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-slow ease-out"
                    style={{
                      width: `${Math.round(rank.progress * 100)}%`,
                      background: `linear-gradient(90deg, ${display.color}77, ${display.color})`,
                      boxShadow: `0 0 14px ${display.color}aa`,
                    }}
                  />
                </div>
                <p className="nx-label mt-2">
                  {rank.next
                    ? `${rank.toNext} puntos para ${rank.next.label}`
                    : display.champion ? "Primero del mundo" : "Rango máximo alcanzado"}
                </p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3">
            {/*
              El avatar, con su MARCO equipado alrededor. El marco no sustituye al emoji
              elegido a mano: lo enmarca. Y si hay un avatar cosmetico equipado, ese manda
              sobre el emoji, porque es lo que el jugador ha desbloqueado y elegido.
            */}
            <span
              className="nx-plate nx-clip-sm grid h-16 w-16 place-items-center text-3xl"
              style={look.marco ? {
                boxShadow: `0 0 0 2px ${look.marco.color}, 0 0 18px ${look.marco.color}66`,
              } : undefined}
              aria-label={
                look.avatar
                  ? `Avatar: ${look.avatar.label}${look.marco ? ` con marco ${look.marco.label}` : ""}`
                  : `Avatar: ${profile.avatar}`
              }
            >
              {look.avatar
                ? <span style={{ color: look.avatar.color }} aria-hidden>{look.avatar.glyph ?? "◆"}</span>
                : profile.avatar}
            </span>
            {(look.marco || look.avatar) && (
              <span className="nx-label text-[9px]">
                {[look.avatar?.label, look.marco?.label].filter(Boolean).join(" · ")}
              </span>
            )}
            <button
              onClick={() => signOut()}
              className="nx-clip-sm border border-white/15 px-3.5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 transition hover:border-white/35 hover:text-white"
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/*
          ═══ LAS CIFRAS ═══
          Esto eran ocho tarjetas de igual peso. Un dato de videojuego no vive en una caja:
          vive sobre la ficha, con su etiqueta encima. Mismos ocho datos y mismos destinos.
        */}
        {statsLoading ? (
          <Loading label="Cargando estadísticas" className="min-h-[10vh]" />
        ) : (
          <div className="relative flex flex-wrap gap-x-8 gap-y-5 border-t border-white/10 bg-black/30 px-5 py-4 sm:px-9">
            <Readout label="Puntos" value={String(points)} accent="#ffd35c" href="/ranking" />
            <Readout label="Torneos" value={String(pickems.events)} href="/pickems" />
            <Readout
              label="Aciertos"
              value={pickems.total > 0 ? `${pickems.correct}/${pickems.total}` : "—"}
              foot={accuracy != null ? `${accuracy}% de acierto` : undefined}
            />
            <Readout label="Recompensas" value={String(rewards)} href="/recompensas" />
            <Readout
              label="Colección" value={String(distinct)} suffix={`/${TOTAL_CARDS}`}
              foot={`${ownedCards.length} cartas`} accent="#7b5cff" href="/coleccion"
            />
            <Readout label="Sobres" value={String(packs)} href={packs > 0 ? "/inventario" : "/tienda"} />
            <Readout label="Créditos" value={formatCredits(profile.credits)} accent="#ffd35c" />
            <Readout label="Fichas" value={formatCredits(profile.tokens)} accent="#19e3ff" />
          </div>
        )}
      </div>

      {/*
        VITRINA DE PRESTIGIO — entre la ficha y las cartas. Va aqui porque responde a
        «quien es este jugador», que es la pregunta de la parte de arriba, y no a «que
        tiene», que es la de abajo. Como mucho seis: una vitrina con veinte piezas deja
        de ser una vitrina.
      */}
      {prestige && prestige.owned.length > 0 && (
        <section aria-label="Prestigio">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="nx-label">Prestigio</h2>
            <span className="nx-label text-[9px]">
              {prestige.totals.purchased} de {prestige.totals.eligible} insignias mejoradas
            </span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {prestige.owned.slice(0, 6).map((o) => (
              <li
                key={o.baseId}
                className="nx-clip-sm flex items-center gap-2 border px-3.5 py-2.5"
                style={{ borderColor: `${o.color}55`, background: `${o.color}14` }}
                title={`${o.label} · ${o.tierLabel}`}
              >
                <span aria-hidden className="text-[15px]" style={{ color: o.color }}>◈</span>
                <span>
                  <span className="block font-display text-[12.5px] font-bold uppercase tracking-[0.05em] text-white">
                    {o.label}
                  </span>
                  <span
                    className="block font-display text-[9px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: o.color }}
                  >
                    {o.tierLabel}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ═══════════════ VITRINA ═══════════════ */}
      {showcase.length > 0 && (
        <section aria-label="Lo mejor de tu colección">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="nx-label">Lo mejor de tu colección</h2>
            <Link href="/coleccion" className="nx-action">Ver todas →</Link>
          </div>
          <div className="flex flex-wrap gap-4">
            {showcase.map((c, i) => {
              const v = getVariant(c.def.variantId);
              return (
                <Card3D
                  key={c.owned.uid}
                  /*
                    El halo continuo (`legendary`) solo lo lleva LA MEJOR. Con cuatro cartas
                    de rareza alta una al lado de otra, cuatro halos pulsando se funden en
                    una mancha: el efecto que debía decir «esta es especial» dejaba de
                    distinguir nada y ademas costaba cuatro repintados en bucle.
                  */
                  mode={i === 0 && v.rank >= 5 ? "legendary" : "hover"}
                  glow={v.palette.primary}
                  delay={card3DStagger(i, 0.07, 0.3)}
                  className="w-[132px] sm:w-[150px]"
                >
                  <PlayerCard card={c.def} size="sm" serial={c.owned.serial} interactive={false} />
                </Card3D>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ AJUSTES ═══════════════ */}
      {/*
        Avatar y región son CONFIGURACIÓN, y por eso van al final. Estaban por delante de
        las estadísticas —doce emoji desplegados nada más entrar— y eso es lo que hacía que
        el perfil se leyera como la pantalla de ajustes de una cuenta.
      */}
      <section aria-label="Ajustes del perfil" className="nx-panel space-y-6 p-5">
        <h2 className="font-display text-lg font-bold uppercase tracking-[0.06em] text-white">Ajustes</h2>

        <div>
          <h3 className="nx-label mb-2">Avatar</h3>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                disabled={savingAvatar !== null}
                aria-label={`Elegir avatar ${a}`}
                aria-pressed={profile.avatar === a}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-lg border text-xl transition disabled:opacity-50",
                  profile.avatar === a ? "border-drl bg-drl/15" : "border-white/10 bg-white/5 hover:bg-white/10",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/*
          ── Región competitiva ──
          La declara el usuario; el servidor no puede saberla y adivinarla sería inventar
          un dato. Sin región se compite en la clasificación global y no en la regional,
          y eso es exactamente lo que dice el texto de abajo.
        */}
        <div>
          <h3 className="nx-label mb-2">Región competitiva</h3>
          <div className="flex flex-wrap gap-1.5">
            {RANK_REGIONS.map((rg) => (
              <button
                key={rg}
                type="button"
                disabled={savingRegion}
                aria-pressed={profile.region === rg}
                onClick={async () => {
                  setSavingRegion(true);
                  try {
                    // Volver a pulsar la región activa la retira: es reversible.
                    const next: RankRegion | null = profile.region === rg ? null : rg;
                    await setMyRegion(next);
                    await refreshProfile();
                    notify(next ? `Región: ${REGION_LABEL[next]}` : "Región retirada", true);
                  } catch (e) {
                    notify(e instanceof Error ? e.message : "No se pudo guardar", false);
                  } finally {
                    setSavingRegion(false);
                  }
                }}
                className={cn(
                  "rounded-control border px-3.5 py-2 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast disabled:opacity-50",
                  profile.region === rg
                    ? "border-drl-cyan/60 bg-drl-cyan/10 text-drl-cyan"
                    : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/80",
                )}
              >
                {REGION_LABEL[rg]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-white/45">
            {profile.region
              ? `Apareces en la clasificación de ${REGION_LABEL[profile.region]} y en la global.`
              : "Sin región solo apareces en la clasificación global. Elige una para entrar también en la regional."}
          </p>
        </div>
      </section>

      <p className="text-xs text-white/35">
        Tu saldo, tus cartas, tus puntos y tu rango los guarda y los valida el servidor.
        Nada de esto se puede modificar desde este dispositivo.
      </p>

      <Toast toast={toast} />
    </section>
  );
}

/**
 * Un color hexadecimal a los tres componentes que espera `--nx-tint`. La ficha se tiñe con
 * el color del RANGO: el tinte de contexto de la sección («progreso», cian) valdría para
 * cualquier pantalla, y esta tiene que decir de qué rango es antes de leer la etiqueta.
 */
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Un dato de la ficha. Etiqueta encima, cifra grande, pie opcional. Sin caja. */
function Readout({
  label, value, suffix, foot, accent = "#eef1f8", href,
}: {
  label: string;
  value: string;
  suffix?: string;
  foot?: string;
  accent?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="nx-label block">{label}</span>
      <span className="nx-readout mt-1 block text-[22px]" style={{ color: accent }}>
        {value}
        {suffix && <span className="text-[13px] text-white/30">{suffix}</span>}
      </span>
      {foot && <span className="mt-1 block text-[11px] text-white/40">{foot}</span>}
    </>
  );
  return href
    ? <Link href={href} className="group min-w-[92px]">{body}</Link>
    : <div className="min-w-[92px]">{body}</div>;
}

function Header() {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
        Mi <span className="text-drl">Perfil</span>
      </h1>
      <p className="mt-1 text-white/50">Tu progreso competitivo de un vistazo.</p>
    </header>
  );
}
