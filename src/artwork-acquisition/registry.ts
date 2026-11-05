/**
 * REGISTRY — materializa el resultado FINAL del pipeline: escribe el PNG+WEBP normalizados
 * en el directorio de assets (convenciones del Artwork Manager) y registra el ArtworkAsset
 * en el Manager. Único punto de escritura del módulo; jamás escribe un asset no validado.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeAsset, type ArtworkAsset, type ArtworkCategory, type ArtworkEngine } from "@/artwork";
import type { AcquisitionTarget, NormalizedAsset } from "./types";

/** Directorio por categoría bajo la raíz de assets (mismas convenciones que el Manager). */
export const SUBJECT_DIRS: Partial<Record<ArtworkCategory, string>> = {
  player: "players", team: "teams", "tournament-logo": "tournaments",
  role: "roles", region: "regions", agent: "agents", map: "maps", badge: "badges", collection: "collections",
  country: "flags",
};

export class AcquisitionRegistry {
  constructor(private artwork: ArtworkEngine, private assetsRoot: string) {}

  /** Ruta pública convencional de un sujeto. */
  publicPath(category: ArtworkCategory, fileName: string): string {
    return `/${SUBJECT_DIRS[category] ?? "misc"}/${fileName}`;
  }

  /** Escribe los ficheros normalizados y registra el asset (path nuevo). */
  register(norm: NormalizedAsset): ArtworkAsset {
    const dir = SUBJECT_DIRS[norm.target.category] ?? "misc";
    const abs = join(this.assetsRoot, dir);
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, norm.fileName), norm.png);
    writeFileSync(join(abs, norm.fileName.replace(/\.png$/, ".webp")), norm.webp);
    return this.registerAt(norm.target, this.publicPath(norm.target.category, norm.fileName), norm);
  }

  /** Registra un asset para un sujeto REUTILIZANDO un fichero ya almacenado (dedupe). */
  registerAt(target: AcquisitionTarget, path: string, norm: Pick<NormalizedAsset, "width" | "height">): ArtworkAsset {
    const asset = makeAsset({
      id: `${target.category}:${target.subjectId}`,
      category: target.category,
      name: `${target.category} de ${target.subjectId}`,
      path,
      format: "png",
      width: norm.width,
      height: norm.height,
      aliases: target.searchTerms,
      subjectId: target.subjectId,
    });
    this.artwork.register(asset);
    return asset;
  }
}
