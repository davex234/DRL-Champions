"use client";

/** LAUNCHER — pantalla de modo sin conexión. Nunca bloquea: deja continuar al launcher. */
import { motion } from "framer-motion";
import { BrandMark } from "@/branding/Logo";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

export function OfflineScreen({
  current,
  onContinue,
  onRetry,
  onExit,
}: {
  current: string;
  onContinue: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  useLocale();
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-base-900 text-white">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-base-800/60 p-8 text-center backdrop-blur"
      >
        <div className="mx-auto w-fit opacity-90">
          <BrandMark size={72} />
        </div>
        <p className="mt-4 text-4xl">📡</p>
        <h1 className="mt-3 font-display text-2xl font-black uppercase">{t("Modo sin conexión")}</h1>
        <p className="mt-2 text-white/55">
          {t("No se ha podido comprobar si existen actualizaciones. Puedes seguir jugando con la versión instalada (v")}{td(current)}).
        </p>

        <div className="mt-7 flex flex-col gap-2">
          <button
            onClick={onContinue}
            className="w-full rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-4 font-display text-lg font-black uppercase tracking-wider text-white shadow-glow transition hover:-translate-y-0.5 hover:brightness-110"
          >
            {t("▸ Continuar sin conexión")}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onRetry}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-semibold text-white/80 transition hover:bg-white/10"
            >
              {t("↻ Reintentar")}
            </button>
            <button
              onClick={onExit}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-semibold text-white/80 transition hover:bg-white/10"
            >
              {t("Salir")}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
