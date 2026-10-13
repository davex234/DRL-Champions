/**
 * TIMEOUT DOSSIER — el tiempo muerto REAL del entrenador.
 *
 * Unifica, en una sola foto, datos que ya viven dispersos en los motores: marcador y
 * momentum (Match), economía (Economy), control del mapa y lecturas (Utility), patrones
 * del rival (Tactical/Scout), estado mental/forma del quinteto (Identity) y el historial
 * agregado (executes/retakes/post-plants/trades). PURO: solo compone lecturas existentes.
 */
import type { MatchState } from "@/match";
import type { RoundState, Side } from "@/sim";
import type { CoachCommandId } from "@/coach";
import { teamEconomyView, type TeamEconomyView } from "@/economy";
import { scout, type ScoutReport } from "./scouting";
import { liveCoachReads } from "./coachLive";
import { ns, td } from "@/i18n/runtime";

const t = ns("match");

export interface FormRow { name: string; confidence: number; tilt: number; morale: number; momentum: number }
export interface AggStat { attempts: number; success: number }

export interface TimeoutDossier {
  situation: string;
  score: { home: number; away: number };
  momentum: number;
  lossStreak: number;
  /** Control del mapa (zonas) si hay ronda en curso. */
  mapControl: { ours: number; theirs: number } | null;
  economy: { ours: TeamEconomyView; theirs: TeamEconomyView } | null;
  /** Forma/estado mental del quinteto entrenado. */
  form: FormRow[];
  /** Últimas rondas (más reciente al final). */
  lastRounds: { round: number; won: boolean; reason: string }[];
  /** Patrones/lecturas del rival (scouting). */
  patterns: string[];
  /** Lecturas en vivo (si hay ronda). */
  reads: string[];
  /** Agregados del partido desde la perspectiva del equipo entrenado. */
  stats: { executes: AggStat; retakes: AggStat; postplants: AggStat; trades: number };
  diagnosis: string[];
  proposal: string;
  /** Órdenes que la IA sugiere para tras la pausa. */
  suggestedCommands: CoachCommandId[];
}

const sideOfRound = (m: MatchState, i: number, r: RoundState): Side => m.history[i]?.homeSide ?? r.coachSide;

/** Trades en una ronda: una baja que venga ≤50 ticks tras la muerte de un compañero. */
function tradesIn(round: RoundState, side: Side): number {
  const kills = round.events.filter((e) => e.type === "kill").sort((a, b) => a.tick - b.tick);
  let trades = 0;
  for (let i = 0; i < kills.length; i++) {
    const k = kills[i];
    if ((k.data as { bySide?: Side }).bySide !== side) continue;
    // ¿hubo una muerte de mi lado en los 50 ticks previos?
    const avenged = kills.some((d, j) => j < i && (d.data as { bySide?: Side }).bySide !== side && k.tick - d.tick <= 50);
    if (avenged) trades++;
  }
  return trades;
}

function aggregate(match: MatchState): TimeoutDossier["stats"] {
  const executes: AggStat = { attempts: 0, success: 0 };
  const retakes: AggStat = { attempts: 0, success: 0 };
  const postplants: AggStat = { attempts: 0, success: 0 };
  let trades = 0;
  match.rounds.forEach((r, i) => {
    const us = sideOfRound(match, i, r);
    const won = r.winner === us;
    if (us === "ATK") {
      if (r.executeTick != null) { executes.attempts++; if (won) executes.success++; }
      if (r.spike.planted) { postplants.attempts++; if (won) postplants.success++; }
    } else {
      if (r.spike.planted) { retakes.attempts++; if (won) retakes.success++; }
    }
    trades += tradesIn(r, us);
  });
  return { executes, retakes, postplants, trades };
}

