"use client";

import { AnimatePresence, motion } from "framer-motion";

export interface ToastState {
  id: number;
  msg: string;
  ok: boolean;
}

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 md:bottom-8">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            className="rounded-xl border px-5 py-3 font-display text-sm font-semibold uppercase tracking-wide shadow-card backdrop-blur"
            style={{
              borderColor: toast.ok ? "rgba(55,230,160,0.4)" : "rgba(255,46,99,0.5)",
              background: toast.ok ? "rgba(55,230,160,0.12)" : "rgba(255,46,99,0.12)",
              color: toast.ok ? "#37e6a0" : "#ff5c8a",
            }}
          >
            {toast.ok ? "✓ " : "✕ "}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
