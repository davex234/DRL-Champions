/**
 * LAYERS — materialización PASIVA de cada elemento de la composición a su fragmento SVG,
 * EN EL ORDEN RECIBIDO (jamás se reordena ni se decide nada): imágenes por data-URI,
 * recursos `css:` como formas de la paleta (marcos/bordes/fondo/rareza/brillo), textos
 * como <text> referenciando la tipografía, efectos vía effects.ts y máscara como clip
 * (aplicada a nivel de documento por canvas.ts).
 */
import type { ArtworkComposition, ComposedElement } from "@/artwork-composer";
import { n, place, placedAttrs, CORNER_RADIUS, type Placed } from "./canvas";
import { effectSvg } from "./effects";
import type { AssetMaterializer } from "./images";
import type { RenderSize } from "./types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colorOf = (token: string, pal: ArtworkComposition["palette"]): string => {
  if (token === "palette.primary") return pal.primary;
  if (token === "palette.secondary") return pal.secondary;
  return pal.text;
};

const ALIGN_ANCHOR: Record<string, string> = { left: "start", center: "middle", right: "end" };

/** Formas deterministas para los recursos `css:` del design system. */
function cssShape(el: ComposedElement, comp: ArtworkComposition, size: RenderSize, p: Placed): string {
  const pal = comp.palette;
  const r = size.width * CORNER_RADIUS;
  const category = el.category;
  if (category === "background") {
    const id = `bg-${el.id.replace(/[^a-z0-9-]/gi, "-")}`;
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${pal.primary}" stop-opacity="0.55"/>` +
      `<stop offset="45%" stop-color="#0c1220"/><stop offset="100%" stop-color="#05070d"/>` +
      `</linearGradient></defs><rect x="0" y="0" width="${size.width}" height="${size.height}" fill="url(#${id})"/>`;
  }
  if (category === "frame") {
    const inset = size.width * 0.03;
    return `<rect x="${n(inset)}" y="${n(inset)}" width="${n(size.width - inset * 2)}" height="${n(size.height - inset * 2)}" rx="${n(r * 0.8)}" fill="none" stroke="${pal.primary}" stroke-width="${n(size.width * 0.012)}"${placedAttrs(p)}/>`;
  }
  if (category === "border") {
    return `<rect x="${n(size.width * 0.008)}" y="${n(size.width * 0.008)}" width="${n(size.width * 0.984)}" height="${n(size.height - size.width * 0.016)}" rx="${n(r)}" fill="none" stroke="${pal.secondary}" stroke-width="${n(size.width * 0.006)}"${placedAttrs(p)}/>`;
  }
  if (category === "rarity") {
    return `<g${placedAttrs(p)}><circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.w / 2)}" fill="${pal.primary}" stroke="${pal.secondary}" stroke-width="${n(p.w * 0.08)}"/>` +
      `<text x="${n(p.cx)}" y="${n(p.cy + p.w * 0.18)}" font-family="'Segoe UI', Arial, sans-serif" font-size="${n(p.w * 0.55)}" font-weight="700" fill="${pal.text}" text-anchor="middle">★</text></g>`;
  }
  if (category === "effect") {
    // Acabado de superficie (overlay:finish → effect:shine del design system).
    const id = `shine-${el.id.replace(/[^a-z0-9-]/gi, "-")}`;
    return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity="0.14"/><stop offset="45%" stop-color="#fff" stop-opacity="0"/><stop offset="100%" stop-color="#fff" stop-opacity="0.05"/></linearGradient></defs>` +
      `<rect x="0" y="0" width="${size.width}" height="${size.height}" fill="url(#${id})"${placedAttrs(p)}/>`;
  }
  return "";
}

/** Un elemento → su fragmento SVG (pasivo: el QUÉ ya viene decidido por el Composer). */
export function elementSvg(
  el: ComposedElement, comp: ArtworkComposition, size: RenderSize, assets: AssetMaterializer,
): string {
  // La máscara de carta se aplica como clip del documento (canvas.ts): aquí no pinta.
  if (el.id === "overlay:mask") return "";

  if (el.type === "text" && el.text) {
    const p = place(el.layout, size);
    const fs = el.text.size * size.height;
    const weight = el.text.role === "ovr" || el.text.role === "player-name" ? "800" : "500";
    return `<text x="${n(p.cx)}" y="${n(p.cy)}" font-family="'Segoe UI', Arial, sans-serif" font-size="${n(fs)}" font-weight="${weight}" fill="${colorOf(el.text.colorToken, comp.palette)}" text-anchor="${ALIGN_ANCHOR[el.layout.align]}"${el.layout.opacity < 1 ? ` opacity="${n(el.layout.opacity)}"` : ""}>${esc(el.text.content)}</text>`;
  }

  if (el.type === "effect" && el.effect) {
    return effectSvg(el, el.effect, place(el.layout, size, 1.4), comp.palette, comp.cardId);
  }

  const img = assets.materialize(el);
  if (img.css) return cssShape(el, comp, size, place(el.layout, size));
  if (!img.href) return "";
  const p = place(el.layout, size, img.aspect);
  return `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="xMidYMid meet" href="${img.href}"${placedAttrs(p)}/>`;
}
