"use client";

/**
 * UPDATE NOTIFICATION — aviso elegante in-app cuando aparece una actualización mientras se
 * usa el juego (no el launcher). Dos variantes:
 *   - Normal: "Actualización disponible" → [Actualizar] [Después]
 *   - En partido: "Se instalará cuando termine el partido" → [Actualizar ahora] [Más tarde]
 *
 * "Actualizar" lleva al launcher (`/launcher`), donde el flujo oficial de Tauri (BootGate →
 * pantalla exclusiva) descarga/verifica/instala/reinicia. Nunca interrumpe un partido.
 */
import { motion } from "framer-motion";

export function UpdateNotification({
  version,
  inMatch,
  onUpdate,
  onDismiss,
}: {
  version: string;
  inMatch: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, x: 24 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      className="fixed bottom-5 right-5 z-[90] w-[340px] overflow-hidden rounded-2xl border border-drl-gold/30 bg-base-800/95 shadow-2xl backdrop-blur"
    >
      <div className="h-1 w-full bg-gradient-to-r from-drl via-drl-gold to-drl-cyan" />
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-drl-gold/15 text-drl-gold">⬆</span>
          <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
            {inMatch ? "Actualización disponible" : "Nueva versión disponible"}
          </p>
        </div>

        <p className="mt-2 text-[12px] text-white/60">
          {inMatch ? (
            <>
              Se instalará cuando termine el partido. Versión{" "}
              <span className="font-bold text-drl-gold">v{version}</span>.
            </>
          ) : (
            <>
              Ya está lista la versión <span className="font-bold text-drl-gold">v{version}</span>.
              Actualiza para tener las últimas mejoras.
            </>
          )}
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={onUpdate}
            className="flex-1 rounded-xl bg-gradient-to-r from-drl-gold to-[#c9962a] px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-base-900 transition hover:brightness-110"
          >
            {inMatch ? "Actualizar ahora" : "Actualizar"}
          </button>
          <button
            onClick={onDismiss}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-white/70 transition hover:bg-white/10"
          >
            {inMatch ? "Más tarde" : "Después"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
