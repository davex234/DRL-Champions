"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { EASE } from "@/design/motion";

/** Transición suave entre rutas (sensación de app, no de web). */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE.out }}
    >
      {children}
    </motion.div>
  );
}
