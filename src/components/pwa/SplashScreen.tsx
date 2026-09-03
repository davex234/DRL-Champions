"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrandMark } from "@/branding/Logo";

/**
 * Pantalla de carga al arrancar.
 *
 * Lleva el mismo nombre que el armazón (`GameShell`): antes decía «DRL CHAMPIONS ·
 * Esports Manager» mientras la barra superior decía «NEXUS», y ver dos nombres en los
 * dos primeros segundos de uso es lo que hace dudar de si estás en el producto correcto.
 */
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
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: [0.97, 1.03, 0.99], opacity: 1 }}
              transition={{ scale: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.4 } }}
              className="drop-shadow-[0_0_30px_rgba(255,46,99,0.4)]"
            >
              <BrandMark size={104} />
            </motion.div>
            <div className="text-center">
              <p className="font-display text-3xl font-bold uppercase tracking-[0.18em] text-white">
                NE<span className="text-drl">XUS</span>
              </p>
              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.4em] text-white/40">
                Valorant Cards
              </p>
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
