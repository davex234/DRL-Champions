/**
 * FASE 43 · RESUMEN ESTRATÉGICO DE UNA PARTIDA (PURO) — HECHOS de los turnos PERSISTIDOS, sin volver a ejecutar el
 * motor y sin causas inventadas.
 *
 * Entrada: los turnos YA proyectados para quien mira (`DuelTurnView`: `outcome` "A" = tú, "B" = rival, "TIE") y el
 * resultado del Combat Resolver (`DuelResultView`). Del rival solo se usa lo que JUGÓ (lo que ya está en los turnos).
 *
 *   · Eje de un turno = la estadística que TÚ declaraste o te impusieron (la del rival sale de la tabla SH↔EF, GS↔GS).
 *   · Turno empatado = 0 puntos para nadie (OPD-05).
 *   · Resolución final duel-combat-2: marcador → suma de OVR (+1 punto) → estadística total (sin punto) → empate.
 */
import { AXES, METRIC_LABEL, type Axis } from "./catalog";
import { ns, td } from "@/i18n/runtime";

const tr = ns("deckStrategy");

export interface TurnFact {
  number: number;
  attacker: "A" | "B";
  outcome: "A" | "B" | "TIE";
  scoreAfterYou: number;
  scoreAfterRival: number;
  you: { uid: string; nick: string; stat: Axis; value: number };
  rival: { uid: string; nick: string; stat: Axis; value: number };
}

export interface ResultFact {
  winner: "YOU" | "RIVAL" | null;
  isDraw: boolean;
  scoreYou: number;
  scoreRival: number;
  tiedEncounters: number;
  decidedBy: "SCORE" | "OVR_TIEBREAK" | "STAT_MARGIN" | "NONE";
  sumOvrYou: number | null;
  sumOvrRival: number | null;
  statTotalYou: number;
  statTotalRival: number;
}

export interface AxisPerformance { axis: Axis; timesCompared: number; wins: number; losses: number; ties: number; pointDelta: number; asAttacker: number; asDefender: number }
export interface CardPerformance { uid: string; nick: string; turns: number; wins: number; losses: number; ties: number; stats: Axis[]; values: number[] }

export interface MatchStrategySummary {
  turns: number;
  complete: boolean;
  wins: number;
  losses: number;
  ties: number;
  axes: AxisPerformance[];
  cards: CardPerformance[];
  resolution: { decidedBy: ResultFact["decidedBy"]; lines: string[]; tiebreakPointYou: number; tiebreakPointRival: number } | null;
  insights: string[];
  /** Coherencia turnos ↔ marcador del resolver (false = datos incoherentes: no se afirma nada del marcador). */
  consistent: boolean;
  /** Eje con más derrotas (si alguna): contexto opcional para abrir el laboratorio filtrado. Nunca una orden. */
  contextAxis: Axis | null;
}

const frac = (a: number, b: number) => `${a} de ${b}`;

