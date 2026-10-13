"use client";

/**
 * FASE 61 · EL BOTÓN ATRÁS NO SACA DE UNA PARTIDA SIN AVISAR.
 *
 * Mientras `active`, se apila una entrada de historial con la MISMA URL (conservando el estado del router de Next,
 * que necesita su `__NA` para no recargar). Si el jugador pulsa Atrás, el navegador consume esa entrada, se vuelve a
 * apilar y se llama a `onAttempt` (la pantalla abre su diálogo de salida). Nada se abandona ni se envía aquí.
 *
 * Una recarga (F5) no pasa por aquí y es segura: la partida vive en el servidor y se retoma.
 */
import { useEffect, useRef } from "react";

export function useLeaveGuard(active: boolean, onAttempt: () => void): void {
  const cb = useRef(onAttempt);
  cb.current = onAttempt;
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const push = () => {
      const prev = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...prev, nxMatchGuard: true }, "", window.location.href);
    };
    push();
    const onPop = () => { push(); cb.current(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [active]);
}
