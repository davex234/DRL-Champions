"use client";

/**
 * FASE 45 · EL MOMENTO EN QUE LA PARTIDA ACABA.
 *
 * Antes, el último turno se resolvía y la pantalla saltaba directa al resultado: la partida terminaba sin que nadie
 * dijera que había terminado. Este es ese golpe: VICTORIA / DERROTA / EMPATE con el marcador final, ~1,2 s y se va
 * sola. No decide nada —el veredicto y el marcador llegan resueltos del servidor en `DuelResultView`— y se puede
 * saltar con clic, Enter, Espacio o Escape, como la intro.
 *
 * Con `prefers-reduced-motion` no hay recorrido: aparece el titular, se lee y se va.
 *
 * FASE 61 · en reducido eran 420 ms: un parpadeo. El usuario ve SIEMPRE la rama reducida (Windows sin animaciones), así
 * que el golpe final se quedaba en nada. Ahora 1 s, sin desplazamiento: el tiempo justo para leer VICTORIA y el marcador.
 */
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { EASE } from "@/design/motion";
import { matchVerdict, VERDICT_TITLE } from "@/lib/duel/experience";
import type { DuelResultView } from "@/lib/duel/types";

/** Cuánto dura el golpe: lo justo para leerlo, nunca una cinemática. */
export const MATCH_COMPLETE_MS = { full: 1200, reduced: 1000 } as const;
export const matchCompleteDuration = (reduced: boolean): number => (reduced ? MATCH_COMPLETE_MS.reduced : MATCH_COMPLETE_MS.full);

const TONO = {
  WIN: { color: "#2fe0ff", sub: "Has ganado la partida" },
  LOSS: { color: "#ff2e63", sub: "Has perdido la partida" },
  DRAW: { color: "#ffd35c", sub: "La partida ha terminado en empate" },
} as const;

export function MatchComplete({ result, onDone, className }: {
  /** Resultado YA resuelto por el servidor. */
  result: DuelResultView;
  onDone: () => void;
  className?: string;
}) {
  const reduced = !!useReducedMotion();
  const verdict = matchVerdict(result);
  const tono = TONO[verdict];

  useEffect(() => {
    const id = window.setTimeout(onDone, matchCompleteDuration(reduced));
    const skip = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); onDone(); } };
    window.addEventListener("keydown", skip);
    return () => { window.clearTimeout(id); window.removeEventListener("keydown", skip); };
  }, [onDone, reduced]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${VERDICT_TITLE[verdict]}. ${result.scoreYou} a ${result.scoreRival}`}
      data-scene="match-complete"
      data-verdict={verdict}
      data-motion-level={reduced ? 1 : 3}
      className={cn("fixed inset-0 z-[80] grid place-items-center bg-[radial-gradient(70%_60%_at_50%_50%,rgba(3,4,10,0.84),rgba(3,4,10,0.6))] px-6", className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.22, ease: EASE.out }}
      onClick={onDone}
    >
      <div className="flex flex-col items-center text-center">
        <motion.p
          className="font-display text-[clamp(44px,9vw,120px)] font-bold uppercase leading-[0.86]"
          style={{ color: tono.color, textShadow: `0 0 60px ${tono.color}66` }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.18, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.34, ease: EASE.out }}
        >
          {VERDICT_TITLE[verdict]}
        </motion.p>
        <p className="mt-2 text-[15px] text-white/70">{tono.sub}</p>
        <p className="mt-5 flex items-center gap-3" data-testid="match-complete-score">
          <b className="nx-readout text-[clamp(30px,4vw,54px)] text-[#2fe0ff] tabular-nums">{result.scoreYou}</b>
          <span className="text-[18px] text-white/30">–</span>
          <b className="nx-readout text-[clamp(30px,4vw,54px)] text-drl tabular-nums">{result.scoreRival}</b>
        </p>
        <p className="nx-label mt-4 text-white/40">Toca para ver el resultado</p>
      </div>
    </motion.div>
  );
}
