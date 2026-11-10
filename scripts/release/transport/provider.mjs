/**
 * PROVIDER SELECTOR — elige el destino de publicación según la configuración disponible, SIN
 * hardcodear nada. Cada provider implementa el mismo contrato (ver providers/fsbase.mjs):
 *
 *   Local · Filesystem · GitHub Release · Cloudflare R2   (+ Custom, vía registro)
 *
 * Selección:
 *   - `DRL_PUBLISH_PROVIDER=<name>` fuerza uno concreto.
 *   - En automático se prefiere el más "remoto" que esté configurado: r2 → github → filesystem.
 *   - Si nada está configurado, cae a `local` (SIEMPRE disponible) → funciona sin secrets.
 */
import { createLocalProvider } from "./providers/local.mjs";
import { createFilesystemProvider } from "./providers/filesystem.mjs";
import { createGitHubProvider } from "./providers/github.mjs";
import { createR2Provider } from "./providers/r2.mjs";

export const FACTORIES = {
  local: createLocalProvider,
  filesystem: createFilesystemProvider,
  github: createGitHubProvider,
  r2: createR2Provider,
};

// Orden de preferencia en automático (más remoto primero); local es el último recurso.
const AUTO_ORDER = ["r2", "github", "filesystem", "local"];

/** Instancia un provider por nombre (sin comprobar configuración). */
export function createProvider(name, opts = {}) {
  const make = FACTORIES[name];
  if (!make) throw new Error(`Provider desconocido: ${name} (válidos: ${Object.keys(FACTORIES).join(", ")})`);
  return make(opts);
}

/** Resuelve el provider a usar: forzado por env, o el primero configurado del orden automático. */
export function selectProvider({ env = process.env, root = process.cwd() } = {}) {
  const opts = { env, root };
  const forced = env.DRL_PUBLISH_PROVIDER;
  if (forced) {
    const p = createProvider(forced, opts);
    return { provider: p, forced: true, configured: p.configured() };
  }
  for (const name of AUTO_ORDER) {
    const p = createProvider(name, opts);
    if (p.configured()) return { provider: p, forced: false, configured: true };
  }
  // Inalcanzable (local siempre configura), pero por robustez:
  const local = createLocalProvider(opts);
  return { provider: local, forced: false, configured: true };
}

export default { FACTORIES, createProvider, selectProvider };
