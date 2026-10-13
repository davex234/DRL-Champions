"use client";

/**
 * F82 · MOMENTO DE COLECCIÓN COMPLETADA. La pantalla se oscurece, entra el escudo del equipo, un barrido de luz y la
 * insignia desbloqueada. Corto (≈1,6 s) y saltable. Con movimiento reducido: mismo contenido, sin escalas ni barridos,
 * un fundido. Foco atrapado, Escape cierra, `role="dialog"` con título.
 */
import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useDialogLayer } from "@/components/ui/game/GameOverlay";
import { NxButton } from "@/components/ui/NxButton";
import type { BadgeFact } from "@/domain/collectionSets/badges";
import { TrophyBadge } from "./TrophyBadge";

export interface CompletionMomentData { title: string; kind: "TEAM" | "EDITION"; badge: BadgeFact | null; already: boolean }

export function CompletionMoment({ data, onClose, onEquip, equipping }: { data: CompletionMomentData | null; onClose: () => void; onEquip?: () => void; equipping?: boolean }) {
  const panel = useRef<HTMLDivElement | null>(null);
  const reduced = !!useReducedMotion();
  useDialogLayer(!!data, onClose, true, panel);
  const t = (d: number) => (reduced ? { duration: 0.2 } : { duration: 0.5, delay: d, ease: [0.2, 0.8, 0.2, 1] as const });
  return (
    <AnimatePresence>
      {data && (
        <motion.div
          key="moment" className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/85 px-4 py-8 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.15 : 0.3 }}
          data-testid="completion-moment" data-reduced={reduced ? "1" : "0"}
        >
          <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="completion-title" tabIndex={-1}
            className="relative flex w-full max-w-md flex-col items-center text-center outline-none">
            {!reduced && (
              <motion.span aria-hidden className="pointer-events-none absolute -left-[20%] top-[24%] h-[2px] w-[140%]"
                style={{ background: `linear-gradient(90deg, transparent, ${data.badge?.color ?? "#ffce4f"}, transparent)` }}
                initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: [0, 1, 0.35] }} transition={{ duration: 0.9, delay: 0.35 }} />
            )}
            <motion.p className="font-display text-[12px] font-bold uppercase tracking-[0.35em] text-white/70"
              initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={t(0.1)}>
              {data.kind === "TEAM" ? "Equipo completado" : "Colección completada"}
            </motion.p>
            <motion.div className="my-5" initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? { duration: 0.2 } : { type: "spring", stiffness: 180, damping: 16, delay: 0.25 }}>
              {data.badge && <TrophyBadge badge={data.badge} size="xl" />}
            </motion.div>
            <motion.h2 id="completion-title" className="font-display text-[34px] font-black uppercase leading-none tracking-wide text-white sm:text-[44px]"
              initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={t(0.55)}>
              {data.title}
            </motion.h2>
            <motion.p className="mt-3 text-[15px] text-white/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(0.8)}>
              {data.already ? "Ya era tuya: la insignia sigue en tu Sala de Trofeos." : <>Insignia desbloqueada: <b className="text-white">{data.badge?.label ?? data.title}</b></>}
            </motion.p>
            <motion.div className="mt-7 flex w-full flex-col gap-2 sm:flex-row sm:justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(1.0)}>
              {onEquip && <NxButton variant="primary" accent="gold" onClick={onEquip} disabled={equipping} data-autofocus data-testid="moment-equip">{equipping ? "Equipando…" : "Destacar en mi perfil"}</NxButton>}
              <NxButton variant="secondary" onClick={onClose} data-testid="moment-continue" {...(onEquip ? {} : { "data-autofocus": true })}>Continuar</NxButton>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
