/**
 * FASE 32 · DECK BUILDER 2.0 — dominio de presentación alrededor del validador canónico.
 *
 * Tests 1–52 del brief (reglas canónicas, constructor, estadísticas, comparador, sugerencia y
 * autocompletado) + nombres, cuerpo estricto y panel de colección. Cartas SINTÉTICAS: el dominio del
 * constructor no consulta el catálogo salvo para la variante (rareza), que es real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS } from "@/data/catalog";
import {
  createDuelDeck, duelDeckStatus, validateDuelDeck, DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES,
} from "@/domain/cardgame";
import type { RoleId, VariantId } from "@/domain/cards/types";
import {
  autocomplete, buildBoard, candidatesForSlot, checkDeckName, checkDraft, compareForSlot, compatibleSlots, copyName,
  countLabel, deltaText, describeIssues, draftCards, indexPool, moveInRole, nextTeamName, poolResolver, readTeam,
  suggestForSlot, teamStats, tryAdd, tryPlace, tryRemove, tryReplace, actionForCard,
  AUTOCOMPLETE_FAIL_TEXT, DUPLICATE_PLAYER_TEXT, LOST_CARD_TEXT, SUGGEST_REASON,
  type BuilderCard, type Pool,
} from "./builder";
import { filterPool, EMPTY_FILTER } from "./pool";
import { parseDeckRequest } from "./request";

const V: VariantId = CARDS[0].variantId as VariantId;
const V2: VariantId = (CARDS.find((c) => c.variantId !== V)?.variantId ?? V) as VariantId;

let seq = 0;
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Carta sintética: OVR x ⇒ Stronghold x, Gamesense x−2, Entryfrag x−4 (salvo que se diga otra cosa). */
function card(role: RoleId, player: string, ovr: number, o: Partial<BuilderCard> = {}): BuilderCard {
  seq++;
  return {
    uid: u(seq), cardId: `${player}-${o.variantId ?? V}-${o.cardId ?? "a"}`, playerId: player, nick: player, team: "Team A",
    country: "ES", role, region: "EMEA", variantId: V, ovr, combat: { stronghold: ovr, gamesense: ovr - 2, entryfrag: ovr - 4 },
    serial: null, dataVersion: "2026", statBoost: 0, obtainedAt: seq, ...o,
  };
}

const SHORT: Record<RoleId, string> = { Duelista: "d", Controlador: "c", Iniciador: "i", Centinela: "s", Flex: "f" };

/** Tres jugadores por rol, OVR 80 / 75 / 70. */
function basePool(): BuilderCard[] {
  const out: BuilderCard[] = [];
  for (const r of DUEL_ROLES) for (const [k, ovr] of [[1, 80], [2, 75], [3, 70]] as const) out.push(card(r, `${SHORT[r]}${k}`, ovr));
  return out;
}

const CARDS_A = basePool();
const POOL: Pool = indexPool(CARDS_A);
const of = (player: string) => CARDS_A.find((c) => c.playerId === player)!;
/** Las dos mejores de cada rol. */
const FULL = DUEL_ROLES.flatMap((r) => [of(`${SHORT[r]}1`).uid, of(`${SHORT[r]}2`).uid]);
/** 6 cartas: 2 Duelista, 1 Controlador, 1 Iniciador, 2 Centinela. */
const PARTIAL = [of("d1").uid, of("d2").uid, of("c1").uid, of("i1").uid, of("s1").uid, of("s2").uid];

/* ───────────────────────── 1–10 · reglas canónicas ───────────────────────── */

test("1 · tamaño canónico: 10 cartas y 10 huecos", () => {
  assert.equal(DUEL_DECK_SIZE, 10);
  assert.equal(buildBoard([], POOL).slots.length, DUEL_DECK_SIZE);
});

