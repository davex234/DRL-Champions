/**
 * PLATFORM — control del ciclo de vida de la app de escritorio (salir).
 *
 * Usa el plugin oficial `@tauri-apps/plugin-process`. Fuera de Tauri intenta cerrar la
 * ventana (web) sin romper nada.
 */
import { isTauri } from "./env";
import { info as logInfo } from "./log";

/** Cierra la aplicación (botón SALIR del launcher). */
export async function exitApp(code = 0): Promise<void> {
  logInfo("app", `Cerrando la aplicación (code ${code})`);
  if (isTauri()) {
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(code);
      return;
    } catch {
      /* cae al fallback */
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.close();
    } catch {
      /* navegadores bloquean close de pestañas no abiertas por script */
    }
  }
}
