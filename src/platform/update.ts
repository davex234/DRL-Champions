/**
 * PLATFORM — fachada de compatibilidad de actualizaciones.
 *
 * La lógica AAA vive en `updater.ts` (máquina de estados + métricas + backend oficial de
 * Tauri) y en `channels.ts`. Este módulo mantiene la API histórica `checkForUpdate` /
 * `applyUpdate` para no romper a nadie que ya la importe, delegando en el controlador.
 */
import { APP_VERSION } from "./version";
import { getUpdateController } from "./updater";
import { loadChannel } from "./channels";

export interface UpdateInfo {
  available: boolean;
  current: string;
  version?: string;
  notes?: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const channel = await loadChannel();
  const c = getUpdateController(channel);
  const s = await c.check();
  return {
    available: s.phase === "available",
    current: s.current || APP_VERSION,
    version: s.available ?? undefined,
    notes: s.notes ?? undefined,
  };
}

/** Descarga + verifica (minisign) + instala + reinicia. Devuelve true si se aplicó. */
export async function applyUpdate(): Promise<boolean> {
  const channel = await loadChannel();
  const c = getUpdateController(channel);
  return c.downloadAndInstall(true);
}
