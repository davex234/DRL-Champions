/**
 * CROPPING — detección de bordes recortados: contenido OPACO tocando los bordes en un
 * asset que sí tiene transparencia (el sujeto no cabe en el encuadre). Solo informa.
 */
import { REQUIREMENTS } from "@/artwork-acquisition";
import type { ArtworkAsset } from "@/artwork";
import type { PixelAnalysis, QualityIssue } from "./types";

export function croppingIssues(asset: ArtworkAsset, px: PixelAnalysis | null): QualityIssue[] {
  const req = REQUIREMENTS[asset.category];
  if (!req?.requiresAlpha || !px || px.corrupt || !px.hasAlpha) return [];
  // Con transparencia real pero >35% del borde opaco ⇒ el sujeto toca/corta el encuadre.
  if (px.transparentRatio >= 0.02 && px.edgeOpaqueRatio > 0.35) {
    return [{
      assetId: asset.id, category: asset.category, code: "CROPPED_EDGES", severity: "warning",
      message: `bordes recortados: el ${(px.edgeOpaqueRatio * 100).toFixed(0)}% del contorno tiene contenido opaco`,
    }];
  }
  return [];
}
