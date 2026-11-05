/**
 * EFFECTS — materialización PASIVA de los efectos DECLARADOS por el Composer (glow · foil ·
 * holographic · shadow · fire · smoke · lightning · particles · aura) como fragmentos SVG
 * deterministas: la aleatoriedad visual usa un PRNG sembrado por cardId+efecto (byte a
 * byte reproducible). Aquí no se decide QUÉ efectos lleva la carta: eso ya viene decidido.
 */
import type { RarityPalette } from "@/domain/cards/types";
import type { ComposedElement, EffectKind } from "@/artwork-composer";
import { n, placedAttrs, type Placed } from "./canvas";

/** PRNG determinista (LCG) sembrado por string. */
export function seeded(seed: string): () => number {
  let s = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { s ^= seed.charCodeAt(i); s = Math.imul(s, 0x01000193); }
  s >>>= 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const fid = (el: ComposedElement, suffix: string): string => `${el.id.replace(/[^a-z0-9-]/gi, "-")}-${suffix}`;

export function effectSvg(el: ComposedElement, effect: EffectKind, p: Placed, pal: RarityPalette, cardId: string): string {
  const rnd = seeded(`${cardId}|${effect}`);
  const g = (inner: string): string => `<g${placedAttrs(p)}>${inner}</g>`;

  switch (effect) {
    case "glow": {
      const id = fid(el, "glow");
      return g(`<defs><radialGradient id="${id}"><stop offset="0%" stop-color="${pal.secondary}" stop-opacity="0.9"/><stop offset="100%" stop-color="${pal.secondary}" stop-opacity="0"/></radialGradient></defs>` +
        `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.w / 2)}" ry="${n(p.h / 2)}" fill="url(#${id})"/>`);
    }
    case "aura": {
      return g(`<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.w * 0.42)}" fill="none" stroke="${pal.primary}" stroke-width="${n(p.w * 0.02)}" stroke-opacity="0.65"/>` +
        `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.w * 0.47)}" fill="none" stroke="${pal.secondary}" stroke-width="${n(p.w * 0.008)}" stroke-opacity="0.4"/>`);
    }
    case "shadow": {
      const id = fid(el, "blur");
      return g(`<defs><filter id="${id}"><feGaussianBlur stdDeviation="${n(p.w * 0.03)}"/></filter></defs>` +
        `<ellipse cx="${n(p.cx)}" cy="${n(p.cy)}" rx="${n(p.w * 0.38)}" ry="${n(p.h * 0.07)}" fill="#000" fill-opacity="0.6" filter="url(#${id})"/>`);
    }
    case "smoke": {
      const id = fid(el, "smoke");
      const puffs = Array.from({ length: 4 }, (_, i) =>
        `<ellipse cx="${n(p.x + rnd() * p.w)}" cy="${n(p.cy + (rnd() - 0.5) * p.h * 0.3)}" rx="${n(p.w * (0.14 + rnd() * 0.1))}" ry="${n(p.h * 0.08)}" fill="#aab" fill-opacity="${n(0.12 + i * 0.04)}"/>`).join("");
      return g(`<defs><filter id="${id}"><feGaussianBlur stdDeviation="${n(p.w * 0.02)}"/></filter></defs><g filter="url(#${id})">${puffs}</g>`);
    }
    case "particles": {
      const dots = Array.from({ length: 24 }, () => {
        const r = 1 + rnd() * 3;
        return `<circle cx="${n(p.x + rnd() * p.w)}" cy="${n(p.y + rnd() * p.h)}" r="${n(r)}" fill="${rnd() > 0.5 ? pal.secondary : pal.primary}" fill-opacity="${n(0.35 + rnd() * 0.5)}"/>`;
      }).join("");
      return g(dots);
    }
    case "foil": {
      const id = fid(el, "foil");
      return g(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity="0.25"/><stop offset="35%" stop-color="#fff" stop-opacity="0"/><stop offset="55%" stop-color="${pal.secondary}" stop-opacity="0.18"/><stop offset="100%" stop-color="#fff" stop-opacity="0.1"/></linearGradient></defs>` +
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="url(#${id})"/>`);
    }
    case "holographic": {
      const id = fid(el, "holo");
      const stops = ["#ff5d8f", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff"]
        .map((c, i) => `<stop offset="${i * 25}%" stop-color="${c}" stop-opacity="0.16"/>`).join("");
      return g(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.4">${stops}</linearGradient></defs>` +
        `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="url(#${id})"/>`);
    }
    case "fire": {
      const flames = Array.from({ length: 7 }, (_, i) => {
        const fx = p.x + (i + 0.5) * (p.w / 7);
        const fh = p.h * (0.25 + rnd() * 0.3);
        return `<path d="M ${n(fx - p.w * 0.05)} ${n(p.y + p.h * 0.45)} Q ${n(fx)} ${n(p.y + p.h * 0.45 - fh)} ${n(fx + p.w * 0.05)} ${n(p.y + p.h * 0.45)} Z" fill="${rnd() > 0.5 ? "#ff7b00" : "#ffc300"}" fill-opacity="${n(0.35 + rnd() * 0.3)}"/>`;
      }).join("");
      return g(flames);
    }
    case "lightning": {
      const pts: string[] = [];
      let lx = p.cx, ly = p.y;
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        pts.push(`${n(lx)},${n(ly)}`);
        lx = p.cx + (rnd() - 0.5) * p.w * 0.4;
        ly = p.y + ((i + 1) / steps) * p.h * 0.5;
      }
      return g(`<polyline points="${pts.join(" ")}" fill="none" stroke="#e8f4ff" stroke-width="${n(p.w * 0.008)}" stroke-opacity="0.85"/>` +
        `<polyline points="${pts.join(" ")}" fill="none" stroke="${pal.secondary}" stroke-width="${n(p.w * 0.02)}" stroke-opacity="0.3"/>`);
    }
  }
}