test("2 · composición canónica: 2 por rol en el orden del dominio, sacada de DUEL_COMPOSITION", () => {
  const board = buildBoard([], POOL);
  for (const r of DUEL_ROLES) {
    assert.equal(DUEL_COMPOSITION[r], 2);
    assert.equal(board.byRole[r].length, DUEL_COMPOSITION[r]);
  }
  assert.deepEqual([...new Set(board.slots.map((s) => s.role))], DUEL_ROLES);
});

test("3 · Flex es un ROL de jugador, no un comodín: un hueco Flex solo admite cartas Flex", () => {
  const flexSlot = buildBoard([], POOL).byRole.Flex[0];
  const r = tryPlace([], flexSlot, of("d1").uid, POOL);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "WRONG_ROLE");
  assert.ok(tryPlace([], flexSlot, of("f1").uid, POOL).ok);
  const fits = compatibleSlots(of("f1"), [], POOL, buildBoard([], POOL));
  assert.deepEqual(fits.map((f) => f.key), ["Flex-1", "Flex-2"]);
});

test("4 · jugador repetido rechazado con frase humana y la carta en conflicto", () => {
  const variant = card("Duelista", "d1", 88, { cardId: "b", variantId: V2 });
  const pool = indexPool([...CARDS_A, variant]);
  const r = tryAdd([of("d1").uid], variant.uid, pool);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === "DUPLICATE_PLAYER" && r.reason === DUPLICATE_PLAYER_TEXT && r.conflictUid === of("d1").uid);
});

test("5 · dos variantes del mismo jugador no se cuelan: el validador canónico lo marca y se explica", () => {
  const variant = card("Duelista", "d1", 88, { cardId: "b", variantId: V2 });
  const pool = indexPool([...CARDS_A, variant]);
  const check = checkDraft([of("d1").uid, variant.uid], pool);
  assert.ok(check.validation.errors.some((e) => e.code === "DUPLICATE_PLAYER"));
  assert.equal(check.status, "INVALID");
  const issue = describeIssues(check, [of("d1").uid, variant.uid], pool).find((i) => i.code === "DUPLICATE_PLAYER");
  assert.ok(issue && issue.message.startsWith(DUPLICATE_PLAYER_TEXT));
  assert.equal(issue!.uids.length, 2);
});

test("6 · carta poseída aceptada", () => {
  const r = tryAdd([], of("c1").uid, POOL);
  assert.ok(r.ok);
  assert.equal(checkDraft(r.ok ? r.uids : [], POOL).status, "INCOMPLETE");
});

test("7 · carta ajena rechazada (no está en la colección del servidor)", () => {
  const foreign = card("Duelista", "zz", 90); // no se añade al pool
  const r = tryAdd([], foreign.uid, POOL);
  assert.ok(!r.ok && r.code === "NOT_OWNED");
  const check = checkDraft([foreign.uid], POOL);
  assert.ok(check.validation.errors.some((e) => e.code === "CARD_NOT_OWNED"));
  assert.deepEqual(check.lostUids, [foreign.uid]);
});

test("8 · carta inexistente rechazada igual que una ajena", () => {
  const ghost = "11111111-1111-4111-8111-111111111111";
  assert.ok(!tryAdd([], ghost, POOL).ok);
  const issues = describeIssues(checkDraft([ghost], POOL), [ghost], POOL);
  assert.ok(issues.some((i) => i.kind === "lost" && i.message === LOST_CARD_TEXT));
});

test("9 · equipo completo válido: READY_FOR_DUEL y todos los huecos FILLED", () => {
  const check = checkDraft(FULL, POOL);
  assert.ok(check.ready);
  assert.equal(check.status, "READY_FOR_DUEL");
  assert.ok(buildBoard(FULL, POOL).slots.every((s) => s.state === "FILLED"));
});

test("10 · equipo incompleto no válido", () => {
  const check = checkDraft(PARTIAL, POOL);
  assert.equal(check.ready, false);
  assert.equal(check.status, "INCOMPLETE");
});

/* ───────────────────────── 11–20 · constructor ───────────────────────── */

