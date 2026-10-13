/**
 * F71 → F72.2 · CÓMO SE ENSEÑA UNA PISTA DE CARTA OCULTA: SOLO IMAGEN.
 *
 * Presentación pura sobre `{ type, value }`, que ya viene calculado del servidor (el valor es el id del asset: ISO,
 * rol oficial, liga VCT o logo del equipo). Aquí no se decide qué pista lleva cada carta (eso es
 * `domain/cardgame/hints` + `lib/duel/hintVisuals`, en servidor): solo qué imagen se pinta. Sin rótulos, sin códigos,
 * sin iniciales. Si el asset no existe → `null` y el dorso sale limpio (nunca un icono roto).
 */
import { hintArt, type HintArt } from "./hintVisuals";
import type { HintType, RivalCardHint } from "./types";
import { ns, td } from "@/i18n/runtime";

const t = ns("duel");

/** Nombre del tipo SOLO para lectores de pantalla (no se pinta). */
export const HINT_KIND_NAME: Record<HintType, string> = {
  COUNTRY: "país",
  REGION: "liga",
  TEAM: "equipo",
  ROLE: "rol",
};

export interface HintPresentation extends HintArt {
  /** Texto accesible del dorso (no visible). */
  ariaLabel: string;
}

export function hintPresentation(h: RivalCardHint): HintPresentation | null {
  const art = hintArt(h);
  if (!art) return null;
  return { ...art, ariaLabel: t("Carta oculta · pista de {v}: {name}", { v: td(HINT_KIND_NAME[h.type]), name: art.name }) };
}
