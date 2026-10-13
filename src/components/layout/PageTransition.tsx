"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { pageMotion, transitionFamily } from "@/design/motion";

/**
 * Transición entre rutas: cambio de PANTALLA del juego, no cambio de URL (Fase 44).
 *
 * Cuatro familias, no veinte (`transitionFamily`): jugar entra directo, colección/sobres/equipos con profundidad,
 * temporada/progreso con luz, el resto funde. 180–300 ms, solo `transform`/`opacity`, y con movimiento reducido un
 * fundido de 120 ms. Al terminar no queda ningún `transform` aplicado (framer lo retira), así que no rompe `fixed`.
 *
 * F72 · En el primer render `useReducedMotion()` aún no sabe la preferencia: la página monta con el `initial` animado
 * (p. ej. `y: 14`) y, al saberse «reducido», el objetivo pasaba a ser solo opacidad → el `translateY(14px)` se quedaba
 * PARA SIEMPRE y todo `position: fixed` de dentro (la barra de CONFIRMAR del draft) quedaba fuera de la pantalla. Con
 * movimiento reducido el objetivo también devuelve las transformaciones a la identidad (framer lo aplica al instante).
 */
const IDENTITY = { y: 0, scale: 1 } as const;

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = !!useReducedMotion();
  const family = transitionFamily(pathname);
  const m = pageMotion(family, reduced);
  return (
    <motion.div
      key={pathname}
      data-transition={family}
      data-motion-level="2"
      initial={m.initial}
      animate={reduced ? { ...m.animate, ...IDENTITY } : m.animate}
      transition={m.transition}
    >
      {children}
    </motion.div>
  );
}
