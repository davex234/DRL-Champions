/**
 * CDN LAYER (Fase 6/7) — SOLO el motor de selección: endpoint principal, mirrors, prioridad,
 * health y fallback por región. NO implementa Cloudflare Workers / DNS / proxies (eso es
 * infraestructura, Fase 7). Es una función PURA sobre los destinos y su health.
 */

/**
 * Construye la vista CDN a partir de los destinos con health.
 * `targets`: [{ id, region, priority, score, ok, destination }]
 * Devuelve mirror principal/secundarios y orden de fallback por región + región primaria global.
 */
export function buildCdn(targets) {
  const byRegion = {};
  for (const t of targets) (byRegion[t.region] ??= []).push(t);

  const regions = Object.keys(byRegion).sort().map((region) => {
    const sorted = byRegion[region].slice().sort((a, b) => (b.score - a.score) || (a.priority - b.priority) || a.id.localeCompare(b.id));
    const healthy = sorted.filter((t) => t.ok);
    const primary = healthy[0] ?? sorted[0] ?? null;
    const mirrors = sorted.filter((t) => t.id !== primary?.id).map((t) => t.id);
    return {
      region,
      primary: primary?.id ?? null,
      endpoint: primary?.destination ?? null,
      mirrors,
      fallbackOrder: sorted.map((t) => t.id),
      healthy: healthy.length,
      total: sorted.length,
    };
  });

  // Región primaria global = la del mejor score disponible.
  const best = (region) => byRegion[region].reduce((m, t) => Math.max(m, t.ok ? t.score : -1), -1);
  const primaryRegion = regions.map((r) => r.region).sort((a, b) => best(b) - best(a) || a.localeCompare(b))[0] ?? null;

  return { primaryRegion, regions };
}

export const CdnEngine = { buildCdn };
export default CdnEngine;
