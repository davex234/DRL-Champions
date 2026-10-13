"use client";

/**
 * RECOMPENSAS DEL EVENTO (Fase 30). SOLO las que ya conceden los sistemas canónicos: los
 * escalones del Pick'em (`REWARD_TIERS`, pagados al corregirse) y el total de los desafíos del
 * evento (pagados al reclamar). Ni «reward track» inventado, ni moneda del evento.
 */
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { EventHubSnapshot } from "@/server/services/liveEvents";
import { rewardText } from "./EventObjectives";

export function EventRewards({ rewards, hasPickem, objectivesCount, signedIn }: { rewards: EventHubSnapshot["rewards"]; hasPickem: boolean; objectivesCount: number; signedIn: boolean }) {
  const none = !hasPickem && objectivesCount === 0;
  return (
    <section id="recompensas" aria-label="Recompensas del evento" data-testid="event-rewards" data-earned={rewards.earnedTier ?? "none"} data-claimed={rewards.claimed}>
      <SectionTitle>Recompensas</SectionTitle>
      {none ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">Este evento no reparte recompensas todavía.</Plate>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {hasPickem && (
            <Plate className="px-4 py-3">
              <p className="nx-label mb-2">Escalones del Pick&apos;em · por puntos</p>
              <ol className="divide-y divide-white/[0.06]">
                {rewards.pickemTiers.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-1.5 text-[12px]" data-tier={t.id} data-reached={t.reached ? "yes" : "no"}>
                    <span className="min-w-0"><span className="font-display font-bold uppercase text-white">{t.label}</span><span className="ml-2 text-white/45">{t.minPoints}+ pts</span></span>
                    <span className="flex items-center gap-2 text-drl-gold">{rewardText(t.reward)}{signedIn && t.reached && <Badge tone="ok">Alcanzado</Badge>}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-white/35">Se conceden al corregirse las predicciones. Sin puntos, sin escalón.</p>
            </Plate>
          )}
          {objectivesCount > 0 && (
            <Plate className="px-4 py-3">
              <p className="nx-label mb-2">Desafíos del evento · al reclamar</p>
              <p className="text-[13px] text-white">Reparte en total <span className="text-drl-gold">{rewardText(rewards.challengesTotal)}</span></p>
              {signedIn && <p className="mt-1 text-[12px] text-white/55">Has reclamado {rewards.claimed} de {objectivesCount}.</p>}
            </Plate>
          )}
        </div>
      )}
    </section>
  );
}
