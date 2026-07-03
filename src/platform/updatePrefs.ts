/**
 * PLATFORM — preferencias de actualización (Configuración del launcher).
 *
 * Controla el comportamiento automático al iniciar: buscar / descargar / instalar / reiniciar.
 * El canal vive aparte en `channels.ts`. Persistido vía el adaptador KV (Tauri fs / localStorage
 * / memoria). Merge seguro con defaults.
 */
import { getAdapter } from "./store";

export interface UpdatePrefs {
  /** Buscar actualizaciones al iniciar. */
  checkOnStart: boolean;
  /** Empezar la descarga automáticamente cuando hay actualización. */
  autoDownload: boolean;
  /** Instalar automáticamente tras descargar. */
  autoInstall: boolean;
  /** Reiniciar automáticamente tras instalar. */
  autoRestart: boolean;
  /** Comprobar periódicamente mientras la app está abierta. */
  periodicCheck: boolean;
  /** Intervalo de la comprobación periódica, en minutos. */
  pollMinutes: number;
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = {
  checkOnStart: true,
  autoDownload: true,
  autoInstall: true,
  autoRestart: true,
  periodicCheck: true,
  pollMinutes: 15,
};

/** Normaliza el intervalo (evita valores absurdos). */
export function clampPollMinutes(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_UPDATE_PREFS.pollMinutes;
  return Math.min(180, Math.max(5, Math.round(n)));
}

const KEY = "update-prefs";

export async function loadUpdatePrefs(): Promise<UpdatePrefs> {
  try {
    const raw = await getAdapter().get(KEY);
    if (!raw) return { ...DEFAULT_UPDATE_PREFS };
    return { ...DEFAULT_UPDATE_PREFS, ...(JSON.parse(raw) as Partial<UpdatePrefs>) };
  } catch {
    return { ...DEFAULT_UPDATE_PREFS };
  }
}

export async function saveUpdatePrefs(patch: Partial<UpdatePrefs>): Promise<UpdatePrefs> {
  const next = { ...(await loadUpdatePrefs()), ...patch };
  await getAdapter().set(KEY, JSON.stringify(next));
  return next;
}
