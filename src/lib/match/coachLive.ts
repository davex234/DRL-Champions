/**
 * COACH LIVE INTEL — lecturas EN VIVO del entrenador (la IA que AYUDA, no decide).
 *
 * Compone el estado REAL de los motores durante la ronda — números (Sim), mapa vivo
 * (Utility), modelo del rival (Tactical/Scout), economía (Economy) y estado mental
 * (Identity) — en un feed PRIORIZADO de lecturas tipo analista ("siempre stackean B",
 * "perdemos Mid", "gastáis la utilidad pronto"). Cada lectura puede SUGERIR una orden,
 * pero el entrenador decide. PURO: solo lee. No duplica motores: los lee.
 */
import type { MatchState } from "@/match";
import type { RoundState, Side } from "@/sim";
import type { CoachCommandId } from "@/coach";
import { mapReads, utilitySummary, executeProbability } from "@/utility";
import { scout, type ScoutReport } from "./scouting";

export interface CoachRead {
  id: string;
  text: string;
  /** 0..100; mayor = más urgente/relevante. */
  priority: number;
  kind: "enemy" | "us" | "map" | "economy" | "mental" | "utility";
  /** Orden que el entrenador podría dar en respuesta. */
  suggests?: CoachCommandId;
}

const aliveN = (r: RoundState, side: Side) => r.players.filter((p) => p.side === side && p.alive).length;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Lecturas en vivo del entrenador, ordenadas por prioridad. `scoutReport` opcional para
 * reutilizar un scouting ya calculado (evita recomputar).
 */
export function liveCoachReads(match: MatchState, round: RoundState, scoutReport?: ScoutReport): CoachRead[] {
  const us = round.coachSide;
  const them: Side = us === "ATK" ? "DEF" : "ATK";
  const out: CoachRead[] = [];
  const add = (id: string, text: string, priority: number, kind: CoachRead["kind"], suggests?: CoachCommandId) =>
    out.push({ id, text, priority, kind, suggests });

  // — Números (lo más urgente) —
  const a = aliveN(round, us), b = aliveN(round, them);
  if (a - b >= 2 && round.phase !== "ENDED") add("adv", `Ventaja ${a}v${b}: ventana para comprometer.`, 88, "us", us === "ATK" ? "force_execute" : "rotate");
  else if (b - a >= 2 && a > 0) add("dis", `Desventaja ${a}v${b}: no regaléis duelos.`, 90, "us", "patience");

  // — Mapa vivo (Utility) —
  for (const [i, txt] of mapReads(round).entries()) add(`map${i}`, txt, 55 - i * 4, "map");

  // — Utilidad: ¿la gastamos demasiado pronto? —
  if (round.map) {
    const u = utilitySummary(round.map, us);
    if (u.fraction >= 0.6 && round.tick < 150 && !round.spike.planted) {
      add("util_early", "Estáis gastando la utilidad demasiado pronto: guardad para la entrada.", 70, "utility", "save_utility");
    }
    const ep = executeProbability(round);
    if (us === "ATK" && ep >= 70 && round.phase !== "EXECUTE") add("exec_ok", `Buen control (${ep}%): podéis ejecutar.`, 66, "map", "force_execute");
    if (us === "ATK" && ep <= 35 && round.phase !== "EXECUTE") add("exec_no", `Poco control (${ep}%): sacad más espacio antes.`, 62, "map", "patience");
  }

  // — Modelo del rival (Scout) —
  const s = scoutReport ?? scout(match);
  if (s.rounds >= 2) {
    if (s.pattern.strength >= 0.6) add("pattern", `Repiten ${s.pattern.label} en bucle: castígalo o fíntalo.`, 64, "enemy", "stack");
    else if (s.predictedAttack.confidence >= 0.5) add("predict", `Atacan sobre todo por ${s.predictedAttack.label} (${Math.round(s.predictedAttack.confidence * 100)}%).`, 58, "enemy");
    if (s.ourWorst.net <= -2) add("ourworst", `Perdemos mucho por ${s.ourWorst.label}: evítalo o cámbialo.`, 60, "us", "spread");
    if (s.dominantFragger) add("fragger", `Cuidado con ${s.dominantFragger}: domina los duelos.`, 50, "enemy", "trade");
  }

  // — Economía —
  const lossStreak = match.economy?.home.lossStreak ?? 0;
  if (lossStreak >= 2) add("eco", `${lossStreak} rondas perdidas seguidas: cuida la economía.`, 52, "economy", "save");
  if (s.enemyEconomy.buyingPower < 0.5) add("enemyeco", "Su economía está tocada: aprovecha el armamento.", 48, "economy", "aggression");

  // — Estado mental del equipo —
  const ours = round.players.filter((p) => p.side === us);
  const tilt = avg(ours.map((p) => p.mental.tilt));
  const conf = avg(ours.map((p) => p.mental.confidence));
  if (tilt >= 55) add("tilt", "El equipo está nervioso (tilt alto): cálmalos.", 68, "mental", "calm");
  else if (conf >= 70) add("hot", "El equipo está inspirado: aprovéchalo.", 46, "mental", "motivate");
  else if (conf <= 38) add("cold", "El equipo está frío: una palabra de ánimo ayudaría.", 56, "mental", "motivate");

  return out.sort((x, y) => y.priority - x.priority);
}