test("11 · borrador vacío", () => {
  const check = checkDraft([], POOL);
  assert.equal(check.status, "EMPTY");
  assert.equal(countLabel(0), "0 / 10 CARTAS");
  assert.ok(buildBoard([], POOL).slots.every((s) => s.state === "EMPTY" && s.card === null));
});

test("12 · añadir carta: cae en el primer hueco libre de su rol", () => {
  const r = tryAdd(PARTIAL, of("c2").uid, POOL);
  assert.ok(r.ok);
  const board = buildBoard(r.ok ? r.uids : [], POOL);
  assert.equal(board.byRole.Controlador[1].uid, of("c2").uid);
  const action = actionForCard(of("c2"), PARTIAL, POOL, buildBoard(PARTIAL, POOL));
  assert.deepEqual(action, { kind: "add", slotKey: "Controlador-2" });
});

test("13 · quitar carta siempre es posible", () => {
  const r = tryRemove(FULL, of("f1").uid);
  assert.ok(r.ok && r.uids.length === 9 && !r.uids.includes(of("f1").uid));
  assert.ok(!tryRemove(FULL, "nope").ok);
});

test("14 · sustituir carta conserva la posición del hueco", () => {
  const r = tryReplace(FULL, of("d2").uid, of("d3").uid, POOL);
  assert.ok(r.ok);
  assert.equal(r.ok && r.uids.indexOf(of("d3").uid), FULL.indexOf(of("d2").uid));
  assert.ok(checkDraft(r.ok ? r.uids : [], POOL).ready);
});

test("15 · huecos compatibles: añadir en el libre; con el rol lleno, sustituir en los ocupados", () => {
  const board = buildBoard(PARTIAL, POOL);
  // c3 puede entrar en el hueco libre (añadir) y también sustituir a c1: las dos cosas son legales.
  assert.deepEqual(compatibleSlots(of("c3"), PARTIAL, POOL, board), [{ key: "Controlador-1", mode: "replace" }, { key: "Controlador-2", mode: "add" }]);
  assert.deepEqual(actionForCard(of("c3"), PARTIAL, POOL, board), { kind: "add", slotKey: "Controlador-2" }, "con hueco libre, pulsar la carta AÑADE");
  assert.deepEqual(compatibleSlots(of("d3"), PARTIAL, POOL, board).map((f) => `${f.key}:${f.mode}`), ["Duelista-1:replace", "Duelista-2:replace"]);
  const action = actionForCard(of("d3"), PARTIAL, POOL, board);
  assert.equal(action.kind, "replace");
});

test("16 · hueco incompatible: otro rol ⇒ bloqueado, y nunca se resalta", () => {
  const board = buildBoard(PARTIAL, POOL);
  const slot = board.byRole.Iniciador[1];
  const r = tryPlace(PARTIAL, slot, of("c3").uid, POOL);
  assert.ok(!r.ok && r.code === "WRONG_ROLE");
  assert.ok(!compatibleSlots(of("c3"), PARTIAL, POOL, board).some((f) => f.key === slot.key));
});

test("17 · rol faltante en lenguaje humano", () => {
  const check = checkDraft(PARTIAL, POOL);
  const missing = describeIssues(check, PARTIAL, POOL).find((i) => i.kind === "missing");
  assert.equal(missing?.message, "Faltan: 1 Controlador · 1 Iniciador · 2 Flex");
});

test("18 · jugador repetido en lenguaje humano, nunca el código", () => {
  const variant = card("Flex", "f1", 90, { cardId: "b", variantId: V2 });
  const pool = indexPool([...CARDS_A, variant]);
  const uids = [of("f1").uid, variant.uid];
  const msgs = describeIssues(checkDraft(uids, pool), uids, pool).map((i) => i.message);
  assert.ok(msgs.some((m) => m === `${DUPLICATE_PLAYER_TEXT} (f1)`));
  assert.ok(!msgs.some((m) => /DUPLICATE|INVALID_DECK/.test(m)));
  const board = buildBoard(uids, pool);
  assert.ok(board.byRole.Flex.every((s) => s.state === "INVALID"));
});

