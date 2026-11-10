/**
 * Tests del Combat Resolver (node:test). Ejecutar: `npm test`.
 *
 * Los tests de combate usan CARTAS REALES del catálogo VCT 2026 y mazos construidos con el mismo
 * dominio de la Fase 3: si el modelo de cartas o el sistema de mazos se rompiera, estos tests lo
 * detectarían igual que los suyos.
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
import {
  resolveCombat, resolveEncounter, sumOvr, explainCombatError, explainCombatResult,
  RESOLVER_VERSION, COMBAT_RULES_V1, type CombatPlan, type DeclaredEncounter,
} from "./index";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Construye un snapshot real usando el bloque `n` de jugadores de cada rol. */
function realSnapshot(block: number, id: string): DuelDeckSnapshot {
  const best = new Map<string, (typeof CARDS)[number]>();
  for (const c of CARDS) {
    const b = best.get(c.playerId);
    if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
  }
  const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
  for (const c of best.values()) {
    const p = registry.player(c.playerId);
    if (!p) continue;
    // Rol de la CARTA (catálogo diseñado, 2026-09-21) si lo imprime; si no, el del jugador.
    byRole.set((c.role ?? p.role), [...(byRole.get((c.role ?? p.role)) ?? []), c]);
  }
  for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));

  const picks = DUEL_ROLES.flatMap((r) => (byRole.get(r) ?? []).slice(block * 2, block * 2 + 2));
  const owned: OwnedCard[] = picks.map((c, i) => ({ uid: `${id}-u${i}`, cardId: c.id, obtainedAt: NOW }));
  const resolve = makeDeckResolver(registry, ownershipFromList(owned));
  const deck = createDuelDeck({ id, name: `Mazo ${block + 1}`, cards: owned.map((o) => o.uid), now: NOW });
  const v = validateDuelDeck(deck, resolve);
  assert.equal(v.valid, true, `el mazo ${id} debe ser válido`);
  return takeDeckSnapshot(deck, v, NOW)!;
}

/** Plan que empareja carta i de A con carta i de B, alternando la estadística declarada. */
function planFor(a: DuelDeckSnapshot, b: DuelDeckSnapshot, stats?: CombatStatKey[]): CombatPlan {
  const order: CombatStatKey[] = stats ?? a.cards.map((_, i) =>
    (["stronghold", "gamesense", "entryfrag"] as CombatStatKey[])[i % 3]);
  const encounters: DeclaredEncounter[] = a.cards.map((c, i) => ({
    aUid: c.uid,
    aStat: order[i],
    bUid: b.cards[i].uid,
    bStat: COMBAT_MATCHUP[order[i]],
  }));
  return { encounters };
}

const A = realSnapshot(0, "deck-a");
const B = realSnapshot(1, "deck-b");
const C = realSnapshot(2, "deck-c");

/** Carta sintética mínima, solo para los tests de comparación de una estadística. */
const card = (uid: string, name: string, sh: number, gs: number, ef: number, ovr = 80) => ({
  uid, cardId: `${name}__gold`, playerId: name, playerName: name, team: "TM",
  region: "EMEA" as const, role: "Duelista" as RoleId, variantId: "gold" as const,
  combat: { stronghold: sh, gamesense: gs, entryfrag: ef },
  ovr, statBoost: 0, dataVersion: "VCT-2026", serial: null,
});

// ───────────────────────────── Comparación de estadísticas ─────────────────────────────

test("1 · A gana Stronghold contra Entryfrag", () => {
  const r = resolveEncounter(0, card("a", "Ana", 84, 50, 50), "stronghold", card("b", "Bea", 50, 50, 71), "entryfrag");
  assert.equal(r.outcome, "A");
  assert.equal(r.a.value, 84);
  assert.equal(r.b.value, 71);
  assert.match(r.reason, /Ana Stronghold 84 > Bea Entryfrag 71/);
});

test("2 · B gana Stronghold contra Entryfrag", () => {
  const r = resolveEncounter(0, card("a", "Ana", 60, 50, 50), "stronghold", card("b", "Bea", 50, 50, 90), "entryfrag");
  assert.equal(r.outcome, "B");
});

test("3 · A gana Gamesense contra Gamesense", () => {
  const r = resolveEncounter(0, card("a", "Ana", 50, 80, 50), "gamesense", card("b", "Bea", 50, 65, 50), "gamesense");
  assert.equal(r.outcome, "A");
  assert.match(r.reason, /Gamesense 80 > .*Gamesense 65/);
});

