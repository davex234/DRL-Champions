"use client";

/**
 * LA PARTIDA CONTADA (Fase 33) — pieza común del final PvE, PvP y privado, y de la repetición.
 *
 *   · CÓMO SE DECIDIÓ, paso a paso (`decisionSteps`): solo los criterios que de verdad se aplicaron
 *     —turnos, suma de OVR (da un punto), total de estadísticas (no da punto), empate total—, con las
 *     cifras del resultado del servidor.
 *   · LÍNEA DE LOS 10 TURNOS con su resultado real y el recuento.
 *   · RECOMPENSA: solo lo que dice el servidor; en PvP, que no hay.
 * Todo es texto además de color: el resultado nunca depende solo del tono.
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import type { DuelMatchView } from "@/lib/duel/types";
import { roundTally } from "@/lib/duel/gameplayUx";
import {
  buildTimeline, decisionSteps, rewardPresentation, DECISION_TITLE, type CellState, type DecisionStep, type MatchMode,
} from "@/lib/duel/experience";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

const OUTCOME_WORD: Record<DecisionStep["outcome"], string> = { YOU: "Para ti", RIVAL: "Para el rival", TIE: "Empate", UNKNOWN: "Sin dato" };
const OUTCOME_TONE: Record<DecisionStep["outcome"], string> = { YOU: "text-ok", RIVAL: "text-drl", TIE: "text-drl-gold", UNKNOWN: "text-white/40" };
const CELL_TONE: Record<CellState, string> = { WIN: "#3fc07a", LOSS: "#ff2e63", DRAW: "#ffd35c", CURRENT: "#3fd2ff", PENDING: "rgba(255,255,255,0.25)" };

export function ResultStory({ view, mode, className }: { view: DuelMatchView; mode: MatchMode; className?: string }) {
  useLocale();
  const reduced = useReducedMotion();
  const r = view.result;
  if (!r) return null;
  const steps = decisionSteps(r);
  const cells = buildTimeline(view);
  const tally = roundTally(view.history);
  const reward = rewardPresentation(mode, r);

  return (
    <section aria-label={t("Resumen de la partida")} data-testid="result-story" data-decided={r.decidedBy} className={cn("nx-clip-sm border border-white/10 bg-white/[0.03] px-4 py-4", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-body font-bold uppercase tracking-wide text-white">{td(DECISION_TITLE[r.decidedBy])}</h2>
        <span className="text-caption text-ink-muted">{t("Paso a paso")}</span>
      </div>
      <ol className="mt-2 space-y-1.5" aria-label={t("Cómo se decidió, paso a paso")}>
        {/*
          EL DESEMPATE SE REVELA PASO A PASO: turnos → (empate) → suma de OVR → (empate) → total de
          estadísticas. Cada criterio entra después del anterior; el que decidió se marca. Con movimiento
          reducido todo está ya puesto. Los números son los del resultado del servidor.
        */}
        {steps.map((s, i) => {
          const decisive = i === steps.length - 1 && s.outcome !== "TIE";
          return (
            <motion.li
              key={s.key}
              data-step={s.key}
              data-outcome={s.outcome}
              data-decisive={decisive}
              initial={reduced ? false : { opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduced ? 0 : 0.2 + i * 0.45, duration: 0.3 }}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 rounded-lg bg-black/25 px-3 py-2",
                decisive && "ring-1 ring-drl-gold/50",
              )}
            >
              <span className="text-[12px] font-semibold text-white/85">{i + 1}. {td(s.label)}</span>
              <b className="nx-readout text-[16px] tabular-nums text-white">{s.you ?? "—"} – {s.rival ?? "—"}</b>
              <span className={cn("font-display text-[11px] font-bold uppercase tracking-[0.1em]", OUTCOME_TONE[s.outcome])}>{td(OUTCOME_WORD[s.outcome])}</span>
              <span className="col-span-3 text-[11px] text-ink-muted">{td(s.note)}</span>
            </motion.li>
          );
        })}
      </ol>

      <div className="mt-4">
        <p className="nx-label">{t("Los {n} turnos", { n: view.totalTurns })}</p>
        <ol className="mt-1.5 grid grid-cols-10 gap-1" aria-label={t("Resultado de cada turno")}>
          {cells.map((c) => (
            <li key={c.number} aria-label={td(c.label)} data-cell={c.state} className="flex flex-col items-center rounded-[3px] border border-white/10 py-1">
              <span className="text-[9px] text-white/40">{c.number}</span>
              <span aria-hidden className="text-[13px] leading-none" style={{ color: CELL_TONE[c.state] }}>{c.glyph}</span>
            </li>
          ))}
        </ol>
        <p className="mt-1.5 text-caption text-ink-secondary">
          {t("Ganados")} <b className="text-white">{tally.won}</b> {t("· Perdidos")} <b className="text-white">{tally.lost}</b> {t("· Empatados")} <b className="text-white">{tally.tied}</b>
          <span className="ml-2 text-ink-faint">{t("(● ganado · ○ perdido · — empate)")}</span>
        </p>
      </div>

      {reward.state !== "GRANTED" && (
        <p className="mt-3 text-caption text-ink-muted" data-reward={reward.state}>{td(reward.note)}</p>
      )}
    </section>
  );
}