test("19 · el veredicto ES el del validador canónico: estado idéntico y añadir ⇔ no deja el equipo INVALID", () => {
  const variant = card("Centinela", "s3", 95, { cardId: "b", variantId: V2 });
  const pool = indexPool([...CARDS_A, variant]);
  const starts = [[], PARTIAL, FULL.slice(0, 9), [of("s1").uid, of("s3").uid]];
  for (const start of starts) {
    const deck = createDuelDeck({ id: "x", name: "x", cards: start, now: 0 });
    const canonical = validateDuelDeck(deck, poolResolver(pool));
    const mine = checkDraft(start, pool);
    assert.deepEqual(mine.validation, canonical);
    assert.equal(mine.status, duelDeckStatus(deck, canonical));
    for (const c of pool.values()) {
      if (start.includes(c.uid) || start.length >= DUEL_DECK_SIZE) continue;
      const after = [...start, c.uid];
      const afterStatus = duelDeckStatus(createDuelDeck({ id: "x", name: "x", cards: after, now: 0 }), validateDuelDeck(createDuelDeck({ id: "x", name: "x", cards: after, now: 0 }), poolResolver(pool)));
      assert.equal(tryAdd(start, c.uid, pool).ok, afterStatus !== "INVALID", `${c.nick} sobre ${start.length}`);
    }
  }
});

test("20 · no hay un segundo motor de reglas: el constructor importa el validador y no copia cuotas", () => {
  const src = readFileSync(join(process.cwd(), "src/domain/deckBuilder/builder.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/validateDuelDeck/.test(src) && /from "@\/domain\/cardgame"/.test(src));
  assert.ok(!/Duelista:\s*2|===\s*2\b|DeckEngine2|TeamBuilderRules|CompetitiveDeckValidator|PrivateDeckValidator/.test(src));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [e.name]));
  const names = walk(join(process.cwd(), "src")).join("\n");
  assert.ok(!/DeckEngine2|TeamBuilderRules|CompetitiveDeckValidator|PrivateDeckValidator/.test(names));
});

/* ───────────────────────── 21–30 · estadísticas ───────────────────────── */

const FULL_STATS = teamStats(draftCards(FULL, POOL));

test("21 · OVR medio", () => { assert.equal(FULL_STATS.ovr, 77.5); });
test("22 · Stronghold medio (stat canónica del trío)", () => { assert.equal(FULL_STATS.stronghold, 77.5); });
test("23 · Gamesense medio", () => { assert.equal(FULL_STATS.gamesense, 75.5); });
test("24 · Entryfrag medio", () => { assert.equal(FULL_STATS.entryfrag, 73.5); });

test("25 · estadísticas de un equipo incompleto: medias de las presentes; sin cartas, nulas", () => {
  const s = teamStats(draftCards([of("d1").uid, of("c2").uid, of("f3").uid], POOL));
  assert.equal(s.count, 3);
  assert.equal(s.complete, false);
  assert.equal(s.ovr, 75);
  const empty = teamStats([]);
  assert.deepEqual([empty.ovr, empty.stronghold, empty.gamesense, empty.entryfrag], [null, null, null, null]);
  assert.deepEqual(readTeam(empty), { highest: null, lowest: null, even: false, weakestRole: null });
});

test("26 · media más alta determinista (empate ⇒ primera en el orden canónico)", () => {
  assert.equal(readTeam(FULL_STATS).highest?.stat, "stronghold");
  const tie = [card("Duelista", "t1", 70, { combat: { stronghold: 80, gamesense: 80, entryfrag: 60 } })];
  assert.equal(readTeam(teamStats(tie)).highest?.stat, "stronghold");
  const even = [card("Duelista", "t2", 70, { combat: { stronghold: 70, gamesense: 70, entryfrag: 70 } })];
  assert.equal(readTeam(teamStats(even)).even, true);
});

