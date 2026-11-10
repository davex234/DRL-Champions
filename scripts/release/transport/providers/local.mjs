/**
 * LOCAL PROVIDER — destino local del propio repo. SIEMPRE disponible (no requiere secrets):
 * es el sink por defecto en desarrollo y en CI sin credenciales. Escribe en
 * `dist/published/` (o `DRL_PUBLISH_LOCAL_DIR`), que está gitignored.
 *
 * "Todo debe funcionar aunque falten Secrets" → este provider garantiza ese mínimo.
 */
import { join } from "node:path";
import { makeFsProvider } from "./fsbase.mjs";

export function createLocalProvider({ root = process.cwd(), env = process.env } = {}) {
  const dir = env.DRL_PUBLISH_LOCAL_DIR || join(root, "dist", "published");
  return makeFsProvider({ name: "local", root: dir, requireConfig: false });
}

export default { createLocalProvider };
