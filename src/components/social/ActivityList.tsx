"use client";

/**
 * ACTIVIDAD (Fase 29, P2 acotado): lista DERIVADA de hechos reales (amistades aceptadas, duelos
 * privados y ranked terminados). Sin texto libre, sin likes, sin feed: solo lo que ya pasó.
 */
import { ACTIVITY_LABEL, type ActivityItem } from "@/domain/social/social";
import { ago } from "./bits";

const GLYPH: Record<ActivityItem["kind"], string> = { FRIENDS_NOW: "👥", PRIVATE_DUEL: "⚔️", RANKED_DUEL: "🏆" };

export function ActivityList({ items, now }: { items: ActivityItem[]; now: number }) {
  if (items.length === 0) {
    return <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-4 text-center text-caption text-ink-muted">Todavía no hay actividad. Añade un amigo o juega un duelo.</p>;
  }
  return (
    <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]" data-testid="activity" data-count={items.length}>
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-kind={it.kind}>
          <span aria-hidden className="w-6 text-center">{GLYPH[it.kind]}</span>
          <span className="min-w-0 flex-1 truncate text-white/85">{ACTIVITY_LABEL[it.kind](it.who, it.letter)}</span>
          <span className="shrink-0 text-[11px] text-white/40">{ago(it.at, now)}</span>
        </li>
      ))}
    </ol>
  );
}
