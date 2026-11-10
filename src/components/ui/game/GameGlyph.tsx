/**
 * FASE 64 · GLIFOS DEL JUEGO — un solo juego de iconos, dibujado aquí.
 *
 * Medido en F64: temporada, logros, progresión, tienda y colección pintaban EMOJIS como iconos de producto (📦 🏭 ⭐ 👑
 * 🗂 🐉 🌍 ⚔ 🎮 🏅 🪙 ✨ 🔒…): cada sistema operativo los dibuja distinto, no siguen la paleta y parecen web. Los datos
 * (logros, fuentes de XP, recompensas) SIGUEN guardando su símbolo —no se toca ningún dato—; la interfaz lo traduce aquí
 * a un glifo propio: trazo de 1,8 px, `currentColor`, rejilla de 24, esquinas en chaflán como el resto de NEXUS.
 *
 * `glyphFor(símbolo)` es puro (lo prueban los tests). `<GameGlyph>` pinta el glifo; si el símbolo no tiene glifo, no pinta
 * nada (mejor ningún icono que un emoji suelto). Decorativo por defecto (`aria-hidden`): el texto de al lado nombra la cosa.
 */
import { cn } from "@/lib/format";
import { td } from "@/i18n/runtime";

export type GlyphName =
  | "pack" | "packs" | "star" | "crown" | "cards" | "crest" | "globe" | "blades" | "duel" | "medal" | "coin" | "xp"
  | "lock" | "unlock" | "card" | "badge" | "materials" | "trophy" | "target" | "book" | "calendar" | "close" | "search"
  | "check" | "gift" | "scroll";

/** Trazos de cada glifo (SVG 24×24, sin relleno salvo donde se indica). Originales. */
const PATHS: Record<GlyphName, string[]> = {
  pack: ["M6 3h12l1 3v14l-1 1H6l-1-1V6z", "M5 7h14", "M9 12l3-2 3 2-3 2z"],
  packs: ["M8 5h11l1 2v11l-1 1H8l-1-1V7z", "M4 8v11l1 1h10", "M10 12l2.5-1.6L15 12l-2.5 1.6z"],
  star: ["M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"],
  crown: ["M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z", "M5 20h14"],
  cards: ["M9 4h9l1 1v12l-1 1H9l-1-1V5z", "M5 7l3-1", "M5 7v12l1 1h8"],
  crest: ["M12 3l7 3v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6z", "M9 11l3 2 3-2", "M12 13v4"],
  globe: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M3 12h18", "M12 3c2.6 2.6 3.6 5.6 3.6 9s-1 6.4-3.6 9c-2.6-2.6-3.6-5.6-3.6-9s1-6.4 3.6-9z"],
  blades: ["M4 4l9 9", "M20 4l-9 9", "M4 4v3l7 7", "M20 4v3l-7 7", "M7 17l-3 3", "M17 17l3 3"],
  duel: ["M5 5l6 6", "M19 5l-6 6", "M9 15l-4 4", "M15 15l4 4", "M12 11l-3 4h6z"],
  medal: ["M8 3l4 6 4-6", "M12 9a6 6 0 100 12 6 6 0 000-12z", "M12 12.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"],
  coin: ["M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z", "M12 7.5l3.9 2.25v4.5L12 16.5l-3.9-2.25v-4.5z"],
  xp: ["M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z"],
  lock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 017 0v3", "M12 14.5v2.5"],
  unlock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 016.8-1.2", "M12 14.5v2.5"],
  card: ["M7 3h10l1 1v16l-1 1H7l-1-1V4z", "M9 7h6", "M9 16h6"],
  badge: ["M12 3l7 4v6c0 4-3 6.6-7 8-4-1.4-7-4-7-8V7z", "M9 12l2 2 4-4"],
  materials: ["M9 3h6", "M10 3v6l-5 9 1 3h12l1-3-5-9V3", "M7.5 15h9"],
  trophy: ["M8 4h8v5a4 4 0 01-8 0z", "M8 6H5v2a3 3 0 003 3", "M16 6h3v2a3 3 0 01-3 3", "M12 13v4", "M8.5 20h7l-1-3h-5z"],
  target: ["M12 3a9 9 0 100 18 9 9 0 000-18z", "M12 7a5 5 0 100 10 5 5 0 000-10z", "M12 11a1 1 0 100 2 1 1 0 000-2z"],
  book: ["M5 4h6l1 2v14l-1-1H5z", "M19 4h-6l-1 2v14l1-1h6z"],
  calendar: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  search: ["M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13z", "M15.5 15.5L20 20"],
  check: ["M5 12.5l4.5 4.5L19 7"],
  gift: ["M4 9h16v4H4z", "M5 13v8h14v-8", "M12 9v12", "M12 9c-2-4-6-4-6-1.5S10 9 12 9c2 0 6-1 6-1.5S14 5 12 9z"],
  scroll: ["M7 4h11v14a2 2 0 01-2 2H6", "M7 4a2 2 0 00-2 2v2h2", "M6 20a2 2 0 002-2V4", "M10 9h5", "M10 13h5"],
};

/** Símbolos que el producto guarda en sus datos → glifo. Sin variante (el selector U+FE0F se ignora). */
const BY_SYMBOL: Record<string, GlyphName> = {
  "📦": "pack", "🏭": "packs", "⭐": "star", "★": "star", "🌟": "star", "👑": "crown", "🗂": "cards", "🐉": "crest",
  "🌍": "globe", "⚔": "blades", "🎮": "duel", "🏅": "medal", "🪙": "coin", "✨": "xp", "🔒": "lock", "🔓": "unlock",
  "🃏": "card", "🎖": "badge", "🧪": "materials", "🏆": "trophy", "🎯": "target", "📚": "book", "🗓": "calendar",
  "✕": "close", "🔎": "search", "✓": "check", "🎁": "gift", "📜": "scroll",
};

export function glyphFor(symbol: string | null | undefined): GlyphName | null {
  if (!symbol) return null;
  const s = symbol.replace(/️/g, "").trim();
  if ((Object.keys(PATHS) as string[]).includes(s)) return s as GlyphName;
  return BY_SYMBOL[s] ?? null;
}

export function GameGlyph({
  name, symbol, className, title, strokeWidth = 1.8,
}: {
  /** Glifo por nombre… */
  name?: GlyphName;
  /** …o el símbolo del dato (📦, ⭐…), traducido con `glyphFor`. */
  symbol?: string | null;
  className?: string;
  /** Con título el glifo deja de ser decorativo (`role="img"`). */
  title?: string;
  strokeWidth?: number;
}) {
  const g = name ?? glyphFor(symbol);
  if (!g) return null;
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={cn("inline-block h-[1em] w-[1em] shrink-0", className)} data-glyph={g}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {title && <title>{td(title)}</title>}
      {PATHS[g].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/** Créditos: el hexágono de la moneda de NEXUS en oro (el mismo sitio donde antes iba 🪙). */
export function CreditGlyph({ className }: { className?: string }) {
  return <GameGlyph name="coin" className={cn("text-drl-gold", className)} />;
}
