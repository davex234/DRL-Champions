"use client";

/**
 * PASE DE BATALLA — `/temporada/pase` (Battle Pass cleanup, 2026-10-07).
 *
 * TEMPORADA → NIVEL + XP → TRACK DE RECOMPENSAS → RECLAMAR. Nada más: Objetivos, Crafteo, ranked, eventos, colección,
 * calendario y logros viven en sus secciones (el hub `/temporada` las separa). Presentación pura sobre la vista CANÓNICA
 * del pase (`ProgressionView`) y el modelo `passRows`; el reclamo lo hace la página con `claimPassLevel` (servidor).
 *
 *   · Cabecera compacta: temporada, nivel, XP, GRATIS/PREMIUM y, si no tienes el
 *     premium, su estado REAL (con pagos apagados: «próximamente», sin botón de compra).
 *   · Track: en móvil, filas de nivel apiladas (nada de tabla aplastada); desde `md`, columnas que se desplazan en
 *     horizontal con imán y arrancan centradas en tu nivel. Cada recompensa dice su carril, su recompensa real
 *     (`RewardDisplay`) y su estado con texto e icono — BLOQUEADO / RECLAMAR / RECLAMADO —, no solo con color.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { ROUTES } from "@/design/nav";
import { Meter } from "@/components/ui/Meter";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { PASS_PRODUCT, PAYMENTS_ENABLED, formatPrice } from "@/config/monetization";
import { PASS_LANES, claimableCount, passRows, type PassLane } from "@/domain/season/battlePass";
import type { PassTrack, ProgressionView } from "@/lib/progression/client";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("season");

const fmt = (n: number) => n.toLocaleString(getIntlLocale(), { useGrouping: "always" } as Intl.NumberFormatOptions);
/** Tinte de cada carril («r,g,b»), en el orden de `PASS_LANES`: gratis cian, competitivo magenta, premium oro. */
const LANE_TINT = Object.fromEntries(PASS_LANES.map((l, i) => [l.track, ["25,227,255", "255,46,99", "255,211,92"][i]])) as Record<PassTrack, string>;

function LockIcon() {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
}
function CheckIcon() {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

function LaneCell({ lane, level, busyKey, onClaim }: { lane: PassLane; level: number; busyKey: string | null; onClaim: (level: number, track: PassTrack) => void }) {
  useLocale();
  const key = `${lane.track}:${level}`;
  const tint = LANE_TINT[lane.track];
  return (
    <div
      data-lane={lane.track}
      data-state={lane.state}
      className={cn("relative flex min-h-[132px] flex-col gap-2 px-3 py-3", lane.state === "LOCKED" && "opacity-60")}
      style={{
        background: lane.state === "AVAILABLE" ? `linear-gradient(180deg, rgba(${tint},0.22), rgba(${tint},0.06))` : "rgba(255,255,255,0.025)",
        boxShadow: `inset 0 0 0 1px rgba(${tint},${lane.state === "AVAILABLE" ? 0.75 : 0.18})`,
      }}
    >
      <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: `rgb(${tint})` }}>{td(lane.label)}</span>
      <RewardDisplay reward={lane.reward} size="sm" dim={lane.state === "CLAIMED"} className="min-w-0 flex-1" />
      {lane.state === "AVAILABLE" ? (
        <button
          type="button"
          onClick={() => onClaim(level, lane.track)}
          disabled={busyKey !== null}
          aria-busy={busyKey === key}
          data-testid="pass-claim"
          className="nx-press nx-clip-sm min-h-[44px] w-full font-display text-[13px] font-bold uppercase tracking-[0.14em] text-[#07080e] transition hover:brightness-110 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{ background: `rgb(${tint})` }}
        >
          {busyKey === key ? t("Reclamando…") : t("Reclamar")}
        </button>
      ) : lane.state === "CLAIMED" ? (
        <span className="flex min-h-[44px] items-center gap-1.5 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-300" data-testid="pass-claimed"><CheckIcon />{t("Reclamado")}</span>
      ) : (
        <span className="flex min-h-[44px] items-center gap-1.5 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/60" data-testid="pass-locked"><LockIcon />{td(lane.lockReason)}</span>
      )}
    </div>
  );
}

