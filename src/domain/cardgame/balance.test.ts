/**
 * Tests de la Fase 7 — DUEL BALANCE & RULES RESOLUTION (node:test). Ejecutar: `npm test`.
 *
 * Cubren lo que la fase decide y congela:
 *   · OPD-05 — un enfrentamiento empatado no puntúa para nadie.
 *   · OPD-08 — segundo y último desempate por estadística total declarada, y después DRAW explícito.
 *   · OPD-42 — escalera de dificultad por tasa de heurística.
 *   · OPD-04 — ningún nivel ve las cartas no jugadas del rival.
 *   · Versionado — una partida antigua se resuelve con SUS reglas, nunca con las nuevas.
 *
 * Usan mazos REALES del catálogo, como el resto del dominio.
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
  deckChecksum, DUEL_ROLES, type DuelDeckCard, type DuelDeckSnapshot,
} from "./index";
import {
  resolveCombat, sumOvr, statTotals, auditCombatResult, explainCombatResult, explainCombatReason,
  COMBAT_RULES_V1, COMBAT_RULES_V2, COMBAT_RULESETS, CURRENT_COMBAT_RULES, getCombatRuleset,
  RESOLVER_VERSION, type CombatPlan, type CombatResult, type DeclaredEncounter, type Side,
} from "./combat";
import {
  startDuelMatch, confirmTurn, buildCombatPlan, ORCHESTRATOR_VERSION,
  selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  type DuelMatch,
} from "./match";
import {
  createRng, createController, advanceBots, createDuelBot, createRandomBot, createSmartBot,
  DIFFICULTY_PROFILE, NORMAL_HEURISTIC_RATE, HARD_HEURISTIC_RATE,
  type BotDifficulty, type DuelOpponent, type DuelParticipant,
} from "./opponent";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Mazo real nº `block`: las cartas de mayor OVR de cada rol, por bloques de dos. */
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

/** Espejo REAL: mismas cartas y mismo OVR, otro dueño (los uid son identidad de instancia). */
function mirrorOf(snap: DuelDeckSnapshot, id: string): DuelDeckSnapshot {
  const cards = snap.cards.map((c) => ({ ...c, uid: `${id}::${c.uid}` }));
  return { ...snap, deckId: id, cards, checksum: deckChecksum(cards) };
}

const M1 = realSnapshot(0, "deck-m1");
const M2 = realSnapshot(1, "deck-m2");
const M3 = realSnapshot(2, "deck-m3");
const M1B = mirrorOf(M1, "mirror-m1");
const M2B = mirrorOf(M2, "mirror-m2");
const M3B = mirrorOf(M3, "mirror-m3");

/*
 * FIXTURES CON PRECONDICIÓN EXPLÍCITA (catálogo diseñado, 2026-09-21).
 *
 * Algunas pruebas necesitan que los DATOS tengan una forma concreta —diez cartas con SH ≠ EF, o un 5-5
 * real entre dos mazos de OVR distinto— y antes la daban por hecha en los bloques 0 y 1. Con OVR
 * impresos hay empates que antes no existían, así que el bloque se ELIGE por su precondición y se
 * afirma que existe. Lo que se prueba del motor no cambia.
 */
function primerBloque(pred: (s: DuelDeckSnapshot) => boolean, id: string, desde = 0): DuelDeckSnapshot {
  for (let b = desde; b < 12; b++) {
    const s = realSnapshot(b, `${id}-${b}`);
    if (pred(s)) return s;
  }
  assert.fail(`ningún bloque real cumple la precondición de ${id}`);
}
const MT = primerBloque((s) => s.cards.every((c) => c.combat.stronghold !== c.combat.entryfrag), "deck-mt");
const MTB = mirrorOf(MT, "mirror-mt");
// Precondición (no la conclusión): declarando siempre Gamesense, M1 contra este mazo EMPATA en el
// marcador (hay desempate) y la suma de OVR es distinta. Quién gana y por qué lo afirma la prueba.
const MADV = primerBloque((s) => {
  const r = resolveCombat(M1, s, planFor(M1, s, allGamesense(M1)));
  return r.errors.length === 0 && !!r.tiebreak && r.tiebreak.sumOvrA !== r.tiebreak.sumOvrB;
}, "deck-madv", 1);

/** Plan carta-i contra carta-i con la estadística indicada en cada posición. */
function planFor(a: DuelDeckSnapshot, b: DuelDeckSnapshot, stats: CombatStatKey[]): CombatPlan {
  const encounters: DeclaredEncounter[] = a.cards.map((c, i) => ({
    aUid: c.uid, aStat: stats[i], bUid: b.cards[i].uid, bStat: COMBAT_MATCHUP[stats[i]],
  }));
  return { encounters };
}

