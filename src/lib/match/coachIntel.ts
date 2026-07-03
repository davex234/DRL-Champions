/**
 * COACH INTEL — modelos de presentación para la sala táctica.
 *
 * Traduce el estado REAL de los motores (Identity/Mental, Economy, Coach, Narrative)
 * a lo que el entrenador necesita ver y entender: tarjetas psicológicas de jugador,
 * el "porqué" de la recomendación de la IA y el análisis del timeout. PURO: solo lee.
 */
import type { MatchState } from "@/match";
import type { CoachDecision } from "@/coach";
import { obedienceProfile } from "@/coach";
import type { Identity, MentalState, Role, RosterEntry } from "@/sim";
import { initialMental, neutralIdentity } from "@/sim";
import type { ScoutReport } from "./scouting";
import { LANE_LABEL } from "./scouting";

// --------------------------------------------------------------------------
// Tarjeta psicológica de jugador
// --------------------------------------------------------------------------
export interface PlayerCardModel {
  name: string;
  role: Role;
  ovr: number;
  image?: string;
  teamTag?: string;
  identity: Identity;
  mental: MentalState;
  /** Créditos del jugador esta ronda (Economy Engine). */
  credits: number;
  /** Adherencia al plan del coach (0..1). */
  obedience: number;
  /** Etiqueta de estilo legible derivada del ADN. */
  style: string;
  /** Resultados recientes del equipo (true = ganó), más reciente al final. */
  recent: boolean[];
  /** Bajas del jugador en la última ronda jugada. */
  killsLastRound: number;
}

const ROLE_LABEL: Record<Role, string> = {
  igl: "IGL", entry: "Entry", anchor: "Ancla", lurk: "Lurker", support: "Soporte",
};

export function roleLabel(role: Role): string {
  return ROLE_LABEL[role] ?? role;
}

/** Etiqueta de estilo a partir del rasgo dominante del ADN. */
export function styleLabel(id: Identity): string {
  const candidates: [number, string][] = [
    [id.entryDrive, "Entry agresivo"],
    [id.lurkTendency, "Lurker / flanco"],
    [id.clutchFactor, "Jugador de clutch"],
    [id.utilityLean, "Maestro de utilidad"],
    [id.aggression, "Agresivo"],
    [id.patience, "Paciente / ancla"],
    [id.leadershipDrive, "Cerebro / IGL"],
    [id.creativity, "Impredecible"],
  ];
  candidates.sort((a, b) => b[0] - a[0]);
  return candidates[0][1];
}

/** Bajas por nombre en una ronda. */
function killsOf(round: MatchState["rounds"][number] | undefined): Record<string, number> {
  const k: Record<string, number> = {};
  if (!round) return k;
  for (const e of round.events) {
    if (e.type !== "kill") continue;
    const name = String((e.data as { byName?: string }).byName ?? "");
    if (name) k[name] = (k[name] ?? 0) + 1;
  }
  return k;
}

/** Construye las tarjetas del quinteto entrenado con su estado mental ACTUAL. */
export function buildPlayerCards(match: MatchState): PlayerCardModel[] {
  const roster = match.config.rosters.home;
  const lastRound = match.rounds[match.rounds.length - 1];
  const kills = killsOf(lastRound);
  const recent = match.history.slice(-5).map((h) => h.winner === "home");

  return roster.map((entry: RosterEntry) => {
    const identity: Identity = entry.identity ?? neutralIdentity();
    const mental = match.memory?.[entry.name] ?? initialMental(identity);
    const credits = match.economy?.home.players[entry.name] ?? 0;
    const obedience = obedienceProfile([entry]).obedience;
    return {
      name: entry.name,
      role: entry.role,
      ovr: entry.meta?.ovr ?? 0,
      image: entry.meta?.image,
      teamTag: entry.meta?.teamTag,
      identity,
      mental,
      credits,
      obedience,
      style: styleLabel(identity),
      recent,
      killsLastRound: kills[entry.name] ?? 0,
    };
  });
}

