/**
 * ASSETS — catálogo SEED del repositorio oficial: los recursos gráficos REALES que ya
 * existen en `public/` (auditoría 2026-07-12), las CONVENCIONES de rutas por sujeto
 * (idénticas a las de `src/lib/assets.ts`, que no se toca) y los PLACEHOLDERS oficiales
 * por categoría (data-URIs SVG deterministas: el juego funciona sin assets locales).
 */
import {
  ARTWORK_CATEGORIES, type ArtworkAsset, type ArtworkCategory, type ArtworkFormat,
} from "./types";

/* ── Huella determinista (FNV-1a 32-bit sobre string/bytes) ───────────────── */

export function artworkHash(data: string | Uint8Array): string {
  let h = 0x811c9dc5;
  if (typeof data === "string") {
    for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  } else {
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
  }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Huella declarativa de un asset aún no cargado (path+formato+medidas, SIN el id: dos
 * assets que declaran el mismo recurso comparten huella ⇒ el manifest los ve duplicados).
 */
export const declaredHash = (a: Pick<ArtworkAsset, "path" | "format" | "width" | "height">): string =>
  artworkHash(`${a.path}|${a.format}|${a.width}x${a.height}`);

/* ── Constructor ──────────────────────────────────────────────────────────── */

export function makeAsset(a: {
  id: string; category: ArtworkCategory; name: string; path: string; format: ArtworkFormat;
  width?: number; height?: number; aliases?: string[]; placeholder?: boolean; subjectId?: string;
}): ArtworkAsset {
  const base = { width: a.width ?? 0, height: a.height ?? 0, ...a };
  return {
    id: a.id, category: a.category, name: a.name, path: a.path, format: a.format,
    width: base.width, height: base.height,
    aliases: a.aliases ?? [],
    hash: declaredHash({ path: a.path, format: a.format, width: base.width, height: base.height }),
    placeholder: a.placeholder,
    subjectId: a.subjectId,
  };
}

/* ── Placeholders oficiales (SVG determinista por categoría) ──────────────── */

const PLACEHOLDER_GLYPH: Record<ArtworkCategory, string> = {
  player: "👤", team: "🛡", "tournament-logo": "🏆", region: "🌍", country: "🏳", agent: "🎯",
  map: "🗺", role: "🎮", background: "▦", frame: "▣", border: "▢", icon: "◆", effect: "✦",
  font: "Aa", rarity: "★", collection: "🗂", badge: "🎖",
};

function placeholderSvg(category: ArtworkCategory): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<rect width="256" height="256" fill="#101623"/>` +
    `<rect x="8" y="8" width="240" height="240" fill="none" stroke="#2b3854" stroke-width="2" stroke-dasharray="8 6"/>` +
    `<text x="128" y="118" font-size="64" text-anchor="middle">${PLACEHOLDER_GLYPH[category]}</text>` +
    `<text x="128" y="180" font-size="20" fill="#8fa3c8" text-anchor="middle" font-family="monospace">${category}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Placeholder oficial de una categoría (siempre existe; nunca cuenta como faltante). */
export const placeholderFor = (category: ArtworkCategory): ArtworkAsset => makeAsset({
  id: `placeholder:${category}`,
  category,
  name: `Placeholder oficial (${category})`,
  path: placeholderSvg(category),
  format: "data-svg",
  width: 256, height: 256,
  aliases: [`${category}:__placeholder`],
  placeholder: true,
});

export const ALL_PLACEHOLDERS = (): ArtworkAsset[] => ARTWORK_CATEGORIES.map(placeholderFor);

/* ── Convenciones por sujeto (mismas rutas que src/lib/assets.ts) ─────────── */

export const playerAsset = (playerId: string): ArtworkAsset => makeAsset({
  id: `player:${playerId}`, category: "player", name: `Foto de ${playerId}`,
  path: `/players/${playerId}.png`, format: "png", width: 512, height: 512,
  aliases: [playerId], subjectId: playerId,
});

export const teamAsset = (slug: string): ArtworkAsset => makeAsset({
  id: `team:${slug}`, category: "team", name: `Logo de ${slug}`,
  path: `/teams/${slug}.png`, format: "png", width: 256, height: 256,
  aliases: [slug], subjectId: slug,
});

export const countryAsset = (iso: string): ArtworkAsset => makeAsset({
  id: `country:${iso.toLowerCase()}`, category: "country", name: `Bandera ${iso.toUpperCase()}`,
  path: `https://flagcdn.com/w80/${iso.toLowerCase()}.png`, format: "png", width: 80, height: 60,
  aliases: [iso.toLowerCase(), iso.toUpperCase()], subjectId: iso.toLowerCase(),
});

export const tournamentLogoAsset = (tournamentId: string): ArtworkAsset => makeAsset({
  id: `tournament-logo:${tournamentId}`, category: "tournament-logo", name: `Logo del torneo ${tournamentId}`,
  path: `/tournaments/${tournamentId}.png`, format: "png", width: 256, height: 256,
  aliases: [tournamentId], subjectId: tournamentId,
});

/* ── Assets REALES existentes (auditoría de public/) ──────────────────────── */

const brandIcon = (slug: string, aliases: string[] = []): ArtworkAsset => makeAsset({
  id: `icon:brand-${slug}`, category: "icon", name: `Branding ${slug}`,
  path: `/branding/icon/${slug}.svg`, format: "svg", aliases,
});
const brandLogo = (slug: string): ArtworkAsset => makeAsset({
  id: `icon:logo-${slug}`, category: "icon", name: `Logo ${slug}`,
  path: `/branding/logo/${slug}.svg`, format: "svg",
});

/** Los recursos gráficos que EXISTEN hoy en `public/` (Apex Crest + PWA). */
export const EXISTING_ASSETS = (): ArtworkAsset[] => [
  brandIcon("icon", ["apex-crest", "app-icon"]),
  brandIcon("icon-light"), brandIcon("icon-mono"), brandIcon("icon-negative"), brandIcon("icon-plate"),
  brandLogo("lockup-horizontal"), brandLogo("lockup-horizontal-light"),
  brandLogo("lockup-horizontal-mono"), brandLogo("lockup-horizontal-negative"),
  brandLogo("lockup-vertical"), brandLogo("wordmark-champions"), brandLogo("wordmark-drl"),
  makeAsset({ id: "icon:og-card", category: "icon", name: "Open Graph", path: "/branding/assets/og.png", format: "png", width: 1200, height: 630 }),
  makeAsset({ id: "icon:favicon", category: "icon", name: "Favicon SVG", path: "/favicon.svg", format: "svg", aliases: ["favicon"] }),
  makeAsset({ id: "icon:favicon-32", category: "icon", name: "Favicon 32", path: "/favicon-32.png", format: "png", width: 32, height: 32 }),
  makeAsset({ id: "icon:favicon-ico", category: "icon", name: "Favicon ICO", path: "/favicon.ico", format: "ico", width: 32, height: 32 }),
  makeAsset({ id: "icon:apple-touch", category: "icon", name: "Apple touch", path: "/apple-touch-icon.png", format: "png", width: 180, height: 180 }),
  makeAsset({ id: "icon:app-192", category: "icon", name: "PWA 192", path: "/icons/icon-192.png", format: "png", width: 192, height: 192 }),
  makeAsset({ id: "icon:app-512", category: "icon", name: "PWA 512", path: "/icons/icon-512.png", format: "png", width: 512, height: 512 }),
  makeAsset({ id: "icon:maskable-192", category: "icon", name: "PWA maskable 192", path: "/icons/maskable-192.png", format: "png", width: 192, height: 192 }),
  makeAsset({ id: "icon:maskable-512", category: "icon", name: "PWA maskable 512", path: "/icons/maskable-512.png", format: "png", width: 512, height: 512 }),
];

/* ── Recursos definidos por el design system (CSS: RarityPalette/variants) ── */

const RARITY_BUCKETS = ["common", "uncommon", "rare", "epic", "legendary"] as const;

/** Rarezas/marcos/bordes/fondos/efectos HOY son CSS (RarityPalette): se registran como `css:`. */
export const CSS_ASSETS = (): ArtworkAsset[] => [
  ...RARITY_BUCKETS.map((b) => makeAsset({
    id: `rarity:${b}`, category: "rarity", name: `Paleta ${b}`, path: `css:rarity/${b}`, format: "css", aliases: [b], subjectId: b,
  })),
  ...RARITY_BUCKETS.map((b) => makeAsset({
    id: `frame:${b}`, category: "frame", name: `Marco ${b}`, path: `css:frame/${b}`, format: "css", subjectId: b,
  })),
  ...RARITY_BUCKETS.map((b) => makeAsset({
    id: `border:${b}`, category: "border", name: `Borde ${b}`, path: `css:border/${b}`, format: "css", subjectId: b,
  })),
  makeAsset({ id: "background:base", category: "background", name: "Fondo base de carta", path: "css:background/base", format: "css", aliases: ["card-base"] }),
  makeAsset({ id: "effect:shine", category: "effect", name: "Brillo de carta", path: "css:effect/shine", format: "css", aliases: ["holo"] }),
  makeAsset({ id: "font:display", category: "font", name: "Fuente display (next/font)", path: "css:var(--font-display)", format: "css", aliases: ["display"] }),
];

/** Seed completo del repositorio: reales + design system + placeholders oficiales. */
export const SEED_ASSETS = (): ArtworkAsset[] => [
  ...EXISTING_ASSETS(),
  ...CSS_ASSETS(),
  ...ALL_PLACEHOLDERS(),
];
