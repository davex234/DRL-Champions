/**
 * IMAGES — materialización de refs a contenido embebible en el documento de render, con
 * CACHE por ruta (un asset jamás se lee dos veces; los compartidos entre cartas se
 * reutilizan). Política de carga PASIVA: ficheros locales de `public/` y recursos
 * virtuales (`data:`) únicamente; un asset remoto o ilegible NUNCA falla ni descarga:
 * se sustituye por el placeholder oficial de su categoría vía Artwork Manager.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtworkAsset, ArtworkEngine, ArtworkFormat } from "@/artwork";
import type { ComposedElement } from "@/artwork-composer";

const MIME: Partial<Record<ArtworkFormat, string>> = {
  svg: "image/svg+xml", "data-svg": "image/svg+xml", png: "image/png", webp: "image/webp",
  jpg: "image/jpeg", gif: "image/gif", ico: "image/x-icon",
};

export interface MaterializedImage {
  /** data-URI embebible, o null si el recurso es css/font (se dibuja como forma/texto). */
  href: string | null;
  /** alto/ancho intrínseco declarado (1 si desconocido). */
  aspect: number;
  /** true si el contenido final es el placeholder oficial (remoto/ilegible/faltante). */
  substituted: boolean;
  css: boolean;
}

export type LocalReader = (publicPath: string) => Uint8Array;

/** Lector por defecto: `public/` del proyecto (solo disco local, cero red). */
export const publicReader = (root = process.cwd()): LocalReader =>
  (p) => readFileSync(join(root, "public", p.replace(/^\//, "")));

export class AssetMaterializer {
  private byPath = new Map<string, MaterializedImage>();
  loads = 0;
  reuses = 0;

  constructor(private artwork: ArtworkEngine, private reader: LocalReader = publicReader()) {}

  /** Materializa la ref de un elemento (real o placeholder; jamás lanza, jamás null-capa). */
  materialize(el: ComposedElement): MaterializedImage {
    const asset = this.artwork.resolveRef(el.ref) ?? this.artwork.resolve(el.category, undefined).asset;
    return this.ofAsset(asset, el.category);
  }

  private ofAsset(asset: ArtworkAsset, category: ComposedElement["category"]): MaterializedImage {
    const hit = this.byPath.get(asset.path);
    if (hit) { this.reuses++; return hit; }
    const out = this.build(asset, category);
    this.byPath.set(asset.path, out);
    this.loads++;
    return out;
  }

  private build(asset: ArtworkAsset, category: ComposedElement["category"]): MaterializedImage {
    const aspect = asset.width > 0 && asset.height > 0 ? asset.height / asset.width : 1;
    if (asset.path.startsWith("css:")) return { href: null, aspect, substituted: false, css: true };
    if (asset.path.startsWith("data:")) return { href: asset.path, aspect, substituted: !!asset.placeholder, css: false };
    if (asset.path.startsWith("/")) {
      try {
        const bytes = this.reader(asset.path);
        const mime = MIME[asset.format] ?? "application/octet-stream";
        return { href: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`, aspect, substituted: false, css: false };
      } catch {
        return this.placeholder(category);
      }
    }
    // Remoto (http/https): el Renderer JAMÁS descarga → placeholder oficial.
    return this.placeholder(category);
  }

  private placeholder(category: ComposedElement["category"]): MaterializedImage {
    const ph = this.artwork.resolve(category, undefined).asset;
    return { href: ph.path, aspect: 1, substituted: true, css: false };
  }
}
