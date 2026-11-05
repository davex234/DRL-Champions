/**
 * RESOLUTION — detecciones de resolución/aspecto/compresión contra los requisitos OFICIALES
 * por categoría (REQUIREMENTS del Acquisition Engine, API pública). Solo informa.
 */
import { REQUIREMENTS } from "@/artwork-acquisition";
import type { ArtworkAsset } from "@/artwork";
import type { PixelAnalysis, QualityIssue } from "./types";

export function resolutionIssues(asset: ArtworkAsset, px: PixelAnalysis | null): QualityIssue[] {
  const req = REQUIREMENTS[asset.category];
  const issues: QualityIssue[] = [];
  const w = px?.width || asset.width;
  const h = px?.height || asset.height;
  if (!req || !w || !h) return issues;
  const add = (code: QualityIssue["code"], severity: QualityIssue["severity"], message: string): void => {
    issues.push({ assetId: asset.id, category: asset.category, code, severity, message });
  };

  if (Math.min(w, h) < req.minSize) {
    add("TOO_SMALL", "critical", `imagen demasiado pequeña: ${w}x${h} (mínimo ${req.minSize})`);
  } else if (Math.min(w, h) < req.normalizedWidth) {
    add("LOW_RESOLUTION", "warning", `resolución por debajo del estándar: ${w}x${h} (estándar ${req.normalizedWidth})`);
  }
  const aspect = w / h;
  if (Math.abs(aspect - req.aspect) > req.aspectTolerance) {
    add("BAD_ASPECT", "warning", `aspecto ${aspect.toFixed(2)} fuera de ${req.aspect.toFixed(2)}±${req.aspectTolerance} (posible imagen estirada)`);
  }
  if (px && !px.corrupt && px.bytesPerPixel > 0 && px.bytesPerPixel < 0.08) {
    add("OVER_COMPRESSED", "warning", `compresión excesiva: ${px.bytesPerPixel.toFixed(3)} bytes/píxel`);
  }
  return issues;
}