export function summarizeMatch(turns: readonly TurnFact[], result: ResultFact | null): MatchStrategySummary {
  const ordered = [...turns].sort((a, b) => a.number - b.number);
  const axes: AxisPerformance[] = AXES.map((axis) => {
    const ts = ordered.filter((t) => t.you.stat === axis);
    const wins = ts.filter((t) => t.outcome === "A").length;
    const losses = ts.filter((t) => t.outcome === "B").length;
    return { axis, timesCompared: ts.length, wins, losses, ties: ts.length - wins - losses, pointDelta: wins - losses, asAttacker: ts.filter((t) => t.attacker === "A").length, asDefender: ts.filter((t) => t.attacker === "B").length };
  });
  const byUid = new Map<string, CardPerformance>();
  for (const t of ordered) {
    const c = byUid.get(t.you.uid) ?? { uid: t.you.uid, nick: t.you.nick, turns: 0, wins: 0, losses: 0, ties: 0, stats: [], values: [] };
    c.turns++; c.stats.push(t.you.stat); c.values.push(t.you.value);
    if (t.outcome === "A") c.wins++; else if (t.outcome === "B") c.losses++; else c.ties++;
    byUid.set(t.you.uid, c);
  }
  const cards = [...byUid.values()];
  const wins = ordered.filter((t) => t.outcome === "A").length;
  const losses = ordered.filter((t) => t.outcome === "B").length;
  const ties = ordered.length - wins - losses;

  let resolution: MatchStrategySummary["resolution"] = null;
  let consistent = true;
  if (result) {
    const tbYou = result.decidedBy === "OVR_TIEBREAK" && result.winner === "YOU" ? 1 : 0;
    const tbRival = result.decidedBy === "OVR_TIEBREAK" && result.winner === "RIVAL" ? 1 : 0;
    consistent = ordered.length === 10 && result.scoreYou === wins + tbYou && result.scoreRival === losses + tbRival && result.tiedEncounters === ties;
    const lines: string[] = [];
    const tiesLine = ties > 0 ? tr(" {ties} {v}: un empate de turno no da punto a nadie.", { ties, v: ties === 1 ? tr("turno empatado") : tr("turnos empatados") }) : "";
    if (result.decidedBy === "SCORE") {
      lines.push(tr("Decidió el marcador: {wins} turnos ganados contra {losses}.{tiesLine}", { wins, losses, tiesLine: td(tiesLine) }));
    } else if (result.decidedBy === "OVR_TIEBREAK") {
      lines.push(tr("Los turnos quedaron {wins}–{losses}.{tiesLine}", { wins, losses, tiesLine: td(tiesLine) }));
      lines.push(tr("Desempate por suma de OVR de los equipos: {sumOvrYou} contra {sumOvrRival}. Da 1 punto a {v}: final {scoreYou}–{scoreRival}.", { sumOvrYou: result.sumOvrYou, sumOvrRival: result.sumOvrRival, v: tbYou ? tr("tu equipo") : tr("el rival"), scoreYou: result.scoreYou, scoreRival: result.scoreRival }));
    } else if (result.decidedBy === "STAT_MARGIN") {
      lines.push(tr("Los turnos quedaron {wins}–{losses} y la suma de OVR empató ({sumOvrYou}–{sumOvrRival}).{tiesLine}", { wins, losses, sumOvrYou: result.sumOvrYou, sumOvrRival: result.sumOvrRival, tiesLine: td(tiesLine) }));
      lines.push(tr("Decidió la estadística total declarada en los diez turnos: {statTotalYou} contra {statTotalRival}. Este desempate no suma punto.", { statTotalYou: result.statTotalYou, statTotalRival: result.statTotalRival }));
    } else {
      lines.push(tr("Empate: turnos {wins}–{losses}, suma de OVR {v}–{v2} y estadística total {statTotalYou}–{statTotalRival}.{tiesLine}", { wins, losses, v: result.sumOvrYou ?? "—", v2: result.sumOvrRival ?? "—", statTotalYou: result.statTotalYou, statTotalRival: result.statTotalRival, tiesLine: td(tiesLine) }));
    }
    resolution = { decidedBy: result.decidedBy, lines, tiebreakPointYou: tbYou, tiebreakPointRival: tbRival };
  }

  // Máximo 3 hechos, sin «porque».
  const insights: string[] = [];
  const bestWin = [...axes].filter((a) => a.timesCompared > 0 && a.wins > a.losses).sort((a, b) => b.wins - a.wins || b.pointDelta - a.pointDelta || AXES.indexOf(a.axis) - AXES.indexOf(b.axis))[0];
  if (bestWin) insights.push(tr("Ganaste {wins} comparaciones de {v}.", { wins: frac(bestWin.wins, bestWin.timesCompared), v: td(METRIC_LABEL[bestWin.axis]) }));
  const worst = [...axes].filter((a) => a.timesCompared > 0 && a.losses > a.wins).sort((a, b) => b.losses - a.losses || a.pointDelta - b.pointDelta || AXES.indexOf(a.axis) - AXES.indexOf(b.axis))[0];
  if (worst) insights.push(tr("Perdiste {losses} comparaciones de {v}.", { losses: frac(worst.losses, worst.timesCompared), v: td(METRIC_LABEL[worst.axis]) }));
  if (ties > 0) insights.push(tr("{ties} {v} en empate de estadística (0 puntos).", { ties, v: ties === 1 ? tr("turno terminó") : tr("turnos terminaron") }));
  else {
    const allWon = cards.filter((c) => c.turns > 0 && c.wins === c.turns);
    if (allWon.length > 0 && insights.length < 3) insights.push(tr("{length} de tus {length2} cartas ganaron su turno.", { length: allWon.length, length2: cards.length }));
  }
  return { turns: ordered.length, complete: ordered.length === 10, wins, losses, ties, axes, cards, resolution, insights: insights.slice(0, 3), consistent, contextAxis: worst?.axis ?? null };
}

/** Adaptador desde la vista de turnos del cliente (`DuelTurnView`). */
export function turnFactsFromView(turns: readonly { number: number; attacker: "A" | "B"; outcome: "A" | "B" | "TIE"; scoreAfterYou: number; scoreAfterRival: number; you: { uid: string; nick: string; stat: Axis; value: number }; rival: { uid: string; nick: string; stat: Axis; value: number } }[]): TurnFact[] {
  return turns.map((t) => ({ number: t.number, attacker: t.attacker, outcome: t.outcome, scoreAfterYou: t.scoreAfterYou, scoreAfterRival: t.scoreAfterRival, you: { uid: t.you.uid, nick: t.you.nick, stat: t.you.stat, value: t.you.value }, rival: { uid: t.rival.uid, nick: t.rival.nick, stat: t.rival.stat, value: t.rival.value } }));
}
