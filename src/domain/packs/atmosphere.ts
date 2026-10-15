/**
 * APERTURA DE SOBRES · AMBIENTE POR RAREZA (2026-10-15) — PRESENTACIÓN PURA.
 *
 * Cada carta que se revela tiñe la sala con SU identidad: la escena no se queda con el color del sobre ni con el de la
 * primera carta. La clave es la CLASE canónica de la carta (`packCardClass`: edición + OVR del catálogo, los mismos datos
 * que el servidor guardó), nunca el nombre, el precio ni un color aproximado. No hay rarezas nuevas: son las siete clases
 * de la línea de sobres (Base · Plata · Oro · Masters · Champions · Prime · Icon), más dos reservas:
 *
 *   · `special`  una carta de una edición fuera de la línea (sobres regionales/antiguos): el color de SU edición
 *                (`VARIANTS[...].palette`), con tratamiento medio.
 *   · `neutral`  la luz de preparación antes de cada revelado, y la reserva segura si la carta no se puede clasificar.
 *
 * DE DÓNDE SALE CADA COLOR (no se inventa ninguno):
 *   · Base, Plata, Oro, Prime, Icon → `PACK_CLASS_COLOR` (la identidad de la clase en fichas y tienda) y las paletas de
 *     metal/edición de `domain/cards/variants`.
 *   · Masters → el violeta/lila de las cartas Masters L y Masters SDC reales (`public/cards/*__masters-*.webp`). La paleta
 *     de respaldo de esas ediciones (`cinematic`, naranja) y `PACK_CLASS_COLOR.masters` (naranja) NO coinciden con el arte
 *     que ve el jugador; esta escena sigue al arte. (Unificarlos en fichas/tienda es una decisión aparte.)
 *   · Champions → la carta Champions S real: negro con oro campeón (`PALETTES.champion`).
 *
 * Intensidad (`tier`) proporcional a la clase: 0 limpio (Base, Plata —con reflejo metálico suave—, reserva), 1 metálico (Oro y ediciones fuera de la
 * línea), 2 especial (Masters, Champions, Prime), 3 cúspide (Icon). Ninguna clase baja es una pantalla «vacía»: todas
 * tienen foco, halo y suelo; solo cambian el color y cuánto se mueve.
 */
import type { CardDef } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { PACK_CLASS_COLOR, PACK_CLASS_LABEL, packCardClass, type PackCardClass } from "./packClass";

export type AtmosphereKey = PackCardClass | "special" | "neutral";
export type AtmosphereTier = 0 | 1 | 2 | 3;

export interface RevealAtmosphere {
  key: AtmosphereKey;
  /** Nombre de la clase (para `data-*` y QA); la carta ya dice su rareza en su ficha. */
  label: string;
  /** `light` = sala clara (Icon): el texto de la ficha pasa a tinta oscura. */
  tone: "dark" | "light";
  tier: AtmosphereTier;
  /** Fondo: centro (`mid`) → borde (`deep`). */
  mid: string;
  deep: string;
  /** Luz de la clase: halo detrás de la carta, foco, suelo y efectos. */
  glow: string;
  /** Brillo secundario: reflejos metálicos, motas. */
  highlight: string;
  /** Tinta legible SOBRE `glow` (insignia de rareza). */
  ink: string;
  /** Barrido de reflejos metálicos (Plata, Oro, Icon). */
  sheen: boolean;
  /** Corona de rayos lenta (solo clases especiales y cúspide). */
  rays: boolean;
  /** Motas de luz que ascienden (0 = ninguna). Tope bajo: es ambiente, no confeti. */
  motes: number;
}

export const NEUTRAL_ATMOSPHERE: RevealAtmosphere = {
  key: "neutral", label: "Neutral", tone: "dark", tier: 0,
  mid: "#161a29", deep: "#04050b", glow: "#9aa7c7", highlight: "#e8eefc", ink: "#0b0d18",
  sheen: false, rays: false, motes: 0,
};

export const CLASS_ATMOSPHERE: Readonly<Record<PackCardClass, RevealAtmosphere>> = {
  base: {
    key: "base", label: PACK_CLASS_LABEL.base, tone: "dark", tier: 0,
    mid: "#2f3a4b", deep: "#080b11", glow: PACK_CLASS_COLOR.base, highlight: "#c9d1db", ink: "#0b0d18",
    sheen: true, rays: false, motes: 0,
  },
  plata: {
    key: "plata", label: PACK_CLASS_LABEL.plata, tone: "dark", tier: 0,
    mid: "#4a5664", deep: "#0a0d12", glow: PACK_CLASS_COLOR.plata, highlight: "#ffffff", ink: "#0b0d18",
    sheen: true, rays: false, motes: 0,
  },
  oro: {
    key: "oro", label: PACK_CLASS_LABEL.oro, tone: "dark", tier: 1,
    mid: "#a0700f", deep: "#1e1403", glow: PACK_CLASS_COLOR.oro, highlight: "#fff1b0", ink: "#3a2c00",
    sheen: true, rays: false, motes: 0,
  },
  masters: {
    key: "masters", label: PACK_CLASS_LABEL.masters, tone: "dark", tier: 2,
    mid: "#5a2ea3", deep: "#140726", glow: "#b48cff", highlight: "#e8dcff", ink: "#16062e",
    sheen: false, rays: true, motes: 10,
  },
  champions: {
    key: "champions", label: PACK_CLASS_LABEL.champions, tone: "dark", tier: 2,
    mid: "#3a2e10", deep: "#040302", glow: "#ffe08a", highlight: "#fffceb", ink: "#2a2000",
    sheen: true, rays: true, motes: 10,
  },
  prime: {
    key: "prime", label: PACK_CLASS_LABEL.prime, tone: "dark", tier: 2,
    mid: "#2140a8", deep: "#050a26", glow: PACK_CLASS_COLOR.prime, highlight: "#c9bcff", ink: "#020a1f",
    sheen: false, rays: true, motes: 12,
  },
  icon: {
    key: "icon", label: PACK_CLASS_LABEL.icon, tone: "light", tier: 3,
    mid: "#fffcf4", deep: "#d8ccab", glow: "#ffffff", highlight: "#d9b85c", ink: "#1a1408",
    sheen: true, rays: true, motes: 14,
  },
};

