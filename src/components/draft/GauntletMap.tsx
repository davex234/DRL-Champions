"use client";

/**
 * DRAFT GAUNTLET · MAPA (Fase 39). Cinco nodos lineales (01–04, FINAL): superado, siguiente, en combate, bloqueado,
 * derrota o empate. Solo pinta lo que dice la run del servidor. Sin scroll horizontal: en móvil es una columna.
 */
import { cn } from "@/lib/format";
import { DIFFICULTY_INFO } from "@/lib/duel/types";
import type { StageNode } from "@/domain/draft/run";
import { NODE_STATE_LABEL } from "@/lib/draft/presentation";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("draft");

const TONE: Record<StageNode["state"], { ring: string; text: string; fill: string }> = {
  LOCKED: { ring: "border-white/12", text: "text-white/40", fill: "bg-white/[0.02]" },
  CURRENT: { ring: "border-drl-gold", text: "text-drl-gold", fill: "bg-drl-gold/10" },
  IN_MATCH: { ring: "border-drl", text: "text-drl-glow", fill: "bg-drl/10" },
  WON: { ring: "border-[#3fc07a]", text: "text-[#6fe0a0]", fill: "bg-[#3fc07a]/10" },
  LOST: { ring: "border-drl/70", text: "text-drl-glow", fill: "bg-drl/5" },
  DRAW: { ring: "border-white/40", text: "text-white/80", fill: "bg-white/[0.05]" },
  ABANDONED: { ring: "border-white/20", text: "text-white/50", fill: "bg-white/[0.02]" },
};

export function GauntletMap({ stages, className }: { stages: StageNode[]; className?: string }) {
  useLocale();
  return (
    <ol aria-label={tr("Mapa del gauntlet")} data-testid="gauntlet-map" className={cn("grid gap-2 sm:grid-cols-5", className)}>
      {stages.map((s, i) => {
        const t = TONE[s.state];
        const final = i === stages.length - 1;
        return (
          <li
            key={s.stage}
            data-testid="gauntlet-node"
            data-state={s.state}
            aria-current={s.state === "CURRENT" || s.state === "IN_MATCH" ? "step" : undefined}
            className={cn("nx-clip-sm relative flex items-center gap-3 border px-3 py-3 sm:flex-col sm:items-start", t.ring, t.fill, final && "sm:border-2")}
          >
            <span className={cn("font-display text-[26px] font-bold leading-none tabular-nums", t.text)}>{td(s.label)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white">{s.rivalName}</span>
              <span className="block text-[11px] uppercase tracking-[0.14em] text-white/50">{td(DIFFICULTY_INFO[s.difficulty].label)}</span>
              <span className={cn("mt-1 block font-display text-[11px] font-bold uppercase tracking-[0.16em]", t.text)}>
                {td(NODE_STATE_LABEL[s.state])}
                {s.scoreYou !== null && s.scoreRival !== null ? ` · ${s.scoreYou}–${s.scoreRival}` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
