/**
 * SIMULACIÓN QA (Fase 33) — SOLO arneses `/design-system/*` y tests. NUNCA una pantalla de juego.
 *
 * Fabrica partidas con el MOTOR PURO (`domain/cardgame`) y dos bots sobre cartas REALES del catálogo, y
 * las proyecta con las MISMAS funciones que usa el servidor (`projectMatchFor` + `buildMatchView`). Es la
 * pieza que las Fases 26/28/29 copiaban en cada arnés. Todo es QA SYNTHETIC: nada se escribe ni se envía.
 * Un contrato comprueba que ninguna ruta real la importa.
 */
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList, DUEL_ROLES,
  type DuelDeckSnapshot,
} from "@/domain/cardgame";
import { startDuelMatch, confirmTurn, type DuelMatch, type Side } from "@/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "@/domain/cardgame/opponent";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { rivalHintsFor, rivalRolesFor, committedRivalHint } from "@/domain/cardgame/hints";
import { visualHintValue } from "@/lib/duel/hintVisuals";
import { duelAward } from "@/domain/progression/duelRewards";
import { buildMatchView, toCardDTO } from "./matchView";
import type { DuelMatchView, DuelReplay } from "./types";

export const qaRegistry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Mazo legal nº `block` (las 2 mejores cartas por rol a partir de ese bloque), con uids sintéticos. */
export function qaSnapshot(block: number, id: string, name: string): DuelDeckSnapshot {
  // Con el catálogo diseñado un jugador puede tener cartas de ROLES distintos: el jugador usado se
  // recuerda en TODO el mazo, no sólo dentro de un rol (el validador rechaza DUPLICATE_PLAYER).
  const usados = new Set<string>();
  const picks = DUEL_ROLES.flatMap((role) => {
    const best = new Map<string, ReturnType<CardRegistry["forRole"]>[number]>();
    for (const c of qaRegistry.forRole(role as RoleId)) {
      if (!c.combat || usados.has(c.playerId)) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, c);
    }
    const elegidas = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(block * 2, block * 2 + 2);
    for (const c of elegidas) usados.add(c.playerId);
    return elegidas;
  });
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(qaRegistry, ownershipFromList(owned)));
  const snap = v.valid ? takeDeckSnapshot(deck, v, NOW) : null;
  if (!snap) throw new Error("qaSnapshot: mazo QA no válido");
  return snap;
}

/**
 * Juega `turns` turnos con dos bots (motor real). Si al parar le toca declarar al rival (B) y
 * `letRivalDeclare`, se le deja declarar para que A quede «defendiendo», como lo devolvería el servidor.
 */
export function qaSimulate(mine: DuelDeckSnapshot, rival: DuelDeckSnapshot, turns: number, first: Side, seed = 7, letRivalDeclare = true): DuelMatch {
  const start = startDuelMatch({ id: `qa-${first}-${turns}-${seed}`, snapshotA: mine, snapshotB: rival, firstAttacker: first });
  if (!start.ok) throw new Error("qaSimulate: no arranca");
  let m = start.match;
  let rng = { a: createRng(seed), b: createRng(seed + 1) };
  const both = createController({ side: "A", kind: "BOT", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
  const bots = { A: createDuelBot("you", "NORMAL"), B: createDuelBot("bot", "HARD") };
  for (let i = 0; i < turns * 8 && m.turns.length < turns && m.status === "IN_PROGRESS"; i++) {
    const r = advanceBots(m, both, bots, rng.a, rng.b, 1);
    m = r.match; rng = { a: r.rngA, b: r.rngB };
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); if (c.ok) m = c.match; }
  }
  if (letRivalDeclare && m.status === "IN_PROGRESS" && m.attacker === "B" && m.phase === "ATTACKER_CARD") {
    const human = createController({ side: "A", kind: "HUMAN", id: "you" }, { side: "B", kind: "BOT", id: "bot" });
    m = advanceBots(m, human, { B: bots.B }, rng.a, rng.b).match;
  }
  return m;
}

export type QaMode = "PVE" | "PVP" | "PVP_PRIVATE";

/** La vista que vería `side`, proyectada como la proyecta el servidor para ese modo. */
export function qaView(m: DuelMatch, side: Side = "A", mode: QaMode = "PVE", rivalLabel?: string): DuelMatchView {
  // F71 · las pistas de las cartas ocultas, igual que en servidor: PvE en la vista, PvP dentro de la proyección.
  const countryOf = (playerId: string): string => qaRegistry.player(playerId)?.country ?? "";
  const projected = mode === "PVE" ? m : projectMatchFor(m, side, countryOf, visualHintValue);
  const view = buildMatchView(projected, {
    side, registry: qaRegistry, difficulty: "NORMAL", rivalLabel: mode === "PVE" ? rivalLabel : rivalLabel ?? "Rival",
    rivalHints: mode === "PVE" ? rivalHintsFor(m, side, countryOf, visualHintValue) : undefined,
    // DUEL GAMEPLAY UX 2.0 · los roles del reverso, alineados con las pistas (PvP: ya van en la proyección).
    rivalRoles: mode === "PVE" ? rivalRolesFor(m, side, countryOf, visualHintValue) : undefined,
    rivalCommitted: mode === "PVE" ? committedRivalHint(m, side, countryOf, visualHintValue) : undefined,
  });
  if (mode !== "PVE" || !view.result) return view;
  const a = duelAward({ winner: view.result.winner, isDraw: view.result.isDraw }, "NORMAL");
  return { ...view, result: { ...view.result, award: { points: a.points, credits: a.reward.credits ?? 0, xp: a.reward.xp ?? 0 } } };
}

/** Repetición con la misma forma y los mismos filtros que `getReplay` en servidor. */
export function qaReplay(m: DuelMatch, side: Side = "A", mode: QaMode = "PVE", rivalName: string | null = null): DuelReplay {
  const view = qaView(m, side, mode);
  const mine = side === "A" ? m.snapshotA : m.snapshotB;
  return {
    matchId: m.id, mode, rivalName, difficulty: "NORMAL", rulesVersion: m.combatRulesVersion,
    yourDeckName: mine.deckName, turns: view.history, result: view.result,
    yourCards: mine.cards.map((c) => toCardDTO(c, qaRegistry)), rivalCards: view.rivalUsed,
  };
}

/** Primera semilla (entre `from` y `to`) cuya partida completa cumple `pred`. */
export function qaFindMatch(pred: (m: DuelMatch) => boolean, from = 1, to = 400): DuelMatch | null {
  const mine = qaSnapshot(0, "qa-you", "QA · Equipo principal");
  const rival = qaSnapshot(1, "qa-rival", "QA · Rival");
  for (let seed = from; seed <= to; seed++) {
    const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
    if (pred(m)) return m;
  }
  return null;
}