test("27 · media más baja determinista", () => {
  assert.equal(readTeam(FULL_STATS).lowest?.stat, "entryfrag");
  const tie = [card("Duelista", "t3", 70, { combat: { stronghold: 90, gamesense: 60, entryfrag: 60 } })];
  assert.equal(readTeam(teamStats(tie)).lowest?.stat, "gamesense");
});

test("28 · sin química inventada en el constructor", () => {
  for (const f of ["src/domain/deckBuilder/builder.ts", "src/components/duel/DeckBuilder.tsx", "src/components/duel/deck/AnalysisPanel.tsx", "src/components/duel/deck/TeamHub.tsx", "src/components/duel/deck/ComparePanel.tsx"]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.ok(!/chemistry|synergy|sinergia|qu[ií]mica/i.test(src), f);
  }
});

test("29 · sin «poder de equipo»: las únicas cifras agregadas son OVR y el trío", () => {
  assert.deepEqual(Object.keys(FULL_STATS).sort(), ["byRole", "complete", "count", "entryfrag", "gamesense", "ovr", "stronghold"]);
  for (const f of ["src/components/duel/deck/AnalysisPanel.tsx", "src/components/duel/deck/TeamHub.tsx"]) {
    const src = readFileSync(join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/team power|poder de equipo|attack power|defense power|meta score|team rating|win ?rate|% de victoria/i.test(src), f);
  }
});

test("30 · el serial no cambia ninguna cifra", () => {
  const a = card("Duelista", "q1", 81);
  const b = { ...a, serial: 1 };
  const c = { ...a, serial: 9999 };
  assert.deepEqual(teamStats([a]), teamStats([b]));
  assert.deepEqual(teamStats([b]), teamStats([c]));
});

/* ───────────────────────── 31–36 · comparador ───────────────────────── */

test("31 · comparar en el mismo rol: filas OVR, trío y rareza", () => {
  const v = compareForSlot(FULL, POOL, of("d2").uid, of("d3").uid)!;
  assert.equal(v.role, "Duelista");
  assert.deepEqual(v.rows.map((r) => r.key), ["ovr", "stronghold", "gamesense", "entryfrag", "rank"]);
  assert.equal(v.legal, true);
});

test("32 · diferencias por estadística, con signo en texto", () => {
  const v = compareForSlot(FULL, POOL, of("d2").uid, of("d3").uid)!;
  const row = (k: string) => v.rows.find((r) => r.key === k)!;
  assert.deepEqual([row("stronghold").delta, row("gamesense").delta, row("entryfrag").delta], [-5, -5, -5]);
  assert.equal(deltaText(4), "+4");
  assert.equal(deltaText(-2), "−2");
  assert.equal(deltaText(0), "=");
});

test("33 · diferencia de OVR", () => {
  const v = compareForSlot(FULL, POOL, of("d2").uid, of("d3").uid)!;
  assert.equal(v.rows[0].delta, -5);
  assert.equal(v.rows[0].current, 75);
  assert.equal(v.rows[0].candidate, 70);
});

test("34 · impacto en las medias del equipo antes → después", () => {
  const v = compareForSlot(FULL, POOL, of("d2").uid, of("d3").uid)!;
  const ovr = v.impact.find((r) => r.key === "ovr")!;
  assert.deepEqual([ovr.before, ovr.after, ovr.delta], [77.5, 77, -0.5]);
  const add = compareForSlot(PARTIAL, POOL, null, of("c2").uid)!;
  assert.equal(add.current, null);
  assert.ok(add.rows.every((r) => r.current === null && r.delta === null));
  assert.ok(add.impact.length === 4);
});

test("35 · candidata ilegal: no se puede confirmar, sin impacto y fuera de las sugerencias", () => {
  const v = compareForSlot(FULL, POOL, of("d2").uid, of("c3").uid)!;
  assert.equal(v.legal, false);
  assert.deepEqual(v.impact, []);
  assert.equal(v.nextUids, null);
});

