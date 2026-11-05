/**
 * ICON REGISTRY (Render/UI Fase 1/7) — registro de iconos por DATOS (nombres → glifo).
 *
 * Sin assets ni render: solo el contrato (nombre semántico → glifo/emoji + keywords). La capa React
 * futura decide cómo pintarlos. Puro y determinista.
 */
export interface IconDef { name: string; glyph: string; keywords: string[] }

export const ICONS: IconDef[] = [
  { name: "home", glyph: "🏠", keywords: ["inicio", "hub"] },
  { name: "collection", glyph: "🃏", keywords: ["cartas", "album"] },
  { name: "pack", glyph: "📦", keywords: ["sobre", "drop"] },
  { name: "deck", glyph: "🛡️", keywords: ["equipo", "squad"] },
  { name: "market", glyph: "💱", keywords: ["mercado", "trade"] },
  { name: "craft", glyph: "⚗️", keywords: ["forja", "evolución"] },
  { name: "battlepass", glyph: "🎫", keywords: ["pase", "temporada"] },
  { name: "trophy", glyph: "🏆", keywords: ["logro", "campeón"] },
  { name: "star", glyph: "★", keywords: ["favorito", "destacado"] },
  { name: "search", glyph: "🔎", keywords: ["buscar"] },
  { name: "filter", glyph: "⛃", keywords: ["filtro"] },
  { name: "settings", glyph: "⚙️", keywords: ["ajustes", "config"] },
  { name: "close", glyph: "✕", keywords: ["cerrar"] },
  { name: "check", glyph: "✓", keywords: ["ok", "hecho"] },
  { name: "chevron", glyph: "›", keywords: ["más", "expandir"] },
  { name: "lock", glyph: "🔒", keywords: ["bloqueado"] },
  { name: "coins", glyph: "🪙", keywords: ["créditos", "moneda"] },
  { name: "gem", glyph: "💎", keywords: ["serial", "gema"] },
];

const BY_NAME = new Map(ICONS.map((i) => [i.name, i]));

/** Resuelve una lista de nombres a sus definiciones (ignora desconocidos). */
export function resolveIcons(names: string[]): IconDef[] {
  return names.map((n) => BY_NAME.get(n)).filter((i): i is IconDef => !!i);
}

export const getIcon = (name: string): IconDef | undefined => BY_NAME.get(name);
