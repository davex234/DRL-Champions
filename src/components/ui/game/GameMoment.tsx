"use client";

/**
 * FASE 44 · MOMENTO DE JUEGO — el rótulo de «OBJETIVO COMPLETADO», «SUBIDA DE NIVEL», «PLANTILLA LISTA»…
 *
 * Nivel 2–3: entra con luz, se lee y se va. No tapa la pantalla, no roba el foco y no bloquea el puntero (solo su
 * botón de cerrar es pulsable). `aria-live="polite"`: el lector de pantalla lo anuncia con el MISMO texto, así que
 * nada importante vive solo en la animación. La cola (`momentsReducer`) garantiza uno a la vez y caducidad.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { playSound, type SoundEvent } from "@/lib/sound";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EMPTY_MOMENTS, MOMENT_COPY, momentsReducer, type Moment, type MomentKind } from "@/lib/gameExperience/moments";
import { SPRING, reducedTransition } from "@/design/motion";

const Ctx = createContext<((m: Moment) => void) | null>(null);

/** Emite un momento REAL. Fuera del proveedor no hace nada (arnés, tests). */
export function useGameMoment(): (m: Moment) => void {
  return useContext(Ctx) ?? (() => {});
}

/**
 * `placement`: arriba (bajo la barra) en pantallas con armazón; ABAJO en las inmersivas (partida, apertura), donde
 * arriba está el titular del momento principal («VICTORIA», «TU SOBRE») y el rótulo lo taparía.
 */
/** Sonido de cada momento (sin sonido = null). */
export const MOMENT_SOUND: Record<MomentKind, SoundEvent | null> = {
  objective: "mission.complete", "level-up": null, achievement: "achievement.unlock", "deck-ready": "ui.confirm",
  "deck-active": "ui.confirm", "deck-saved": "ui.confirm", reward: "mission.complete", prediction: "ui.confirm", rating: null,
};

export function GameMomentProvider({ children, placement = "top" }: { children: React.ReactNode; placement?: "top" | "bottom" }) {
  const reduced = !!useReducedMotion();
  const [state, dispatch] = useReducer(momentsReducer, EMPTY_MOMENTS);
  const push = useCallback((m: Moment) => dispatch({ type: "push", moment: m, now: Date.now(), reduced }), [reduced]);

  useEffect(() => {
    if (!state.visible && state.queue.length === 0) return;
    const id = window.setInterval(() => dispatch({ type: "tick", now: Date.now(), reduced }), 250);
    return () => window.clearInterval(id);
  }, [state.visible, state.queue.length, reduced]);

  /*
   * Fase 44.1 · cada momento suena al APARECER (una vez por momento). La subida de nivel no: ya suena en la barra de XP
   * (`XpProgress`) y sonaría dos veces.
   */
  const shownId = state.visible ? `${state.visible.key}:${state.visible.shownAt}` : null;
  useEffect(() => {
    if (!state.visible) return;
    const ev = MOMENT_SOUND[state.visible.kind];
    if (ev) playSound(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId]);

  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <GameMomentView moment={state.visible} placement={placement} onDismiss={() => dispatch({ type: "dismiss", now: Date.now(), reduced })} />
    </Ctx.Provider>
  );
}

export function GameMomentView({ moment, onDismiss, inline = false, placement = "top" }: { moment: Moment | null; onDismiss?: () => void; inline?: boolean; placement?: "top" | "bottom" }) {
  const reduced = useReducedMotion();
  const copy = moment ? MOMENT_COPY[moment.kind] : null;
  // Pack Opening 3.0 · abajo, el rótulo se aparta de un dock de acciones si la pantalla lo declara (`--nx-moment-offset`,
  // lo fija el resumen del sobre con la altura real de su dock): nunca tapa ABRIR OTRO / COLECCIÓN / JUGAR.
  const fixedPos = placement === "bottom"
    ? "bottom-[calc(env(safe-area-inset-bottom)+var(--nx-moment-offset,20px))]"
    : "top-[calc(var(--nx-topbar)+env(safe-area-inset-top)+12px)]";
  return (
    <div
      aria-live="polite"
      data-placement={inline ? "inline" : placement}
      className={inline ? "relative" : `pointer-events-none fixed inset-x-0 ${fixedPos} z-[70] flex justify-center px-4`}
      data-testid="game-moment-region"
    >
      <AnimatePresence>
        {moment && copy && (
          <motion.div
            key={moment.key}
            role="status"
            data-testid="game-moment"
            data-kind={moment.kind}
            data-motion-level={copy.level}
            data-tone={copy.tone}
            className="nx-moment pointer-events-auto relative flex w-full max-w-md items-center gap-4 overflow-hidden px-5 py-3.5"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={reduced ? reducedTransition : SPRING.card}
          >
            <span aria-hidden className="nx-moment-sweep" />
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center" style={{ color: "rgb(var(--m-rgb))" }}>
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 2 21 7v10l-9 5-9-5V7z" /><path d="m8 12 3 3 5-6" /></svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[18px] font-bold uppercase leading-none tracking-[0.1em]" style={{ color: "rgb(var(--m-rgb))" }}>{copy.title}</span>
              <span className="mt-1 block truncate text-[14px] font-semibold text-white">{moment.fact}</span>
              {moment.reward && <span className="nx-readout mt-0.5 block text-[13px] text-drl-gold">{moment.reward}</span>}
            </span>
            {onDismiss && (
              <button type="button" onClick={onDismiss} className="grid h-11 w-11 shrink-0 place-items-center text-white/50 hover:text-white" aria-label="Cerrar aviso">
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
