/**
 * Tests del Duel Match Orchestrator (node:test). Ejecutar: `npm test`.
 *
 * Usan mazos REALES construidos con el dominio de la Fase 3 y resueltos con el Combat Resolver de
 * la Fase 4: si cualquiera de las dos capas se rompiera, estos tests lo detectarían.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { COMBAT_MATCHUP, type CombatStatKey } from "@/domain/cards/combat";
import {
  createDuelDeck, validateDuelDeck, takeDeckSnapshot, makeDeckResolver, ownershipFromList,
  DUEL_ROLES, type DuelDeckSnapshot,
} from "../index";
import { resolveCombat } from "../combat";
import {
  startDuelMatch, selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  confirmTurn, buildCombatPlan, availableCards, requiredDefenderStat, matchView,
  explainMatchError, explainTurn, ORCHESTRATOR_VERSION, TURNS_PER_MATCH, ATTACKS_PER_SIDE,
  type DuelMatch, type MatchAction, type Side,
} from "./index";

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
    if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  assert.equal(v.valid, true);
  return takeDeckSnapshot(deck, v, NOW)!;
}

const A = realSnapshot(0, "deck-a");
const B = realSnapshot(1, "deck-b");
const C = realSnapshot(2, "deck-c");

const must = (r: MatchAction): DuelMatch => {
  assert.ok(r.ok, r.ok ? "" : `${r.error.code}: ${explainMatchError(r.error)}`);
  return r.match;
};

const start = (a = A, b = B, first: Side = "A") =>
  must(startDuelMatch({ id: "m1", snapshotA: a, snapshotB: b, firstAttacker: first }));

/** Estrategia determinista: primera carta disponible y estadística según el número de turno. */
function playTurn(m: DuelMatch, statPick?: CombatStatKey): DuelMatch {
  const atk = m.attacker!;
  const aCard = availableCards(m, atk)[0];
  const stat = statPick ?? (["stronghold", "gamesense", "entryfrag"] as CombatStatKey[])[(m.currentTurn - 1) % 3];
  let s = must(selectAttackerCard(m, aCard.uid));
  s = must(selectAttackerStat(s, stat));
  const dCard = availableCards(s, atk === "A" ? "B" : "A")[0];
  s = must(selectDefenderCard(s, dCard.uid));
  s = must(selectDefenderStat(s, requiredDefenderStat(s)!));
  return must(confirmTurn(s));
}

const playFull = (a = A, b = B, first: Side = "A"): DuelMatch => {
  let m = start(a, b, first);
  for (let i = 0; i < TURNS_PER_MATCH; i++) m = playTurn(m);
  return m;
};

// ───────────────────────────── Arranque y alternancia ─────────────────────────────

test("1 · la partida empieza en el turno 1, en fase de elegir carta atacante", () => {
  const m = start();
  assert.equal(m.status, "IN_PROGRESS");
  assert.equal(m.phase, "ATTACKER_CARD");
  assert.equal(m.currentTurn, 1);
  assert.equal(m.turns.length, 0);
  assert.equal(m.orchestratorVersion, ORCHESTRATOR_VERSION);
});

test("2-3 · A ataca el turno 1 y B el turno 2", () => {
  const m = start();
  assert.equal(m.attacker, "A");
  assert.equal(playTurn(m).attacker, "B");
});

test("4-6 · alternancia durante 10 turnos: 5 ataques por bando", () => {
  const m = playFull();
  assert.equal(m.turns.length, TURNS_PER_MATCH);
  const seq = m.turns.map((t) => t.attacker).join("");
  assert.equal(seq, "ABABABABAB");
  assert.equal(m.turns.filter((t) => t.attacker === "A").length, ATTACKS_PER_SIDE);
  assert.equal(m.turns.filter((t) => t.attacker === "B").length, ATTACKS_PER_SIDE);
});

test("el primer atacante es explícito y configurable", () => {
  const m = start(A, B, "B");
  assert.equal(m.attacker, "B");
  assert.equal(playFull(A, B, "B").turns.map((t) => t.attacker).join(""), "BABABABABA");
});

// ───────────────────────────── Legalidad de selecciones ─────────────────────────────