export function BattlePassScreen({ view, busyKey, onClaim }: {
  view: ProgressionView;
  /** `track:nivel` que se está reclamando (un reclamo cada vez). */
  busyKey: string | null;
  onClaim: (level: number, track: PassTrack) => void;
}) {
  useLocale();
  const rows = passRows(view);
  const pending = claimableCount(view);
  const maxed = view.level >= view.season.maxLevel;
  const trackRef = useRef<HTMLOListElement>(null);

  // Desde `md` el track se desplaza en horizontal: arranca centrado en tu nivel (en móvil no se mueve la página).
  useEffect(() => {
    const el = trackRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const cur = el.querySelector<HTMLElement>('[data-current="true"]');
    if (cur) el.scrollLeft = Math.max(0, cur.offsetLeft - el.clientWidth / 2 + cur.clientWidth / 2);
  }, [view.level]);

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-5 px-4 pb-10 pt-5 md:px-8" data-testid="battle-pass" data-season={view.season.id}>
      {/* ═══ CABECERA ═══ */}
      <header
        className="nx-clip relative overflow-hidden px-5 py-5 sm:px-7"
        style={{ background: "radial-gradient(70% 160% at 0% 0%, rgba(255,211,92,0.18), transparent 60%), linear-gradient(160deg, rgba(14,16,26,0.92), rgba(6,7,13,0.96))", boxShadow: "inset 0 0 0 1px rgba(255,211,92,0.28)" }}
        data-testid="pass-header"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.24em] text-drl-gold">
              {t("Pase de batalla · Temporada actual")}
            </p>
            <h1 className="mt-1 font-display text-[clamp(26px,3.6vw,42px)] font-extrabold uppercase leading-none text-white" data-testid="pass-season">{td(view.season.name)}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="pass-tier" data-premium={view.premium ? "true" : "false"}
              className={cn("nx-clip-sm px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.16em]", view.premium ? "bg-drl-gold text-[#221703]" : "border border-white/25 text-white")}>
              {view.premium ? t("Premium") : t("Gratis")}
            </span>
            {!view.premium && (
              <span data-testid="pass-premium-offer" className="nx-clip-sm border border-drl-gold/35 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-gold/80">
                {td(PASS_PRODUCT.label)} · {formatPrice(PASS_PRODUCT.price)}{!PAYMENTS_ENABLED && (" " + t("· próximamente"))}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="font-display uppercase leading-none text-white" data-testid="pass-level" data-level={view.level}>
            <span className="text-[13px] font-bold tracking-[0.18em] text-white/60">{t("Nivel")} </span>
            <span className="nx-readout text-[34px] font-bold">{view.level}</span>
            <span className="text-[15px] text-white/45"> / {view.season.maxLevel}</span>
          </p>
          <div className="min-w-[200px] flex-1">
            <Meter value={maxed ? 100 : view.progress * 100} height={10} tone="info" label={t("XP del pase: {xpIntoLevel} de {xpForNext}", { xpIntoLevel: view.xpIntoLevel, xpForNext: view.xpForNext })} />
            <p className="mt-1.5 flex flex-wrap justify-between gap-x-4 text-[12px] text-white/60" data-testid="pass-xp" data-xp={view.xpIntoLevel} data-next={view.xpForNext}>
              <span className="nx-readout text-white">{maxed ? t("Pase completado") : t("{xpIntoLevel} / {xpForNext} XP", { xpIntoLevel: fmt(view.xpIntoLevel), xpForNext: fmt(view.xpForNext) })}</span>
              <Link href={ROUTES.objectives} className="nx-focus font-display font-bold uppercase tracking-[0.12em] text-drl-cyan hover:text-white" data-testid="pass-objectives-link">{t("Ver objetivos →")}</Link>
            </p>
          </div>
          {pending > 0 && (
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-drl-gold" data-testid="pass-pending" role="status">
              {pending === 1 ? t("1 recompensa por reclamar") : t("{pending} recompensas por reclamar", { pending })}
            </span>
          )}
        </div>
      </header>

      {/* ═══ TRACK DE RECOMPENSAS ═══ */}
      <section aria-label={t("Recompensas del pase")}>
        <ol
          ref={trackRef}
          data-testid="pass-track"
          className="flex flex-col gap-2 md:snap-x md:snap-mandatory md:flex-row md:gap-2.5 md:overflow-x-auto md:pb-3"
        >
          {rows.map((r) => (
            <li
              key={r.level}
              data-level={r.level}
              data-current={r.current ? "true" : undefined}
              data-reached={r.reached ? "true" : "false"}
              className={cn(
                "grid grid-cols-[64px_minmax(0,1fr)] gap-2 md:flex md:w-[208px] md:shrink-0 md:snap-center md:flex-col",
                r.current && "relative",
              )}
            >
              <div
                className={cn("flex flex-col items-center justify-center py-2 font-display uppercase md:flex-row md:gap-2 md:py-2.5",
                  r.reached ? "bg-white/[0.08] text-white" : "bg-white/[0.025] text-white/45")}
                style={r.current ? { boxShadow: "inset 0 0 0 2px #ffd35c" } : undefined}
              >
                <span className="text-[10px] font-bold tracking-[0.2em]">{t("Nivel")}</span>
                <span className="nx-readout text-[24px] font-bold leading-none">{r.level}</span>
                {r.current && <span className="mt-1 text-[9px] font-bold tracking-[0.16em] text-drl-gold md:mt-0">{t("Tú")}</span>}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                {r.lanes.map((lane) => <LaneCell key={lane.track} lane={lane} level={r.level} busyKey={busyKey} onClaim={onClaim} />)}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
