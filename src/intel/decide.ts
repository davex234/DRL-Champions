/**
 * LIVE INTEL — DECISIÓN DE CICLO DE VIDA DE LA CARTA.
 *
 * Compara el rendimiento NUEVO con el HISTÓRICO del jugador y decide: crear, mejorar,
 * mantener (no crear) o edición especial (campeón/MVP). Reglas, no hardcode por jugador.
 * Es la "inteligencia" que hoy falta (antes: siempre crear).
 */
export type CardAction = "new" | "improve" | "keep" | "special";

export type RarityTier = "comun" | "rara" | "epica" | "legendaria" | "mitica";
const TIER_LABEL: Record<RarityTier, string> = {
  comun: "Común", rara: "Rara", epica: "Épica", legendaria: "Legendaria", mitica: "Mítica",
};

/** Umbral local de rareza por rating (la regla DB es la autoridad cuando hay Supabase). */
export function rarityFor(rating: number): { tier: RarityTier; label: string } {
  const tier: RarityTier = rating >= 94 ? "mitica" : rating >= 88 ? "legendaria" : rating >= 80 ? "epica" : rating >= 70 ? "rara" : "comun";
  return { tier, label: TIER_LABEL[tier] };
}

export interface PlayerHistory {
  /** Mejor rating de carta que ya posee el jugador (null si no tiene). */
  bestRating: number | null;
  /** Familias/ediciones que ya tiene (para no duplicar). */
  ownsFamilies: string[];
}

export interface CardDecision {
  action: CardAction;
  reason: string;
  tier: RarityTier;
  tierLabel: string;
}

const IMPROVE_DELTA = 4; // hay que superar el histórico por un margen para "mejorar"

/**
 * Decide qué hacer con la actuación de un jugador en un torneo finalizado.
 * `family` = familia que se generaría (p.ej. "champions-mvp"); si ya la posee y no es
 * mejora clara, se MANTIENE (no duplica).
 */
export function decideCard(opts: { rating: number; won: boolean; mvp: boolean; family: string; history: PlayerHistory }): CardDecision {
  const { rating, won, mvp, family, history } = opts;
  const r = rarityFor(rating);

  // Edición especial: MVP o campeón siempre merece su edición (si no la tiene ya).
  if ((mvp || won) && !history.ownsFamilies.includes(family)) {
    return { action: "special", reason: mvp ? "MVP del torneo" : "Campeón del torneo", tier: r.tier, tierLabel: r.label };
  }
  // Sin historial → primera carta.
  if (history.bestRating == null) {
    return { action: "new", reason: "Primera carta del jugador", tier: r.tier, tierLabel: r.label };
  }
  // Supera claramente su nivel → mejora.
  if (rating >= history.bestRating + IMPROVE_DELTA) {
    return { action: "improve", reason: `Supera su histórico (${history.bestRating}→${rating})`, tier: r.tier, tierLabel: r.label };
  }
  // No aporta sobre lo que ya tiene → no se crea.
  return { action: "keep", reason: "No supera su carta actual", tier: r.tier, tierLabel: r.label };
}
