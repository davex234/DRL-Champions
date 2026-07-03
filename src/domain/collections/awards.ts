/**
 * DRL COLLECTION ENGINE — cálculo de premios (PURO).
 *
 * Dado el rendimiento de los jugadores de un torneo, decide los líderes de cada
 * categoría (Top ACS / Rating / HS% / Kills / Assist, Clutch, Rookie). Lo usan
 * tanto el motor de torneos (Supabase, desde `tournament_players`) como el
 * proveedor local (desde `player.metrics`). Determinista → testeable.
 *
 * MVP y Champion los resuelve el `CardGenerationEngine` (por flag/rating y por
 * equipo ganador); aquí van los 7 premios estadísticos.
 */
import type { AccoladeId, VariantId } from "@/domain/cards/types";

export type AwardKind =
  | "rookie" | "clutch" | "top-acs" | "top-rating" | "top-hs" | "top-kills" | "top-assist";

export interface AwardPlayer {
  playerId: string;
  nick?: string;
  teamId?: string;
  rating?: number;
  acs?: number;
  kills?: number;
  assists?: number;
  hsPct?: number;
  clutch?: number;
  isRookie?: boolean;
}

export interface AwardCategory {
  kind: AwardKind;
  label: string;
  accolade: AccoladeId;
  variantId: VariantId;
  /** Métrica comparable (mayor = mejor). null/undefined = el jugador no aplica. */
  metric: (p: AwardPlayer) => number | null | undefined;
}

/** Catálogo de premios estadísticos (orden = prioridad de muestra). */
export const AWARD_CATEGORIES: AwardCategory[] = [
  { kind: "top-rating", label: "Top Rating", accolade: "tournament-top-rating", variantId: "top-rating", metric: (p) => p.rating },
  { kind: "top-acs", label: "Top ACS", accolade: "tournament-top-acs", variantId: "top-acs", metric: (p) => p.acs },
  { kind: "top-kills", label: "Top Kills", accolade: "tournament-top-kills", variantId: "top-kills", metric: (p) => p.kills },
  { kind: "top-assist", label: "Top Assist", accolade: "tournament-top-assists", variantId: "top-assist", metric: (p) => p.assists },
  { kind: "top-hs", label: "Top HS%", accolade: "tournament-top-hs", variantId: "top-hs", metric: (p) => p.hsPct },
  { kind: "clutch", label: "Clutch King", accolade: "tournament-clutch", variantId: "clutch", metric: (p) => p.clutch },
  // Rookie no es estadístico: depende del flag (admin) o del status (local).
  { kind: "rookie", label: "Rookie", accolade: "tournament-rookie", variantId: "rookie", metric: (p) => (p.isRookie ? (p.rating ?? 1) : null) },
];

export interface AwardWinner {
  kind: AwardKind;
  label: string;
  accolade: AccoladeId;
  variantId: VariantId;
  playerId: string;
  nick?: string;
  teamId?: string;
  /** Carta premio: `${playerId}__${variantId}`. */
  cardId: string;
  value: number;
}

const has = (v: number | null | undefined): v is number => typeof v === "number" && !Number.isNaN(v);

/** Elige el líder de cada categoría (desempate por rating; omite sin datos). */
export function computeAwards(players: AwardPlayer[]): AwardWinner[] {
  const winners: AwardWinner[] = [];
  for (const cat of AWARD_CATEGORIES) {
    let best: AwardPlayer | null = null;
    let bestVal = -Infinity;
    for (const p of players) {
      const v = cat.metric(p);
      if (!has(v)) continue;
      if (v > bestVal || (v === bestVal && (p.rating ?? 0) > (best?.rating ?? 0))) {
        best = p;
        bestVal = v;
      }
    }
    if (best) {
      winners.push({
        kind: cat.kind, label: cat.label, accolade: cat.accolade, variantId: cat.variantId,
        playerId: best.playerId, nick: best.nick, teamId: best.teamId,
        cardId: `${best.playerId}__${cat.variantId}`, value: bestVal,
      });
    }
  }
  return winners;
}
