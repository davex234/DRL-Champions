"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** Pantalla de carga propia (logo DRL + animación ligera) al arrancar. */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1300);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-base-900"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div
            className="absolute inset-0 opacity-70"
            style={{ background: "radial-gradient(700px 500px at 50% 40%, rgba(255,46,99,0.18), transparent 70%)" }}
          />
          <div className="relative flex flex-col items-center gap-5">
            <motion.div
              className="grid h-24 w-24 place-items-center rounded-3xl bg-gradient-to-br from-drl to-[#7b1733] font-display text-5xl font-bold text-white shadow-glow"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: [0.95, 1.02, 0.98], opacity: 1 }}
              transition={{ scale: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }}
            >
              D
            </motion.div>
            <div className="text-center">
              <p className="font-display text-2xl font-bold uppercase tracking-[0.15em] text-white">
                DRL <span className="text-drl">Champions</span>
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.4em] text-white/40">Valorant Card Game</p>
            </div>
            <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-1/2 rounded-full bg-gradient-to-r from-drl to-drl-glow"
                animate={{ x: ["-100%", "250%"] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
