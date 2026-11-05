/**
 * COACH × PLAYER IDENTITY — la OBEDIENCIA emerge del ADN.
 *
 * Los jugadores no obedecen siempre igual: la disciplina aumenta la adherencia al
 * plan del coach; la creatividad aumenta la improvisación; el ego aumenta el riesgo
 * asumido. Solo LEE la identidad; no modifica el Identity Engine.
 */
import type { RosterEntry } from "@/sim";
import type { ObedienceProfile } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const unit = (t: number) => (Math.max(0, Math.min(100, t)) - 50) / 50; // -1..1

function mean(roster: RosterEntry[], pick: (id: NonNullable<RosterEntry["identity"]>) => number): number {
  const withId = roster.filter((r) => r.identity);
  if (withId.length === 0) return 0;
  return withId.reduce((s, r) => s + unit(pick(r.identity!)), 0) / withId.length;
}

export function obedienceProfile(roster: RosterEntry[]): ObedienceProfile {
  const discipline = mean(roster, (id) => id.discipline);
  const creativity = mean(roster, (id) => id.creativity);
  const ego = mean(roster, (id) => id.ego);
  return {
    obedience: clamp(0.6 + discipline * 0.4 - ego * 0.15, 0, 1),
    improvisation: clamp(0.1 + creativity * 0.5, 0, 1),
    egoRisk: clamp(0.5 + ego * 0.5, 0, 1),
  };
}
