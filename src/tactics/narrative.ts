/**
 * TACTICAL DIRECTOR 2.0 × NARRATIVE — significado TÁCTICO de las rondas (sin frases). Lee las
 * rondas terminadas (su Tactical Runtime + resultado) y detecta momentos de equipo. Complementa la
 * narrativa de combate; NO modifica el Narrative Engine. PURO.
 */
import type { RoundState, Side } from "../sim";

export type TacticalEventType =
  | "perfect_fake" | "early_rotation" | "late_execute" | "slow_default" | "fast_execute"
  | "mid_control" | "retake_masterclass" | "perfect_post_plant" | "save_call" | "anti_strat_success"
  | "over_rotation" | "wrong_read" | "momentum_swing";

export interface TacticalEvent {
  type: TacticalEventType;
  round: number;
  team: "home" | "away";
  magnitude: number;
  detail?: string;
}

const aliveOf = (round: RoundState, side: Side) => round.players.filter((p) => p.side === side && p.alive).length;
const killsOf = (round: RoundState, side: Side) => round.events.filter((e) => e.type === "kill" && e.data.bySide === side).length;

/** Detecta los eventos tácticos sobre las rondas (necesita `round.tactical`). */
export function detectTacticalEvents(rounds: RoundState[]): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  rounds.forEach((round, idx) => {
    const t = round.tactical;
    if (!t) return;
    const n = idx + 1;
    const homeSide = round.coachSide;
    const teamOf = (side: Side): "home" | "away" => (side === homeSide ? "home" : "away");
    const winner = round.winner;
    const atk = t.ATK, def = t.DEF;
    const planted = round.spike.planted;
    const push = (type: TacticalEventType, side: Side, magnitude: number, detail?: string) =>
      out.push({ type, round: n, team: teamOf(side), magnitude: Math.min(100, Math.max(1, Math.round(magnitude))), detail });

    // — Ataque —
    if (atk) {
      if (atk.concept === "fake" && winner === "ATK") push("perfect_fake", "ATK", 75, `finta ${atk.fakeLane ?? "?"} → ${atk.lane}`);
      if (atk.notes.some((x) => x.includes("anti-strat")) && winner === "ATK") push("anti_strat_success", "ATK", 65);
      if ((atk.concept === "map_control" || atk.concept === "default" || atk.lane === "mid") && winner === "ATK") push("mid_control", "ATK", 50);
      if (round.executeTick != null) {
        if (round.executeTick > atk.commitTick + 30) push("late_execute", "ATK", 45);
        else if (round.executeTick <= 55) push("fast_execute", "ATK", 50);
        if ((atk.concept === "default" || atk.concept === "play_picks") && round.executeTick > 110) push("slow_default", "ATK", 40);
      }
      if (atk.concept === "save" || atk.activeNode === "save") push("save_call", "ATK", 30);
    }

    // — Defensa —
    if (def) {
      if (def.notes.some((x) => x.includes("anti-strat") || x.includes("stack")) && winner === "DEF") push("anti_strat_success", "DEF", 65);
      if (def.concept === "stack" && atk && atk.lane !== def.lane && winner === "ATK") push("wrong_read", "DEF", 60, `stack ${def.lane}, hit ${atk.lane}`);
      if (def.adapted) {
        if (atk?.concept === "fake" && winner === "ATK") push("over_rotation", "DEF", 60);
        else if (winner === "DEF") push("early_rotation", "DEF", 55);
      }
      if (def.style === "save") push("save_call", "DEF", 30);
    }

    // — Objetivo —
    if (planted) {
      if (round.endReason === "detonation" && winner === "ATK") push("perfect_post_plant", "ATK", 60);
      if (round.endReason === "defuse" && winner === "DEF") {
        const adv = aliveOf(round, "DEF") <= aliveOf(round, "ATK");
        push("retake_masterclass", "DEF", adv ? 80 : 55, adv ? "retake en desventaja" : "retake limpio");
      }
    }

    // — Remontada de ronda (ganar perdiendo los duelos) —
    if (winner && killsOf(round, winner) < killsOf(round, winner === "ATK" ? "DEF" : "ATK")) {
      push("momentum_swing", winner, 55);
    }
  });
  return out;
}
