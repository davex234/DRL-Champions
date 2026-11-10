/**
 * ARNÉS QA · FASE 45 — ESCENAS Y FIXTURES (QA SYNTHETIC, sin servidor).
 *
 * Las partidas salen del MOTOR PURO (`qaSimulation`: dos bots sobre cartas reales) y se proyectan con las mismas
 * funciones que usa el servidor. Aquí no se decide ningún resultado: cuando una semilla no da el caso que hace falta
 * (empate total, desempate), se FABRICA con la forma exacta de `DuelResultView` y la escena lo dice.
 */
import { qaSnapshot, qaSimulate, qaView, qaRegistry } from "@/lib/duel/qaSimulation";
import { toCardDTO } from "@/lib/duel/matchView";
import { turnHeader } from "@/lib/duel/experience";
import type { DuelDeckDTO, DuelMatchView, DuelResultView, DuelTurnView } from "@/lib/duel/types";
import type { DuelDeckSnapshot } from "@/domain/cardgame";
import type { DuelMatch } from "@/domain/cardgame/match";

export type Section45 =
  | "PLAY HUB" | "PRE MATCH" | "MATCH INTRO" | "ARENA" | "TURN" | "CLASH" | "SCORE" | "FINAL TURN"
  | "WAITING" | "MATCH COMPLETE" | "RESULT" | "REWARDS" | "RANKED" | "CAMPAIGN" | "DRAFT" | "REDUCED MOTION" | "MOBILE";

export interface Fase45Scene {
  id: string;
  section: Section45;
  note: string;
  /** Ancho forzado de la escena (solo las de móvil). */
  narrow?: boolean;
  /** La escena se enseña con movimiento reducido. */
  reduced?: boolean;
}

const s = (section: Section45, id: string, note: string, o: Partial<Fase45Scene> = {}): Fase45Scene => ({ id, section, note, ...o });

