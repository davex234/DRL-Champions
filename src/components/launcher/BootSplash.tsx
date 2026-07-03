"use client";

/**
 * LAUNCHER — splash de arranque a pantalla completa (logo + estado).
 * Dos variantes: "loading" (spinner + mensaje rotativo) y "success" (✔ actualizado).
 */
import { motion } from "framer-motion";
import { BrandMark } from "@/branding/Logo";

export function BootSplash({
  variant = "loading",
  title,
  subtitle,
  version,
}: {
  variant?: "loading" | "success";
  title: string;
  subtitle?: string;
  version?: string;
}) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-base-900 text-white">
      <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-drl/20 blur-3xl" />
      <div className="absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-drl-cyan/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative flex flex-col items-center"
      >
        <motion.div
          animate={variant === "loading" ? { scale: [1, 1.04, 1] } : { scale: 1 }}
          transition={{ duration: 2.4, repeat: variant === "loading" ? Infinity : 0, ease: "easeInOut" }}
        >
          <BrandMark size={120} />
        </motion.div>

        <p className="mt-8 font-display text-3xl font-black uppercase tracking-wide">
          DRL <span className="text-drl">CHAMPIONS</span>
        </p>

        <div className="mt-6 flex items-center gap-3 text-white/70">
          {variant === "loading" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-drl border-t-transparent" />
          ) : (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 16 }}
              className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-sm font-black text-base-900"
            >
              ✓
            </motion.span>
          )}
          <span className="text-sm">{title}</span>
        </div>

        {subtitle && <p className="mt-2 text-[12px] text-white/40">{subtitle}</p>}
        {version && (
          <p className="mt-1 font-display text-sm font-bold text-drl-gold">Versión {version}</p>
        )}
      </motion.div>

      <p className="absolute bottom-6 text-[10px] uppercase tracking-[0.3em] text-white/25">
        DRL Champions © · Esports Manager
      </p>
    </div>
  );
}
