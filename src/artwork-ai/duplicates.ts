/**
 * DUPLICATES — detección de recursos idénticos: por huella del CONTENIDO decodificado
 * (dos ficheros distintos con los mismos píxeles) y por huella declarada del Manager
 * (dos assets apuntando al mismo recurso). Solo informa; jamás fusiona ni borra.
 */
import type { ArtworkAsset } from "@/artwork";
import type { AnalysisContext, DuplicateGroup, QualityIssue } from "./types";

export function findDuplicates(ctx: AnalysisContext): DuplicateGroup[] {
  const byHash = new Map<string, string[]>();
  for (const a of ctx.assets) {
    const px = ctx.pixels.get(a.id);
    const key = px && !px.corrupt ? px.contentHash : a.hash;
    byHash.set(key, [...(byHash.get(key) ?? []), a.id]);
  }
  return [...byHash.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([contentHash, assetIds]) => ({ contentHash, assetIds: [...assetIds].sort() }))
    .sort((a, b) => (a.contentHash < b.contentHash ? -1 : 1));
}

export function duplicateIssues(ctx: AnalysisContext, groups: DuplicateGroup[]): QualityIssue[] {
  const byId = new Map(ctx.assets.map((a) => [a.id, a]));
  return groups.flatMap((g) => g.assetIds.map((assetId): QualityIssue => ({
    assetId,
    category: byId.get(assetId)!.category,
    code: "DUPLICATE",
    severity: "warning",
    message: `hay ${g.assetIds.length} assets idénticos: ${g.assetIds.join(", ")}`,
  })));
}
