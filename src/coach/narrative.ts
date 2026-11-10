/**
 * COACH × NARRATIVE — significado de las DECISIONES del entrenador (sin frases).
 *
 * Lee las rondas terminadas (sus `coachCall` events + Tactical Runtime + estado mental
 * + resultado) y detecta momentos de ENTRENADOR: grandes timeouts, lecturas, adaptaciones,
 * llamadas brillantes/arriesgadas, mind games, planes de remontada, victorias psicológicas.
 * Mismo patrón que `detectTacticalEvents`/`detectAbilityEvents`. NO modifica ningún motor. PURO.
 */
import type { RoundState, Side } from "@/sim";
import { ns } from "@/i18n/runtime";

const tr = ns("coach");

export type CoachEventType =
  | "great_timeout" | "wrong_timeout" | "momentum_shift" | "coach_read"
  | "perfect_adaptation" | "brilliant_call" | "tactical_genius" | "risky_call"
  | "mind_game" | "comeback_plan" | "psychological_win" | "perfect_adjustment";

export interface CoachEvent {
  type: CoachEventType;
  round: number;
  team: "home" | "away";
  magnitude: number;
  detail?: string;
}

interface CoachCallInfo { id: string; effective: boolean; kind?: string; category?: string }

const AGGRESSIVE = new Set(["rush", "execute", "force_execute", "aggression", "tempo_up", "use_utility", "retake", "cancel_fake"]);
const RECOVERY = new Set(["save", "regroup", "play-picks", "play_picks", "patience", "calm", "tempo_down"]);

const callsOf = (round: RoundState): CoachCallInfo[] =>
  round.events.filter((e) => e.type === "coachCall").map((e) => e.data as unknown as CoachCallInfo);

const killsOf = (round: RoundState, side: Side) =>
  round.events.filter((e) => e.type === "kill" && e.data.bySide === side).length;

const avgConfidence = (round: RoundState, side: Side): number => {
  const ps = round.players.filter((p) => p.side === side);
  if (ps.length === 0) return 50;
  return ps.reduce((a, p) => a + p.mental.confidence, 0) / ps.length;
};

/**
 * Detecta los eventos de entrenador sobre las rondas jugadas. `momenta` opcional = momentum
 * del partido por ronda (para detectar giros); si falta, se deriva de los ganadores.
 */
export function detectCoachEvents(rounds: RoundState[]): CoachEvent[] {
  const out: CoachEvent[] = [];
  // Momentum derivado (perspectiva del lado entrenado) para giros y remontadas.
  let run = 0;
  const swing: number[] = [];
  for (const r of rounds) {
    const won = r.winner === r.coachSide;
    run = Math.max(-100, Math.min(100, run * 0.6 + (won ? 40 : -40)));
    swing.push(run);
  }

  rounds.forEach((round, idx) => {
    const n = idx + 1;
    const homeSide = round.coachSide;
    const teamOf = (side: Side): "home" | "away" => (side === homeSide ? "home" : "away");
    const won = round.winner === homeSide;
    const calls = callsOf(round);
    const t = round.tactical;
    const us = homeSide;
    const them: Side = us === "ATK" ? "DEF" : "ATK";
    const push = (type: CoachEventType, side: Side, magnitude: number, detail?: string) =>
      out.push({ type, round: n, team: teamOf(side), magnitude: Math.min(100, Math.max(1, Math.round(magnitude))), detail });

    // — Decisiones en vivo (coachCall) —
    if (calls.length > 0) {
      const effective = calls.filter((c) => c.effective).length;
      const aggressive = calls.some((c) => AGGRESSIVE.has(c.id));
      const recovery = calls.some((c) => RECOVERY.has(c.id));

      if (won && effective > 0) {
        if (recovery) push("great_timeout", us, 55 + effective * 8, tr("{effective} llamada(s) salvaron la ronda", { effective }));
        else push("brilliant_call", us, 55 + effective * 8);
      }
      if (won && effective >= 2) push("tactical_genius", us, 80, tr("{effective} ajustes en una ronda", { effective }));
      if (won && aggressive && killsOf(round, us) <= killsOf(round, them)) push("risky_call", us, 65, tr("apuesta agresiva que salió"));
      if (!won && aggressive) push("risky_call", us, 40, tr("apuesta agresiva fallida"));
      if (!won && recovery) push("wrong_timeout", us, 45, tr("la pausa no cambió la ronda"));
    }

    // — Lectura / adaptación táctica del lado entrenado —
    if (t) {
      const ours = us === "ATK" ? t.ATK : t.DEF;
      if (ours) {
        if (ours.reads && ours.reads.length > 0 && won) push("coach_read", us, 60, ours.reads[0]);
        if (ours.adapted && won) push("perfect_adaptation", us, 65);
        if (ours.concept === "fake" && won) push("mind_game", us, 70, `finta ${ours.fakeLane ?? "?"} → ${ours.lane}`);
        if (calls.some((c) => c.kind === "command") && won && killsOf(round, us) > killsOf(round, them)) {
          push("perfect_adjustment", us, 58);
        }
      }
    }

    // — Victoria psicológica: ganar con la moral arriba pese a perder los duelos —
    if (won && avgConfidence(round, us) >= 60 && killsOf(round, us) < killsOf(round, them)) {
      push("psychological_win", us, 55);
    }

    // — Giro de momentum / plan de remontada (nivel partido) —
    if (idx >= 1) {
      const prev = swing[idx - 1], cur = swing[idx];
      if (prev <= -30 && cur >= 0) push("momentum_shift", us, 60, tr("el partido gira"));
      if (prev <= -50 && won && swing[idx - 1] < swing[idx]) push("comeback_plan", us, 70, tr("arranca la remontada"));
    }
  });

  return out;
}