export const FASE45_SCENES: Fase45Scene[] = [
  // ── PLAY HUB ──
  s("PLAY HUB", "hub", "selector completo: campaña destacada y cuatro modos"),
  s("PLAY HUB", "hub-resume", "partida abierta: la acción dominante es retomarla"),
  s("PLAY HUB", "hub-no-deck", "sin equipo válido: cada modo dice qué falta"),
  s("PLAY HUB", "hub-signed-out", "sin sesión"),
  s("PLAY HUB", "hub-offline", "sin conexión"),
  s("PLAY HUB", "hub-campaign-complete", "campaña completada"),
  // ── PRE MATCH ──
  s("PRE MATCH", "prematch", "preparación PvE: tu equipo, el rival oculto y la dificultad"),
  s("PRE MATCH", "prematch-versus", "solo el enfrentamiento: tú contra diez reversos"),
  s("PRE MATCH", "prematch-first", "primera partida: dificultad fácil preseleccionada"),
  // ── MATCH INTRO ──
  s("MATCH INTRO", "intro", "entrada: identidad, equipos y VS"),
  s("MATCH INTRO", "intro-reduced", "entrada con movimiento reducido", { reduced: true }),
  // ── ARENA ──
  s("ARENA", "arena-idle", "turno 1, atacas tú: la mesa espera tu carta"),
  s("ARENA", "arena-defense", "defiendes: el eje lo impone el servidor"),
  s("ARENA", "arena-mid", "turno 5: cartas jugadas a ambos lados"),
  s("ARENA", "arena-selected", "carta elegida y estadística declarada"),
  s("ARENA", "arena-locked", "jugada en vuelo: la mesa se cierra"),
  s("ARENA", "arena-attacker-you", "foco del escenario cuando atacas"),
  s("ARENA", "arena-attacker-rival", "foco del escenario cuando ataca el rival"),
  // ── TURN ──
  s("TURN", "turn-win", "turno ganado: el enfrentamiento y el punto"),
  s("TURN", "turn-loss", "turno perdido"),
  s("TURN", "turn-tie", "turno empatado: 0 puntos, y se ve"),
  s("TURN", "turn-history", "historial por turnos abierto"),
  s("TURN", "turn-timeline", "los diez turnos con su estado"),
  s("TURN", "turn-detail", "detalle de un turno ya jugado"),
  // ── CLASH ──
  s("CLASH", "clash-undeclared", "sin declarar todavía"),
  s("CLASH", "clash-declared", "eje declarado por ti"),
  s("CLASH", "clash-imposed", "eje impuesto al defender"),
  s("CLASH", "clash-resolved", "resuelto: 87 contra 82 y quién gana"),
  s("CLASH", "clash-same-axis", "los dos pelean en el mismo eje"),
  // ── SCORE ──
  s("SCORE", "score-lead", "vas por delante"),
  s("SCORE", "score-behind", "vas por detrás"),
  s("SCORE", "score-tied", "empate en el marcador"),
  // ── FINAL TURN ──
  s("FINAL TURN", "final-turn", "turno 10: el canto de la mesa se calienta"),
  s("FINAL TURN", "match-point", "punto de partida"),
  // ── WAITING ──
  s("WAITING", "waiting-rival", "PvP: esperando al rival, la arena sigue viva"),
  s("WAITING", "resync", "resincronizando con el servidor"),
  s("WAITING", "offline", "sin conexión durante la partida"),
  s("WAITING", "reconnect", "partida recuperada al volver"),
  // ── MATCH COMPLETE ──
  s("MATCH COMPLETE", "complete-win", "VICTORIA: el golpe antes del resultado"),
  s("MATCH COMPLETE", "complete-loss", "DERROTA"),
  s("MATCH COMPLETE", "complete-draw", "EMPATE"),
  s("MATCH COMPLETE", "complete-reduced", "el mismo golpe con movimiento reducido", { reduced: true }),
  // ── RESULT ──
  s("RESULT", "result-win", "resultado PvE ganado"),
  s("RESULT", "result-loss", "resultado PvE perdido"),
  s("RESULT", "result-draw", "resultado en empate"),
  s("RESULT", "result-ovr", "desempate por suma de OVR"),
  s("RESULT", "result-history", "cómo se decidió, turno a turno"),
  // ── REWARDS ──
  s("REWARDS", "rewards", "recompensas reales del servidor, una detrás de otra"),
  s("REWARDS", "no-rewards", "sin recompensa: se dice por qué"),
  s("REWARDS", "level-up", "subida de nivel dentro del resultado"),
  // ── RANKED ──
  s("RANKED", "ranked-win", "resultado ranked ganado"),
  s("RANKED", "ranked-rating-up", "rating: antes → cambio → después"),
  s("RANKED", "ranked-rating-down", "rating a la baja"),
  s("RANKED", "ranked-pending", "rating todavía sin liquidar"),
  // ── CAMPAIGN ──
  s("CAMPAIGN", "campaign-result", "nodo superado con primera victoria"),
  s("CAMPAIGN", "campaign-loss", "nodo perdido: se puede reintentar"),
  // ── DRAFT ──
  s("DRAFT", "draft-result", "fase del gauntlet superada"),
  s("DRAFT", "draft-economy", "el draft no da créditos, sobres ni XP"),
  // ── REDUCED MOTION ──
  s("REDUCED MOTION", "arena-reduced", "arena sin movimiento", { reduced: true }),
  s("REDUCED MOTION", "result-reduced", "resultado sin movimiento", { reduced: true }),
  // ── MOBILE ──
  s("MOBILE", "mobile-arena", "arena a 390 px", { narrow: true }),
  s("MOBILE", "mobile-clash", "enfrentamiento a 390 px", { narrow: true }),
  s("MOBILE", "mobile-result", "resultado a 390 px", { narrow: true }),
  s("MOBILE", "mobile-complete", "golpe final a 390 px", { narrow: true }),
];

export const SECTIONS_45: Section45[] = [...new Set(FASE45_SCENES.map((x) => x.section))];

/* ───────────── fixtures ───────────── */

const NOW = 1_700_000_000_000;

export function deckDTO(snap: DuelDeckSnapshot, id: string): DuelDeckDTO {
  const cards = snap.cards.map((c) => toCardDTO(c, qaRegistry));
  const roleCounts = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const c of cards) roleCounts[c.role] += 1;
  return {
    id, name: snap.deckName, cardUids: cards.map((c) => c.uid), cards, valid: true, status: "READY_FOR_DUEL", roleCounts,
    missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 }, errors: [],
    sumOvr: cards.reduce((a, c) => a + c.ovr, 0), updatedAt: NOW,
  };
}

/** Resultado FABRICADO con la forma exacta del servidor (solo para casos que las semillas no dan). */
export function withResult(v: DuelMatchView, r: Partial<DuelResultView>): DuelMatchView {
  return { ...v, result: { ...v.result!, ...r } };
}

