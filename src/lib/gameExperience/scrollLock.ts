/**
 * FASE 44.1 · BLOQUEO DE SCROLL DE FONDO — UNO solo para todo el juego, con contador.
 *
 * Antes había dos (visor de carta y hojas/diálogos), y cada uno guardaba y restauraba `body.style.overflow` por su
 * cuenta: si se abrían dos capas y se cerraban en otro orden, la segunda restauraba el «hidden» de la primera y el
 * fondo quedaba bloqueado para siempre. Además, desde que body ya no es contenedor de scroll, bloquear body no
 * bloquea el viewport: el bloqueo va sobre `<html>`.
 *
 * Contrato: cada `lockScroll()` devuelve SU liberador (idempotente); el estilo original se restaura exactamente
 * cuando se libera el último. La lógica es pura (`createScrollLock`) para poder fuzzearla sin navegador.
 */

export interface StyleTarget { style: { overflow: string } }

export function createScrollLock(getTarget: () => StyleTarget | null) {
  let count = 0;
  let saved: string | null = null;
  return {
    lock(): () => void {
      const t = getTarget();
      if (!t) return () => {};
      if (count === 0) { saved = t.style.overflow; t.style.overflow = "hidden"; }
      count++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count = Math.max(0, count - 1);
        const target = getTarget();
        if (count === 0 && target) { target.style.overflow = saved ?? ""; saved = null; }
      };
    },
    count: () => count,
  };
}

const shared = createScrollLock(() => (typeof document === "undefined" ? null : document.documentElement));

/** Bloquea el scroll del documento mientras haya al menos una capa modal abierta. Devuelve el liberador. */
export const lockScroll = (): (() => void) => shared.lock();
export const scrollLockCount = (): number => shared.count();