test("7 · una carta ya usada no puede volver a seleccionarse", () => {
  let m = start();
  const first = availableCards(m, "A")[0].uid;
  m = playTurn(m);          // turno 1: A usó `first`
  m = playTurn(m);          // turno 2: ataca B; vuelve a tocar A
  assert.equal(m.attacker, "A");
  const r = selectAttackerCard(m, first);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "CARD_ALREADY_USED");
});

test("8 · una carta inexistente no puede seleccionarse", () => {
  const r = selectAttackerCard(start(), "uid-que-no-existe");
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "CARD_NOT_IN_SNAPSHOT");
});

test("9 · el atacante no puede seleccionar una carta del rival", () => {
  const m = start();               // ataca A
  const r = selectAttackerCard(m, B.cards[0].uid);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "CARD_NOT_IN_SNAPSHOT");
});

test("el defensor no puede responder con una carta del atacante", () => {
  let m = start();
  m = must(selectAttackerCard(m, A.cards[0].uid));
  m = must(selectAttackerStat(m, "stronghold"));
  const r = selectDefenderCard(m, A.cards[1].uid);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "CARD_NOT_IN_SNAPSHOT");
});

test("10-11 · la estadística del defensor debe respetar COMBAT_MATCHUP", () => {
  let m = start();
  m = must(selectAttackerCard(m, A.cards[0].uid));
  m = must(selectAttackerStat(m, "stronghold"));
  m = must(selectDefenderCard(m, B.cards[0].uid));

  for (const illegal of ["stronghold", "gamesense"] as CombatStatKey[]) {
    const r = selectDefenderStat(m, illegal);
    assert.equal(r.ok, false, illegal);
    assert.equal(r.ok ? "" : r.error.code, "ILLEGAL_STAT_MATCHUP");
  }
  assert.equal(COMBAT_MATCHUP.stronghold, "entryfrag");
  assert.ok(selectDefenderStat(m, "entryfrag").ok);
});

test("12 · un turno incompleto no puede confirmarse", () => {
  let m = start();
  assert.equal(confirmTurn(m).ok, false);
  m = must(selectAttackerCard(m, A.cards[0].uid));
  assert.equal(confirmTurn(m).ok, false);
  m = must(selectAttackerStat(m, "gamesense"));
  assert.equal(confirmTurn(m).ok, false);
  m = must(selectDefenderCard(m, B.cards[0].uid));
  const r = confirmTurn(m);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "WRONG_PHASE");
});

test("las acciones fuera de fase se rechazan con WRONG_PHASE", () => {
  const m = start();
  for (const r of [selectAttackerStat(m, "stronghold"), selectDefenderCard(m, B.cards[0].uid), selectDefenderStat(m, "entryfrag")]) {
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.error.code, "WRONG_PHASE");
  }
});

// ───────────────────────────── Turno y marcador ─────────────────────────────

test("13-14 · un turno completo produce resultado y actualiza el marcador", () => {
  const m0 = start();
  const m = playTurn(m0);
  assert.equal(m.turns.length, 1);
  const t = m.turns[0];
  assert.ok(["A", "B", "TIE"].includes(t.outcome));
  assert.equal(m.scoreA + m.scoreB + m.ties, 1);
  assert.equal(t.scoreAfterA, m.scoreA);
  assert.equal(t.scoreAfterB, m.scoreB);
  assert.ok(t.encounter.reason.length > 0);
});

test("15 · un empate incrementa tiedEncounters y no puntúa a nadie", () => {
  // Mazo contra sí mismo con la MISMA estadística en los dos lados: valores idénticos.
  let m = must(startDuelMatch({ id: "tie", snapshotA: A, snapshotB: A, firstAttacker: "A" }));
  const aCard = availableCards(m, "A")[0];
  m = must(selectAttackerCard(m, aCard.uid));
  m = must(selectAttackerStat(m, "gamesense"));
  const same = m.snapshotB.cards.find((c) => c.cardId === aCard.cardId)!;
  m = must(selectDefenderCard(m, same.uid));
  m = must(selectDefenderStat(m, "gamesense"));
  m = must(confirmTurn(m));
  assert.equal(m.turns[0].outcome, "TIE");
  assert.equal(m.ties, 1);
  assert.equal(m.scoreA, 0);
  assert.equal(m.scoreB, 0);
});

