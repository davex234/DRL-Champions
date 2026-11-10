"use client";

/**
 * OBJETIVOS DEL EVENTO (Fase 30). Son los DESAFÍOS DE EVENTO que ya existen (Fase 10/12):
 * definiciones reales por tipo de evento, progreso contado por el servidor sobre hechos reales
 * (predicciones, duelos, sobres dentro de la ventana del evento), reclamación idempotente por
 * `app_grant_reward`. Aquí no hay un segundo motor: el botón llama al MISMO `claimChallenge`.
 * Sin definiciones no se inventa nada: «sin objetivos del evento».
 */
import { useState } from "react";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NxButton } from "@/components/ui/NxButton";
import type { EventHubSnapshot, ObjectiveView } from "@/server/services/liveEvents";
import type { Reward } from "@/domain/events/types";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("liveEvents");

export function rewardText(r: Reward): string {
  const parts: string[] = [];
  if (r.credits) parts.push(t("{n} créditos", { n: r.credits.toLocaleString(getIntlLocale()) }));
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.packId && r.packCount) parts.push(t("{n, plural, one {{n} sobre} other {{n} sobres}}", { n: r.packCount }));
  return parts.join(" · ") || t("Sin recompensa");
}

export function EventObjectives({ objectives, eventId, signedIn, onClaim, busy }: { objectives: EventHubSnapshot["objectives"]; eventId: string; signedIn: boolean; onClaim?: (o: ObjectiveView) => void; busy?: string | null }) {
  useLocale();
  const [showAll, setShowAll] = useState(false);
  const items = objectives.items;
  const done = items.filter((i) => i.complete).length;
  return (
    <section id="objetivos" aria-label={t("Objetivos del evento")} data-testid="event-objectives" data-count={items.length} data-claimable={objectives.claimable} data-event={eventId}>
      <SectionTitle>{t("Objetivos del evento")}{items.length > 0 && <span className="ml-2 text-ink-faint">· {done} / {items.length}</span>}</SectionTitle>
      {items.length === 0 ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{t("Sin objetivos del evento.")}</Plate>
      ) : (
        <>
          <p className="-mt-1.5 mb-3 text-caption text-ink-muted">{!signedIn ? t("{conjunto} · inicia sesión para progresar y reclamar", { conjunto: td(objectives.set) }) : td(objectives.set)}</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {(showAll ? items : items.slice(0, 6)).map((o) => {
              const pct = o.goal === 0 ? 0 : Math.min(100, Math.round((o.progress / o.goal) * 100));
              return (
                <li key={o.id}>
                  <Plate tone={o.claimable ? "gold" : o.claimed ? "success" : "neutral"} className="flex h-full flex-col gap-2 px-3 py-3" data-objective={o.id} data-state={o.claimed ? "claimed" : o.claimable ? "claimable" : o.complete ? "complete" : "progress"}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-display text-[13px] font-bold uppercase text-white">{td(o.label)}</span>
                        <span className="block text-[12px] text-white/55">{td(o.description)}</span>
                      </span>
                      {o.claimed ? <Badge tone="ok">{t("Reclamado")}</Badge> : o.claimable ? <Badge tone="gold" dot>{t("Reclamable")}</Badge> : null}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-white/50">
                      <span className="tabular-nums">{o.progress} / {o.goal}</span>
                      <Meter value={pct} tone={o.complete ? "ok" : "key"} height={4} label={t("{label}: {progress} de {goal}", { label: td(o.label), progress: o.progress, goal: o.goal })} className="flex-1" />
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <span className="text-[11px] text-drl-gold">{rewardText(o.reward)}</span>
                      {signedIn && o.claimable && onClaim && <NxButton size="sm" variant="primary" accent="gold" onClick={() => onClaim(o)} disabled={busy === o.id} data-claim={o.id}>{busy === o.id ? t("Reclamando…") : t("Reclamar")}</NxButton>}
                    </div>
                  </Plate>
                </li>
              );
            })}
          </ol>
          {!showAll && items.length > 6 && <button type="button" onClick={() => setShowAll(true)} className="nx-focus mt-2 min-h-[44px] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{t("Ver los {n} objetivos", { n: items.length })}</button>}
        </>
      )}
    </section>
  );
}
