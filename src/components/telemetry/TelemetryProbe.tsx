"use client";

/**
 * LA SONDA DE TELEMETRÍA (Fase 14, bloque 4).
 *
 * No pinta nada. Vive dentro de `GameShell`, que es el único armazón del producto y está
 * en las dieciocho zonas de jugador (verificado en la Fase 12), y desde ahí observa dos
 * cosas: cuándo empieza una sesión y a qué zona entra el jugador.
 *
 * ────────────────────────── POR QUÉ UNA SOLA INTEGRACIÓN ──────────────────────────
 *
 * La alternativa era instrumentar las treinta y tres rutas una a una. Sería más código,
 * más frágil y —lo importante— **incompleto desde el primer día**: cualquier ruta nueva
 * nacería sin telemetría y nadie lo notaría hasta echar de menos los datos meses después.
 *
 * Aquí basta con que `zoneFromPath` conozca la ruta. Y si no la conoce, cae en `other`, que
 * sigue contando como uso del producto.
 *
 * ────────────────────────── MONTADA EN LAS DOS RAMAS ──────────────────────────
 *
 * `GameShell` renderiza dos árboles distintos: el normal y el inmersivo (la ceremonia del
 * sobre, la partida de duelo). La sonda va en los dos. Dejarla fuera del inmersivo habría
 * cegado justo las dos zonas de mayor intención del juego.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No lee estado del jugador, no toca el store, no espera a nada y no puede fallar hacia
 * fuera: cada llamada de `@/lib/telemetry/client` traga sus propios errores. Si este
 * componente desapareciera, el producto no cambiaría en nada.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startSession, trackZone } from "@/lib/telemetry/client";

export function TelemetryProbe() {
  const pathname = usePathname();

  /*
   * ARRANQUE, UNA VEZ POR MONTAJE.
   *
   * `startSession` es idempotente por su cuenta —solo emite si de verdad nace una sesión—
   * pero esta referencia evita además que el modo estricto de React, que monta dos veces
   * en desarrollo, dispare la primera zona por duplicado.
   */
  const arrancado = useRef(false);

  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;

    // El orden importa: primero la sesión, para que la primera zona ya viaje con su
    // identificador y el recorrido quede completo desde el primer evento.
    const { isNew } = startSession(pathname);
    trackZone(pathname, isNew);

    /*
     * MANEJADORES GLOBALES DE ERROR.
     *
     * `src/platform/crash.ts` ya los instala —captura `error` y `unhandledrejection`,
     * compone el informe y lo guarda— pero solo se activaba desde `initPlatform()`, y a
     * `initPlatform()` únicamente lo llama `BootGate`, es decir, **solo el launcher**.
     * En las rutas normales de jugador no había ningún manejador global: un fallo no
     * controlado no lo veía nadie.
     *
     * Se reutiliza el instalador que ya existe en vez de escribir un segundo capturador.
     * Es idempotente por su cuenta, así que llamarlo aquí no molesta al launcher si un
     * día ambos coinciden.
     *
     * Carga diferida para no meter la capa de plataforma en el paquete inicial: un
     * manejador de errores puede llegar unos milisegundos tarde; el vestíbulo, no.
     */
    void import("@/platform/crash")
      .then((m) => m.installCrashHandler())
      .catch(() => { /* sin manejador global; el producto sigue igual */ });
    // Solo al montar: los cambios de ruta los recoge el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * CAMBIOS DE ZONA.
   *
   * Se dispara en cada cambio de `pathname`, pero `trackZone` descarta el evento si la
   * zona no ha cambiado de verdad. Así, pasar de `/colecciones/ewc-2026` a
   * `/colecciones/champions-paris` no cuenta como zona nueva: es la misma respuesta a
   * «¿qué zonas usa el jugador?».
   */
  useEffect(() => {
    if (!arrancado.current) return;
    trackZone(pathname);
  }, [pathname]);

  return null;
}