/** Todos los enfrentamientos con Gamesense: la única estadística que se enfrenta a sí misma. */
function allGamesense(a: DuelDeckSnapshot): CombatStatKey[] { return a.cards.map(() => "gamesense" as CombatStatKey); }

const BOT = (side: Side): DuelParticipant => ({ side, kind: "BOT", id: `bot-${side}` });

/** Partida Bot vs Bot completa con las reglas indicadas. */
function play(
  a: DuelDeckSnapshot, b: DuelDeckSnapshot, botA: DuelOpponent, botB: DuelOpponent,
  seedA: number, seedB: number, first: Side = "A", rules = CURRENT_COMBAT_RULES,
): DuelMatch {
  const start = startDuelMatch({ id: "t", snapshotA: a, snapshotB: b, firstAttacker: first, rules });
  assert.ok(start.ok, start.ok ? "" : start.error.code);
  const res = advanceBots(
    start.match, createController(BOT("A"), BOT("B")), { A: botA, B: botB },
    createRng(seedA), createRng(seedB),
  );
  assert.ok(!res.error, res.error?.code);
  return res.match;
}

const lvl = (d: BotDifficulty) => (id: string) => createDuelBot(id, d);

// ═════════════════════════ OPD-05 · empate de enfrentamiento ═════════════════════════

test("OPD-05 · un enfrentamiento con valores idénticos no puntúa para nadie", () => {
  const r = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  assert.equal(r.encounters.length, 10);
  assert.ok(r.encounters.every((e) => e.outcome === "TIE"), "el mismo Gamesense contra sí mismo empata");
  assert.equal(r.tiedEncounters, 10);
  // 10 empates ⇒ 0-0. Nadie se lleva punto por empatar; el marcador NO lo tocan los empates.
  assert.equal(r.scoreA, 0);
  assert.equal(r.scoreB, 0);
});

test("OPD-05 · la política vigente es NO_POINT en las dos versiones de reglas", () => {
  assert.equal(COMBAT_RULES_V1.encounterTie, "NO_POINT");
  assert.equal(COMBAT_RULES_V2.encounterTie, "NO_POINT");
});

test("OPD-05 · un empate de enfrentamiento no depende de quién ataca", () => {
  // El mismo enfrentamiento resuelto con los bandos intercambiados sigue siendo empate.
  const ab = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  const ba = resolveCombat(M1B, M1, planFor(M1B, M1, allGamesense(M1B)));
  assert.equal(ab.tiedEncounters, ba.tiedEncounters);
  assert.equal(ab.scoreA, ba.scoreB);
  assert.equal(ab.status, ba.status);
});

// ═════════════════════════ OPD-08 · desempate final ═════════════════════════

test("OPD-08 · empate absoluto: mismo mazo, misma estadística, mismos totales ⇒ DRAW explícito", () => {
  const r = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  assert.equal(r.scoreA, r.scoreB);
  assert.equal(r.tiebreak!.sumOvrA, r.tiebreak!.sumOvrB, "mazos espejo ⇒ misma suma de medias");
  assert.equal(r.tiebreak!.awardedTo, null);
  assert.equal(r.statTotalA, r.statTotalB, "declarando lo mismo, la estadística total coincide");
  assert.equal(r.marginTiebreak!.awardedTo, null);
  assert.equal(r.status, "DRAW");
  assert.equal(r.decidedBy, "NONE");
  assert.equal(r.winner, null);
  assert.equal(r.loser, null);
});

/**
 * Fixture de DOBLE EMPATE construido, no buscado.
 *
 * Con mazos espejo la carta i de los dos bandos es la MISMA carta, así que declarando SH contra EF
 * gana A si `sh > ef` y declarando EF contra SH gana A si `ef > sh`: se puede fijar el ganador de
 * cada enfrentamiento a voluntad. Con `aWins` posiciones para A y el resto para B sale un 5-5
 * exacto; el OVR ya empata por ser el mismo mazo. Solo queda el margen.
 */
function doubleTiePlan(a: DuelDeckSnapshot, b: DuelDeckSnapshot, aWins: number): CombatPlan {
  const usable = a.cards
    .map((c, i) => ({ i, diff: c.combat.stronghold - c.combat.entryfrag }))
    .filter((x) => x.diff !== 0);
  assert.ok(usable.length >= 10, "el mazo debe tener 10 cartas con SH ≠ EF");
  const win = new Set(usable.slice(0, aWins).map((x) => x.i));
  const stats: CombatStatKey[] = a.cards.map((c, i) => {
    const shBigger = c.combat.stronghold > c.combat.entryfrag;
    return win.has(i) === shBigger ? "stronghold" : "entryfrag";
  });
  return planFor(a, b, stats);
}

