"use client";

/**
 * F84 · HÉROE RANKED 2.0. De un vistazo: ¿qué RANGO tengo (tier + división)? ¿con qué rating? ¿en qué puesto del Top?
 * ¿cuánto me falta para la siguiente división? En colocación, X / N partidas (el rango no se enseña hasta cerrarla).
 *
 * Todo sale del `CompetitiveSnapshot` del servidor: el rango lo derivó el servidor del rating canónico con la versión de
 * fronteras de la temporada; el puesto es el de la clasificación (vista `competitive_ladder`). Aquí no se calcula nada.
 * (F55 contaba el «rango» como puesto de la escalera; el puesto sigue aquí, como dato del Top.)
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import type { CompetitiveSelf, CompetitiveStats, CompetitiveBlock } from "@/server/services/competitive";
import { rankChip } from "@/domain/ranked/config";
import { ladderStanding, positionLabel, type StandingEntry } from "@/domain/pvpLadder/ranked";
import { CompetitiveEmblem } from "./CompetitiveEmblem";

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions).format(n);

export function RankedHero({ self, stats, rows, competitive, className }: { self: CompetitiveSelf; stats: CompetitiveStats; rows: StandingEntry[]; competitive: CompetitiveBlock; className?: string }) {
  const reduced = useReducedMotion();
  const { standing, season, eligibility } = competitive;
  const rank = standing.rank;
  const chip = rank ? rankChip(rank) : null;
  const st = ladderStanding({ rating: self.rating.rating, gamesPlayed: self.rating.gamesPlayed, position: self.position, rankedTotal: self.rankedTotal, pointsToAbove: self.pointsToAbove }, rows);
  const accent = rank?.color ?? (standing.state === "PLACEMENT" ? "#19e3ff" : "#ff2e63");
  const title = standing.state === "RANKED" && rank ? rank.tierName : standing.state === "PLACEMENT" ? "Colocación" : "Sin clasificar";
  const division = standing.state === "RANKED" && rank?.division ? ["", "I", "II", "III"][rank.division] : null;

  return (
    <section
      aria-label="Tu rango competitivo"
      className={cn("nx-clip relative isolate flex flex-col justify-between gap-6 overflow-hidden border p-5 sm:p-7", className)}
      style={{ borderColor: `${accent}44`, background: `radial-gradient(90% 120% at 12% 0%, ${accent}2e, transparent 60%), radial-gradient(70% 90% at 100% 100%, rgba(25,227,255,0.07), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.35))` }}
      data-scene="ranked-hero" data-state={standing.state} data-tier={rank?.tierId ?? "none"} data-position={self.position ?? "none"}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]" style={{ backgroundImage: "repeating-linear-gradient(115deg, #fff 0 1px, transparent 1px 22px)" }} />
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex flex-col items-center gap-1.5">
          <CompetitiveEmblem rank={chip} state={standing.state} placement={standing.placement} size="xl" position={self.position} />
          {self.position !== null && (
            <span className="nx-clip-sm border px-2.5 py-0.5 nx-readout text-[15px] text-white" style={{ borderColor: `${accent}88`, background: `${accent}22` }} data-field="top-position">
              Top {season?.top.size ?? 500} · {positionLabel(self.position)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="nx-label" style={{ color: accent }}>Competitivo · {season?.name ?? "Ranked PvP"}</p>
          <h1 className="mt-1 font-display text-[clamp(34px,6vw,62px)] font-bold uppercase leading-[0.9] tracking-wide text-white" data-field="rank-title">
            {title}{division && <span className="ml-3 align-top text-[0.62em]" style={{ color: accent }} data-field="rank-division">{division}</span>}
          </h1>
          <div className="mt-3 flex flex-wrap items-end justify-center gap-x-6 gap-y-2 sm:justify-start">
            <div>
              <span className="nx-label block !text-white/50">Rating</span>
              <span className="nx-readout block text-[clamp(32px,5vw,48px)] leading-none text-white" data-field="rating" style={{ textShadow: `0 0 24px ${accent}66` }}>{self.rating.rating}</span>
            </div>
            {self.position !== null && (
              <div>
                <span className="nx-label block !text-white/50">Clasificación</span>
                <span className="nx-readout block text-[22px] leading-none text-drl-cyan" data-field="position">{positionLabel(self.position)}<span className="text-[14px] text-white/45"> de {fmt(self.rankedTotal)}</span></span>
              </div>
            )}
            {standing.peakRank && (
              <div>
                <span className="nx-label block !text-white/50">Mejor rango</span>
                <span className="nx-readout block text-[18px] leading-none" style={{ color: standing.peakRank.color }} data-field="peak-rank">{standing.peakRank.label}</span>
              </div>
            )}
          </div>

          {standing.state === "RANKED" && rank && (
            <div className="mt-5" data-testid="division-progress">
              {rank.ceil !== null && rank.progress !== null ? (
                <>
                  <div className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="text-white/60">{rank.label} · {rank.floor}</span>
                    <span className="text-white/60">{rank.nextLabel} · {rank.ceil}</span>
                  </div>
                  <div className="nx-clip-sm relative mt-1 h-2.5 overflow-hidden bg-white/10" role="progressbar" aria-label={`Progreso hacia ${rank.nextLabel}`} aria-valuemin={rank.floor} aria-valuemax={rank.ceil} aria-valuenow={self.rating.rating}>
                    <motion.div className="absolute inset-y-0 left-0" style={{ background: `linear-gradient(90deg, ${accent}aa, ${accent})` }}
                      initial={{ width: reduced ? `${rank.progress * 100}%` : "0%" }} animate={{ width: `${Math.max(3, rank.progress * 100)}%` }} transition={{ duration: reduced ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-white/75" data-field="to-next"><b className="nx-readout" style={{ color: accent }}>+{rank.pointsToNext}</b> de rating para {rank.nextLabel}.</p>
                </>
              ) : (
                <p className="text-[12.5px] text-drl-gold" data-field="to-next">Estás en la Cumbre: la élite. Tu puesto en el Top es lo que queda por defender.</p>
              )}
            </div>
          )}

          {standing.state !== "RANKED" && (
            <div className="mt-5" data-testid="placement">
              <p className="flex items-baseline justify-between gap-2">
                <span className="nx-label !text-drl-cyan">Partidas de colocación</span>
                <span className="nx-readout text-[15px] text-white" data-field="placement">{standing.placement.played} / {standing.placement.total}</span>
              </p>
              <ol className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${standing.placement.total}, minmax(0, 1fr))` }} aria-label={`Colocación: ${standing.placement.played} de ${standing.placement.total} partidas jugadas`}>
                {Array.from({ length: standing.placement.total }, (_, i) => (
                  <li key={i} className={cn("nx-clip-sm h-2.5", i < standing.placement.played ? "bg-drl-cyan" : "bg-white/10")} />
                ))}
              </ol>
              <p className="mt-1.5 text-[12px] text-white/60">
                {standing.state === "UNRANKED"
                  ? `Juega ${standing.placement.total} partidas ranked esta temporada para obtener tu rango. Tu rating actual (${self.rating.rating}) es el punto de partida.`
                  : `Te ${standing.placement.remaining === 1 ? "falta 1 partida" : `faltan ${standing.placement.remaining} partidas`}: al terminar se revela tu rango. Tu rating ya se mueve con cada partida.`}
              </p>
            </div>
          )}

          {standing.state === "RANKED" && self.position === null && eligibility && !eligibility.eligible && (
            <p className="mt-3 text-[12px] text-white/55" data-field="top-missing">Para entrar en el Top {season?.top.size ?? 500}: {eligibility.missing.join(" · ")}.</p>
          )}
          {self.position !== null && st.above && (
            <p className="mt-2 text-[12px] text-white/60" data-field="to-above"><b className="nx-readout text-drl-cyan">+{st.above.gap}</b> para superar a <b className="text-white">{st.above.username}</b> ({positionLabel(st.above.position)}).</p>
          )}
          {self.position === 1 && <p className="mt-2 text-[12px] text-drl-gold" data-field="to-above">Eres el número 1 de la clasificación. Defiéndelo.</p>}
        </div>
      </div>
      <StatStrip competitive={competitive} stats={stats} highest={self.highestRating} />
    </section>
  );
}

/** Récord de la TEMPORADA competitiva (servidor) + forma reciente real + mejor rating del libro. Nunca K/D ni MVP. */
function StatStrip({ competitive, stats, highest, className }: { competitive: CompetitiveBlock; stats: CompetitiveStats; highest: number | null; className?: string }) {
  const r = competitive.standing.record;
  const items: { k: string; label: string; value: string; tone?: string }[] = [
    { k: "matches", label: "Partidas · temporada", value: fmt(r.matches) },
    { k: "wins", label: "Victorias", value: fmt(r.wins), tone: "text-ok" },
    { k: "losses", label: "Derrotas", value: fmt(r.losses), tone: "text-drl-glow" },
    ...(r.draws > 0 ? [{ k: "draws", label: "Empates", value: fmt(r.draws) }] : []),
    { k: "winrate", label: "% victorias", value: r.winrate !== null ? `${r.winrate}%` : "—" },
    ...(stats.streak && stats.streak.n >= 2 && stats.streak.kind !== "D"
      // La forma reciente cubre las últimas 10 partidas: una racha de 10 es «al menos 10», no «10».
      ? [{ k: "streak", label: "Racha", value: `${stats.streak.n >= 10 ? "≥ 10" : stats.streak.n} ${stats.streak.kind === "W" ? "victorias" : "derrotas"}`, tone: stats.streak.kind === "W" ? "text-ok" : "text-drl-glow" }] : []),
    ...(highest !== null ? [{ k: "best", label: "Mejor rating", value: String(highest), tone: "text-drl-gold" }] : []),
  ];
  return (
    <dl className={cn("grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(104px,1fr))]", className)} data-testid="ranked-stats">
      {items.map((it) => (
        <div key={it.k} className="nx-clip-sm border border-white/[0.08] bg-black/25 px-3 py-2" data-stat={it.k}>
          <dt className="nx-label !text-[9.5px] !text-white/45">{it.label}</dt>
          <dd className={cn("nx-readout mt-0.5 truncate text-[18px] leading-none text-white", it.tone)}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