export function timeoutDossier(match: MatchState, round?: RoundState | null, scoutReport?: ScoutReport): TimeoutDossier {
  const s = scoutReport ?? scout(match);
  const homeScore = match.score.home, awayScore = match.score.away;
  const losing = awayScore > homeScore;
  const lossStreak = match.economy?.home.lossStreak ?? 0;

  const economy = match.economy
    ? { ours: teamEconomyView(match.economy.home, match.economy.rules), theirs: teamEconomyView(match.economy.away, match.economy.rules) }
    : null;

  // Control del mapa desde la perspectiva del lado entrenado.
  let mapControl: { ours: number; theirs: number } | null = null;
  if (round?.map) {
    const us = round.coachSide;
    mapControl = { ours: round.map.control[us], theirs: round.map.control[us === "ATK" ? "DEF" : "ATK"] };
  }

  // Forma del quinteto (estado mental actual de la memoria del partido o de la ronda).
  const form: FormRow[] = [];
  const roster = match.config.rosters.home;
  for (const e of roster) {
    const live = round?.players.find((p) => p.name === e.name && p.side === round.coachSide);
    const m = live?.mental ?? match.memory?.[e.name];
    if (m) form.push({ name: e.name, confidence: Math.round(m.confidence), tilt: Math.round(m.tilt), morale: Math.round(m.morale), momentum: Math.round(m.momentum) });
  }

  const lastRounds = match.history.slice(-5).map((h) => ({ round: h.number, won: h.winner === "home", reason: h.reason }));

  const patterns: string[] = [];
  if (s.rounds >= 2) {
    if (s.predictedAttack.confidence >= 0.5) patterns.push(t("Atacan por {label} ({Math}%).", { label: td(s.predictedAttack.label), Math: Math.round(s.predictedAttack.confidence * 100) }));
    if (s.pattern.strength >= 0.5) patterns.push(`Repiten ${s.pattern.label} (${Math.round(s.pattern.strength * 100)}%).`);
    patterns.push(`Defienden menos ${s.leastDefended.label}.`);
    if (s.dominantFragger) patterns.push(t("Su jugador caliente: {dominantFragger}.", { dominantFragger: td(s.dominantFragger) }));
  }

  const reads = round ? liveCoachReads(match, round, s).slice(0, 4).map((r) => r.text) : [];
  const stats = aggregate(match);

  const diagnosis: string[] = [];
  if (lossStreak >= 2) diagnosis.push(t("Llevamos {lossStreak} rondas seguidas perdidas.", { lossStreak }));
  if (match.momentum < -30) diagnosis.push(t("El rival tiene toda la inercia."));
  if (stats.executes.attempts >= 2 && stats.executes.success / stats.executes.attempts < 0.4) diagnosis.push(t("Nuestros executes no están entrando: cambia el ritmo o el carril."));
  if (stats.retakes.attempts >= 2 && stats.retakes.success / stats.retakes.attempts < 0.4) diagnosis.push(t("Fallamos los retakes: compromételos antes y con utilidad."));
  const avgTilt = form.length ? form.reduce((a, f) => a + f.tilt, 0) / form.length : 0;
  if (avgTilt >= 50) diagnosis.push(t("El equipo está tilteado: toca calmar."));
  if (diagnosis.length === 0) diagnosis.push(t("Partido parejo; ajustar pequeños detalles."));

  const proposal = losing
    ? t("Cambiemos el lado: ataquemos por {label}, donde menos defienden, con paciencia.", { label: td(s.leastDefended.label) })
    : t("Mantengamos lo que funciona y cerremos por {label}; sin regalar duelos.", { label: td(s.leastDefended.label) });

  const suggestedCommands: CoachCommandId[] = [];
  if (avgTilt >= 50) suggestedCommands.push("calm");
  if (losing) suggestedCommands.push("patience");
  else suggestedCommands.push("motivate");
  if (s.pattern.strength >= 0.6) suggestedCommands.push("stack");

  return {
    situation: t("Marcador {home}-{away}. {state}", { home: homeScore, away: awayScore, state: losing ? t("Vamos por detrás.") : homeScore === awayScore ? t("Todo igualado.") : t("Vamos por delante.") }),
    score: { home: homeScore, away: awayScore },
    momentum: match.momentum,
    lossStreak,
    mapControl,
    economy,
    form,
    lastRounds,
    patterns,
    reads,
    stats,
    diagnosis,
    proposal,
    suggestedCommands: [...new Set(suggestedCommands)],
  };
}
