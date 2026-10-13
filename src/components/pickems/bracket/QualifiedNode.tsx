"use client";

/**
 * LA CAJA DEL CLASIFICADO (Fase 24.4).
 *
 *     ╭──────────────────────╮            ╭──────────────────────╮
 *     │ CLASIFICADO          │   antes:   │ CLASIFICADO          │
 *     │ [LOGO] HERETICS      │            │ POR DEFINIR          │
 *     ╰──────────────────────╯            ╰──────────────────────╯
 *
 * Existe solo cuando la fuente CONFIRMA que el ganador de un partido se clasifica
 * (`winner_qualifies`). El nombre sale del ganador REAL de ese partido; hasta entonces, «Por
 * definir». No se predice aquí: la pregunta «¿quién se clasifica?» es una `PickQuestion`/caja
 * normal sobre el partido de origen.
 */
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { cn } from "@/lib/format";
import type { QualificationNode } from "@/domain/pickems/bracket";

export function QualifiedNode({ node, compact, className, highlight }: { node: QualificationNode; compact?: boolean; className?: string; highlight?: boolean }) {
  const known = !!node.team;
  const tone = known ? "255,211,92" : "255,255,255";
  return (
    <article
      data-match-id={node.id}
      data-qualified={known ? "team" : "tbd"}
      aria-label={`${node.label}: ${node.team?.name ?? "Por definir"}`}
      className={cn("nx-clip-sm relative flex flex-col", compact ? "w-full" : "w-[220px] sm:w-[240px]", highlight && "nx-live-glow", className)}
      data-highlight={highlight ? "true" : undefined}
      style={{
        background: `linear-gradient(180deg, rgb(${tone} / ${known ? 0.14 : 0.05}), rgba(255,255,255,0.02) 60%), rgba(8,10,18,0.92)`,
        boxShadow: `inset 0 0 0 1px rgb(${tone} / ${known ? 0.5 : 0.14}), 0 10px 26px -14px rgba(0,0,0,0.9)${known ? `, 0 0 22px -8px rgb(${tone} / 0.5)` : ""}`,
      }}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="nx-label" style={known ? { color: "var(--nx-gold)" } : undefined}>{node.label}</span>
        {known && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--nx-gold)", boxShadow: "0 0 8px var(--nx-gold)" }} />}
      </header>
      <div aria-hidden className="h-px" style={{ background: `linear-gradient(90deg, transparent, rgb(${tone} / 0.4), transparent)` }} />
      <div className="flex min-h-[44px] items-center gap-2 px-3 py-2">
        {node.team ? (
          <>
            <span className="shrink-0" aria-hidden><TeamLogo team={node.team.name} size={22} /></span>
            <b className="min-w-0 flex-1 truncate font-display text-[13px] font-bold uppercase tracking-[0.03em] text-white">{node.team.name}</b>
          </>
        ) : (
          <>
            <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-white/5 text-[10px] text-ink-faint">?</span>
            <span className="italic text-[13px] text-ink-faint">Por definir</span>
          </>
        )}
      </div>
    </article>
  );
}
