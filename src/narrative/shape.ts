/**
 * MATCH NARRATIVE ENGINE — Forma del partido.
 *
 * Clasifica el partido a partir del recorrido del marcador (cambios de liderato,
 * margen final, mayor déficit remontado), las rachas y los clutches. Emerge: no hay
 * un guion; la misma forma puede contar historias distintas.
 */
import type { MatchShape, MatchShapeId, TeamId } from "./types";
import type { RoundRecord } from "./memory";
import { ns } from "@/i18n/runtime";

const t = ns("narrative");

export function classifyShape(
  records: RoundRecord[], score: Record<TeamId, number>, winner: TeamId | null,
): MatchShape {
  if (!records.length || !winner) {
    return { id: "trading_blows", confidence: 0.3, descriptors: [] };
  }
  const loser: TeamId = winner === "A" ? "B" : "A";
  const margin = Math.abs(score.A - score.B);
  const total = score.A + score.B;

  // Recorrido del marcador (lead del ganador a lo largo del partido).
  const leadSeries = records.map((r) => (r.scoreAfter[winner] - r.scoreAfter[loser]));
  const maxDeficit = Math.max(0, -Math.min(...leadSeries)); // peor situación del ganador
  const leadChanges = countLeadChanges(leadSeries);

  // Rachas máximas (cualquiera).
  const maxStreak = longestStreak(records);
  // Clutches ganados en total.
  const clutches = records.filter((r) => Object.values(r.lines).some((l) => l.clutchWon)).length;

  const descriptors: string[] = [];
  let id: MatchShapeId;
  let confidence = 0.6;

  if (maxDeficit >= 5) {
    id = maxDeficit >= 7 ? "miracle" : "comeback";
    descriptors.push(t("remontó un −{maxDeficit}", { maxDeficit }));
    confidence = 0.8;
    if (clutches >= 3) descriptors.push(t("{clutches} rondas de clutch", { clutches }));
  } else if (margin >= 9) {
    id = "blowout";
    descriptors.push(t("paliza por {v}-{v2}", { v: score[winner], v2: score[loser] }));
    confidence = 0.85;
  } else if (margin >= 6) {
    id = "dominance";
    descriptors.push(t("dominio claro"));
    confidence = 0.7;
  } else if (leadChanges >= 4) {
    id = "trading_blows";
    descriptors.push(t("{leadChanges} cambios de liderato", { leadChanges }));
    confidence = 0.7;
  } else if (margin <= 2 && total >= 14) {
    id = "nail_biter";
    descriptors.push(t("decidido por {margin}", { margin }));
    confidence = 0.8;
    if (clutches >= 2) descriptors.push(t("al filo"));
  } else if (maxStreak >= 6) {
    id = "snowball";
    descriptors.push(t("bola de nieve de {maxStreak} rondas", { maxStreak }));
    confidence = 0.75;
  } else if (leadSeries[Math.floor(leadSeries.length / 2)] < 0) {
    id = "comeback";
    descriptors.push(t("le dieron la vuelta"));
    confidence = 0.6;
  } else {
    id = "one_sided";
    descriptors.push(t("control de {winner}", { winner }));
    confidence = 0.55;
  }

  // ¿Colapso del perdedor? (iba ganando claro y lo perdió).
  if ((id === "comeback" || id === "miracle") && Math.max(...leadSeries.slice(0, Math.ceil(leadSeries.length / 2))) <= -3) {
    descriptors.push(t("colapso del rival"));
  }
  return { id, confidence, descriptors };
}

function countLeadChanges(lead: number[]): number {
  let changes = 0;
  let sign = 0;
  for (const v of lead) {
    const s = Math.sign(v);
    if (s !== 0 && s !== sign) { if (sign !== 0) changes++; sign = s; }
  }
  return changes;
}

function longestStreak(records: RoundRecord[]): number {
  let best = 0, cur = 0;
  let last: TeamId | null = null;
  for (const r of records) {
    if (r.winner === last) cur++; else { cur = 1; last = r.winner; }
    best = Math.max(best, cur);
  }
  return best;
}
