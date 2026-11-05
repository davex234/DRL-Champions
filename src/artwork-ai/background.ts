/**
 * BACKGROUND — detección de "fondo no eliminado" y transparencia perdida en categorías que
 * exigen recorte (player/team/role/badge…): sin canal alfa, o con alfa pero opaco de borde
 * a borde (transparencia ~0). Solo informa; jamás recorta nada.
 */
import { REQUIREMENTS } from "@/artwork-acquisition";
import type { ArtworkAsset } from "@/artwork";
import type { PixelAnalysis, QualityIssue } from "./types";

export function backgroundIssues(asset: ArtworkAsset, px: PixelAnalysis | null): QualityIssue[] {
  const req = REQUIREMENTS[asset.category];
  if (!req?.requiresAlpha || !px || px.corrupt) return [];
  const issues: QualityIssue[] = [];

  if (!px.hasAlpha) {
    issues.push({
      assetId: asset.id, category: asset.category, code: "NO_TRANSPARENCY", severity: "critical",
      message: "transparencia perdida: la categoría exige fondo recortado y el fichero no tiene canal alfa",
    });
  } else if (px.transparentRatio < 0.02 && px.edgeOpaqueRatio > 0.85) {
    issues.push({
      assetId: asset.id, category: asset.category, code: "BACKGROUND_NOT_REMOVED", severity: "warning",
      message: `el fondo parece no haber sido eliminado (transparencia ${(px.transparentRatio * 100).toFixed(1)}%, bordes opacos ${(px.edgeOpaqueRatio * 100).toFixed(0)}%)`,
    });
  }
  return issues;
}
