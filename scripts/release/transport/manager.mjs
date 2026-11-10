/**
 * PROVIDER MANAGER (Fase 6/7) — decide DÓNDE publicar: construye y ordena los destinos
 * (región + provider) SIN modificar los providers ni el selector existente. Reutiliza
 * `createProvider`/`selectProvider`.
 *
 * Un destino = { id, region, provider, priority, required }.
 *
 * Config (no asume infraestructura):
 *   - `DRL_DISTRIBUTION` = JSON `[{ region, provider, priority, required, dir, env }]`
 *      o forma simple `region:provider[:dir]` separada por comas.
 *   - Sin config → un único destino con el provider seleccionado (compatibilidad Fase 3-5).
 */
import { createProvider, selectProvider } from "./provider.mjs";

function parseSimple(raw) {
  return raw.split(",").map((part) => {
    const [region, provider, dir] = part.split(":").map((x) => x?.trim());
    return { region, provider: provider || "local", dir: dir || undefined };
  });
}

function makeTarget(spec, i, env, root) {
  const penv = { ...env, ...(spec.env || {}) };
  // Provider local por-región: su directorio ES la región (aislamiento + manifiestos propios).
  if (spec.dir) penv.DRL_PUBLISH_LOCAL_DIR = spec.dir;
  const provider = createProvider(spec.provider || "local", { env: penv, root });
  return {
    id: spec.id || `${spec.region || "global"}-${spec.provider || "local"}`,
    region: spec.region || "global",
    provider,
    priority: spec.priority ?? i + 1,
    required: spec.required ?? true,
  };
}

/** Construye la lista de destinos a partir del entorno. */
export function buildTargets({ env = process.env, root = process.cwd() } = {}) {
  const raw = env.DRL_DISTRIBUTION;
  if (raw) {
    let specs;
    try { specs = JSON.parse(raw); } catch { specs = parseSimple(raw); }
    if (Array.isArray(specs) && specs.length) return specs.map((s, i) => makeTarget(s, i, env, root));
  }
  // Compatibilidad: un único destino (el provider activo) = comportamiento de las fases previas.
  const { provider } = selectProvider({ env, root });
  return [{ id: provider.name, region: env.DRL_REGION || "global", provider, priority: 1, required: true }];
}

/** Ordena destinos por prioridad (asc) y desempata por id. */
export function orderTargets(targets) {
  return targets.slice().sort((a, b) => (a.priority - b.priority) || String(a.id).localeCompare(String(b.id)));
}

/** Regiones requeridas declaradas en los destinos. */
export function requiredRegionsOf(targets) {
  return [...new Set(targets.filter((t) => t.required).map((t) => t.region))];
}

export const ProviderManager = { buildTargets, orderTargets, requiredRegionsOf };
export default ProviderManager;
