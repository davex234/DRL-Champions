/**
 * MANAGER CAREER ENGINE — reputación mundial.
 *
 * Reputación por ámbitos (local → regional → continental → global). Crece desde los
 * RESULTADOS, ponderada por importancia del torneo (reutiliza la IDEA de pesos del
 * `contextualRating` de Intel). La reputación de un ámbito "tira" de los superiores con
 * un factor de filtración (lo local sube global muy poco; lo global sube todo). Puro.
 */
import type { Reputation, ReputationTierId, CompetitionTier, MatchOutcome, SeasonOutcome } from "./types";

export const ZERO_REPUTATION: Reputation = { local: 0, regional: 0, continental: 0, global: 0 };

const clampRep = (n: number): number => Math.max(0, Math.min(100, n));

/** Puntuación global ponderada (la "reputación" de una sola cifra para UI/licencias). */
export function globalReputationScore(r: Reputation): number {
  return Math.round(r.local * 0.15 + r.regional * 0.25 + r.continental * 0.3 + r.global * 0.3);
}

/** Escalas de la importancia del resultado por ámbito. */
const TIER_GAIN: Record<CompetitionTier, Reputation> = {
  regional: { local: 1, regional: 0.7, continental: 0.18, global: 0.05 },
  continental: { local: 0.6, regional: 0.9, continental: 1, global: 0.4 },
  global: { local: 0.4, regional: 0.7, continental: 0.9, global: 1.2 },
};

function applyGain(r: Reputation, tier: CompetitionTier, amount: number): Reputation {
  const g = TIER_GAIN[tier];
  return {
    local: clampRep(r.local + amount * g.local),
    regional: clampRep(r.regional + amount * g.regional),
    continental: clampRep(r.continental + amount * g.continental),
    global: clampRep(r.global + amount * g.global),
  };
}

/** Reputación tras un partido (ganancia pequeña; perder casi no mueve). */
export function reputationAfterMatch(r: Reputation, o: MatchOutcome): Reputation {
  const tier = o.tier ?? "regional";
  const amount = (o.won ? 1.2 : 0.2) + (o.mvp ? 0.6 : 0);
  return applyGain(r, tier, amount);
}

/** Reputación tras una temporada/competición (campeón = gran salto). */
export function reputationAfterSeason(r: Reputation, o: SeasonOutcome): Reputation {
  let amount = 2 + o.wins * 0.3;
  if (o.champion) amount += 16;
  else if (o.finalist) amount += 7;
  else amount += Math.max(0, 5 - (o.placement - 1));
  if (o.mvpAwarded) amount += 3;
  return applyGain(r, o.tier, amount);
}

const TIERS: { id: ReputationTierId; label: string; min: number }[] = [
  { id: "legendary", label: "Leyenda mundial", min: 90 },
  { id: "global", label: "Élite global", min: 72 },
  { id: "continental", label: "Referente continental", min: 52 },
  { id: "regional", label: "Conocido en la región", min: 30 },
  { id: "local", label: "Promesa local", min: 10 },
  { id: "unknown", label: "Desconocido", min: 0 },
];

export function reputationTier(r: Reputation): { id: ReputationTierId; label: string } {
  const score = globalReputationScore(r);
  const t = TIERS.find((x) => score >= x.min) ?? TIERS[TIERS.length - 1];
  return { id: t.id, label: t.label };
}
