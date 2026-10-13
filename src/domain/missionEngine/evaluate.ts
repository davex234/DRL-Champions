/**
 * F73 · EVALUACIÓN DE MISIONES — de un EVENTO del servidor a operaciones de progreso. PURO.
 *
 * ─────────────────────────── ANTI-AFK (F72.8) ───────────────────────────
 * El reloj juega por quien no decide. Para que dejar el juego solo no complete misiones, una partida CUENTA solo si la
 * persona tomó al menos `MIN_HUMAN_DECISIONS` de sus 10 decisiones (la mitad). Una partida no elegible no suma y no
 * rompe rachas (no se le castiga, simplemente no cuenta). El reloj no se toca.
 *
 * ─────────────────────────── ANTI-FARM ───────────────────────────
 *  · Solo partidas TERMINADAS por reglas: un abandono (propio o del rival) no cuenta, ni para jugar ni para ganar.
 *  · PvP privado no cuenta nunca (dos cuentas amigas podrían regalarse victorias).
 *  · Cada evento lleva clave única (`match:<id>`, la ref de la apertura o del crafteo): el servidor la registra y un
 *    evento repetido no hace nada (F5, reintento, dos pestañas, sondeos).
 *  · El equipo evaluado es el que congeló el SERVIDOR al empezar la partida, no lo que diga el navegador ni el equipo
 *    guardado después.
 */
import type { DeckFact, MatchEvent, MissionDef, MissionEvent, ProgressOp } from "./types";

export const MIN_HUMAN_DECISIONS = 5;
const DIFF_RANK = { EASY: 0, NORMAL: 1, HARD: 2 } as const;

/** ¿Cuenta esta partida para misiones? (anti-AFK + anti-farm). */
export function matchCounts(e: MatchEvent): boolean {
  return e.finished && e.mode !== "PRIVATE" && e.humanDecisions >= MIN_HUMAN_DECISIONS;
}

const maxGroup = (deck: DeckFact[], key: (d: DeckFact) => string): number => {
  const n = new Map<string, number>();
  for (const d of deck) { const k = key(d); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
  return Math.max(0, ...n.values());
};
const countBy = (deck: DeckFact[], pred: (d: DeckFact) => boolean) => deck.filter(pred).length;

/** ¿Cumple el equipo del evento lo que pide la condición? (independiente de ganar). */
function deckOk(m: MissionDef, e: MatchEvent): boolean {
  const c = m.condition;
  const min = Math.max(1, c.min ?? 1);
  switch (c.type) {
    case "USE_CARD": return !!c.cardId && e.deck.some((d) => d.cardId === c.cardId);
    case "USE_PLAYER": case "DECK_CONTAINS_PLAYER": case "WIN_WITH_PLAYER":
      return !!c.playerId && e.deck.some((d) => d.playerId === c.playerId);
    case "USE_TEAM": return !!c.team && e.deck.some((d) => d.team === c.team);
    case "USE_COUNTRY": return !!c.country && e.deck.some((d) => d.country === c.country);
    case "USE_ROLE": return !!c.role && e.deck.some((d) => d.role === c.role);
    case "DECK_MIN_TEAM": case "WIN_WITH_TEAM_COUNT":
      return (c.team ? countBy(e.deck, (d) => d.team === c.team) : maxGroup(e.deck, (d) => d.team)) >= min;
    case "DECK_MIN_COUNTRY": case "WIN_WITH_COUNTRY_COUNT":
      return (c.country ? countBy(e.deck, (d) => d.country === c.country) : maxGroup(e.deck, (d) => d.country)) >= min;
    case "DECK_MIN_ROLE": case "WIN_WITH_ROLE_COUNT":
      return (c.role ? countBy(e.deck, (d) => d.role === c.role) : maxGroup(e.deck, (d) => d.role)) >= min;
    default: return true;
  }
}

const NEEDS_WIN = new Set(["MATCH_WIN", "WIN_WITH_PLAYER", "WIN_WITH_TEAM_COUNT", "WIN_WITH_COUNTRY_COUNT", "WIN_WITH_ROLE_COUNT", "WIN_PVE", "WIN_PVP", "WIN_COMPETITIVE", "WIN_DRAFT"]);
const FORCED_MODE: Partial<Record<string, MatchEvent["mode"]>> = { WIN_PVE: "PVE", WIN_PVP: "RANKED", WIN_COMPETITIVE: "RANKED", WIN_DRAFT: "DRAFT" };
const MATCH_TYPES = new Set(["MATCH_PLAY", "MATCH_WIN", "WIN_STREAK", "TURN_WIN", "USE_CARD", "USE_PLAYER", "USE_TEAM", "USE_COUNTRY", "USE_ROLE",
  "DECK_CONTAINS_PLAYER", "DECK_MIN_TEAM", "DECK_MIN_COUNTRY", "DECK_MIN_ROLE", ...NEEDS_WIN]);

/** Operación de progreso que produce UN evento sobre UNA misión (o `null`: no le afecta). */
export function evaluate(m: MissionDef, e: MissionEvent): ProgressOp | null {
  const c = m.condition;
  const inc = (value: number): ProgressOp | null => (value > 0 ? { missionId: m.id, op: "INC", value, target: m.target } : null);
  if (e.kind === "OPEN_PACK" || e.kind === "CRAFT_PACK") {
    if (c.type !== e.kind) return null;
    return c.packId && c.packId !== e.packId ? null : inc(1);
  }
  if (e.kind === "CRAFT_CARD") return c.type === "CRAFT_CARD" ? inc(1) : null;
  if (e.kind !== "MATCH") return null;

  // ── partidas ──
  if (!MATCH_TYPES.has(c.type)) return null;
  if (!matchCounts(e)) return null;
  const forced = FORCED_MODE[c.type];
  if (forced && e.mode !== forced) return null;
  if (c.modes && c.modes.length && !c.modes.includes(e.mode as never)) return null;
  if (c.minDifficulty && e.mode === "PVE" && (e.difficulty === null || DIFF_RANK[e.difficulty] < DIFF_RANK[c.minDifficulty])) return null;
  if (c.type === "WIN_STREAK") return { missionId: m.id, op: e.won ? "STREAK_WIN" : "STREAK_RESET", target: m.target };
  if (!deckOk(m, e)) return null;
  if (NEEDS_WIN.has(c.type) && !e.won) return null;
  if (c.type === "TURN_WIN") return inc(e.turnsWon);
  return inc(1);
}

/** Todas las operaciones de un evento, solo sobre misiones ACTIVAS para el usuario (ni bloqueadas ni completadas). */
export function evaluateAll(active: readonly MissionDef[], e: MissionEvent): ProgressOp[] {
  return active.map((m) => evaluate(m, e)).filter((x): x is ProgressOp => x !== null);
}