test("OPD-08 · marcador 5-5 con OVR igual ⇒ decide la estadística total declarada", () => {
  const r = resolveCombat(MT, MTB, doubleTiePlan(MT, MTB, 5));
  assert.deepEqual(r.errors, []);
  assert.equal(r.scoreA, 5);
  assert.equal(r.scoreB, 5, "el fixture debe llegar realmente al 5-5");
  assert.equal(r.tiebreak!.sumOvrA, r.tiebreak!.sumOvrB);
  assert.equal(r.tiebreak!.awardedTo, null, "el desempate del PDF no puede decidir un espejo");
  assert.equal(r.decidedBy, "STAT_MARGIN");
  assert.equal(r.status, "RESOLVED");
  assert.notEqual(r.marginTiebreak!.statTotalA, r.marginTiebreak!.statTotalB);
  assert.equal(r.winner, r.marginTiebreak!.statTotalA > r.marginTiebreak!.statTotalB ? "A" : "B");
  assert.equal(r.loser, r.winner === "A" ? "B" : "A");
  // El marcador NO se toca: el margen nombra ganador, no reparte puntos.
  assert.equal(r.scoreA, 5);
  assert.equal(r.scoreB, 5);
});

test("OPD-08 · el margen es simétrico: intercambiar los bandos intercambia el ganador", () => {
  const ab = resolveCombat(MT, MTB, doubleTiePlan(MT, MTB, 5));
  // El mismo reparto visto desde el otro lado: lo que A declaraba ahora lo declara B.
  const ba = resolveCombat(MTB, MT, {
    encounters: ab.encounters.map((e) => ({ aUid: e.b.uid, aStat: e.b.stat, bUid: e.a.uid, bStat: e.a.stat })),
  });
  assert.equal(ba.decidedBy, "STAT_MARGIN");
  assert.equal(ba.statTotalA, ab.statTotalB);
  assert.equal(ba.statTotalB, ab.statTotalA);
  assert.equal(ba.winner, ab.winner === "A" ? "B" : "A");
});

test("OPD-08 · con el marcador desnivelado el margen ni se calcula como desempate", () => {
  const r = resolveCombat(MT, MTB, doubleTiePlan(MT, MTB, 7));
  assert.equal(r.scoreA, 7);
  assert.equal(r.decidedBy, "SCORE");
  assert.equal(r.tiebreak, null);
  assert.equal(r.marginTiebreak, null);
  // Pero el total declarado se guarda igual: es dato de auditoría, no una regla.
  assert.ok(r.statTotalA > 0 && r.statTotalB > 0);
});

test("OPD-08 · el margen NO toca el marcador; solo lo mueve el desempate que define el PDF", () => {
  const r = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  const wins = { A: 0, B: 0 };
  for (const e of r.encounters) if (e.outcome !== "TIE") wins[e.outcome]++;
  // Sin punto de OVR (las sumas empatan) el marcador es exactamente el de los enfrentamientos.
  assert.equal(r.scoreA, wins.A);
  assert.equal(r.scoreB, wins.B);
});

test("OPD-08 · `statTotals` es la suma de los valores declarados y siempre se guarda", () => {
  const r = resolveCombat(M1, M2, planFor(M1, M2, allGamesense(M1)));
  const t = statTotals(r.encounters);
  assert.equal(r.statTotalA, t.a);
  assert.equal(r.statTotalB, t.b);
  assert.equal(t.a, r.encounters.reduce((s, e) => s + e.a.value, 0));
  assert.ok(t.a > 0 && t.b > 0);
});

