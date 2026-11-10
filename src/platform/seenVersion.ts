/**
 * PLATFORM — última versión "vista" por el usuario.
 *
 * Permite detectar que la app ACABA de actualizarse (la versión instalada es distinta a la
 * última que el usuario llegó a ver) para mostrar el mensaje "Actualizado correctamente".
 * Persistido vía el adaptador KV (Tauri fs / localStorage / memoria).
 */
import { getAdapter } from "./store";

const KEY = "last-seen-version";

export async function loadLastSeenVersion(): Promise<string | null> {
  try {
    return (await getAdapter().get(KEY)) || null;
  } catch {
    return null;
  }
}

export async function saveLastSeenVersion(full: string): Promise<void> {
  try {
    await getAdapter().set(KEY, full);
  } catch {
    /* best-effort */
  }
}
