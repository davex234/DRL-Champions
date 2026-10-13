/**
 * F60 · SUBIDAS DEL CMS — reglas PURAS (sin red, sin `sharp`) para decidir si unos bytes son la imagen que dicen ser.
 *
 * Orden de las comprobaciones, y la que manda es la de los BYTES:
 *   1. tamaño (vacío / máximo del tipo de asset);
 *   2. nombre: sin rutas (`/`, `\`, `..`), sin bytes de control, una sola extensión «real» (nada de `x.png.html`);
 *   3. FIRMA (magic bytes) → formato detectado. SVG, HTML, texto o cualquier otra cosa: fuera. La extensión y el MIME
 *      declarado por el navegador sólo pueden CONFIRMAR lo detectado, nunca decidirlo;
 *   4. dimensiones leídas de la cabecera (PNG/JPEG/WEBP; AVIF las da el decodificador) y reglas del tipo de asset.
 *
 * La decodificación completa (fichero corrupto, alfa real) la hace el servidor con `sharp` (`server/cms/assets.ts`) y
 * falla CERRADO: sin decodificador no se acepta nada.
 */

export type ImageFormat = "png" | "webp" | "jpeg" | "avif";

export const MIME_OF: Record<ImageFormat, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg", avif: "image/avif" };
const EXT_OF: Record<ImageFormat, readonly string[]> = { png: ["png"], webp: ["webp"], jpeg: ["jpg", "jpeg"], avif: ["avif"] };

/** Tipos de asset que gestiona el CMS y sus reglas. Los otros tipos de `assets` siguen con su gestor heredado. */
export type CmsAssetKind = "agent_face" | "agent_full" | "card_artwork" | "pack_art" | "event_art" | "map_art" | "player_photo" | "team_logo" | "background";

export interface AssetRule {
  label: string;
  formats: readonly ImageFormat[];
  maxBytes: number;
  minW: number; minH: number; maxW: number; maxH: number;
  /** Relación ancho/alto admitida [min, max]. */
  aspect: readonly [number, number];
  subject: "agent" | "card" | "pack" | "event" | "map" | "player" | "team" | "none";
}

const MB = 1024 * 1024;
export const ASSET_RULES: Record<CmsAssetKind, AssetRule> = {
  agent_face:   { label: "Cara de agente",          formats: ["png", "webp", "jpeg", "avif"], maxBytes: 4 * MB,  minW: 128, minH: 128, maxW: 2048, maxH: 2048, aspect: [0.8, 1.25], subject: "agent" },
  agent_full:   { label: "Cuerpo entero de agente", formats: ["png", "webp", "jpeg", "avif"], maxBytes: 6 * MB,  minW: 200, minH: 260, maxW: 2048, maxH: 3072, aspect: [0.4, 1.0],  subject: "agent" },
  card_artwork: { label: "Arte de carta",           formats: ["png", "webp"],                 maxBytes: 12 * MB, minW: 500, minH: 700, maxW: 3000, maxH: 4200, aspect: [0.68, 0.75], subject: "card" },
  pack_art:     { label: "Arte de sobre",           formats: ["png", "webp"],                 maxBytes: 8 * MB,  minW: 300, minH: 400, maxW: 3000, maxH: 4000, aspect: [0.5, 1.0],  subject: "pack" },
  event_art:    { label: "Imagen de evento",        formats: ["png", "webp", "jpeg"],         maxBytes: 8 * MB,  minW: 600, minH: 300, maxW: 4096, maxH: 4096, aspect: [1.0, 4.0],  subject: "event" },
  map_art:      { label: "Arte de mapa",            formats: ["png", "webp"],                 maxBytes: 12 * MB, minW: 512, minH: 512, maxW: 4096, maxH: 4096, aspect: [0.75, 1.34], subject: "map" },
  player_photo: { label: "Foto de jugador",         formats: ["png", "webp"],                 maxBytes: 4 * MB,  minW: 128, minH: 128, maxW: 2048, maxH: 2048, aspect: [0.5, 1.5],  subject: "player" },
  team_logo:    { label: "Logo de equipo",          formats: ["png", "webp"],                 maxBytes: 2 * MB,  minW: 64,  minH: 64,  maxW: 2048, maxH: 2048, aspect: [0.75, 1.34], subject: "team" },
  /* F71 · fondo de temática de duelo (panorámico, sin sujeto). Tipo `background` admitido por la BD desde 0007. */
  background:   { label: "Fondo de arena",          formats: ["png", "webp", "jpeg"],         maxBytes: 8 * MB,  minW: 1280, minH: 640, maxW: 4096, maxH: 2560, aspect: [1.3, 2.6],  subject: "none" },
};

export const CMS_ASSET_KINDS = Object.keys(ASSET_RULES) as CmsAssetKind[];
export const isCmsAssetKind = (k: unknown): k is CmsAssetKind => typeof k === "string" && (CMS_ASSET_KINDS as string[]).includes(k);

