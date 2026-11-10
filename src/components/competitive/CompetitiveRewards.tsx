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
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("competitive");

export function CompetitiveRewards({ rewards, className }: { rewards: Rewards; className?: string }) {
  useLocale();
  const available = rewards.levels.filter((l) => l.claimable).length;
  const earned = rewards.levels.filter((l) => l.claimed).length;
  return (
    <section aria-label={t("Recompensas competitivas")} className={className} data-rewards={rewards.levels.length} data-unlocked={rewards.unlocked}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">
          {t("Carril competitivo del pase · {n} de {total} conseguidas", { n: earned, total: rewards.levels.length })}
          {available > 0 && <span className="ml-2 text-drl-gold">{t("{n, plural, one {# disponible} other {# disponibles}}", { n: available })}</span>}
        </p>
        <Link href="/logros" className="nx-action">{t("Reclamar en Logros y pase →")}</Link>
      </div>
      {!rewards.unlocked && (
        <p className="nx-clip-sm mb-2 border border-l-2 border-drl/40 border-l-drl bg-drl/[0.06] px-3 py-2 text-caption text-ink-secondary">
          {fill(t("Se abre al llegar a {rango} ({min} puntos de rango). Llevas {puntos}: te faltan {faltan}. Los puntos de rango se ganan en duelos contra el bot y en Pick'ems; el rating PvP no da recompensas.", { ...slots("rango", "puntos"), min: rewards.minPoints, faltan: Math.max(0, rewards.minPoints - rewards.points) }), {
            rango: <b className="text-white">{t("Oro")}</b>,
            puntos: <b className="nx-readout text-white">{rewards.points}</b>,
          })}
        </p>
      )}
      {rewards.levels.length === 0 ? (
        <p className="nx-clip-sm border-l-2 border-l-drl/60 bg-white/[0.03] px-4 text-left !text-[14px] !text-white/70 py-4 text-center text-caption text-ink-muted">{t("No hay recompensas competitivas definidas.")}</p>
      ) : (
        <ol className="flex snap-x gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label={t("Hitos del carril competitivo")}>
          {rewards.levels.map((l) => {
            const state = trackState(l);
            const reached = l.level <= rewards.passLevel;
            return (
              <li key={l.level} data-level={l.level} data-state={state}
                className={cn("nx-clip-sm flex w-[150px] shrink-0 snap-center flex-col gap-1 border px-3 py-2.5",
                  state === "CONSEGUIDO" ? "border-ok/40 bg-ok/[0.06]" : state === "DISPONIBLE" ? "border-drl-gold/60 bg-drl-gold/[0.10]"
                    : reached ? "border-white/20 bg-white/[0.04]" : "border-white/[0.08] bg-white/[0.02] opacity-70")}>
                <span className="flex items-center justify-between">
                  <span className="nx-readout text-[15px] text-white">{t("Nivel")} {l.level}</span>
                  <Badge tone={state === "CONSEGUIDO" ? "ok" : state === "DISPONIBLE" ? "gold" : "muted"}>
                    {state === "CONSEGUIDO" ? t("Conseguido") : state === "DISPONIBLE" ? t("Disponible") : t("Bloqueado")}
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
