/**
 * Tests del PvP Match Model (node:test). Ejecutar: `npm test`.
 *
 * Cubren la capa PURA: ciclo de vida, autoridad de turno, concurrencia y secreto. Usan mazos
 * REALES del catálogo y el orquestador REAL, igual que `match.test.ts`: si el motor cambiara,
 * estos tests se enterarían.
 *
 * Lo que NO se prueba aquí porque necesita base de datos —restricciones, `action_id` contra la
 * clave primaria, abandono persistido— vive en `scripts/pvp-model-verify.ts` y en
 * `supabase/tests/0031_pvp_duels_test.sql`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  DUEL_ROLES, type DuelDeckSnapshot,
} from "../index";
import {
  startDuelMatch, selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  confirmTurn, requiredDefenderStat,
  type DuelMatch, type MatchAction, type Side,
} from "../match";
import {
  pvpLifecycle, lifecycleOf, isTerminal, acceptsActions, canTransition, transitionsFrom,
  sideForPlayer, playerForSide, expectedPlayer, opponentOf, guardAction, nextVersion, turnWindow,
  projectMatchFor, leakedUids,
  type PvpMatchRecord,
} from "./index";
import { buildSnapshot } from "./sync";
import { hintForCard, rivalUnplayedCards } from "../hints";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

function realSnapshot(block: number, id: string): DuelDeckSnapshot {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    // Rol de la CARTA (catálogo diseñado, 2026-09-21) si lo imprime; si no, el del jugador.
    if (p) byRole.set((c.role ?? p.role), [...(byRole.get((c.role ?? p.role)) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  assert.equal(v.valid, true);
  return takeDeckSnapshot(deck, v, NOW)!;
}

const SNAP_A = realSnapshot(0, "deck-a");
const SNAP_B = realSnapshot(1, "deck-b");

const must = (r: MatchAction): DuelMatch => {
  assert.ok(r.ok, r.ok ? "" : r.error.code);
  return r.match;
};

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";

const startMatch = (first: Side = "A"): DuelMatch =>
  must(startDuelMatch({ id: "m-pvp", snapshotA: SNAP_A, snapshotB: SNAP_B, firstAttacker: first }));

function record(over: Partial<PvpMatchRecord> = {}): PvpMatchRecord {
  return {
    id: "m-pvp",
    mode: "PVP",
    playerAId: USER_A,
    playerBId: USER_B,
    deckAId: "deck-a",
    deckBId: "deck-b",
    match: startMatch(),
    stateVersion: 0,
    closedReason: null,
    closedBy: null,
    closedAt: null,
    turnStartedAt: NOW,
    turnDeadlineAt: NOW + 90_000,
    ...over,
  };
}

const env = (over: Partial<{ actionId: string; expectedVersion: number; playerId: string }> = {}) => ({
  actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expectedVersion: 0,
  playerId: USER_A,
  ...over,
});

// ───────────────────────────── identidad de bando ─────────────────────────────

test("el servidor traduce usuario → bando, y un tercero no es de la partida", () => {
  const rec = record();
  assert.equal(sideForPlayer(rec, USER_A), "A");
  assert.equal(sideForPlayer(rec, USER_B), "B");
  assert.equal(sideForPlayer(rec, USER_C), null);
  // Un id vacío nunca puede colarse como bando, aunque una columna llegara vacía.
  assert.equal(sideForPlayer({ ...rec, playerBId: "" }, ""), null);
  assert.equal(playerForSide(rec, "A"), USER_A);
  assert.equal(playerForSide(rec, "B"), USER_B);
  assert.equal(opponentOf(rec, USER_A), USER_B);
  assert.equal(opponentOf(rec, USER_B), USER_A);
  assert.equal(opponentOf(rec, USER_C), null);
});

// ───────────────────────────── ciclo de vida ─────────────────────────────

test("el ciclo de vida se DERIVA de status + closedReason, y el cierre gana", () => {
  const m = startMatch();
  assert.equal(pvpLifecycle({ ...m, status: "WAITING" }, null), "CREATED");
  assert.equal(pvpLifecycle({ ...m, status: "IN_PROGRESS" }, null), "IN_TURN");
  assert.equal(pvpLifecycle({ ...m, status: "COMPLETED" }, null), "FINISHED");
  assert.equal(pvpLifecycle({ ...m, status: "DRAW" }, null), "FINISHED");
  assert.equal(pvpLifecycle({ ...m, status: "UNRESOLVED" }, null), "FINISHED");
  // Una partida abandonada en pleno turno sigue diciendo IN_PROGRESS en sus reglas —eso es
  // cierto y no se falsea— pero su ciclo de vida efectivo es ABANDONED.
  assert.equal(pvpLifecycle({ ...m, status: "IN_PROGRESS" }, "ABANDONED"), "ABANDONED");
  assert.equal(pvpLifecycle({ ...m, status: "IN_PROGRESS" }, "EXPIRED"), "EXPIRED");
});

test("los estados terminales son terminales y no aceptan acciones", () => {
  for (const l of ["FINISHED", "ABANDONED", "EXPIRED"] as const) {
    assert.equal(isTerminal(l), true, l);
    assert.equal(acceptsActions(l), false, l);
    assert.deepEqual(transitionsFrom(l), [], `${l} no debe tener salida`);
  }
  assert.equal(acceptsActions("IN_TURN"), true);
  // CREATED no acepta acciones: una partida sin empezar no tiene turno que jugar.
  assert.equal(acceptsActions("CREATED"), false);
});

test("las transiciones prohibidas están prohibidas", () => {
  assert.equal(canTransition("CREATED", "IN_TURN"), true);
  assert.equal(canTransition("IN_TURN", "FINISHED"), true);
  assert.equal(canTransition("IN_TURN", "ABANDONED"), true);
  assert.equal(canTransition("CREATED", "EXPIRED"), true);
  assert.equal(canTransition("FINISHED", "IN_TURN"), false);
  assert.equal(canTransition("ABANDONED", "IN_TURN"), false);
  assert.equal(canTransition("EXPIRED", "IN_TURN"), false);
  assert.equal(canTransition("FINISHED", "ABANDONED"), false);
});

// ───────────────────────────── expected player ─────────────────────────────

test("expected_player lo decide el servidor a partir del motor, no el cliente", () => {
  const rec = record({ match: startMatch("A") });
  // Abre A: le toca a A declarar carta.
  assert.equal(expectedPlayer(rec), USER_A);

  // A declara carta y estadística ⇒ pasa a defender B.
  const afterCard = must(selectAttackerCard(rec.match, rec.match.snapshotA.cards[0].uid));
  const afterStat = must(selectAttackerStat(afterCard, "stronghold"));
  assert.equal(expectedPlayer({ ...rec, match: afterStat }), USER_B);

  // Si abre B, el primero en actuar es B.
  assert.equal(expectedPlayer(record({ match: startMatch("B") })), USER_B);

  // Una partida cerrada no espera a nadie.
  assert.equal(expectedPlayer({ ...rec, closedReason: "ABANDONED" }), null);
  assert.equal(expectedPlayer({ ...rec, match: { ...rec.match, status: "COMPLETED" } }), null);
});

// ───────────────────────────── el guard ─────────────────────────────

test("guardAction acepta al jugador correcto en su turno", () => {
  const rec = record({ match: startMatch("A") });
  const g = guardAction(rec, env({ playerId: USER_A }), NOW);
  assert.equal(g.ok, true);
  assert.equal(g.ok && g.side, "A");
});

test("SEGURIDAD: un tercero no puede actuar aunque envíe todo bien", () => {
  const rec = record({ match: startMatch("A") });
  const g = guardAction(rec, env({ playerId: USER_C }), NOW);
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.error.code, "NOT_A_PLAYER");
});

test("SEGURIDAD: actuar fuera de turno se rechaza", () => {
  // Abre A ⇒ B no puede actuar todavía.
  const rec = record({ match: startMatch("A") });
  const g = guardAction(rec, env({ playerId: USER_B }), NOW);
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.error.code, "NOT_YOUR_TURN");
});

test("SEGURIDAD: una versión vieja se rechaza (concurrencia)", () => {
  const rec = record({ stateVersion: 11 });
  const g = guardAction(rec, env({ expectedVersion: 10 }), NOW);
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.error.code, "STALE_VERSION");
  assert.equal(!g.ok && g.error.actualVersion, 11);
  assert.equal(!g.ok && g.error.expectedVersion, 10);
});

test("SEGURIDAD: una partida cerrada no acepta acciones, sea cual sea el cierre", () => {
  for (const reason of ["ABANDONED", "EXPIRED"] as const) {
    const g = guardAction(record({ closedReason: reason }), env(), NOW);
    assert.equal(g.ok, false, reason);
    assert.equal(!g.ok && g.error.code, "MATCH_CLOSED");
  }
  // Y una partida terminada por reglas tampoco.
  const finished = record();
  const g = guardAction({ ...finished, match: { ...finished.match, status: "COMPLETED" } }, env(), NOW);
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.error.code, "MATCH_CLOSED");
});

test("SEGURIDAD: el reloj del turno lo impone el servidor", () => {
  const rec = record({ turnDeadlineAt: NOW + 1000 });
  assert.equal(guardAction(rec, env(), NOW + 500).ok, true, "dentro de plazo");
  const late = guardAction(rec, env(), NOW + 1001);
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.error.code, "TURN_EXPIRED");
  // Sin plazo configurado, nunca expira.
  assert.equal(guardAction(record({ turnDeadlineAt: null }), env(), NOW + 10_000_000).ok, true);
});

test("SEGURIDAD: una partida PvE no entra por la puerta PvP", () => {
  const g = guardAction(record({ mode: "PVE" }), env(), NOW);
  assert.equal(g.ok, false);
  assert.equal(!g.ok && g.error.code, "NOT_PVP");
});

test("la versión avanza de uno en uno y es monotónica", () => {
  assert.equal(nextVersion(record({ stateVersion: 0 })), 1);
  assert.equal(nextVersion(record({ stateVersion: 10 })), 11);
  const w = turnWindow(NOW, 90_000);
  assert.equal(w.startedAt, NOW);
  assert.equal(w.deadlineAt, NOW + 90_000);
  assert.equal(turnWindow(NOW, null).deadlineAt, null);
});

// ───────────────────────────── estado privado ─────────────────────────────

test("SECRETO: A no recibe las cartas ocultas de B, y B no recibe las de A", () => {
  const m = startMatch("A");

  const forA = projectMatchFor(m, "A");
  // A conserva su mazo entero…
  assert.equal(forA.snapshotA.cards.length, m.snapshotA.cards.length);
  // …y del de B, al principio, no ve nada: no ha jugado ninguna.
  assert.equal(forA.snapshotB.cards.length, 0);
  assert.deepEqual(leakedUids(forA, "A", m), []);

  const forB = projectMatchFor(m, "B");
  assert.equal(forB.snapshotB.cards.length, m.snapshotB.cards.length);
  assert.equal(forB.snapshotA.cards.length, 0);
  assert.deepEqual(leakedUids(forB, "B", m), []);
});

test("SECRETO · DUEL UX 2.0: la carta que el rival COMPROMETE atacando NO es pública hasta que respondes (solo su eje)", () => {
  const m0 = startMatch("A");
  const declared = m0.snapshotA.cards[0].uid;
  const m = must(selectAttackerStat(must(selectAttackerCard(m0, declared)), "stronghold"));

  // B está defendiendo: ve que A comprometió UNA carta y su ESTADÍSTICA, pero no la carta (ni en el snapshot ni en el draft).
  const forB = projectMatchFor(m, "B");
  assert.deepEqual(forB.snapshotA.cards.map((c) => c.uid), []);
  assert.equal(forB.draft.attackerCardUid, null);
  assert.equal(forB.draft.attackerStat, "stronghold");
  assert.ok(!JSON.stringify(forB).includes(`"${declared}"`), "el uid no viaja en ningún campo");
  assert.deepEqual(leakedUids(forB, "B", m), []);
  // A (el atacante) sigue viendo su propia carta comprometida.
  assert.equal(projectMatchFor(m, "A").draft.attackerCardUid, declared);
  // Y la proyección que no redactara la comprometida se detectaría como fuga.
  assert.deepEqual(leakedUids({ ...forB, draft: m.draft }, "B", m), [declared]);
});

test("SECRETO: tras cerrarse un turno, las cartas jugadas quedan visibles para ambos", () => {
  let m = startMatch("A");
  const aCard = m.snapshotA.cards[0].uid;
  m = must(selectAttackerStat(must(selectAttackerCard(m, aCard)), "stronghold"));
  const bCard = m.snapshotB.cards[0].uid;
  m = must(selectDefenderCard(m, bCard));
  m = must(selectDefenderStat(m, requiredDefenderStat(m)!));
  m = must(confirmTurn(m));

  // Cada uno ve la carta que el otro gastó, pero ninguna más.
  const forA = projectMatchFor(m, "A");
  assert.deepEqual(forA.snapshotB.cards.map((c) => c.uid), [bCard]);
  assert.deepEqual(leakedUids(forA, "A", m), []);

  const forB = projectMatchFor(m, "B");
  assert.deepEqual(forB.snapshotA.cards.map((c) => c.uid), [aCard]);
  assert.deepEqual(leakedUids(forB, "B", m), []);
});

test("SECRETO: la proyección NO altera el estado autoritativo ni el resto de la partida", () => {
  const m = startMatch("A");
  const before = JSON.stringify(m);
  const forA = projectMatchFor(m, "A");
  assert.equal(JSON.stringify(m), before, "el original no se muta");
  // Todo lo público se conserva intacto: marcador, turno, fase, atacante, historial.
  assert.equal(forA.status, m.status);
  assert.equal(forA.phase, m.phase);
  assert.equal(forA.currentTurn, m.currentTurn);
  assert.equal(forA.attacker, m.attacker);
  assert.equal(forA.scoreA, m.scoreA);
  assert.equal(forA.scoreB, m.scoreB);
  assert.deepEqual(forA.turns, m.turns);
});

test("leakedUids DETECTA una fuga si alguien envía el estado crudo", () => {
  const m = startMatch("A");
  // Enviar el estado sin proyectar es exactamente el fallo que este modelo evita.
  const leak = leakedUids(m, "A", m);
  assert.ok(leak.length > 0, "el estado crudo debe delatarse como fuga");
  assert.equal(leak.length, m.snapshotB.cards.length);
});

// ───────────────────────────── lifecycleOf sobre el registro ─────────────────────────────

test("lifecycleOf compone el registro completo", () => {
  assert.equal(lifecycleOf(record()), "IN_TURN");
  assert.equal(lifecycleOf(record({ closedReason: "ABANDONED" })), "ABANDONED");
  const rec = record();
  assert.equal(lifecycleOf({ ...rec, match: { ...rec.match, status: "WAITING" } }), "CREATED");
});

// ───────────────────────────── F71 · pistas de las cartas ocultas ─────────────────────────────

const countryOf = (pid: string): string => registry.player(pid)?.country ?? "";

/** Partida a mitad: dos turnos cerrados y A declarando el tercero (su carta ya es pública). */
function midMatch(): DuelMatch {
  let m = startMatch("A");
  for (let t = 0; t < 2; t++) {
    const atk = m.attacker!;
    const atkSnap = atk === "A" ? m.snapshotA : m.snapshotB;
    const defSnap = atk === "A" ? m.snapshotB : m.snapshotA;
    const usedAtk = new Set(atk === "A" ? m.usedA : m.usedB);
    const usedDef = new Set(atk === "A" ? m.usedB : m.usedA);
    m = must(selectAttackerStat(must(selectAttackerCard(m, atkSnap.cards.find((c) => !usedAtk.has(c.uid))!.uid)), "gamesense"));
    m = must(selectDefenderCard(m, defSnap.cards.find((c) => !usedDef.has(c.uid))!.uid));
    m = must(selectDefenderStat(m, requiredDefenderStat(m)!));
    m = must(confirmTurn(m));
  }
  return m;
}

