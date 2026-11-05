"use client";

/**
 * ¿Se cumple una media query AHORA? (Fase 24.3)
 *
 * Existe para que el cuadro de eliminatorias monte UNA versión —columnas en escritorio,
 * selector de ronda en móvil— en vez de pintar las dos y esconder una con CSS: un lector de
 * pantalla leería los partidos dos veces. En el servidor y antes de hidratar devuelve
 * `initial`.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Móvil: por debajo del punto `md` de Tailwind. */
export const useIsNarrow = (): boolean => useMediaQuery("(max-width: 767px)");
