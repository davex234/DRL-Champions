/**
 * FILESYSTEM PROVIDER — destino de filesystem EXTERNO (carpeta servida por un web server, share
 * de red montado, volumen del host de actualizaciones…). A diferencia de Local, requiere que la
 * raíz se declare explícitamente (`DRL_PUBLISH_FS_DIR`) y puede exponer una URL pública
 * (`DRL_PUBLISH_FS_URL`) para que los manifiestos apunten al servidor real.
 */
import { makeFsProvider } from "./fsbase.mjs";

export function createFilesystemProvider({ env = process.env } = {}) {
  const root = env.DRL_PUBLISH_FS_DIR || null;
  const urlBase = env.DRL_PUBLISH_FS_URL || null;
  return makeFsProvider({ name: "filesystem", root, requireConfig: true, urlBase });
}

export default { createFilesystemProvider };