// ───────────────────────────── Fin de partida ─────────────────────────────

test("16-17 · tras 10 turnos la partida termina y no admite un turno 11", () => {
  const m = playFull();
  assert.ok(m.status === "COMPLETED" || m.status === "UNRESOLVED");
  assert.equal(m.phase, "FINISHED");
  assert.ok(m.result);
  for (const r of [selectAttackerCard(m, A.cards[0].uid), confirmTurn(m)]) {
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.error.code, "MATCH_ALREADY_COMPLETE");
  }
});

test("18-19 · el plan final tiene 10 enfrentamientos y consume cada carta una vez", () => {
  const m = playFull();
  const plan = buildCombatPlan(m);
  assert.equal(plan.encounters.length, TURNS_PER_MATCH);
  assert.equal(new Set(plan.encounters.map((e) => e.aUid)).size, 10);
  assert.equal(new Set(plan.encounters.map((e) => e.bUid)).size, 10);
  assert.deepEqual([...m.usedA].sort(), A.cards.map((c) => c.uid).sort());
  assert.deepEqual([...m.usedB].sort(), B.cards.map((c) => c.uid).sort());
});

test("20 · el resultado del match coincide con el del Combat Resolver", () => {
  const m = playFull();
  const direct = resolveCombat(A, B, buildCombatPlan(m));
  assert.deepEqual(m.result!.combat, direct);
  assert.equal(m.result!.scoreA, direct.scoreA);
  assert.equal(m.result!.scoreB, direct.scoreB);
  assert.equal(m.result!.winner, direct.winner);
  assert.equal(m.result!.integrityOk, true, "el recuento incremental debe cuadrar con el resolver");
});

// ───────────────────────────── Inmutabilidad y determinismo ─────────────────────────────

test("21-22 · no se mutan los snapshots ni el match", () => {
  const beforeA = JSON.stringify(A);
  const beforeB = JSON.stringify(B);
  const m0 = start();
  const before0 = JSON.stringify(m0);
  const m1 = playTurn(m0);
  assert.equal(JSON.stringify(A), beforeA);
  assert.equal(JSON.stringify(B), beforeB);
  assert.equal(JSON.stringify(m0), before0, "el estado anterior no cambia");
  assert.notEqual(JSON.stringify(m1), before0);
});