test("PRINCIPIO · la cadena de desempates tiene exactamente dos niveles y termina", () => {
  // marcador → suma de OVR → estadística total → DRAW. No hay un cuarto criterio en ningún sitio.
  assert.equal(CURRENT_COMBAT_RULES.finalTiebreak, "STAT_MARGIN");
  assert.equal(CURRENT_COMBAT_RULES.terminal, "DRAW");
  const src = readFileSync(new URL("./combat/resolver.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Solo dos criterios de desempate viven en el resolver.
  assert.equal((code.match(/finalTiebreak/g) ?? []).length, 1, "un único punto de decisión del 2º desempate");
  assert.ok(!code.includes("Math.random"));
  assert.ok(!code.includes("Date.now"));
});

// ═════════════════════════ Property tests ═════════════════════════

/** Recorre muchas partidas Bot vs Bot variando mazos, semillas, niveles y primer atacante. */
function* corpus(n: number): Generator<{ match: DuelMatch; first: Side; label: string }> {
  const pairs: [DuelDeckSnapshot, DuelDeckSnapshot, string][] = [
    [M1, M1B, "M1vM1"], [M2, M2B, "M2vM2"], [M3, M3B, "M3vM3"],
    [M1, M2, "M1vM2"], [M1, M3, "M1vM3"], [M2, M3, "M2vM3"],
  ];
  const levels: BotDifficulty[] = ["EASY", "NORMAL", "HARD"];
  for (let i = 0; i < n; i++) {
    const [a, b, label] = pairs[i % pairs.length];
    const first: Side = i % 2 === 0 ? "A" : "B";
    const la = levels[i % levels.length];
    const lb = levels[(i + 1) % levels.length];
    yield {
      match: play(a, b, createDuelBot("x", la), createDuelBot("y", lb), i * 7919 + 13, i * 6271 + 977, first),
      first, label: `${label}/${la}v${lb}/${first}`,
    };
  }
}

test("PROPIEDAD 1-2 · toda partida termina y ninguna queda UNRESOLVED por accidente", () => {
  const decided: Record<string, number> = {};
  for (const { match, label } of corpus(600)) {
    assert.equal(match.turns.length, 10, label);
    assert.ok(match.status === "COMPLETED" || match.status === "DRAW", `${label}: ${match.status}`);
    assert.notEqual(match.status, "UNRESOLVED", label);
    assert.ok(match.result, label);
    const by = match.result!.combat.decidedBy;
    decided[by] = (decided[by] ?? 0) + 1;
  }
  // El corpus debe EJERCITAR de verdad los tres niveles; si no, esta propiedad no demostraría nada.
  assert.ok(decided.SCORE > 0, "victorias por enfrentamientos");
  assert.ok(decided.OVR_TIEBREAK > 0, "victorias por el desempate del PDF");
  assert.ok(decided.STAT_MARGIN > 0, "victorias por el segundo desempate (OPD-08)");
});

test("PROPIEDAD 3-4 · el empate es EXPLÍCITO y distinguible de la ausencia de ganador", () => {
  for (const { match, label } of corpus(600)) {
    const r = match.result!;
    if (r.winner === null) {
      assert.equal(r.isDraw, true, label);
      assert.equal(match.status, "DRAW", label);
      assert.equal(r.combat.status, "DRAW", label);
      assert.equal(r.loser, null, label);
    } else {
      assert.equal(r.isDraw, false, label);
      assert.equal(match.status, "COMPLETED", label);
      assert.notEqual(r.loser, r.winner, label);
    }
  }
});

test("PROPIEDAD 5 · la misma entrada NUNCA produce un resultado distinto", () => {
  for (const [a, b] of [[M1, M1B], [M1, M2], [M2, M3]] as const) {
    for (const seed of [1, 4242, 999999]) {
      const x = play(a, b, createDuelBot("x", "NORMAL"), createDuelBot("y", "HARD"), seed, seed + 1);
      const y = play(a, b, createDuelBot("x", "NORMAL"), createDuelBot("y", "HARD"), seed, seed + 1);
      assert.equal(JSON.stringify(x), JSON.stringify(y));
    }
  }
});

test("PROPIEDAD 6 · el Combat Resolver sigue siendo la ÚNICA autoridad", () => {
  for (const { match, label } of corpus(60)) {
    const r = match.result!;
    // El resultado guardado es EXACTAMENTE lo que devuelve el resolver sobre el plan completo.
    const rules = getCombatRuleset(match.combatRulesVersion)!;
    assert.deepEqual(r.combat, resolveCombat(match.snapshotA, match.snapshotB, buildCombatPlan(match), rules), label);
    assert.equal(r.winner, r.combat.winner, label);
    assert.equal(r.scoreA, r.combat.scoreA, label);
    assert.equal(r.scoreB, r.combat.scoreB, label);
    assert.equal(r.integrityOk, true, label);
  }
});

test("PROPIEDAD 7 · el orquestador no calcula desempates ni resultados", () => {
  const src = readFileSync(new URL("./match/orchestrator.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["sumOvr", "statTotals", "STAT_MARGIN", "marginTiebreak", "tiebreak", "Math.random", "Date.now"]) {
    assert.ok(!code.includes(forbidden), `el orquestador no debe contener "${forbidden}"`);
  }
  // El estado terminal se ADOPTA del resolver, no se deduce del marcador.
  assert.ok(!/scoreA\s*[<>]\s*.*scoreB/.test(code), "el orquestador no compara marcadores");
});

// ═════════════════════════ Adversariales ═════════════════════════

test("ADVERSARIAL · empate total (0-0, 10 empates) termina en DRAW determinista", () => {
  const r1 = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  const r2 = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  assert.equal(r1.status, "DRAW");
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test("ADVERSARIAL · marcador igualado con OVR distinto lo decide el desempate del PDF", () => {
  // M1 vs M2 declarando siempre Gamesense llega al 5-5 con mazos de OVR distinto: el criterio del
  // PDF decide y otorga su punto, y el margen no llega ni a calcularse.
  const r = resolveCombat(M1, MADV, planFor(M1, MADV, allGamesense(M1)));
  assert.equal(r.decidedBy, "OVR_TIEBREAK");
  assert.notEqual(r.tiebreak!.sumOvrA, r.tiebreak!.sumOvrB);
  assert.equal(r.winner, r.tiebreak!.awardedTo);
  assert.equal(r.marginTiebreak, null, "con el OVR decidido, el margen ni se aplica");
  assert.equal(r.status, "RESOLVED");
  // El punto del desempate SÍ mueve el marcador: es la regla que el PDF define.
  assert.equal(Math.abs(r.scoreA - r.scoreB), 1);
});

test("ADVERSARIAL · mazos casi idénticos: una sola carta distinta rompe el espejo", () => {
  // M1 con UNA carta sustituida por la equivalente de M2: mismo rol, distinto OVR.
  // La primera posición en la que M1 y M2 difieren de OVR (misma posición = mismo rol).
  const k = M1.cards.findIndex((c, i) => c.ovr !== M2.cards[i].ovr);
  assert.ok(k >= 0, "M1 y M2 deben diferir en alguna carta");
  const swapped: DuelDeckCard[] = M1.cards.map((c, i) =>
    i === k ? { ...M2.cards[k], uid: `almost::${M2.cards[k].uid}` } : { ...c, uid: `almost::${c.uid}` });
  const almost: DuelDeckSnapshot = { ...M1, deckId: "almost", cards: swapped, checksum: deckChecksum(swapped) };
  const r = resolveCombat(M1, almost, planFor(M1, almost, allGamesense(M1)));
  assert.deepEqual(r.errors, []);
  assert.notEqual(sumOvr(M1.cards), sumOvr(almost.cards), "los mazos ya no son espejo");
  assert.ok(r.status === "RESOLVED" || r.status === "DRAW");
});

test("ADVERSARIAL · los dos primeros atacantes producen partidas legales y terminadas", () => {
  for (const first of ["A", "B"] as const) {
    for (const [a, b] of [[M1, M1B], [M1, M2]] as const) {
      const m = play(a, b, createDuelBot("x", "NORMAL"), createDuelBot("y", "NORMAL"), 55, 66, first);
      assert.equal(m.turns[0].attacker, first);
      assert.equal(m.turns.filter((t) => t.attacker === "A").length, 5);
      assert.equal(m.turns.length, 10);
      assert.ok(m.status === "COMPLETED" || m.status === "DRAW");
    }
  }
});

test("ADVERSARIAL · una partida terminada en DRAW no acepta más acciones", () => {
  const start = startDuelMatch({ id: "d", snapshotA: M1, snapshotB: M1B });
  assert.ok(start.ok);
  let m = start.match;
  // Se fuerza el empate absoluto jugando siempre Gamesense por los dos lados.
  for (let t = 0; t < 10; t++) {
    const atk = m.attacker!;
    const atkCards = (atk === "A" ? m.snapshotA : m.snapshotB).cards
      .filter((c) => !(atk === "A" ? m.usedA : m.usedB).includes(c.uid));
    const defSide = atk === "A" ? "B" : "A";
    const defCards = (defSide === "A" ? m.snapshotA : m.snapshotB).cards
      .filter((c) => !(defSide === "A" ? m.usedA : m.usedB).includes(c.uid));
    // Se elige la MISMA posición en los dos mazos espejo: valores idénticos ⇒ empate.
    const idx = atkCards.findIndex((c) => defCards.some((d) => d.cardId === c.cardId));
    const a = atkCards[idx];
    const d = defCards.find((x) => x.cardId === a.cardId)!;
    let r = selectAttackerCard(m, a.uid); assert.ok(r.ok); m = r.match;
    r = selectAttackerStat(m, "gamesense"); assert.ok(r.ok); m = r.match;
    r = selectDefenderCard(m, d.uid); assert.ok(r.ok); m = r.match;
    r = selectDefenderStat(m, "gamesense"); assert.ok(r.ok); m = r.match;
    const c = confirmTurn(m); assert.ok(c.ok); m = c.match;
  }
  assert.equal(m.status, "DRAW");
  assert.equal(m.result!.isDraw, true);
  assert.equal(m.result!.combat.tiedEncounters, 10);
  const again = confirmTurn(m);
  assert.equal(again.ok, false);
  assert.equal(again.ok ? "" : again.error.code, "MATCH_ALREADY_COMPLETE");
});

// ═════════════════════════ Versionado y replay ═════════════════════════

test("VERSIONADO · el registro conoce las dos versiones y la vigente es la 2", () => {
  assert.equal(RESOLVER_VERSION, "duel-combat-2");
  assert.equal(CURRENT_COMBAT_RULES, COMBAT_RULES_V2);
  assert.equal(getCombatRuleset("duel-combat-1"), COMBAT_RULES_V1);
  assert.equal(getCombatRuleset("duel-combat-2"), COMBAT_RULES_V2);
  assert.equal(getCombatRuleset("duel-combat-99"), null, "una versión desconocida no se sustituye");
  assert.deepEqual(Object.keys(COMBAT_RULESETS).sort(), ["duel-combat-1", "duel-combat-2"]);
  assert.equal(ORCHESTRATOR_VERSION, "duel-turns-2");
});

test("REPLAY · el mismo plan resuelto con reglas v1 y v2 difiere SOLO en el doble empate", () => {
  const plan = planFor(M1, M1B, allGamesense(M1));
  const v1 = resolveCombat(M1, M1B, plan, COMBAT_RULES_V1);
  const v2 = resolveCombat(M1, M1B, plan, COMBAT_RULES_V2);
  // Enfrentamientos, marcador y desempate del PDF: idénticos. Las reglas nuevas no reescriben nada.
  assert.deepEqual(v1.encounters, v2.encounters);
  assert.equal(v1.scoreA, v2.scoreA);
  assert.equal(v1.scoreB, v2.scoreB);
  assert.deepEqual(v1.tiebreak, v2.tiebreak);
  // Lo único que cambia es el estado terminal.
  assert.equal(v1.status, "UNRESOLVED_TIEBREAK");
  assert.equal(v2.status, "DRAW");
  assert.equal(v1.resolverVersion, "duel-combat-1");
  assert.equal(v2.resolverVersion, "duel-combat-2");
});

test("REPLAY · una partida antigua se cierra con SUS reglas, no con las nuevas", () => {
  const m = play(M1, M1B, createRandomBot("a"), createRandomBot("b"), 31, 41, "A", COMBAT_RULES_V1);
  assert.equal(m.combatRulesVersion, "duel-combat-1");
  assert.equal(m.result!.combat.resolverVersion, "duel-combat-1");
  assert.equal(m.result!.combat.marginTiebreak, null, "v1 no tiene segundo desempate");
  // Y el resolver reproduce ese resultado exacto cuando se le dan las reglas guardadas.
  const again = resolveCombat(m.snapshotA, m.snapshotB, buildCombatPlan(m), getCombatRuleset(m.combatRulesVersion)!);
  assert.deepEqual(again, m.result!.combat);
});

test("REPLAY · pausar, serializar y reanudar da el mismo resultado con las reglas nuevas", () => {
  const ctrl = createController(BOT("A"), BOT("B"));
  const bots = { A: createDuelBot("a", "NORMAL"), B: createDuelBot("b", "HARD") };
  const start = () => {
    const s = startDuelMatch({ id: "r", snapshotA: M1, snapshotB: M1B });
    assert.ok(s.ok);
    return s.match;
  };
  const full = advanceBots(start(), ctrl, bots, createRng(11), createRng(22));

  let m = start(), ra = createRng(11), rb = createRng(22);
  for (let i = 0; i < 40 && m.turns.length < 4; i++) {
    const s = advanceBots(m, ctrl, bots, ra, rb, 1);
    m = s.match; ra = s.rngA; rb = s.rngB;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); assert.ok(c.ok); m = c.match; }
  }
  const saved = JSON.parse(JSON.stringify({ m, ra, rb }));
  const resumed = advanceBots(saved.m, ctrl, bots, saved.ra, saved.rb);
  assert.equal(JSON.stringify(resumed.match), JSON.stringify(full.match));
});

test("SERIALIZACIÓN · el estado nuevo sobrevive a un ida y vuelta por JSON", () => {
  const m = play(M1, M1B, createDuelBot("a", "NORMAL"), createDuelBot("b", "HARD"), 5, 6);
  const revived = JSON.parse(JSON.stringify(m)) as DuelMatch;
  assert.deepEqual(revived, m);
  assert.equal(typeof revived.combatRulesVersion, "string");
  assert.equal(typeof revived.result!.isDraw, "boolean");
  assert.equal(typeof revived.result!.combat.statTotalA, "number");
  assert.equal(typeof revived.result!.combat.decidedBy, "string");
});

// ═════════════════════════ Audit trail ═════════════════════════

test("AUDIT · todo resultado se explica de forma determinista y sin códigos", () => {
  const seen = new Set<CombatResult["decidedBy"]>();
  for (const { match } of corpus(120)) {
    const r = match.result!.combat;
    seen.add(r.decidedBy);
    const audit = auditCombatResult(r);
    assert.equal(audit, auditCombatResult(r), "el audit trail es determinista");
    assert.ok(audit.includes("FINAL RESULT") && audit.includes("Reason:"));
    assert.ok(audit.includes(`${r.scoreA}-${r.scoreB}`));
    assert.ok(explainCombatReason(r).length > 10);
    assert.ok(explainCombatResult(r).length > 10);
    assert.ok(!/[A-Z_]{6,}/.test(explainCombatResult(r).replace(/[ÁÉÍÓÚÑ]/g, "")), "sin códigos de dominio");
  }
  assert.ok(seen.has("SCORE"), "el corpus debe cubrir victorias por marcador");
  assert.ok(seen.has("OVR_TIEBREAK"), "y por el desempate del PDF");
  assert.ok(seen.has("STAT_MARGIN"), "y por el segundo desempate");
});

test("AUDIT · el DRAW se explica como empate, nunca como fallo", () => {
  const r = resolveCombat(M1, M1B, planFor(M1, M1B, allGamesense(M1)));
  const audit = auditCombatResult(r);
  assert.ok(audit.includes("Result:\nDRAW"), audit);
  assert.ok(audit.includes("duel-combat-2"));
  assert.ok(/[Ee]mpate/.test(explainCombatReason(r)));
});

// ═════════════════════════ OPD-42 · dificultad ═════════════════════════

test("OPD-42 · los perfiles son 0 < NORMAL < HARD y ninguno ve información oculta", () => {
  assert.equal(DIFFICULTY_PROFILE.EASY.heuristicRate, 0);
  assert.equal(DIFFICULTY_PROFILE.NORMAL.heuristicRate, NORMAL_HEURISTIC_RATE);
  assert.equal(DIFFICULTY_PROFILE.HARD.heuristicRate, HARD_HEURISTIC_RATE);
  assert.ok(DIFFICULTY_PROFILE.EASY.heuristicRate < DIFFICULTY_PROFILE.NORMAL.heuristicRate);
  assert.ok(DIFFICULTY_PROFILE.NORMAL.heuristicRate < DIFFICULTY_PROFILE.HARD.heuristicRate);
  assert.ok(DIFFICULTY_PROFILE.HARD.heuristicRate < 1, "HARD no puede ser un bot perfecto");
  for (const d of ["EASY", "NORMAL", "HARD"] as const) {
    assert.equal(DIFFICULTY_PROFILE[d].perfectInformation, false, `${d} no ve el mazo rival`);
    assert.equal(createDuelBot("b", d).perfectInformation, false, d);
  }
});

test("OPD-42 · EASY es exactamente el bot aleatorio y no consume RNG de más", () => {
  const easy = play(M1, M1B, createDuelBot("a", "EASY"), createDuelBot("b", "EASY"), 7, 8);
  const random = play(M1, M1B, createRandomBot("a", "EASY"), createRandomBot("b", "EASY"), 7, 8);
  assert.equal(
    JSON.stringify(easy.turns.map((t) => [t.attackerCardUid, t.attackerStat, t.defenderCardUid])),
    JSON.stringify(random.turns.map((t) => [t.attackerCardUid, t.attackerStat, t.defenderCardUid])),
  );
});

test("OPD-42 · la mezcla es determinista y la semilla la mueve de verdad", () => {
  const decisions = (m: DuelMatch) =>
    m.turns.map((t) => `${t.attackerCardUid}|${t.attackerStat}|${t.defenderCardUid}`).join(",");
  const a = play(M1, M1B, createDuelBot("a", "NORMAL"), createDuelBot("b", "NORMAL"), 100, 200);
  const b = play(M1, M1B, createDuelBot("a", "NORMAL"), createDuelBot("b", "NORMAL"), 100, 200);
  const c = play(M1, M1B, createDuelBot("a", "NORMAL"), createDuelBot("b", "NORMAL"), 555, 200);
  assert.equal(decisions(a), decisions(b));
  assert.notEqual(decisions(a), decisions(c));
});

test("OPD-42 · un bot mezclado no produce partidas idénticas con mazos espejo", () => {
  // El problema estructural de un bot 100 % heurístico: siempre la misma partida. Se mide aquí.
  const distinct = (make: (id: string) => DuelOpponent, n: number) => {
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const m = play(M1, M1B, make("x"), make("y"), i * 7919 + 13, i * 6271 + 977, i % 2 === 0 ? "A" : "B");
      seen.add(m.turns.map((t) => `${t.attackerCardUid}|${t.attackerStat}|${t.defenderCardUid}`).join(","));
    }
    return seen.size;
  };
  assert.equal(distinct((id) => createSmartBot(id, "HARD"), 40), 2, "heurística pura ⇒ 2 partidas (una por atacante)");
  assert.ok(distinct(lvl("HARD"), 40) > 20, "HARD mezclado conserva variedad");
  assert.ok(distinct(lvl("NORMAL"), 40) > 30, "NORMAL conserva variedad");
});

test("OPD-42 · la escalera es estrictamente creciente: EASY < NORMAL < HARD", () => {
  const winRate = (rowLevel: BotDifficulty, colLevel: BotDifficulty, n = 240) => {
    let wins = 0, decided = 0;
    for (let i = 0; i < n; i++) {
      const m = play(M1, M1B, createDuelBot("x", rowLevel), createDuelBot("y", colLevel),
        i * 7919 + 13, i * 6271 + 977, i % 2 === 0 ? "A" : "B");
      if (m.result!.winner === null) continue;
      decided++;
      if (m.result!.winner === "A") wins++;
    }
    return wins / decided;
  };
  const normalVsEasy = winRate("NORMAL", "EASY");
  const hardVsEasy = winRate("HARD", "EASY");
  const hardVsNormal = winRate("HARD", "NORMAL");

  assert.ok(normalVsEasy > 0.6, `NORMAL debe superar claramente a EASY (${normalVsEasy})`);
  assert.ok(normalVsEasy < 0.95, `NORMAL no puede rozar el 100 % contra EASY (${normalVsEasy})`);
  assert.ok(hardVsNormal > 0.6, `HARD debe superar claramente a NORMAL (${hardVsNormal})`);
  assert.ok(hardVsEasy > normalVsEasy, "HARD debe ser más fuerte que NORMAL contra el mismo rival");
});

test("OPD-42 · con mazos idénticos, un nivel contra sí mismo es aproximadamente simétrico", () => {
  for (const [a, b] of [[M1, M1B], [M2, M2B], [M3, M3B]] as const) {
    for (const d of ["EASY", "NORMAL", "HARD"] as const) {
      let winA = 0, decided = 0;
      const n = 240;
      for (let i = 0; i < n; i++) {
        const m = play(a, b, createDuelBot("x", d), createDuelBot("y", d),
          i * 7919 + 13, i * 6271 + 977, i % 2 === 0 ? "A" : "B");
        if (m.result!.winner === null) continue;
        decided++;
        if (m.result!.winner === "A") winA++;
      }
      const rate = winA / decided;
      assert.ok(rate > 0.35 && rate < 0.65, `${d} espejo debería rondar 50 %, dio ${(100 * rate).toFixed(1)} %`);
    }
  }
});

// ═════════════════════════ OPD-04 · información oculta ═════════════════════════

test("OPD-04 · ningún bot de la escalera recibe cartas no jugadas del rival", () => {
  // Se instrumenta el bot para capturar lo que el controlador le deja ver.
  for (const d of ["EASY", "NORMAL", "HARD"] as const) {
    const base = createDuelBot("spy", d);
    let maxVisible = 0;
    let turnsSeen = 0;
    const spy: DuelOpponent = {
      ...base,
      chooseAttackerCard(ctx) {
        maxVisible = Math.max(maxVisible, ctx.visibleOpponentCards.length);
        turnsSeen = Math.max(turnsSeen, ctx.turn);
        // Solo puede ver cartas YA jugadas: como mucho, tantas como turnos completados.
        assert.ok(ctx.visibleOpponentCards.length <= ctx.turn - 1, `${d}: turno ${ctx.turn}`);
        return base.chooseAttackerCard(ctx);
      },
    };
    const m = play(M1, M1B, spy, createDuelBot("y", "EASY"), 12, 34);
    assert.equal(m.turns.length, 10);
    assert.ok(turnsSeen > 0, `${d}: el espía debe haber decidido`);
    assert.ok(maxVisible <= 9, d);
  }
});

test("OPD-04 · la visibilidad la declara el bot, no su dificultad", () => {
  assert.equal(createDuelBot("x", "HARD").perfectInformation, false);
  assert.equal(createDuelBot("x", "HARD", { perfectInformation: true }).perfectInformation, true);
  assert.equal(createSmartBot("x", "NORMAL").perfectInformation, false);
  // Compatibilidad: `createSmartBot(_, "HARD")` conserva la visibilidad de la Fase 6.
  assert.equal(createSmartBot("x", "HARD").perfectInformation, true);
});

// ═════════════════════════ Seguridad y pureza ═════════════════════════

test("SEGURIDAD · la fase sigue siendo dominio puro", () => {
  for (const file of ["./combat/rules.ts", "./combat/resolver.ts", "./match/orchestrator.ts", "./opponent/bots.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "Math.random", "Date.now", "performance.now", "crypto.", "localStorage", "sessionStorage",
      "supabase", "fetch(", "process.env", "@/data/catalog", "@/store", "@/app", "react", "useState",
    ]) {
      assert.ok(!code.includes(forbidden), `${file} no debe contener "${forbidden}"`);
    }
  }
});

test("SEGURIDAD · no se han tocado cartas, OVR ni matchup", () => {
  // La tabla del PDF y el modelo de combate siguen siendo los de la Fase 2, consumidos sin copiar.
  assert.deepEqual(COMBAT_MATCHUP, { stronghold: "entryfrag", gamesense: "gamesense", entryfrag: "stronghold" });
  assert.equal(sumOvr(M1.cards), M1.cards.reduce((s, c) => s + c.ovr, 0));
  const rules = readFileSync(new URL("./combat/rules.ts", import.meta.url), "utf8");
  assert.ok(!rules.includes("combat["), "las reglas de resultado no tocan estadísticas");
});
