"use client";

/**
 * RECOMPENSAS COMPETITIVAS (Fase 28). Lo ÚNICO que el backend define: el carril COMPETITIVO del
 * pase (`CURRENT_SEASON.competitive`: 6 hitos, 26.000 créditos + 6 sobres premium), que se abre
 * al llegar a Oro (400 puntos de rango, `profiles.points`) y se reclama nivel a nivel en
 * «Logros y pase». No hay recompensas por rating PvP: no se inventan.
 *
 * Estados por autoridad real: Bloqueado · Disponible · Conseguido (`trackState`).
 */
import Link from "next/link";
import { trackState } from "@/components/progression/FreeTrack";
import { describeReward } from "@/components/progression/PassRail";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/format";
import type { CompetitiveRewards as Rewards } from "@/server/services/competitive";

export function CompetitiveRewards({ rewards, className }: { rewards: Rewards; className?: string }) {
  const available = rewards.levels.filter((l) => l.claimable).length;
  const earned = rewards.levels.filter((l) => l.claimed).length;
  return (
    <section aria-label="Recompensas competitivas" className={className} data-rewards={rewards.levels.length} data-unlocked={rewards.unlocked}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">
          Carril competitivo del pase · {earned} de {rewards.levels.length} conseguidas
          {available > 0 && <span className="ml-2 text-drl-gold">{available} disponible{available === 1 ? "" : "s"}</span>}
        </p>
        <Link href="/logros" className="nx-action">Reclamar en Logros y pase →</Link>
      </div>
      {!rewards.unlocked && (
        <p className="nx-clip-sm mb-2 border border-l-2 border-drl/40 border-l-drl bg-drl/[0.06] px-3 py-2 text-caption text-ink-secondary">
          Se abre al llegar a <b className="text-white">Oro</b> ({rewards.minPoints} puntos de rango). Llevas <b className="nx-readout text-white">{rewards.points}</b>: te faltan {Math.max(0, rewards.minPoints - rewards.points)}.
          Los puntos de rango se ganan en duelos contra el bot y en Pick&apos;ems; el rating PvP no da recompensas.
        </p>
      )}
      {rewards.levels.length === 0 ? (
        <p className="nx-clip-sm border-l-2 border-l-drl/60 bg-white/[0.03] px-4 text-left !text-[14px] !text-white/70 py-4 text-center text-caption text-ink-muted">No hay recompensas competitivas definidas.</p>
      ) : (
        <ol className="flex snap-x gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label="Hitos del carril competitivo">
          {rewards.levels.map((l) => {
            const state = trackState(l);
            const reached = l.level <= rewards.passLevel;
            return (
              <li key={l.level} data-level={l.level} data-state={state}
                className={cn("nx-clip-sm flex w-[150px] shrink-0 snap-center flex-col gap-1 border px-3 py-2.5",
                  state === "CONSEGUIDO" ? "border-ok/40 bg-ok/[0.06]" : state === "DISPONIBLE" ? "border-drl-gold/60 bg-drl-gold/[0.10]"
                    : reached ? "border-white/20 bg-white/[0.04]" : "border-white/[0.08] bg-white/[0.02] opacity-70")}>
                <span className="flex items-center justify-between">
                  <span className="nx-readout text-[15px] text-white">Nivel {l.level}</span>
                  <Badge tone={state === "CONSEGUIDO" ? "ok" : state === "DISPONIBLE" ? "gold" : "muted"}>
                    {state === "CONSEGUIDO" ? "Conseguido" : state === "DISPONIBLE" ? "Disponible" : "Bloqueado"}
                  </Badge>
                </span>
                <span className="text-[11.5px] leading-snug text-white/70">{describeReward(l.reward)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