test("36 · candidata del mismo jugador que otro hueco: marcada ilegal en la lista", () => {
  const variant = card("Duelista", "d1", 99, { cardId: "b", variantId: V2 });
  const pool = indexPool([...CARDS_A, variant]);
  const slot = buildBoard(FULL, pool).byRole.Duelista[1]; // ocupado por d2
  const cands = candidatesForSlot(slot, FULL, pool);
  const bad = cands.find((c) => c.card.uid === variant.uid)!;
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, DUPLICATE_PLAYER_TEXT);
  assert.ok(cands.findIndex((c) => !c.ok) > cands.findIndex((c) => c.ok), "las legales van primero");
});

/* ───────────────────────── 37–42 · sugerencia ───────────────────────── */

test("37 · sugerencia solo con cartas poseídas", () => {
  const slot = buildBoard(PARTIAL, POOL).byRole.Flex[0];
  const s = suggestForSlot(slot, PARTIAL, POOL);
  assert.ok(s.card && POOL.has(s.card.uid));
});

test("38 · sugerencia solo legal", () => {
  const variant = card("Flex", "f9", 99, { dataVersion: "2025" }); // otra temporada: ilegal junto al resto
  const pool = indexPool([...CARDS_A, variant]);
  const slot = buildBoard(PARTIAL, pool).byRole.Flex[0];
  const s = suggestForSlot(slot, PARTIAL, pool);
  assert.notEqual(s.card?.uid, variant.uid);
  assert.equal(s.card?.uid, of("f1").uid);
});

test("39 · sugerencia determinista (mismo resultado con otro orden de la colección)", () => {
  const slot = buildBoard(PARTIAL, POOL).byRole.Flex[0];
  const a = suggestForSlot(slot, PARTIAL, POOL);
  const b = suggestForSlot(slot, PARTIAL, indexPool([...CARDS_A].reverse()));
  assert.equal(a.card?.uid, b.card?.uid);
});

test("40 · regla documentada: mayor OVR; empate ⇒ nick; y un hueco ocupado solo se mejora", () => {
  const x = card("Iniciador", "bbb", 90);
  const y = card("Iniciador", "aaa", 90);
  const pool = indexPool([...CARDS_A, x, y]);
  const slot = buildBoard(PARTIAL, pool).byRole.Iniciador[1];
  const s = suggestForSlot(slot, PARTIAL, pool);
  assert.equal(s.card?.nick, "aaa");
  assert.equal(s.reason, SUGGEST_REASON);
  const filled = buildBoard(FULL, POOL).byRole.Duelista[0]; // d1, OVR 80: no hay mejor
  assert.equal(suggestForSlot(filled, FULL, POOL).card, null);
});

