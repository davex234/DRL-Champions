/**
 * TACTICAL INTELLIGENCE ENGINE — Runner.
 *
 * Cada tick avanza el Tactical Graph: evalúa condiciones (de DATOS) para transicionar
 * de objetivo→acción→fallback / setup→rotate→retake, ADAPTA en caliente (re-hit por
 * otro carril si el contacto va mal) y aplica la asignación. Determinista.
 */
import type { Rng } from "../sim/rng";
import type { RoundState, Side } from "../sim";
import type { ConditionKind, TeamTacticState } from "./types";
import { otherLane } from "./map";
import { assignAttack, assignDefense, contactLane } from "./assign";
import { tacticalPhase } from "./phases";

const aliveN = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive).length;

const PRIORITY: Record<ConditionKind, number> = {
  planted: 100, outnumbered: 80, contactBad: 70, contactDetected: 60,
  manDown: 50, atCommit: 40, mapControlDone: 35, laneOpen: 20, always: 0,
};

function condMet(s: RoundState, side: Side, st: TeamTacticState, when: ConditionKind): boolean {
  const us = aliveN(s, side);
  const them = aliveN(s, side === "ATK" ? "DEF" : "ATK");
  switch (when) {
    case "always": return true;
    case "atCommit": return s.phase !== "SETUP" && s.tick >= st.commitTick;
    case "mapControlDone": return s.phase !== "SETUP";
    case "contactBad": return s.phase === "EXECUTE" && us < them && !st.adapted;
    case "outnumbered": return us <= them - 2;
    case "manDown": return us < 5;
    case "planted": return s.spike.planted;
    case "contactDetected": return contactLane(s).contact;
    case "laneOpen": return false;
    default: return false;
  }
}

function stepTeam(s: RoundState, side: Side, st: TeamTacticState, rng: Rng): void {
  // Elige la mejor transición disponible desde el nodo activo.
  let bestTo: string | null = null;
  let bestPr = -1;
  let bestWhen: ConditionKind | null = null;
  for (const e of st.plan.edges) {
    if (e.from !== st.activeNode) continue;
    if (!condMet(s, side, st, e.when)) continue;
    const pr = PRIORITY[e.when];
    if (pr > bestPr) { bestPr = pr; bestTo = e.to; bestWhen = e.when; }
  }
  if (bestTo && bestTo !== st.activeNode) {
    const prevNode = st.activeNode;
    st.activeNode = bestTo;
    // Adaptación de ataque: el re-hit cambia de carril (rompe el contacto malo).
    if (bestTo === "rehit") {
      st.lane = otherLane(st.lane);
      st.adapted = true;
      st.notes.push(`adapta: re-hit por ${st.lane} (contacto malo en ${prevNode})`);
    } else if (bestTo === "save") {
      st.notes.push("adapta: save (en desventaja)");
    } else if (bestTo === "react" && bestWhen === "contactDetected") {
      st.notes.push(`rota al contacto (${contactLane(s).lane})`);
    }
  }
  void rng;
  if (side === "ATK") assignAttack(s, side, st);
  else assignDefense(s, side, st);
  // Fase táctica reconocible en curso (Tactical Director 2.0) — para broadcast/narrativa.
  st.phase = tacticalPhase(s, side, st);
}

/** Avanza las tácticas PRESENTES un tick (lo llama el director). */
export function stepTactics(s: RoundState, rng: Rng): void {
  if (!s.tactical) return;
  if (s.tactical.ATK) stepTeam(s, "ATK", s.tactical.ATK, rng);
  if (s.tactical.DEF) stepTeam(s, "DEF", s.tactical.DEF, rng);
}

/** Tick de execute que el ataque planea comprometer (lo lee el director). */
export function commitTick(s: RoundState): number | null {
  return s.tactical?.ATK ? s.tactical.ATK.commitTick : null;
}
