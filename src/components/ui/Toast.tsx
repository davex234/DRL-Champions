"use client";

/**
 * AVISO BREVE (toast) — FASE 44: rótulo de juego, no una notificación de web.
 *
 * Misma API de siempre (`{ id, msg, ok }`) para no tocar las pantallas. Cambia la presentación: placa chaflanada con
 * filo de color, glifo de la casa en vez de «✓/✕», y los errores pasan por `playerMessage` para que un mensaje técnico
 * nunca llegue al jugador. `role="status"` / `aria-live`: el texto se anuncia igual que se ve.
 */
import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { playSound } from "@/lib/sound";
import { playerMessage } from "@/components/ui/game/GameStates";
import { SPRING, reducedTransition } from "@/design/motion";

export interface ToastState {
  id: number;
  msg: string;
  ok: boolean;
  /** F64 · veces que se ha repetido mientras estaba en pantalla (se pinta «×N», no otro aviso). */
  count?: number;
}

export function Toast({ toast }: { toast: ToastState | null }) {
  const reduced = useReducedMotion();
  /* F64 · el aviso SUENA al entrar (una vez por aviso nuevo; repetir el mismo mensaje no vuelve a sonar). */
  const id = toast?.id ?? null;
  const ok = toast?.ok ?? true;
  useEffect(() => { if (id !== null) playSound(ok ? "ui.success" : "ui.error"); }, [id, ok]);
  return (
    <div className="pointer-events-none fixed bottom-[calc(var(--nx-mobilebar)+env(safe-area-inset-bottom)+20px)] left-1/2 z-toast w-[min(92vw,460px)] -translate-x-1/2 lg:bottom-8" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            data-testid="game-toast"
            data-ok={toast.ok ? "true" : "false"}
            data-motion-level="2"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            transition={reduced ? reducedTransition : SPRING.card}
            className="nx-clip-sm flex items-center gap-3 px-4 py-3 backdrop-blur"
            style={{
              background: "linear-gradient(180deg, rgba(23,26,43,0.97), rgba(9,10,18,0.97))",
              boxShadow: `inset 3px 0 0 ${toast.ok ? "#3fc07a" : "#ff4d5e"}, inset 0 0 0 1px rgba(255,255,255,0.1), 0 18px 40px -18px rgba(0,0,0,0.9)`,
            }}
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke={toast.ok ? "#3fc07a" : "#ff4d5e"} strokeWidth={1.8}>
              <path d="M12 2 21 7v10l-9 5-9-5V7z" />
              {toast.ok ? <path d="m8 12 3 3 5-6" /> : <path d="M12 7.5v5.5M12 16v.5" />}
            </svg>
            <span className="font-display text-[15px] font-bold uppercase leading-snug tracking-[0.06em] text-white">
              {toast.ok ? toast.msg : playerMessage(toast.msg)}
              {(toast.count ?? 1) > 1 && <span className="nx-readout ml-2 text-white/60" data-testid="toast-count">×{toast.count}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