test("F71 · PvP: la proyección de A trae una pista por carta oculta de B, y la de B una por cada oculta de A", () => {
  const m = midMatch();
  const forA = projectMatchFor(m, "A", countryOf);
  const forB = projectMatchFor(m, "B", countryOf);
  assert.equal(forA.rivalHints?.length, m.snapshotB.cards.length - m.usedB.length);
  assert.equal(forB.rivalHints?.length, m.snapshotA.cards.length - m.usedA.length);
  for (const h of [...forA.rivalHints!, ...forB.rivalHints!]) {
    assert.deepEqual(Object.keys(h!).sort(), ["type", "value"]);
    assert.ok(h!.value.length > 0);
  }
  // Las de A son exactamente las pistas de las cartas no jugadas de B (como multiconjunto).
  const key = (h: { type: string; value: string } | null) => (h ? `${h.type}=${h.value}` : "none");
  const expectA = rivalUnplayedCards(m, "A").map((c) => key(hintForCard(m.id, c, countryOf)!)).sort();
  assert.deepEqual(forA.rivalHints!.map(key).sort(), expectA);
});

test("F71 · PvP: la pista de una carta es la misma la mire quien la mire (clave = id de la partida)", () => {
  const m = midMatch();
  // B mira las cartas de A desde su proyección; la pista de cada carta de A no depende del espectador:
  // se calcula con el id de la partida y la carta, no con el bando que mira.
  const forB = projectMatchFor(m, "B", countryOf);
  const direct = rivalUnplayedCards(m, "B").map((c) => hintForCard(m.id, c, countryOf)!);
  const key = (h: { type: string; value: string } | null) => (h ? `${h.type}=${h.value}` : "none");
  assert.deepEqual(forB.rivalHints!.map(key).sort(), direct.map(key).sort());
  // Y proyectar otra vez (otro sondeo, otra petición) da exactamente lo mismo, en el mismo orden.
  assert.deepEqual(projectMatchFor(m, "B", countryOf).rivalHints, forB.rivalHints);
  // El snapshot de sincronización usa la misma proyección.
  const snap = buildSnapshot(record({ match: m }), USER_B, countryOf)!;
  assert.deepEqual(snap.match.rivalHints, forB.rivalHints);
});

test("F71 · PvP: las pistas no filtran uid, carta, jugador, nick, OVR ni estadísticas de lo oculto", () => {
  const m = midMatch();
  for (const viewer of ["A", "B"] as const) {
    const projected = projectMatchFor(m, viewer, countryOf);
    const json = JSON.stringify(projected.rivalHints);
    for (const c of rivalUnplayedCards(m, viewer)) {
      for (const secret of [c.uid, c.cardId, c.playerId, c.playerName]) {
        assert.ok(!json.includes(`"${secret}"`), `${viewer}: la pista no puede llevar «${secret}»`);
      }
    }
    for (const field of ["uid", "cardId", "playerId", "ovr", "combat", "serial", "variantId", "nick", "playerName"]) {
      assert.ok(!json.includes(`"${field}"`), `${viewer}: campo prohibido «${field}»`);
    }
    // Y la proyección entera sigue sin cartas ocultas (la pista no reabre la frontera).
    assert.deepEqual(leakedUids(projected, viewer, m), []);
  }
});