test("41 · sin IA: ni red ni modelos en el dominio del constructor", () => {
  const src = readFileSync(join(process.cwd(), "src/domain/deckBuilder/builder.ts"), "utf8");
  assert.ok(!/fetch\(|openai|anthropic|\bllm\b|Math\.random/i.test(src));
  assert.equal(SUGGEST_REASON, "Mejor OVR disponible para este hueco.");
});

test("42 · nunca sugiere una carta no disponible", () => {
  const ghost = "22222222-2222-4222-8222-222222222222";
  const uids = [...PARTIAL, ghost];
  const slot = buildBoard(uids, POOL).byRole.Flex[0];
  const s = suggestForSlot(slot, uids, POOL);
  assert.ok(s.card && s.card.uid !== ghost && POOL.has(s.card.uid));
});

/* ───────────────────────── 43–52 · autocompletar ───────────────────────── */

test("43 · completa un equipo sencillo", () => {
  const r = autocomplete(PARTIAL, POOL);
  assert.ok(r.ok);
  assert.equal(r.ok && r.uids.length, 10);
});

test("44 · respeta las cartas fijadas", () => {
  const pinned = [of("d2").uid, of("s2").uid];
  const r = autocomplete(pinned, POOL, { pinned: new Set(pinned) });
  assert.ok(r.ok && pinned.every((p) => r.uids.includes(p)));
  const sub = autocomplete([of("d3").uid], POOL); // por defecto todas fijadas
  assert.ok(sub.ok && sub.uids.includes(of("d3").uid));
});

test("45 · respeta los roles", () => {
  const r = autocomplete([], POOL);
  assert.ok(r.ok);
  const cards = draftCards(r.ok ? r.uids : [], POOL);
  for (const role of DUEL_ROLES) assert.equal(cards.filter((c) => c.role === role).length, DUEL_COMPOSITION[role]);
});

test("46 · respeta el jugador único (aunque las variantes tengan más OVR)", () => {
  const extra = [card("Centinela", "s1", 99, { cardId: "b", variantId: V2 }), card("Centinela", "s1", 98, { cardId: "c" })];
  const pool = indexPool([...CARDS_A, ...extra]);
  const r = autocomplete([], pool);
  assert.ok(r.ok);
  const players = draftCards(r.ok ? r.uids : [], pool).map((c) => c.playerId);
  assert.equal(new Set(players).size, players.length);
});

test("47 · respeta la propiedad: solo uids de la colección", () => {
  const r = autocomplete([], POOL);
  assert.ok(r.ok && r.uids.every((x) => POOL.has(x)));
});

test("48 · determinista", () => {
  const a = autocomplete(PARTIAL, POOL);
  const b = autocomplete(PARTIAL, indexPool([...CARDS_A].reverse()));
  assert.deepEqual(a.ok && [...a.uids].sort(), b.ok && [...b.uids].sort());
});

test("49 · encuentra solución donde el voraz ingenuo se bloquea (temporadas y variantes)", () => {
  // Temporada 2027: las mejores OVR, pero SIN ningún Flex. Temporada 2026: equipo completo más flojo.
  const s27 = DUEL_ROLES.filter((r) => r !== "Flex").flatMap((r) => [card(r, `${SHORT[r]}x1`, 95, { dataVersion: "2027" }), card(r, `${SHORT[r]}x2`, 94, { dataVersion: "2027" })]);
  // Y un jugador con dos variantes arriba del todo en Iniciador.
  const twin = [card("Iniciador", "twin", 99, { cardId: "a" }), card("Iniciador", "twin", 98, { cardId: "b", variantId: V2 })];
  const all = [...CARDS_A, ...s27, ...twin];
  const pool = indexPool(all);
  // Voraz ingenuo: las 2 de mayor OVR de cada rol, sin mirar nada más.
  const naive = DUEL_ROLES.flatMap((r) => all.filter((c) => c.role === r).sort((a, b) => b.ovr - a.ovr).slice(0, 2).map((c) => c.uid));
  assert.equal(checkDraft(naive, pool).ready, false, "el voraz ingenuo produce un equipo ilegal");
  const r = autocomplete([], pool);
  assert.ok(r.ok, "la búsqueda con retroceso sí encuentra equipo");
  assert.ok(checkDraft(r.ok ? r.uids : [], pool).ready);
});

test("50 · colección insuficiente ⇒ fallo honesto con el déficit por rol", () => {
  const scarce = CARDS_A.filter((c) => c.role !== "Centinela" || c.playerId === "s1");
  const r = autocomplete([], indexPool(scarce));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === AUTOCOMPLETE_FAIL_TEXT);
  assert.deepEqual(!r.ok && r.shortages, [{ role: "Centinela", need: 2, available: 1 }]);
});

test("51 · nunca inventa cartas", () => {
  const r = autocomplete(PARTIAL, POOL);
  assert.ok(r.ok && r.added.every((x) => POOL.has(x)) && r.uids.every((x) => PARTIAL.includes(x) || r.added.includes(x)));
});

test("52 · el resultado pasa el validador canónico", () => {
  for (const start of [[], PARTIAL, [of("f3").uid]]) {
    const r = autocomplete(start, POOL);
    assert.ok(r.ok);
    const deck = createDuelDeck({ id: "a", name: "a", cards: r.ok ? r.uids : [], now: 0 });
    assert.equal(validateDuelDeck(deck, poolResolver(POOL)).valid, true);
  }
});

