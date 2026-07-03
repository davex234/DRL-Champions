/**
 * DRL ASSET MANAGER — selección del "mejor asset" (PURO).
 *
 * Criterio único y determinista usado tanto por el resolver del cliente como por
 * la BD (`asset_best` lo replica en SQL). Generaliza el SOURCE_PRIORITY del motor
 * de torneos (`src/domain/tournaments/rarity.ts`).
 */
import type { Asset, AssetSource } from "./types";

/** Prioridad por defecto de cada fuente (mayor = mejor). */
export const SOURCE_PRIORITY: Record<AssetSource, number> = {
  riot_media: 100,
  event_official: 80,
  generated: 70,
  manual: 60,
  upload: 55,
  social: 50,
  broadcast_frame: 30,
};

/**
 * Puntuación comparable de un asset. Orden de importancia:
 * prioridad explícita → calidad → resolución → fuente → versión.
 * Solo tiene sentido entre assets del mismo sujeto/tipo.
 */
export function scoreAsset(a: Pick<Asset, "priority" | "quality" | "width" | "height" | "source" | "version">): number {
  const area = (a.width ?? 0) * (a.height ?? 0);
  return (
    a.priority * 1e12 +
    a.quality * 1e9 +
    Math.min(area, 1e8) * 10 +
    (SOURCE_PRIORITY[a.source] ?? 0) * 1e5 +
    a.version
  );
}

/**
 * Elige el mejor asset aprobado y vigente de una lista (mismo sujeto). Devuelve
 * null si no hay ninguno apto.
 */
export function pickBest(assets: Asset[]): Asset | null {
  const apt = assets.filter((a) => a.status === "approved" && a.isCurrent);
  if (!apt.length) return null;
  return [...apt].sort((a, b) => scoreAsset(b) - scoreAsset(a))[0];
}

/**
 * Clave de deduplicado: el checksum si existe; si no, una clave por
 * tipo+sujeto+nombre (para detectar candidatos sin checksum calculado).
 */
export function dedupeKey(a: Pick<Asset, "checksum" | "kind" | "subjectType" | "subjectId" | "name">): string {
  if (a.checksum) return `sum:${a.checksum}`;
  return `meta:${a.kind}:${a.subjectType}:${a.subjectId ?? "_"}:${a.name.toLowerCase()}`;
}
