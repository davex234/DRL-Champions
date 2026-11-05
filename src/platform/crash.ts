/**
 * PLATFORM — crash reporter (preparado para enviar al servidor en el futuro).
 *
 * Captura errores no controlados, guarda {versión, plataforma, SO, stack, hora} en logs
 * y en el adaptador KV. Hoy solo local; el envío remoto se activará luego sin reescribir.
 */
import { buildInfo } from "./version";
import { getAdapter } from "./store";
import { error, getLogs } from "./log";

export interface CrashReport {
  at: number;
  version: string;
  platform: string;
  os: string;
  message: string;
  stack?: string;
  recentLogs: { at: number; level: string; scope: string; msg: string }[];
}

export async function reportCrash(err: unknown): Promise<CrashReport> {
  const b = buildInfo();
  const e = err instanceof Error ? err : new Error(String(err));
  const report: CrashReport = {
    at: Date.now(), version: b.version, platform: b.platform, os: b.os,
    message: e.message, stack: e.stack,
    recentLogs: getLogs().slice(-25).map((l) => ({ at: l.at, level: l.level, scope: l.scope, msg: l.msg })),
  };
  error("crash", e.message, { stack: e.stack });
  try { await getAdapter().set(`crash-${report.at}`, JSON.stringify(report)); } catch { /* noop */ }

  /*
   * FASE 14 · Aquí estaba el `TODO(server): POST report al endpoint de crashes cuando
   * exista`. Ya existe: `/api/telemetry`.
   *
   * LO QUE SE ENVÍA Y LO QUE NO. El informe completo se queda donde siempre —en el
   * almacenamiento local del dispositivo— y al servidor solo va lo mínimo para saber que
   * algo se rompió y poder agruparlo:
   *
   *   · `recentLogs` NO viaja. Es un búfer de 25 entradas al que cualquiera puede haber
   *     pasado cualquier cosa con `log()`. Mandarlo sería abrir un canal por el que
   *     podría salir, un día, cualquier dato del jugador.
   *   · El `stack` NO viaja. Lleva rutas absolutas del sistema de ficheros de quien
   *     ejecuta y, en un paquete de escritorio, la estructura de la instalación.
   *   · El mensaje viaja, y el servidor lo sanea otra vez por forma (JWT, Bearer, correo,
   *     UUID, consultas, rutas, IP) antes de escribirlo.
   *
   * `trackError` ya trae sus tres cortafuegos: no reporta un error mientras reporta otro
   * —el bucle evidente cuando lo que falla es la red—, descarta huellas repetidas y tiene
   * techo por sesión.
   *
   * Y no se espera: un informe de fallo no puede retrasar la recuperación de la pantalla.
   */
  try {
    const { trackError } = await import("@/lib/telemetry/client");
    trackError({
      code: "UNHANDLED",
      message: e.message,
      source: "client",
      /*
       * `error`, no `critical`. Un error no controlado es grave, pero `critical` está
       * reservado a los nueve flujos que impiden jugar, y desde aquí —un manejador
       * global— no se sabe en cuál estaba el jugador. Reclasificar hacia arriba sin
       * saberlo vaciaría de significado la única señal que la consola necesita.
       */
      severity: "error",
    });
  } catch { /* la telemetría jamás decide si un fallo se recupera o no */ }

  return report;
}

/** Instala manejadores globales (navegador/Tauri WebView). Idempotente. */
let installed = false;
export function installCrashHandler(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => { void reportCrash(ev.error ?? ev.message); });
  window.addEventListener("unhandledrejection", (ev) => { void reportCrash((ev as PromiseRejectionEvent).reason); });
}
