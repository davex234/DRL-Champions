"use client";

/**
 * AVISOS DE PROGRESO (Fase 27). Subida de nivel, objetivo completado, logro conseguido, sobre
 * recibido. Ligero: una pila de avisos con identidad estable (`ProgressEvent.id`) que el módulo
 * cliente ya ha filtrado (`takeProgressEvents`), así que un sondeo o un render no los repiten.
 * `aria-live` solo aquí, porque son los únicos cambios que merecen anuncio inmediato.
 *
 * El LEVEL UP tiene su propia pieza, más grande, que se cierra a mano o sola. No se persiste
 * ningún acuse: sin mecanismo en el servidor, solo se avisa de lo visto en esta sesión.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProgressEvent } from "@/domain/progression/meta";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("progression");

const TONE: Record<ProgressEvent["kind"], string> = {
  LEVEL_UP: "25,227,255", OBJECTIVE_COMPLETE: "63,192,122", ACHIEVEMENT: "255,211,92", PACK_REWARD: "255,138,61",
};

export function ProgressAlerts({ events, ttlMs = 4200 }: { events: ProgressEvent[]; ttlMs?: number }) {
  useLocale();
  const [visible, setVisible] = useState<ProgressEvent[]>([]);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (events.length === 0) return;
    setVisible((v) => [...v, ...events.filter((e) => !v.some((x) => x.id === e.id))].slice(-3));
    const id = window.setTimeout(() => setVisible((v) => v.filter((x) => !events.some((e) => e.id === x.id))), ttlMs);
    return () => window.clearTimeout(id);
  }, [events, ttlMs]);

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-toast flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 md:bottom-8" aria-live="polite" role="status">
      <AnimatePresence>
        {visible.map((e) => (
          <motion.div
            key={e.id}
            data-alert={e.kind}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="nx-clip-sm border px-4 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.08em] shadow-card backdrop-blur"
            style={{ borderColor: `rgb(${TONE[e.kind]} / 0.5)`, background: `rgb(${TONE[e.kind]} / 0.14)`, color: `rgb(${TONE[e.kind]})` }}
          >
            {td(e.text)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Subida de nivel, a lo grande. Una vez por nivel visto en la sesión (la identidad la pone quien la monta). */
export function LevelUpBanner({ levels, onClose, autoCloseMs = 5000, from }: { levels: number[]; onClose: () => void; autoCloseMs?: number; /** F62 · nivel de partida (antes de la subida), del servidor. */ from?: number }) {
  useLocale();
  const reduced = useReducedMotion();
  useEffect(() => {
    const id = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(id);
  }, [onClose, autoCloseMs]);
  if (levels.length === 0) return null;
  const top = levels[levels.length - 1];
  return (
    <motion.section
      role="status"
      aria-live="assertive"
      data-levelup={top}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.2 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="nx-clip relative overflow-hidden border border-drl-cyan/60 px-5 py-6 text-center"
      style={{ background: "radial-gradient(120% 100% at 50% 0%, rgba(25,227,255,0.24), transparent 62%), rgba(255,255,255,0.03)" }}
    >
      <span className="nx-label">{levels.length > 1 ? t("{n} niveles de golpe · nivel de cuenta", { n: levels.length }) : t("Subida de nivel · nivel de cuenta")}</span>
      <p className="mt-1 font-display text-[clamp(34px,8vw,64px)] font-bold uppercase leading-none text-white" style={{ textShadow: "0 0 40px rgba(25,227,255,0.55)" }} data-levelup-from={from ?? top - levels.length}>
        {/* F62 · de → a: el nivel anterior, tachado de luz, y el nuevo. */}
        <span className="nx-f62-levelup-from">{t("Nivel {level}", { level: from ?? top - levels.length })}</span> <span aria-hidden>→</span> {t("Nivel {level}", { level: top })}
      </p>
      <p className="mt-2 text-caption text-ink-secondary">{t("Tu cuenta ha subido de nivel. La XP de cuenta la concede el servidor; el nivel de cuenta no tiene recompensa propia.")}</p>
      <button type="button" onClick={onClose} className="nx-focus mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-white/15 px-5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70 transition hover:bg-white/10">
        {t("Seguir")}
      </button>
    </motion.section>
  );
}
