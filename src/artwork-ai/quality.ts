/**
 * QUALITY — QualityScore objetivo 0..100 por asset, agregando siete dimensiones medibles
 * (resolución · nitidez · consistencia · formato · uso · licencia · estado) con pesos
 * fijos. Sin IA generativa: aritmética determinista sobre métricas y issues.
 */
import { REQUIREMENTS } from "@/artwork-acquisition";
import { currentVersion } from "@/artwork-updater";
import type { ArtworkAsset } from "@/artwork";
import type { AnalysisContext, AssetQuality, PixelAnalysis, QualityDimensions, QualityGrade, QualityIssue } from "./types";

const WEIGHTS: Record<keyof QualityDimensions, number> = {
  resolution: 25, sharpness: 15, consistency: 15, format: 10, usage: 10, license: 15, status: 10,
};

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function scoreAsset(
  asset: ArtworkAsset, px: PixelAnalysis | null, issues: QualityIssue[], ctx: AnalysisContext,
): AssetQuality {
  const mine = issues.filter((i) => i.assetId === asset.id);
  const has = (code: QualityIssue["code"]): boolean => mine.some((i) => i.code === code);
  const req = REQUIREMENTS[asset.category];

  // Resolución: proporción frente al estándar de la categoría, con castigos de issues.
  const w = px?.width || asset.width;
  let resolution = req && w ? clamp((Math.min(w, req.normalizedWidth * 2) / req.normalizedWidth) * 75) : 70;
  if (has("TOO_SMALL")) resolution = 10;
  else if (has("LOW_RESOLUTION")) resolution = Math.min(resolution, 45);
  if (has("BAD_ASPECT")) resolution = Math.min(resolution, 55);

  const sharpness = px && !px.corrupt ? clamp(30 + px.sharpness * 90 - (has("OVER_COMPRESSED") ? 30 : 0)) : 60;

  let consistency = 100;
  if (has("INCONSISTENT_SUBJECT")) consistency -= 40;
  if (has("OUTDATED_VERSION")) consistency -= 25;
  if (has("UNOFFICIAL_MISMATCH")) consistency -= 35;
  if (has("DUPLICATE")) consistency -= 20;

  let format = ["png", "webp", "svg", "data-svg"].includes(asset.format) ? 100 : 60;
  if (has("NO_TRANSPARENCY")) format -= 50;
  if (has("BACKGROUND_NOT_REMOVED")) format -= 30;
  if (has("CROPPED_EDGES")) format -= 20;

  const usage = has("ORPHAN") ? 20 : has("UNUSED") ? 55 : 100;

  const entry = ctx.lifecycle?.assets[asset.id];
  const license = entry
    ? (currentVersion(entry).license === "official" ? 100 : currentVersion(entry).license ? 75 : 30)
    : (has("NO_LICENSE") ? 30 : 60);

  let status = 100;
  if (entry?.status === "obsolete") status = 40;
  if (entry?.status === "removed") status = 10;
  if (has("CORRUPT") || px?.corrupt) status = 0;

  const dimensions: QualityDimensions = {
    resolution: clamp(resolution), sharpness, consistency: clamp(consistency),
    format: clamp(format), usage, license: clamp(license), status: clamp(status),
  };
  const total = Object.keys(WEIGHTS).reduce(
    (sum, k) => sum + dimensions[k as keyof QualityDimensions] * WEIGHTS[k as keyof QualityDimensions], 0,
  ) / 100;
  const score = has("CORRUPT") || px?.corrupt ? Math.min(15, clamp(total)) : clamp(total);

  return { assetId: asset.id, category: asset.category, subjectId: asset.subjectId, score, grade: gradeOf(score), dimensions, issues: mine };
}

export function gradeOf(score: number): QualityGrade {
  if (score >= 90) return "excelente";
  if (score >= 75) return "bueno";
  if (score >= 60) return "aceptable";
  if (score >= 40) return "deficiente";
  return "crítico";
}
