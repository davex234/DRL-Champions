"use client";

/**
 * FASE 61 · EL DESEMPATE, EN ESCENA.
 *
 * Antes, un 5–5 se resolvía en silencio: el último turno terminaba, saltaba «VICTORIA 6–5» y el porqué quedaba en
 * un panel del resultado, bajo el pliegue. El jugador no entendía por qué había ganado (o perdido) con un punto
 * que no había visto ganar.
 *
 * Ahora, SOLO cuando el marcador no decidió (`decidedBy !== "SCORE"`), entre el último turno y el golpe final se
 * enseñan los pasos que DE VERDAD aplicó el motor (`tiebreakPlan` → `decisionSteps`), uno detrás de otro:
 *
 *   EMPATE EN TURNOS 5–5  →  SUMA DE OVR 812 vs 806 (+1 punto)          (OVR_TIEBREAK)
 *   EMPATE EN TURNOS      →  OVR empatado  →  TOTAL DE ESTADÍSTICAS (sin punto)   (STAT_MARGIN)
 *   EMPATE EN TURNOS      →  OVR empatado  →  estadísticas empatadas → EMPATE    (NONE)
 *
 * Todas las cifras llegan en `DuelResultView` (servidor). Aquí no se compara nada: el ganador de cada paso es el
 * `outcome` que ya trae el paso. Saltable (clic, Intro, Espacio, Escape); con movimiento reducido, fundidos.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { EASE } from "@/design/motion";
import { playSound } from "@/lib/sound";
import { ARENA_ACCENT } from "@/lib/duel/arenas";
import { tiebreakPlan, TIEBREAK_STEP_MS } from "@/lib/duel/matchFlow";
import type { DuelResultView } from "@/lib/duel/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

const TONO = { YOU: ARENA_ACCENT.player, RIVAL: ARENA_ACCENT.opponent, TIE: ARENA_ACCENT.draw, UNKNOWN: "#9aa3b5" } as const;
const OUTCOME_TEXT = { YOU: "Para ti", RIVAL: "Para el rival", TIE: "Empate", UNKNOWN: "Sin dato" } as const;

export function TiebreakReveal({ result, onDone }: { result: DuelResultView; onDone: () => void }) {
  useLocale();
  const reduced = !!useReducedMotion();
  const plan = useMemo(() => tiebreakPlan(result, reduced), [result, reduced]);
  const per = reduced ? TIEBREAK_STEP_MS.reduced : TIEBREAK_STEP_MS.full;
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (!plan) { onDone(); return; }
    const ids: number[] = [];
    for (let i = 2; i <= plan.steps.length; i++) ids.push(window.setTimeout(() => setShown(i), per * (i - 1)));
    ids.push(window.setTimeout(onDone, plan.totalMs));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [plan, per, onDone]);

  useEffect(() => { playSound("tiebreak.step"); }, [shown]);

  useEffect(() => {
    const skip = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); onDone(); } };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [onDone]);

  if (!plan) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={td(plan.title)}
      data-scene="tiebreak"
      data-decided={result.decidedBy}
      className="fixed inset-0 z-[78] grid place-items-center bg-[radial-gradient(70%_60%_at_50%_45%,rgba(40,30,4,0.55),rgba(3,4,10,0.9))] px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE.out }}
      onClick={onDone}
    >
      <div className="w-full max-w-[640px] text-center">
        <motion.p
          className="font-display text-[clamp(30px,6vw,64px)] font-extrabold uppercase italic leading-none text-drl-gold"
          style={{ textShadow: "0 0 40px rgba(255,211,92,0.45)" }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.34, ease: EASE.out }}
        >
          {result.decidedBy === "NONE" ? t("Empate total") : t("Desempate")}
        </motion.p>
        <p className="nx-label mt-2 !text-white/60">{td(plan.title)}</p>

        <ol className="mt-7 flex flex-col gap-3" aria-live="polite">
          {plan.steps.slice(0, shown).map((s, i) => {
            const tone = TONO[s.outcome];
            const last = i === plan.steps.length - 1;
            return (
              <motion.li
                key={s.key}
                data-step={s.key}
                data-outcome={s.outcome}
                className={cn("nx-f61-tb-step grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3", last && "is-decisive")}
                style={{ ["--tb" as string]: tone }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: EASE.out }}
              >
                <b className="nx-readout justify-self-end text-[clamp(26px,5vw,44px)] tabular-nums" style={{ color: s.outcome === "YOU" ? TONO.YOU : "#eef1f8" }}>
                  {s.you ?? "—"}
                </b>
                <span className="flex flex-col items-center">
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/75">{td(s.label)}</span>
                  <span className="mt-1 rounded-full px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: tone, boxShadow: `inset 0 0 0 1px ${tone}77` }}>
                    {td(OUTCOME_TEXT[s.outcome])}
                  </span>
                </span>
                <b className="nx-readout justify-self-start text-[clamp(26px,5vw,44px)] tabular-nums" style={{ color: s.outcome === "RIVAL" ? TONO.RIVAL : "#eef1f8" }}>
                  {s.rival ?? "—"}
                </b>
                <span className="col-span-3 text-[12.5px] text-white/65">{td(s.note)}</span>
              </motion.li>
            );
          })}
        </ol>
        <p className="nx-label mt-6 text-white/40">{t("Toca para continuar")}</p>
      </div>
    </motion.div>
  );
}
