"use client";

/**
 * HERO COMPETITIVO (Fase 28). El rating REAL es el protagonista; la posición solo si existe (nunca
 * «#0»); percentil solo con población suficiente; provisional solo porque el backend lo define
 * (< 10 partidas liquidadas, K 40). Sin divisiones ni tiers: el competitivo es rating + escalera.
 */
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { Stage } from "@/components/ui/Surface";
import type { CompetitiveSelf, CompetitiveStats } from "@/server/services/competitive";
import type { RatingPoint } from "@/domain/pvpLadder/ladder";
import { RecentForm } from "./RecentForm";
import { PlayButton } from "@/components/ui/game/PlayButton";

/** Fase 44 · emblema de rating: la cifra REAL dentro de un hexágono de la casa. Sin tiers ni divisiones inventadas. */
function RatingEmblem({ rating, provisional }: { rating: number; provisional: boolean }) {
  return (
    <div className="relative grid h-[150px] w-[150px] shrink-0 place-items-center sm:h-[176px] sm:w-[176px]" aria-hidden data-testid="rating-emblem">
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <polygon points="100,6 182,53 182,147 100,194 18,147 18,53" fill="rgba(255,46,99,0.08)" stroke="rgba(255,46,99,0.7)" strokeWidth="2" />
        <polygon points="100,26 164,63 164,137 100,174 36,137 36,63" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray={provisional ? "6 6" : undefined} />
      </svg>
      <span className="relative text-center">
        <span className="nx-label block !text-white/55">Rating</span>
        <span className="nx-readout block text-[46px] leading-none text-white sm:text-[54px]" style={{ textShadow: "0 0 28px rgba(255,46,99,0.55)" }}>{rating}</span>
      </span>
    </div>
  );
}

export function CompetitiveHero({ self, stats, last, className, cta = true }: { self: CompetitiveSelf; stats: CompetitiveStats; last: RatingPoint | null; className?: string; cta?: boolean }) {
  const r = self.rating;
  const ranked = self.position !== null;
  return (
    <Stage tone="primary" grid className={`relative overflow-hidden p-5 sm:p-7 ${className ?? ""}`} data-scene="competitive-hero" data-position={self.position ?? "unranked"}>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-wrap items-center gap-5">
        <RatingEmblem rating={r.rating} provisional={r.provisional} />
        <div className="min-w-0">
          <span className="nx-label">Ranked · duelos PvP</span>
          <div className="mt-1 flex flex-wrap items-end gap-x-5 gap-y-2">
            <div className="sr-only">
              <span className="nx-label block !text-white/45">Rating</span>
              <span className="nx-readout block text-[clamp(44px,8vw,72px)] leading-none text-white" data-rating={r.rating}>{r.rating}</span>
            </div>
            <div>
              <span className="nx-label block !text-white/45">Posición</span>
              {ranked ? (
                <span className="nx-readout block text-[clamp(28px,5vw,44px)] leading-none text-drl-cyan" data-field="position">#{self.position}</span>
              ) : (
                <span className="block font-display text-[clamp(16px,3vw,22px)] font-bold uppercase leading-none text-white/60" data-field="position">Sin clasificar</span>
              )}
              {ranked && <span className="nx-label mt-1 block">de {self.rankedTotal}{self.percentile !== null ? ` · Top ${self.percentile} %` : ""}</span>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {r.provisional && (
              <Badge tone="warn" dot>Provisional · {r.gamesPlayed} / {self.placementGames} partidas</Badge>
            )}
            {last && (
              <Badge tone={last.delta >= 0 ? "ok" : "bad"}>Última partida {last.delta >= 0 ? "+" : ""}{last.delta}</Badge>
            )}
            {self.highestRating !== null && self.highestRating > r.rating && (
              <Badge tone="muted">Máximo {self.highestRating}</Badge>
            )}
          </div>
        </div>
        </div>
        {cta && (
          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto">
            {/* Fase 44 · JUGAR RANKED es la acción de juego de esta pantalla: misma pieza que JUGAR. */}
            <PlayButton cta={{ kind: "play", label: "Jugar ranked", href: "/duelos/pvp", ariaLabel: "Jugar ranked: buscar rival", hint: null }} size="hero" testId="ranked-play" className="w-full sm:w-auto [&>a]:w-full" />
            {!ranked && <span className="text-center text-caption text-ink-muted">Una partida liquidada te pone en la escalera.</span>}
          </div>
        )}
      </div>

      {/* Móvil: las tres cifras en una fila y la forma debajo a todo el ancho; escritorio: una sola fila. */}
      <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-[auto_auto_auto_1fr] sm:items-end">
        <Readout size="sm" label="Récord" value={`${stats.wins}–${stats.losses}${stats.draws > 0 ? `–${stats.draws}` : ""}`} tone="var(--nx-ok)" />
        <Readout size="sm" label="Winrate" value={stats.winrate !== null ? `${stats.winrate} %` : "—"} />
        <Readout size="sm" label="Partidas" value={stats.matches} />
        <div className="col-span-3 sm:col-span-1"><RecentForm form={stats.form} streak={stats.streak} /></div>
      </div>
      {ranked && self.pointsToAbove !== null && self.pointsToAbove > 0 && (
        <p className="mt-3 text-caption text-ink-secondary" data-field="to-above">
          Te faltan <b className="nx-readout text-white">{self.pointsToAbove}</b> puntos para pasar al #{(self.position ?? 1) - 1}.
        </p>
      )}
      {r.provisional && (
        <p className="mt-2 text-caption text-ink-faint">Mientras eres provisional tu rating se mueve más deprisa (K 40 frente a 24). Sales de provisional al liquidar {self.placementGames} partidas.</p>
      )}
    </Stage>
  );
}