/** Mezcla lineal de dos `#rrggbb` (t = 0 → a, 1 → b). Entradas no válidas → `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
}

/**
 * El ambiente de UNA carta. `null`/carta sin datos → neutral (reserva segura). Una edición conocida fuera de la línea →
 * `special` con el color de SU edición. Nunca lanza.
 */
export function atmosphereForCard(card: Pick<CardDef, "variantId" | "ovr"> | null | undefined): RevealAtmosphere {
  if (!card) return NEUTRAL_ATMOSPHERE;
  const cls = packCardClass(card);
  if (cls) return CLASS_ATMOSPHERE[cls];
  // Una edición de la línea que no clasifica (p. ej. una Base con OVR corrupto) NO es «especial»: reserva neutra.
  if (card.variantId === "base") return NEUTRAL_ATMOSPHERE;
  const v = card.variantId ? getVariant(card.variantId) : undefined;
  const glow = v?.palette?.primary;
  if (!v || !glow || !/^#[0-9a-f]{6}$/i.test(glow)) return NEUTRAL_ATMOSPHERE;
  return {
    key: "special", label: v.label, tone: "dark", tier: 1,
    mid: mixHex(glow, "#000000", 0.62), deep: mixHex(glow, "#000000", 0.94), glow,
    highlight: /^#[0-9a-f]{6}$/i.test(v.palette.secondary) ? v.palette.secondary : "#ffffff",
    ink: /^#[0-9a-f]{6}$/i.test(v.palette.text) ? v.palette.text : "#0b0d18",
    sheen: false, rays: false, motes: 0,
  };
}

/* ═══════════════════════ ritmo de cada revelado (fuera de la hero) ═══════════════════════ */

/** Luz de preparación (sala neutra, dorso cargándose) antes del giro: más larga cuanto más alta la clase. */
export const REVEAL_PREP_MS: Readonly<Record<AtmosphereTier, number>> = { 0: 420, 1: 560, 2: 760, 3: 980 };
export const REVEAL_PREP_REDUCED_MS = 160;
/** Giro de cada carta del resto. */
export const CARD_FLIP_MS = 650;
export const CARD_FLIP_REDUCED_MS = 280;
/**
 * Fundidos del ambiente. La SALIDA (`exit`) es más corta que la preparación más corta: cuando gira la carta siguiente,
 * el color de la anterior ya no está en pantalla.
 */
export const ATMOSPHERE_ENTER_MS = 620;
export const ATMOSPHERE_EXIT_MS = 340;
export const ATMOSPHERE_REDUCED_MS = 140;

export const revealPrepMs = (tier: AtmosphereTier, reduced: boolean): number => (reduced ? REVEAL_PREP_REDUCED_MS : REVEAL_PREP_MS[tier]);

/* ═══════════════════════ qué carta manda en la sala ═══════════════════════ */

type SceneState = { phase: string; restIndex: number; restShown: boolean };
type SceneCard = { uid: string; card: Pick<CardDef, "variantId" | "ovr"> };

/**
 * La carta que tiñe la sala AHORA (o null = luz neutra de preparación) y el ambiente resultante (null = sin sala: sobre
 * cerrado, rotura, resumen). Se calcula con el MISMO estado que decide qué carta se pinta: la sala nunca va un paso por
 * detrás (no enseña el color de la carta anterior) ni uno por delante (no anticipa la rareza antes del giro).
 */
export function sceneAtmosphere<T extends SceneCard>(s: SceneState, hero: T | null | undefined, rest: readonly T[]): { card: T | null; atmosphere: RevealAtmosphere | null } {
  if (s.phase === "buildup") return { card: null, atmosphere: NEUTRAL_ATMOSPHERE };
  if ((s.phase === "hero" || s.phase === "hero_hold") && hero) return { card: hero, atmosphere: atmosphereForCard(hero.card) };
  if (s.phase === "rest" && rest.length > 0) {
    const item = rest[Math.min(Math.max(0, s.restIndex), rest.length - 1)];
    return s.restShown ? { card: item, atmosphere: atmosphereForCard(item.card) } : { card: null, atmosphere: NEUTRAL_ATMOSPHERE };
  }
  return { card: null, atmosphere: null };
}
