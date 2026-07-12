/**
 * VALIDATION — seguridad del repositorio: ids bien formados, formato permitido por
 * categoría, dimensiones coherentes, rutas válidas, ids/alias no duplicados y placeholder
 * oficial presente para TODA categoría (garantía de "la resolución nunca deja huecos").
 */
import { ALLOWED_FORMATS, ARTWORK_CATEGORIES } from "./types";
import type { ArtworkAsset, ArtworkIssue, ArtworkValidation } from "./types";

const ID_RE = /^[a-z0-9-]+:[a-z0-9_.:-]+$/i;
const PATH_RE = /^(\/|https?:\/\/|data:|css:)/;

/** Valida UN asset (declaración). */
export function validateAsset(a: ArtworkAsset): ArtworkValidation {
  const issues: ArtworkIssue[] = [];
  const err = (code: ArtworkIssue["code"], message: string): void => {
    issues.push({ severity: "error", assetId: a.id, code, message });
  };

  if (!ID_RE.test(a.id)) err("BAD_ID", `id mal formado: "${a.id}" (esperado "<categoría>:<slug>")`);
  if (!ALLOWED_FORMATS[a.category]?.includes(a.format)) err("BAD_FORMAT", `formato ${a.format} no permitido para ${a.category}`);
  if (!PATH_RE.test(a.path)) err("BAD_PATH", `ruta inválida: "${a.path}" (esperada /, http(s), data: o css:)`);
  const vectorial = a.format === "svg" || a.format === "data-svg" || a.format === "css" || a.format === "woff2" || a.format === "ttf";
  if (!vectorial && (a.width <= 0 || a.height <= 0)) err("BAD_DIMENSIONS", `resolución inválida ${a.width}x${a.height} para ${a.format}`);
  if (a.width < 0 || a.height < 0 || !Number.isInteger(a.width) || !Number.isInteger(a.height)) {
    err("BAD_DIMENSIONS", `dimensiones no válidas: ${a.width}x${a.height}`);
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/** Valida el repositorio COMPLETO (unicidad + placeholders de las 17 categorías). */
export function validateAssets(assets: ArtworkAsset[]): ArtworkValidation {
  const issues: ArtworkIssue[] = [];
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();

  for (const a of assets) {
    issues.push(...validateAsset(a).issues);
    if (ids.has(a.id)) issues.push({ severity: "error", assetId: a.id, code: "DUPLICATE_ID", message: `id duplicado: ${a.id}` });
    ids.add(a.id);
    for (const alias of a.aliases) {
      const owner = aliasOwner.get(alias);
      if (owner && owner !== a.id) {
        issues.push({ severity: "warning", assetId: a.id, code: "DUPLICATE_ALIAS", message: `alias "${alias}" ya pertenece a ${owner}` });
      } else {
        aliasOwner.set(alias, a.id);
      }
    }
  }

  for (const category of ARTWORK_CATEGORIES) {
    if (!assets.some((a) => a.placeholder && a.category === category)) {
      issues.push({ severity: "error", code: "MISSING_PLACEHOLDER", message: `categoría sin placeholder oficial: ${category}` });
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