test("4 · B gana Gamesense contra Gamesense", () => {
  const r = resolveEncounter(0, card("a", "Ana", 50, 40, 50), "gamesense", card("b", "Bea", 50, 77, 50), "gamesense");
  assert.equal(r.outcome, "B");
});

test("5 · A gana Entryfrag contra Stronghold", () => {
  const r = resolveEncounter(0, card("a", "Ana", 50, 50, 92), "entryfrag", card("b", "Bea", 40, 50, 50), "stronghold");
  assert.equal(r.outcome, "A");
});

test("6 · valores idénticos producen TIE, sin ganador arbitrario", () => {
  const r = resolveEncounter(0, card("a", "Ana", 70, 50, 50), "stronghold", card("b", "Bea", 50, 50, 70), "entryfrag");
  assert.equal(r.outcome, "TIE");
  assert.match(r.reason, /70 = .*70/);
});

test("el ejemplo literal del PDF se reproduce en las tres comparaciones", () => {
  // J1 (76 SH / 80 GS / 26 EF) vs J2 (40 SH / 65 GS / 90 EF)
  const j1 = card("a", "J1", 76, 80, 26);
  const j2 = card("b", "J2", 40, 65, 90);
  assert.equal(resolveEncounter(0, j1, "stronghold", j2, "entryfrag").outcome, "B"); // 76 < 90
  assert.equal(resolveEncounter(1, j1, "gamesense", j2, "gamesense").outcome, "A");  // 80 > 65
  assert.equal(resolveEncounter(2, j1, "entryfrag", j2, "stronghold").outcome, "B"); // 26 < 40
});

// ───────────────────────────── Validación de entrada ─────────────────────────────

test("7 · un snapshot con checksum manipulado se rechaza", () => {
  const bad = { ...A, checksum: "deadbeef" };
  const r = resolveCombat(bad, B, planFor(bad, B));
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "SNAPSHOT_CHECKSUM_MISMATCH"));
  assert.deepEqual(r.encounters, []);
});

test("8 · modificar una estadística invalida el checksum", () => {
  const tampered: DuelDeckSnapshot = {
    ...A,
    cards: A.cards.map((c, i) => (i === 0 ? { ...c, combat: { ...c.combat, stronghold: 99 } } : c)),
  };
  const r = resolveCombat(tampered, B, planFor(tampered, B));
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "SNAPSHOT_CHECKSUM_MISMATCH"));
});

test("9 · dataVersion incompatible se rechaza", () => {
  const other = { ...B, dataVersion: "VCT-2027" };
  const r = resolveCombat(A, other, planFor(A, other));
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "DATA_VERSION_MISMATCH"));
});

test("10 · un mazo con composición incorrecta se rechaza", () => {
  const broken: DuelDeckSnapshot = { ...A, cards: A.cards.slice(0, 9) };
  const fixed = { ...broken, checksum: A.checksum };
  const r = resolveCombat(fixed, B, planFor(fixed, B));
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "SNAPSHOT_SIZE"));
});

test("un esquema de snapshot no soportado se rechaza", () => {
  const old = { ...A, schemaVersion: 99 };
  const r = resolveCombat(old, B, planFor(old, B));
  assert.ok(r.errors.some((e) => e.code === "SNAPSHOT_SCHEMA_UNSUPPORTED"));
});

test("un emparejamiento fuera de la tabla se rechaza", () => {
  const plan = planFor(A, B);
  plan.encounters[0] = { ...plan.encounters[0], aStat: "stronghold", bStat: "gamesense" };
  const r = resolveCombat(A, B, plan);
  assert.equal(r.status, "INVALID_INPUT");
  const err = r.errors.find((e) => e.code === "PLAN_ILLEGAL_MATCHUP");
  assert.ok(err);
  assert.deepEqual(err!.matchup, ["stronghold", "gamesense"]);
});

test("reutilizar una carta se rechaza: una estadística por carta", () => {
  const plan = planFor(A, B);
  plan.encounters[1] = { ...plan.encounters[1], aUid: plan.encounters[0].aUid };
  const r = resolveCombat(A, B, plan);
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "PLAN_CARD_REUSED"));
  assert.ok(r.errors.some((e) => e.code === "PLAN_CARD_UNUSED"));
});

test("un plan con menos de 10 enfrentamientos se rechaza", () => {
  const plan = planFor(A, B);
  const r = resolveCombat(A, B, { encounters: plan.encounters.slice(0, 8) });
  assert.equal(r.status, "INVALID_INPUT");
  assert.ok(r.errors.some((e) => e.code === "PLAN_SIZE"));
});