export interface Fase45Fixtures {
  decks: DuelDeckDTO[];
  attack: DuelMatchView;
  defense: DuelMatchView;
  imposed: DuelMatchView;
  mid: DuelMatchView;
  t10: DuelMatchView;
  matchPoint: DuelMatchView | null;
  win: DuelMatchView;
  loss: DuelMatchView;
  draw: DuelMatchView;
  ovr: DuelMatchView;
  pvpWin: DuelMatchView;
  pvpPartial: DuelMatchView;
  winTurn: DuelTurnView | null;
  lossTurn: DuelTurnView | null;
  tieTurn: DuelTurnView | null;
  fabricated: { draw: boolean; ovr: boolean; tie: boolean };
}

/** Construye TODAS las vistas del arnés una sola vez. Determinista: mismas semillas, mismas partidas. */
export function fase45Fixtures(): Fase45Fixtures {
  const mine = qaSnapshot(0, "qa-you", "QA SYNTHETIC · Mi equipo");
  const rival = qaSnapshot(1, "qa-rival", "QA SYNTHETIC · Rival");
  const mirror = qaSnapshot(0, "qa-mirror", "QA SYNTHETIC · Espejo");

  const attack = qaView(qaSimulate(mine, rival, 0, "A"));
  const defense = qaView(qaSimulate(mine, rival, 0, "B"));
  const imposed = qaView(qaSimulate(mine, rival, 3, "A", 7));
  const mid = qaView(qaSimulate(mine, rival, 4, "A", 7));
  const t10 = qaView(qaSimulate(mine, rival, 9, "A", 7));

  let winM: DuelMatch | null = null; let lossM: DuelMatch | null = null; let ovrM: DuelMatch | null = null;
  for (let seed = 1; seed <= 400 && (!winM || !lossM || !ovrM); seed++) {
    const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
    const r = m.result;
    if (!r) continue;
    if (r.winner === "A" && r.combat.decidedBy === "SCORE" && !winM) winM = m;
    if (r.winner === "B" && r.combat.decidedBy === "SCORE" && !lossM) lossM = m;
    if (r.combat.decidedBy === "OVR_TIEBREAK" && !ovrM) ovrM = m;
  }
  let drawM: DuelMatch | null = null;
  for (let seed = 1; seed <= 400 && !drawM; seed++) {
    const m = qaSimulate(mine, mirror, 10, seed % 2 ? "A" : "B", seed);
    if (m.result?.isDraw) drawM = m;
  }
  let matchPoint: DuelMatchView | null = null;
  for (let seed = 1; seed <= 200 && !matchPoint; seed++) {
    for (const n of [7, 8, 9]) {
      const v = qaView(qaSimulate(mine, rival, n, seed % 2 ? "A" : "B", seed));
      if (v.status === "IN_PROGRESS" && turnHeader(v).matchPoint) { matchPoint = v; break; }
    }
  }

  const win = qaView(winM!);
  const loss = qaView(lossM!);
  const draw = drawM ? qaView(drawM) : null;
  const ovr = ovrM ? qaView(ovrM) : null;
  const pick = (h: DuelTurnView[], o: DuelTurnView["outcome"]) => h.find((t) => t.outcome === o) ?? null;
  const tie = pick([...win.history, ...loss.history], "TIE");

  return {
    decks: [deckDTO(mine, "qa-listo")],
    attack, defense, imposed, mid, t10, matchPoint, win, loss,
    draw: draw ?? withResult(win, { decidedBy: "NONE", winner: null, isDraw: true, scoreYou: 5, scoreRival: 5, reason: "QA SYNTHETIC · empate fabricado" }),
    ovr: ovr ?? withResult(win, { decidedBy: "OVR_TIEBREAK", winner: "YOU", scoreYou: 5, scoreRival: 5, sumOvrYou: 845, sumOvrRival: 838, reason: "QA SYNTHETIC · desempate fabricado" }),
    pvpWin: qaView(winM!, "A", "PVP"),
    pvpPartial: qaView(qaSimulate(mine, rival, 3, "A", 11, false), "A", "PVP"),
    winTurn: pick(win.history, "A"),
    lossTurn: pick(loss.history, "B"),
    tieTurn: tie ?? (win.history[0] ? { ...win.history[0], outcome: "TIE" as const, rival: { ...win.history[0].rival, value: win.history[0].you.value } } : null),
    fabricated: { draw: !draw, ovr: !ovr, tie: !tie },
  };
}