/* ───────────────────────── extra · mover, nombres, cuerpo estricto, panel ───────────────────────── */

test("mover arriba/abajo dentro del rol intercambia los dos huecos de ese rol y nada más", () => {
  const next = moveInRole(FULL, of("d2").uid, -1, POOL);
  const board = buildBoard(next, POOL);
  assert.equal(board.byRole.Duelista[0].uid, of("d2").uid);
  assert.equal(board.byRole.Controlador[0].uid, of("c1").uid);
  assert.deepEqual(moveInRole(FULL, of("d1").uid, -1, POOL), FULL, "el primero no sube más");
});

test("nombres: texto plano corto, normalizado, sin HTML; «Equipo N» y «copia»", () => {
  assert.deepEqual(checkDeckName("  Equipo   Rojo "), { ok: true, name: "Equipo Rojo" });
  assert.equal(checkDeckName("<b>x</b>").ok, false);
  assert.equal(checkDeckName("a".repeat(41)).ok, false);
  assert.equal(checkDeckName("").ok, false);
  assert.equal(checkDeckName(42).ok, false);
  assert.equal(nextTeamName(["Equipo 1", "equipo 2"]), "Equipo 3");
  assert.equal(copyName("Principal", ["Principal"]), "Principal copia");
  assert.equal(copyName("Principal", ["Principal", "Principal copia"]), "Principal copia 2");
  assert.ok(copyName("x".repeat(40), []).length <= 40);
});

test("cuerpo estricto: claves desconocidas, UUID y cartas no-UUID ⇒ rechazo", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(parseDeckRequest({ action: "set_active", id, userId: id }).ok, false);
  assert.equal(parseDeckRequest({ action: "set_active", id: "nope" }).ok, false);
  assert.equal(parseDeckRequest({ action: "save", name: "a", cardUids: ["x"] }).ok, false);
  assert.equal(parseDeckRequest({ action: "save_composition", id, name: "a", cardUids: [], baseVersion: "ayer" }).ok, false);
  assert.equal(parseDeckRequest({ action: "save", name: "a", cardUids: Array.from({ length: 11 }, () => id) }).ok, false);
  assert.equal(parseDeckRequest([]).ok, false);
  assert.equal(parseDeckRequest({ action: "hack" }).ok, false);
  const ok = parseDeckRequest({ action: "save_composition", id, name: "a", cardUids: [id], baseVersion: "2026-09-14T10:11:12.123456+00:00" });
  assert.ok(ok.ok && ok.req.action === "save_composition");
  const del = parseDeckRequest({ action: "delete", id });
  assert.ok(del.ok && del.req.action === "delete" && del.req.confirmActive === false && del.req.expectedVersion === null);
});

test("panel de colección: reutiliza el filtro de Collection 2.0 y ordena por lo pedido", () => {
  const extra = card("Duelista", "d1", 60, { cardId: "a", team: "Team B", obtainedAt: 99999 }); // segunda copia de d1
  const cards = [...CARDS_A, { ...extra, cardId: of("d1").cardId }];
  assert.equal(filterPool(cards, { ...EMPTY_FILTER, text: "c2" }, "ovr").map((c) => c.playerId).join(), "c2");
  assert.ok(filterPool(cards, { ...EMPTY_FILTER, role: "Flex" }, "ovr").every((c) => c.role === "Flex"));
  assert.deepEqual(filterPool(cards, { ...EMPTY_FILTER, team: "Team B" }, "ovr").map((c) => c.uid), [extra.uid]);
  assert.equal(filterPool(cards, { ...EMPTY_FILTER, duplicates: true }, "ovr").length, 2);
  assert.equal(filterPool(cards, EMPTY_FILTER, "recent")[0].uid, extra.uid);
  assert.equal(filterPool(cards, EMPTY_FILTER, "ovr")[0].ovr, 80);
  assert.ok(filterPool(cards, { ...EMPTY_FILTER, minOvr: 75 }, "name").every((c) => c.ovr >= 75));
});