// --------------------------------------------------------------------------
// El "porqué" de la recomendación de la IA
// --------------------------------------------------------------------------
const NOTE_REASON: Record<string, string> = {
  react_match_point: "Estamos ante el match point rival: hay que arriesgar.",
  react_to_losses: "Venimos de varias derrotas: toca cambiar el enfoque.",
  high_confidence: "El equipo está inspirado: ejecuta con decisión.",
  endorse_plan: "La lectura automática es sólida; el plan se mantiene.",
  lean_force: "La economía aconseja forzar esta ronda.",
  lean_save: "La economía aconseja salvar para la siguiente.",
};

/** Frases en español que explican la recomendación de la IA (estilo analista). */
export function recommendationReasons(
  decision: CoachDecision,
  scout: ScoutReport,
  match: MatchState,
): string[] {
  const out: string[] = [];
  for (const n of decision.notes) {
    if (NOTE_REASON[n]) out.push(NOTE_REASON[n]);
  }

  if (scout.rounds >= 2) {
    if (scout.predictedAttack.confidence >= 0.5) {
      out.push(`El rival ataca sobre todo por ${scout.predictedAttack.label} (${Math.round(scout.predictedAttack.confidence * 100)}%).`);
    }
    if (scout.pattern.strength >= 0.66) {
      out.push(`Repite ${scout.pattern.label} en bucle: castígalo o fíntalo.`);
    }
    if (scout.dominantFragger) {
      out.push(`Cuidado con ${scout.dominantFragger}: está dominando los duelos.`);
    }
  }

  if (scout.enemyEconomy.buyingPower < 0.5) {
    out.push("Su economía está tocada: aprovecha la ventaja de armamento.");
  }

  if (match.momentum > 40) out.push("El momentum es nuestro.");
  else if (match.momentum < -40) out.push("El momentum es suyo: hay que cortar la racha.");

  if (out.length === 0) out.push("Ronda equilibrada: ejecuta tu plan con limpieza.");
  return out;
}

// --------------------------------------------------------------------------
// Análisis del timeout
// --------------------------------------------------------------------------
export interface TimeoutAnalysis {
  situation: string;
  diagnosis: string[];
  proposal: string;
}

export function timeoutAnalysis(match: MatchState, scout: ScoutReport): TimeoutAnalysis {
  const homeScore = match.score.home;
  const awayScore = match.score.away;
  const losing = awayScore > homeScore;
  const lossStreak = match.economy?.home.lossStreak ?? 0;

  const diagnosis: string[] = [];
  if (lossStreak >= 2) diagnosis.push(`Llevamos ${lossStreak} rondas seguidas perdidas.`);
  if (match.momentum < -30) diagnosis.push("El rival tiene toda la inercia.");
  if (scout.rounds >= 2 && scout.predictedAttack.confidence >= 0.5) {
    diagnosis.push(`Insisten por ${scout.predictedAttack.label} y nos está costando leerlo.`);
  }
  if ((match.economy?.away ? scout.enemyEconomy.buyingPower : 1) > 1) {
    diagnosis.push("Su economía está saneada: no podemos regalar rondas.");
  }
  if (diagnosis.length === 0) diagnosis.push("Partido parejo; toca ajustar pequeños detalles.");

  const proposal = losing
    ? `Cambiemos el lado del mapa: ataquemos por ${scout.leastDefended.label}, donde menos defienden, y juguemos con paciencia.`
    : `Mantengamos lo que funciona y cerremos por ${scout.leastDefended.label}; no regalemos duelos.`;

  return {
    situation: `Marcador ${homeScore}-${awayScore}. ${losing ? "Vamos por detrás." : homeScore === awayScore ? "Todo igualado." : "Vamos por delante."}`,
    diagnosis,
    proposal,
  };
}
