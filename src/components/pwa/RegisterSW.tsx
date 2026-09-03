"use client";

import { useEffect } from "react";

/**
 * Registra el service worker en producción — y, en desarrollo, lo RETIRA.
 *
 * Lo segundo no es un detalle. Un service worker se instala por ORIGEN, no por modo:
 * basta con haber abierto una vez una compilación de producción en `localhost:3001` para
 * que siga controlando las sesiones de `next dev` en ese mismo puerto. Entonces sirve
 * desde su caché artefactos de producción a un cliente de desarrollo, cuyos
 * identificadores de módulo no tienen nada que ver, y el protocolo Flight se rompe con
 * `chunk.reason.enqueueModel is not a function`.
 *
 * La versión anterior se limitaba a `return` en desarrollo, que deja al service worker ya
 * instalado exactamente donde estaba. No registrar no es lo mismo que desregistrar.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // ── Desarrollo: retirar cualquier service worker previo y vaciar sus cachés ──
    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          if (regs.length === 0) return;

          // Se le pide al propio worker que se purgue: así borra también sus cachés,
          // a las que la página no siempre puede llegar por nombre.
          navigator.serviceWorker.controller?.postMessage("nexus:purge");
          await Promise.all(regs.map((r) => r.unregister()));

          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
          // Una recarga deja la pestaña ya sin controlador, con artefactos de dev limpios.
          window.location.reload();
        } catch {
          /* si no se puede, la aplicación sigue: solo se queda el worker viejo */
        }
      })();
      return;
    }

    // ── Producción: registro normal ──
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sin SW: la app sigue funcionando, solo sin offline */
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
