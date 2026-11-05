/**
 * F67 · ARRANQUE DEL SERVIDOR (hook oficial de Next.js, se ejecuta una vez por proceso antes de atender tráfico).
 *
 * Valida la configuración. En PRODUCCIÓN, un fallo CRÍTICO (falta Supabase, clave pública que es de servicio…) aborta
 * el arranque con un mensaje claro en el log, en vez de descubrirlo con el primer usuario. En desarrollo solo avisa.
 * Nunca imprime valores: solo nombres de variables.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv, describeEnv } = await import("./server/ops/env");
  const { logEvent } = await import("./server/ops/log");
  const r = validateEnv(process.env);
  logEvent(r.ok ? (r.issues.length ? "warn" : "info") : "error", "startup", "configuración", {
    production: r.production, ok: r.ok, issues: r.issues.map((i) => `${i.level}:${i.name}:${i.problem}`),
  });
  if (!r.ok && r.production) {
    /*
     * Salir con código 1, no solo lanzar: medido, un `throw` aquí deja el proceso VIVO sin escuchar (Next registra el
     * fallo y sigue), y un gestor de procesos no se entera. Con exit(1), systemd/pm2 ven el fallo y el log dice por qué.
     */
    console.error(`[startup] Configuración crítica incompleta; el servidor no arranca.\n${describeEnv(r)}`);
    process.exit(1);
  }
}