test("una carta ajena al snapshot se rechaza", () => {
  const plan = planFor(A, B);
  plan.encounters[0] = { ...plan.encounters[0], aUid: "uid-de-otro-mazo" };
  const r = resolveCombat(A, B, plan);
  assert.ok(r.errors.some((e) => e.code === "PLAN_CARD_NOT_IN_SNAPSHOT"));
});

// ───────────────────────────── Determinismo ─────────────────────────────

test("11-12 · el resolver es determinista: mismo snapshot, mismo resultado", () => {
  const plan = planFor(A, B);
  const r1 = resolveCombat(A, B, plan);
  const r2 = resolveCombat(A, B, plan);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test("13 · reordenar el plan no cambia el marcador (el orden no es semántico)", () => {
  const plan = planFor(A, B);
  const reversed: CombatPlan = { encounters: [...plan.encounters].reverse() };
  const r1 = resolveCombat(A, B, plan);
  const r2 = resolveCombat(A, B, reversed);
  assert.equal(r1.scoreA, r2.scoreA);
  assert.equal(r1.scoreB, r2.scoreB);
  assert.equal(r1.winner, r2.winner);
  assert.equal(r1.tiedEncounters, r2.tiedEncounters);
});

test("14 · cambiar una estadística cambia el resultado cuando corresponde", () => {
  const base = resolveEncounter(0, card("a", "Ana", 70, 50, 50), "stronghold", card("b", "Bea", 50, 50, 71), "entryfrag");
  const bumped = resolveEncounter(0, card("a", "Ana", 72, 50, 50), "stronghold", card("b", "Bea", 50, 50, 71), "entryfrag");
  assert.equal(base.outcome, "B");
  assert.equal(bumped.outcome, "A");
});

// ───────────────────────────── Invariantes ─────────────────────────────

test("INVARIANTE · el resolver nunca muta los snapshots ni el plan", () => {
  const plan = planFor(A, B);
  const beforeA = JSON.stringify(A);
  const beforeB = JSON.stringify(B);
  const beforePlan = JSON.stringify(plan);
  resolveCombat(A, B, plan);
  assert.equal(JSON.stringify(A), beforeA);
  assert.equal(JSON.stringify(B), beforeB);
  assert.equal(JSON.stringify(plan), beforePlan);
});

test("INVARIANTE · el resolver no importa catálogo, propiedad, red ni estado global", () => {
  const src = readFileSync(new URL("./resolver.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "Math.random", "Date.now", "localStorage", "supabase", "fetch(", "process.env",
    "@/data/catalog", "@/store", "@/collection/ownership", "react",
  ]) {
    assert.ok(!code.includes(forbidden), `el resolver no debe contener "${forbidden}"`);
  }
});

test("INVARIANTE · el resolver no usa las 6 estadísticas heredadas ni el OVR para comparar", () => {
  const src = readFileSync(new URL("./resolver.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Límites de palabra: `.combat` es legítimo, `.com` (la stat heredada) no lo es.
  for (const legacy of [/\.dmg\b/, /\.scr\b/, /\.com\b/, /\.hs\b/, /\.ast\b/, /\.clu\b/, /\.stats\b/]) {
    assert.ok(!legacy.test(code), `el resolver no debe tocar ${legacy}`);
  }
  // El OVR solo aparece en el desempate, nunca en la comparación de un enfrentamiento.
  const r = resolveCombat(A, B, planFor(A, B));
  for (const e of r.encounters) {
    const a = A.cards.find((c) => c.uid === e.a.uid)!;
    assert.equal(e.a.value, a.combat[e.a.stat]);
    assert.notEqual(e.a.value, a.ovr === a.combat[e.a.stat] ? -1 : a.ovr);
  }
});

test("INVARIANTE · cada enfrentamiento usa exclusivamente la estadística declarada", () => {
  const plan = planFor(A, B);
  const r = resolveCombat(A, B, plan);
  assert.equal(r.encounters.length, 10);
  for (let i = 0; i < r.encounters.length; i++) {
    const e = r.encounters[i];
    const d = plan.encounters[i];
    assert.equal(e.a.stat, d.aStat);
    assert.equal(e.b.stat, d.bStat);
    assert.equal(COMBAT_MATCHUP[e.a.stat], e.b.stat, "el par debe estar en la tabla del PDF");
    assert.equal(e.a.value, A.cards.find((c) => c.uid === d.aUid)!.combat[d.aStat]);
    assert.equal(e.b.value, B.cards.find((c) => c.uid === d.bUid)!.combat[d.bStat]);
  }
});

test("INVARIANTE · el marcador cuadra con los enfrentamientos", () => {
  const r = resolveCombat(A, B, planFor(A, B));
  const wins = { A: 0, B: 0, TIE: 0 };
  for (const e of r.encounters) wins[e.outcome]++;
  const bonus = r.tiebreak?.awardedTo;
  assert.equal(r.scoreA, wins.A + (bonus === "A" ? 1 : 0));
  assert.equal(r.scoreB, wins.B + (bonus === "B" ? 1 : 0));
  assert.equal(r.tiedEncounters, wins.TIE);
  assert.equal(wins.A + wins.B + wins.TIE, 10);
});

test("INVARIANTE · 1000 resoluciones seguidas dan el mismo resultado y no acumulan estado", () => {
  const plan = planFor(A, B);
  const first = JSON.stringify(resolveCombat(A, B, plan));
  for (let i = 0; i < 1000; i++) {
    assert.equal(JSON.stringify(resolveCombat(A, B, plan)), first);
  }
});

// ───────────────────────────── Desempate ─────────────────────────────

test("el desempate del PDF suma las medias y otorga un punto", () => {
  // Fase 7: se fija EXPLÍCITAMENTE el ruleset histórico. Antes esta comprobación colgaba de un
  // `if` y podía pasar sin ejecutarse; ahora se afirma el caso concreto y, además, se verifica que
  // una partida antigua sigue resolviéndose exactamente igual bajo sus propias reglas.
  // Empate ABSOLUTO reproducible: el mismo mazo contra sí mismo declarando siempre Gamesense, que
  // es la única estadística que se enfrenta a sí misma. Los 10 enfrentamientos empatan ⇒ 0-0.
  const mirrorPlan = planFor(A, A, A.cards.map(() => "gamesense" as CombatStatKey));
  const r = resolveCombat(A, A, mirrorPlan, COMBAT_RULES_V1);
  assert.equal(r.resolverVersion, COMBAT_RULES_V1.version);
  assert.ok(r.tiebreak, "un mazo contra sí mismo iguala el marcador y aplica el desempate");
  assert.equal(r.tiebreak!.sumOvrA, r.tiebreak!.sumOvrB, "las medias de un mazo consigo mismo coinciden");
  assert.equal(r.tiebreak!.awardedTo, null);
  assert.equal(r.status, "UNRESOLVED_TIEBREAK");
  assert.equal(r.winner, null);
});

test("sumOvr reproduce el ejemplo numérico del PDF", () => {
  const mk = (ovrs: number[]) => ovrs.map((o, i) => card(`u${i}`, `p${i}`, 50, 50, 50, o));
  assert.equal(sumOvr(mk([88, 82, 85, 73, 70, 88, 77, 86, 70, 75])), 794);
  assert.equal(sumOvr(mk([89, 83, 86, 74, 71, 89, 78, 87, 71, 76])), 804);
});

test("las sumas idénticas NO producen ganador inventado", () => {
  // Con las reglas históricas no había segundo desempate: el resolver declaraba que no sabía.
  // Empate ABSOLUTO reproducible: el mismo mazo contra sí mismo declarando siempre Gamesense, que
  // es la única estadística que se enfrenta a sí misma. Los 10 enfrentamientos empatan ⇒ 0-0.
  const mirrorPlan = planFor(A, A, A.cards.map(() => "gamesense" as CombatStatKey));
  const r = resolveCombat(A, A, mirrorPlan, COMBAT_RULES_V1);
  assert.equal(r.tiebreak!.awardedTo, null);
  assert.equal(r.status, "UNRESOLVED_TIEBREAK");
  assert.equal(r.winner, null);
  assert.equal(r.loser, null);
});

// ───────────────────────────── Mazos reales ─────────────────────────────

test("MAZOS REALES · Mazo 1 vs Mazo 2, Mazo 1 vs Mazo 3, Mazo 2 vs Mazo 3", () => {
  for (const [x, y, label] of [[A, B, "1v2"], [A, C, "1v3"], [B, C, "2v3"]] as const) {
    const r = resolveCombat(x, y, planFor(x, y));
    assert.ok(r.status === "RESOLVED" || r.status === "UNRESOLVED_TIEBREAK", label);
    assert.deepEqual(r.errors, [], label);
    assert.equal(r.encounters.length, 10, label);
    assert.equal(r.inputChecksumA, x.checksum);
    assert.equal(r.inputChecksumB, y.checksum);
    assert.equal(r.resolverVersion, RESOLVER_VERSION);
    assert.equal(r.dataVersion, "VCT-2026");
    for (const e of r.encounters) {
      assert.ok(e.reason.length > 0, "cada enfrentamiento debe explicarse");
      assert.ok(e.a.playerName && e.b.playerName);
      assert.ok(e.a.playerId && e.b.playerId);
      assert.ok(e.a.role && e.b.role);
    }
  }
});

// ───────────────────────────── Audit trail y explicación ─────────────────────────────

test("el audit trail conserva identidad completa de las dos cartas", () => {
  const r = resolveCombat(A, B, planFor(A, B));
  const e = r.encounters[0];
  for (const s of [e.a, e.b]) {
    assert.ok(s.uid && s.cardId && s.playerId && s.playerName && s.team && s.role && s.variantId);
    assert.equal(typeof s.value, "number");
    assert.ok(["stronghold", "gamesense", "entryfrag"].includes(s.stat));
  }
});

test("todos los códigos de error tienen explicación con contexto", () => {
  const codes: Parameters<typeof explainCombatError>[0][] = [
    { code: "SNAPSHOT_SCHEMA_UNSUPPORTED", side: "A", expected: 1, actual: 9 },
    { code: "SNAPSHOT_SIZE", side: "A", expected: 10, actual: 9 },
    { code: "SNAPSHOT_COMPOSITION", side: "B", role: "Duelista", expected: 2, actual: 3 },
    { code: "SNAPSHOT_CHECKSUM_MISMATCH", side: "A" },
    { code: "SNAPSHOT_MISSING_COMBAT", side: "A" },
    { code: "SNAPSHOT_DUPLICATE_CARD", side: "B" },
    { code: "DATA_VERSION_MISMATCH", expected: "VCT-2026", actual: "VCT-2027" },
    { code: "PLAN_SIZE", expected: 10, actual: 8 },
    { code: "PLAN_CARD_NOT_IN_SNAPSHOT", side: "A" },
    { code: "PLAN_CARD_REUSED", side: "A" },
    { code: "PLAN_CARD_UNUSED", side: "B" },
    { code: "PLAN_ILLEGAL_MATCHUP", matchup: ["stronghold", "gamesense"] },
  ];
  for (const c of codes) assert.ok(explainCombatError(c).length > 15, c.code);
});

test("el resultado se explica en una frase", () => {
  const r = resolveCombat(A, B, planFor(A, B));
  const msg = explainCombatResult(r);
  assert.ok(msg.length > 10);
  assert.match(msg, /Gana|Empate|no se puede/);
});

// ───────────────────────────── Casos extremos ─────────────────────────────

test("CASO EXTREMO · especialista EF alto contra especialista SH bajo", () => {
  const r = resolveEncounter(0, card("a", "Entry", 45, 51, 99), "entryfrag", card("b", "Ancla", 43, 50, 50), "stronghold");
  assert.equal(r.outcome, "A");
  assert.equal(r.a.value, 99);
  assert.equal(r.b.value, 43);
});

test("CASO EXTREMO · el trío en sus límites 0 y 99", () => {
  const r = resolveEncounter(0, card("a", "Max", 99, 99, 99), "gamesense", card("b", "Min", 0, 0, 0), "gamesense");
  assert.equal(r.outcome, "A");
  const inv = resolveEncounter(0, card("a", "Min", 0, 0, 0), "stronghold", card("b", "Max", 99, 99, 99), "entryfrag");
  assert.equal(inv.outcome, "B");
});

test("CASO EXTREMO · el OVR alto NO gana un enfrentamiento por sí solo", () => {
  // A tiene OVR 93 pero un Stronghold pésimo; B tiene OVR 70 y un Entryfrag altísimo.
  const r = resolveEncounter(0, card("a", "Estrella", 20, 99, 99, 93), "stronghold", card("b", "Nicho", 50, 40, 85, 70), "entryfrag");
  assert.equal(r.outcome, "B", "el OVR no debe decidir la comparación");
});

test("CASO EXTREMO · cartas de variantes y equipos distintos conviven sin problema", () => {
  const r = resolveCombat(A, B, planFor(A, B));
  assert.ok(new Set(A.cards.map((c) => c.variantId)).size >= 2, "el mazo real mezcla variantes");
  assert.ok(new Set(A.cards.map((c) => c.team)).size >= 2, "el mazo real mezcla equipos");
  assert.deepEqual(r.errors, []);
});
