/**
 * MOMENTOS DE PRODUCCIÓN + CALIFICACIÓN DEL ENTRENADOR (capa de presentación).
 *
 * Detecta los "momentos enormes" de una ronda (ACE, FLAWLESS, THRIFTY, ECO WIN…) y
 * calcula la nota del entrenador/táctica para la ceremonia final. PURO: solo LEE el
 * estado que los motores ya produjeron (RoundState terminado, MatchState, Narrative).
 * No toca ninguna lógica de juego.
 */
import type { RoundState, Side } from "@/sim";
import type { MatchState } from "@/match";

export type MomentKind =
  | "first_blood" | "ace" | "team_ace" | "clutch" | "thrifty" | "eco_win"
  | "flawless" | "comeback" | "match_point";

export interface MomentBadge {
  kind: MomentKind;
  label: string;
  sub?: string;
  hex: string;
  /** Prioridad de producción (mayor = más espectacular). */
  priority: number;
}

const GOLD = "#ffce4f";
const CLUTCH = "#ff2e63";
const ECO = "#37e6a0";
const ATKHEX = "#ff3b5c";

function killsByName(round: RoundState): Record<string, number> {
  const k: Record<string, number> = {};
  for (const e of round.events) {
    if (e.type !== "kill") continue;
    const name = String((e.data as { byName?: string }).byName ?? "");
    if (name) k[name] = (k[name] ?? 0) + 1;
  }
  return k;
}

const aliveOf = (round: RoundState, side: Side) => round.players.filter((p) => p.side === side && p.alive).length;

/**
 * Detecta los momentos destacados de una ronda recién terminada. Devuelve las
 * insignias ordenadas por espectacularidad (la [0] sirve de titular).
 */
export function detectRoundMoments(match: MatchState, finished: RoundState): MomentBadge[] {
  const out: MomentBadge[] = [];
  const us = finished.coachSide;
  const them: Side = us === "ATK" ? "DEF" : "ATK";
  const homeWon = finished.winner === us;
  const homeAlive = aliveOf(finished, us);

  // ACE / TEAM ACE (cualquier bando).
  const kills = killsByName(finished);
  const homeNames = new Set(finished.players.filter((p) => p.side === us).map((p) => p.name));
  const acer = Object.entries(kills).find(([, k]) => k >= 5);
  if (acer) {
    out.push({ kind: "ace", label: "ACE", sub: acer[0], hex: GOLD, priority: 90 });
  } else if (homeWon && aliveOf(finished, them) === 0) {
    const killers = Object.keys(kills).filter((n) => homeNames.has(n)).length;
    if (killers >= 4) out.push({ kind: "team_ace", label: "TEAM ACE", hex: GOLD, priority: 80 });
  }

  // FLAWLESS: ganamos sin perder a nadie.
  if (homeWon && homeAlive === finished.players.filter((p) => p.side === us).length) {
    out.push({ kind: "flawless", label: "FLAWLESS", sub: "Ronda perfecta", hex: "#7b5cff", priority: 70 });
  }

  // CLUTCH: ganamos siendo el último vivo.
  if (homeWon && homeAlive === 1) {
    out.push({ kind: "clutch", label: "CLUTCH", sub: "1 contra el mundo", hex: CLUTCH, priority: 75 });
  }

  // ECO WIN / THRIFTY (con loadouts de la ronda).
  const lo = match.currentLoadouts;
  if (homeWon && lo) {
    const home = us === "ATK" ? lo.home : lo.home; // home siempre es el equipo entrenado
    const away = lo.away;
    const homeBuy = home.buy;
    const awayBuy = away.buy;
    if ((homeBuy === "eco" || homeBuy === "save") && (awayBuy === "full" || awayBuy === "force")) {
      out.push({ kind: "eco_win", label: "ECO WIN", sub: "Robo a pleno", hex: ECO, priority: 78 });
    } else if (home.totalValue * 1.35 < away.totalValue) {
      out.push({ kind: "thrifty", label: "THRIFTY", sub: "Ganada con menos", hex: ECO, priority: 60 });
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
}

const HEX = { ATK: ATKHEX, DEF: "#19e3ff" };

/** Insignia de MATCH POINT (se decide en preparación). */
export function matchPointBadge(side: Side): MomentBadge {
  return { kind: "match_point", label: "MATCH POINT", hex: HEX[side], priority: 95 };
}

// ---------------------------------------------------------------------------
// Calificación del entrenador y táctica (para la ceremonia)
// ---------------------------------------------------------------------------
export interface CoachRating {
  grade: string;        // S/A/B/C/D
  score: number;        // 0..100
  label: string;        // frase corta
  tactical: string;     // nota táctica S..D
  roundWinRate: number; // 0..1
  variety: number;      // conceptos distintos usados
}

const gradeOf = (s: number): string => (s >= 88 ? "S" : s >= 76 ? "A" : s >= 60 ? "B" : s >= 44 ? "C" : "D");

/**
 * Historia de UTILIDAD/CONTROL del partido (Utility Engine) — para la narrativa.
 * Lee el mapa final de cada ronda. Devuelve un beat o null.
 */
export function utilityStory(match: MatchState): string | null {
  const rounds = match.rounds;
  if (rounds.length === 0) return null;
  let wonRounds = 0, controlWins = 0, spentSum = 0, n = 0;
  for (const r of rounds) {
    const m = r.map;
    if (!m) continue;
    const us = r.coachSide;
    const homeCtrl = us === "ATK" ? m.control.ATK : m.control.DEF;
    const awayCtrl = us === "ATK" ? m.control.DEF : m.control.ATK;
    if (r.winner === us) { wonRounds++; if (homeCtrl > awayCtrl) controlWins++; }
    spentSum += us === "ATK" ? m.spent.ATK : m.spent.DEF; n++;
  }
  if (wonRounds > 0 && controlWins / wonRounds >= 0.6) return "Ganasteis gracias al control del mapa.";
  if (n > 0 && spentSum / n >= 4.5) return "La utilidad decidió: dominasteis con herramientas.";
  if (wonRounds > 0 && controlWins / wonRounds <= 0.25) return "Ganasteis a pesar de ceder el control: puro aim y duelos.";
  return null;
}

export function coachRating(match: MatchState): CoachRating {
  const total = Math.max(1, match.history.length);
  const wins = match.history.filter((h) => h.winner === "home").length;
  const roundWinRate = wins / total;
  const won = match.winner === "home";

  // Variedad táctica: conceptos distintos que ordenó el entrenador.
  const concepts = new Set(match.history.map((h) => h.coach?.concept).filter(Boolean));
  const variety = concepts.size;

  // Forma del partido (remontada/milagro premian al entrenador).
  const shape = match.narrative?.match.shape.id;
  const comebackBonus = shape === "comeback" || shape === "miracle" ? 10 : 0;

  // Control del momentum a favor del equipo entrenado.
  const momentumBonus = Math.max(-6, Math.min(8, Math.round(match.momentum / 14)));

  let score = roundWinRate * 70 + (won ? 14 : 0) + Math.min(8, variety * 1.6) + comebackBonus + momentumBonus;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const tacticalScore = Math.min(100, Math.round(variety * 11 + roundWinRate * 50 + comebackBonus));

  const label = won
    ? score >= 88 ? "Dirección magistral" : score >= 76 ? "Gran lectura del partido" : "Victoria trabajada"
    : score >= 60 ? "Buena dirección pese a la derrota" : "Partido para olvidar";

  return { grade: gradeOf(score), score, label, tactical: gradeOf(tacticalScore), roundWinRate, variety };
}