/** Formato por FIRMA. Nada más decide qué es un fichero. */
export function sniffImage(b: Uint8Array): ImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12))) return "avif";
  return null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Dimensiones desde la cabecera. `null` si el formato no las da sin decodificar (AVIF) o la cabecera está rota. */
export function headerDimensions(b: Uint8Array, f: ImageFormat): { width: number; height: number } | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  try {
    if (f === "png") {
      if (ascii(b, 12, 16) !== "IHDR") return null;
      return { width: u32(16), height: u32(20) };
    }
    if (f === "webp") {
      const chunk = ascii(b, 12, 16);
      if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
      if (chunk === "VP8L") { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      return null;
    }
    if (f === "jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = u16be(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: u16be(i + 7), height: u16be(i + 5) };
        i += 2 + len;
      }
      return null;
    }
  } catch { return null; }
  return null;
}

/** Nombre de fichero seguro para GUARDAR como metadato (nunca como ruta: la ruta la genera el servidor). */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f<>"|?*]/g, "").split(String.fromCharCode(58)).join("").replace(/\s+/g, " ").trim().slice(0, 120) || "archivo";
}

export type UploadCheck =
  | { ok: true; format: ImageFormat; mime: string; width: number | null; height: number | null }
  | { ok: false; error: string };

/**
 * Validación completa ANTES de decodificar. `dims` = las del decodificador si ya se tienen (AVIF), si no se leen de
 * la cabecera. Devuelve el formato DETECTADO (y su MIME), que es lo que se usa para guardar y servir.
 */
export function checkUpload(kind: CmsAssetKind, name: string, declaredMime: string, bytes: Uint8Array,
  dims?: { width: number; height: number } | null): UploadCheck {
  const rule = ASSET_RULES[kind];
  if (!rule) return { ok: false, error: "Tipo de asset no admitido" };
  if (bytes.byteLength === 0) return { ok: false, error: "El fichero está vacío" };
  if (bytes.byteLength > rule.maxBytes) return { ok: false, error: `Pesa ${(bytes.byteLength / MB).toFixed(1)} MB; el máximo para ${rule.label.toLowerCase()} es ${rule.maxBytes / MB} MB` };
  if (/[\\/]|\.\./.test(name) || /[\u0000-\u001f]/.test(name)) return { ok: false, error: "Nombre de fichero no válido" };
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return { ok: false, error: "El fichero necesita extensión" };
  const ext = parts[parts.length - 1];
  const inner = parts.slice(1, -1);
  const dangerous = ["html", "htm", "svg", "js", "php", "exe", "sh", "bat", "cmd", "xml", "xhtml"];
  if (inner.some((p) => dangerous.includes(p)) || dangerous.includes(ext)) return { ok: false, error: "Doble extensión o tipo no permitido" };

  const format = sniffImage(bytes);
  if (!format) return { ok: false, error: "El contenido no es una imagen admitida (PNG, WEBP, JPEG o AVIF). SVG no se admite." };
  if (!rule.formats.includes(format)) return { ok: false, error: `${rule.label}: formato ${format.toUpperCase()} no admitido (${rule.formats.join(", ").toUpperCase()})` };
  if (!EXT_OF[format].includes(ext)) return { ok: false, error: `La extensión .${ext} no corresponde al contenido (${format.toUpperCase()})` };
  if (declaredMime && declaredMime !== MIME_OF[format] && !(format === "jpeg" && declaredMime === "image/jpg")) {
    return { ok: false, error: `El tipo declarado (${declaredMime.slice(0, 40)}) no corresponde al contenido` };
  }
  const d = dims ?? headerDimensions(bytes, format);
  if (d) {
    const { width: w, height: h } = d;
    if (!(w > 0 && h > 0)) return { ok: false, error: "Dimensiones ilegibles" };
    if (w < rule.minW || h < rule.minH) return { ok: false, error: `${rule.label}: mínimo ${rule.minW}×${rule.minH} px (tiene ${w}×${h})` };
    if (w > rule.maxW || h > rule.maxH) return { ok: false, error: `${rule.label}: máximo ${rule.maxW}×${rule.maxH} px (tiene ${w}×${h})` };
    const ar = w / h;
    if (ar < rule.aspect[0] || ar > rule.aspect[1]) return { ok: false, error: `${rule.label}: proporción ${ar.toFixed(2)} fuera de [${rule.aspect[0]}, ${rule.aspect[1]}]` };
  }
  return { ok: true, format, mime: MIME_OF[format], width: d?.width ?? null, height: d?.height ?? null };
}

/** Ruta en el bucket: la genera SIEMPRE el servidor. El cliente no aporta ni un carácter. */
export const cmsStoragePath = (kind: CmsAssetKind, assetId: string, variant: "original" | "w256" | "w96" | "w704" | "w960", format: ImageFormat | "webp"): string =>
  `cms/${kind}/${assetId}/${variant}.${format === "jpeg" ? "jpg" : format}`;