test("23-24 · serializar, deserializar y continuar produce el mismo resultado", () => {
  let m = start();
  for (let i = 0; i < 4; i++) m = playTurn(m);
  const revived = JSON.parse(JSON.stringify(m)) as DuelMatch;
  assert.deepEqual(revived, m);
  let a = m, b = revived;
  for (let i = 0; i < 6; i++) { a = playTurn(a); b = playTurn(b); }
  assert.deepEqual(a.result, b.result);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("25 · determinismo completo: mismas decisiones, mismo resultado", () => {
  assert.equal(JSON.stringify(playFull()), JSON.stringify(playFull()));
});

test("el estado serializado no lleva funciones, clases ni ciclos", () => {
  const m = playFull();
  const json = JSON.stringify(m);
  const back = JSON.parse(json);
  assert.deepEqual(back, m);
  assert.ok(!json.includes("function"));
});

// ───────────────────────────── Invariantes ─────────────────────────────

test("INVARIANTE · tras N turnos cada bando ha consumido N cartas", () => {
  let m = start();
  for (let n = 1; n <= TURNS_PER_MATCH; n++) {
    m = playTurn(m);
    assert.equal(m.usedA.length, n, `turno ${n}`);
    assert.equal(m.usedB.length, n, `turno ${n}`);
    assert.equal(new Set(m.usedA).size, n, "sin repetidos");
    assert.equal(new Set(m.usedB).size, n, "sin repetidos");
  }
  assert.equal(m.usedA.length, 10);
  assert.equal(m.usedB.length, 10);
});

test("INVARIANTE · cada turno consume exactamente una carta de cada bando", () => {
  let m = start();
  for (let i = 0; i < TURNS_PER_MATCH; i++) {
    const a0 = m.usedA.length, b0 = m.usedB.length;
    m = playTurn(m);
    assert.equal(m.usedA.length - a0, 1);
    assert.equal(m.usedB.length - b0, 1);
  }
});

test("INVARIANTE · ninguna estadística se resuelve fuera de COMBAT_MATCHUP", () => {
  const m = playFull();
  for (const t of m.turns) {
    assert.equal(COMBAT_MATCHUP[t.attackerStat], t.defenderStat);
    assert.equal(COMBAT_MATCHUP[t.encounter.a.stat], t.encounter.b.stat);
  }
});

test("INVARIANTE · el orquestador no calcula estadísticas ni compara valores", () => {
  const src = readFileSync(new URL("./orchestrator.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "Math.random", "Date.now", "localStorage", "supabase", "fetch(", "process.env",
    "@/data/catalog", "@/store", "react", "deriveCombat", "computeCombatOvr", "sumOvr",
  ]) {
    assert.ok(!code.includes(forbidden), `el orquestador no debe contener "${forbidden}"`);
  }
  // No compara valores de combate: eso es del resolver.
  assert.ok(!/\.value\s*[<>]/.test(code), "no debe comparar valores");
  assert.ok(!/combat\.(stronghold|gamesense|entryfrag)/.test(code), "no debe leer el trío");
});

test("INVARIANTE · el resolver sigue siendo la única autoridad del marcador final", () => {
  const m = playFull();
  // El marcador final sale del resolver, que puede añadir el punto del desempate.
  assert.equal(m.result!.scoreA, m.result!.combat.scoreA);
  assert.equal(m.result!.scoreB, m.result!.combat.scoreB);
  assert.equal(m.result!.winner, m.result!.combat.winner);
});

// ───────────────────────────── Adversariales ─────────────────────────────

test("ADVERSARIAL · reutilizar carta, intercambiar bando y declarar matchup ilegal", () => {
  let m = start();
  const used = availableCards(m, "A")[0].uid;
  m = playTurn(m);   // turno 2: ataca B

  // Reutilizar una carta ya gastada (turno 3, vuelve A).
  m = playTurn(m);
  assert.equal(m.attacker, "A");
  assert.equal(selectAttackerCard(m, used).ok, false);

  // El atacante intenta usar una carta del rival.
  assert.equal(selectAttackerCard(m, B.cards[0].uid).ok, false);

  // Matchup ilegal.
  let s = must(selectAttackerCard(m, availableCards(m, "A")[0].uid));
  s = must(selectAttackerStat(s, "entryfrag"));
  s = must(selectDefenderCard(s, availableCards(s, "B")[0].uid));
  assert.equal(selectDefenderStat(s, "gamesense").ok, false);
});

test("ADVERSARIAL · saltarse el turno o confirmar sin selecciones", () => {
  const m = start();
  assert.equal(confirmTurn(m).ok, false);                       // sin nada
  assert.equal(selectDefenderStat(m, "entryfrag").ok, false);   // saltando fases
});

test("ADVERSARIAL · no se puede alterar un turno anterior", () => {
  let m = start();
  m = playTurn(m);
  const before = JSON.stringify(m.turns[0]);
  m = playTurn(m);
  assert.equal(JSON.stringify(m.turns[0]), before, "los turnos pasados son inmutables");
});

test("ADVERSARIAL · snapshot manipulado o checksum alterado impide empezar", () => {
  const tampered: DuelDeckSnapshot = {
    ...A,
    cards: A.cards.map((c, i) => (i === 0 ? { ...c, combat: { ...c.combat, stronghold: 99 } } : c)),
  };
  const r = startDuelMatch({ id: "x", snapshotA: tampered, snapshotB: B });
  assert.equal(r.ok, false);
  assert.equal(r.ok ? "" : r.error.code, "INVALID_MATCH");
  assert.ok(r.ok ? false : r.error.combatErrors!.some((e) => e.code === "SNAPSHOT_CHECKSUM_MISMATCH"));
});

test("ADVERSARIAL · dataVersion distinta impide empezar", () => {
  const r = startDuelMatch({ id: "x", snapshotA: A, snapshotB: { ...B, dataVersion: "VCT-2027" } });
  assert.equal(r.ok, false);
  assert.ok(r.ok ? false : r.error.combatErrors!.some((e) => e.code === "DATA_VERSION_MISMATCH"));
});

test("ADVERSARIAL · un mazo de tamaño incorrecto impide empezar", () => {
  const r = startDuelMatch({ id: "x", snapshotA: { ...A, cards: A.cards.slice(0, 9) }, snapshotB: B });
  assert.equal(r.ok, false);
  assert.ok(r.ok ? false : r.error.combatErrors!.some((e) => e.code === "SNAPSHOT_SIZE"));
});

// ───────────────────────────── Mazos reales ─────────────────────────────

test("MAZOS REALES · tres partidas completas coinciden con el resolver de la Fase 4", () => {
  for (const [x, y, label] of [[A, B, "1v2"], [A, C, "1v3"], [B, C, "2v3"]] as const) {
    const m = playFull(x, y);
    assert.equal(m.turns.length, 10, label);
    assert.equal(m.turns.filter((t) => t.attacker === "A").length, 5, label);
    assert.equal(m.turns.filter((t) => t.attacker === "B").length, 5, label);
    assert.equal(m.usedA.length, 10, label);
    assert.equal(m.usedB.length, 10, label);
    assert.ok(m.result, label);
    assert.equal(m.result!.integrityOk, true, label);
    assert.deepEqual(m.result!.combat, resolveCombat(x, y, buildCombatPlan(m)), label);
    assert.deepEqual(m.result!.combat.errors, [], label);
  }
});

// ───────────────────────────── Vista e historial ─────────────────────────────

test("la vista expone todo lo que la interfaz necesitará", () => {
  let m = start();
  const v0 = matchView(m);
  assert.equal(v0.turn, 1);
  assert.equal(v0.attacker, "A");
  assert.equal(v0.defender, "B");
  assert.equal(v0.attackerChoices.length, 10);
  assert.deepEqual(v0.defenderChoices, []);
  assert.deepEqual(v0.statChoices, []);

  m = must(selectAttackerCard(m, v0.attackerChoices[0].uid));
  assert.deepEqual(matchView(m).statChoices, ["stronghold", "gamesense", "entryfrag"]);
  m = must(selectAttackerStat(m, "stronghold"));
  const v2 = matchView(m);
  assert.equal(v2.defenderChoices.length, 10);
  m = must(selectDefenderCard(m, v2.defenderChoices[0].uid));
  assert.deepEqual(matchView(m).statChoices, ["entryfrag"], "solo la estadística que impone la tabla");

  const done = matchView(playFull());
  assert.equal(done.history.length, 10);
  assert.equal(done.usedA.length, 10);
  assert.equal(done.availableA.length, 0);
  assert.ok(done.result);
});

test("el historial se explica turno a turno", () => {
  const m = playFull();
  for (const t of m.turns) {
    const line = explainTurn(t);
    assert.match(line, /^Turno \d+ · ataca [AB] · .+ · (gana [AB]|empate)$/);
  }
});

test("todos los códigos de error del orquestador tienen explicación", () => {
  const codes: Parameters<typeof explainMatchError>[0][] = [
    { code: "INVALID_MATCH", combatErrors: [] },
    { code: "WRONG_PHASE", expectedPhase: "ATTACKER_CARD", actualPhase: "DEFENDER_STAT" },
    { code: "CARD_ALREADY_USED" }, { code: "CARD_NOT_IN_SNAPSHOT" },
    { code: "STAT_ALREADY_CONSUMED" }, { code: "ILLEGAL_STAT_MATCHUP" },
    { code: "MISSING_ATTACKER_CARD" }, { code: "MISSING_ATTACKER_STAT" },
    { code: "MISSING_DEFENDER_CARD" }, { code: "MISSING_DEFENDER_STAT" },
    { code: "MATCH_ALREADY_COMPLETE" }, { code: "INVALID_PLAN" },
  ];
  for (const c of codes) assert.ok(explainMatchError(c).length > 15, c.code);
});
