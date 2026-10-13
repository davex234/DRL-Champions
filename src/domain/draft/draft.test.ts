/**
 * DRAFT GAUNTLET · DOMINIO (Fase 39) — generación determinista, legalidad por construcción, transiciones de la run,
 * redacción de la foto y presentación pura. El validador de mazo es el CANÓNICO (`draftDeckCheck` → `validateDuelDeck`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import type { CardDef } from "@/domain/cards/types";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame/types";
import { createRng } from "@/domain/cardgame/opponent/rng";
import { DIFFICULTY_PROFILE } from "@/domain/cardgame/opponent/bots";
import {
  buildDraftPool, distinctPlayers, eligibleDataVersion, hashSeed, offerFor, poolIsSolvable, rivalDeckFor, roleOrderFor,
  shuffle, simulateDraft, type DraftPool,
} from "./generate";
import {
  applyPick, createRunState, currentOffer, currentRole, findAction, isDraftComplete, outcomeForHuman, recordAction,
  rivalsFor, settleTransition, stageBoard, toRunView, type DraftRunRow, type DraftRunState,
} from "./run";
import {
  ACTIVE_STATUSES, DRAFT_MATCH_MODE, DRAFT_MODE_NAME, DRAFT_OPTIONS, DRAFT_PICKS, DRAFT_RULES_VERSION,
  FINAL_STATUSES, GAUNTLET_STAGES, MAX_ACTION_LOG, RIVAL_NAMES, STAGE_DIFFICULTY, STAGE_LABEL, isActiveStatus,
} from "./rules";
import { buildDraftSnapshot, draftCardDTO, winsOf } from "./snapshot";
import { draftEconomyView } from "./economy";
import { draftDeckCheck, draftRivalCheck, draftCardUid, DRAFT_GAUNTLET_MODE } from "@/server/services/duels";

const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const DV = eligibleDataVersion(INPUT)!;
const POOL = buildDraftPool(INPUT, DV);
const RUN_ID = "11111111-2222-4333-8444-555555555555";

function draftAll(pool: DraftPool, seed: number, choose = 0): DraftRunState {
  let s = createRunState(pool, seed);
  while (!isDraftComplete(s)) {
    const offer = currentOffer(s);
    const r = applyPick(s, pool, seed, offer[Math.min(choose, offer.length - 1)]);
    assert.ok(r.ok, `pick ${s.picks.length}`);
    s = r.state;
  }
  return s;
}

/* ─────────────── reglas del modo ─────────────── */

test("D01 · nombre, versión de reglas y modo de partida fijados", () => {
  assert.equal(DRAFT_MODE_NAME, "DRAFT GAUNTLET");
  assert.equal(DRAFT_RULES_VERSION, "draft-gauntlet-1");
  assert.equal(DRAFT_MATCH_MODE, "DRAFT_GAUNTLET");
  assert.equal(DRAFT_GAUNTLET_MODE, DRAFT_MATCH_MODE);
});

test("D02 · 10 elecciones × 3 opciones, 5 combates", () => {
  assert.deepEqual([DRAFT_PICKS, DRAFT_OPTIONS, GAUNTLET_STAGES], [10, 3, 5]);
});

test("D03 · dificultades canónicas Fácil, Normal, Normal, Difícil, Difícil con coeficientes 0 / 0,5 / 0,85", () => {
  assert.deepEqual(STAGE_DIFFICULTY, ["EASY", "NORMAL", "NORMAL", "HARD", "HARD"]);
  const coef = (d: keyof typeof DIFFICULTY_PROFILE) => Object.values(DIFFICULTY_PROFILE[d]).find((v) => typeof v === "number");
  assert.deepEqual(["EASY", "NORMAL", "HARD"].map((d) => coef(d as "EASY")), [0, 0.5, 0.85]);
});

test("D04 · etiquetas del mapa 01–04 y FINAL; rivales con nombres originales NEXUS", () => {
  assert.deepEqual(STAGE_LABEL, ["01", "02", "03", "04", "FINAL"]);
  assert.equal(RIVAL_NAMES.length, 5);
  for (const n of RIVAL_NAMES) assert.match(n, /^NEXUS /);
});

test("D05 · F72: la economía del modo es la tabla de `economy.ts` (entrada 2.000; 0/200/500/1.000/1.600/2.100)", () => {
  const e = draftEconomyView();
  assert.equal(e.entryFee, 2_000);
  assert.deepEqual(e.table.map((l) => l.credits), [0, 200, 500, 1_000, 1_600, 2_100]);
  assert.deepEqual(e.table.map((l) => l.jackpot), [false, false, false, false, false, true]);
});

test("D06 · estados activos y finales son disjuntos y cubren los seis", () => {
  assert.equal(ACTIVE_STATUSES.length + FINAL_STATUSES.length, 6);
  for (const s of ACTIVE_STATUSES) { assert.ok(isActiveStatus(s)); assert.ok(!FINAL_STATUSES.includes(s)); }
  for (const s of FINAL_STATUSES) assert.ok(!isActiveStatus(s));
});

/* ─────────────── semilla y orden de roles ─────────────── */

test("D07 · hashSeed es estable y distingue partes", () => {
  assert.equal(hashSeed(1, "roles"), hashSeed(1, "roles"));
  assert.notEqual(hashSeed(1, "roles"), hashSeed(2, "roles"));
  assert.notEqual(hashSeed(1, "offer", 0), hashSeed(1, "offer", 1));
  assert.ok(hashSeed("x") >= 0 && hashSeed("x") < 2 ** 32);
});

test("D08 · shuffle es una permutación y no muta la entrada", () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(createRng(7), src).value;
  assert.deepEqual([...out].sort(), [...src].sort());
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("D09 · orden de roles: exactamente 2 de cada rol (Flex incluido)", () => {
  for (let seed = 0; seed < 300; seed++) {
    const order = roleOrderFor(seed);
    assert.equal(order.length, 10);
    for (const r of DUEL_ROLES) assert.equal(order.filter((x) => x === r).length, DUEL_COMPOSITION[r]);
  }
});

test("D10 · orden de roles determinista por semilla y variado entre semillas", () => {
  assert.deepEqual(roleOrderFor(42), roleOrderFor(42));
  const distinct = new Set(Array.from({ length: 200 }, (_, s) => roleOrderFor(s).join(",")));
  assert.ok(distinct.size > 150, `solo ${distinct.size} órdenes distintos`);
});

/* ─────────────── pool ─────────────── */

test("D11 · pool real: una sola versión de datos, resoluble y con ≥2 jugadores por rol", () => {
  assert.ok(DV);
  assert.ok(poolIsSolvable(POOL));
  for (const r of DUEL_ROLES) assert.ok(distinctPlayers(POOL.byRole[r]) >= 2);
  for (const c of POOL.byId.values()) assert.equal(REG.card(c.cardId)!.dataVersion ?? "", DV);
});

test("D12 · el pool solo admite cartas con combate y rol de duelo", () => {
  for (const c of POOL.byId.values()) {
    assert.ok(REG.card(c.cardId)!.combat);
    assert.ok((DUEL_ROLES as readonly string[]).includes(c.role));
    // El rol de la carta manda (catálogo diseñado: la carta impresa fija su rol); si no lo trae, el del jugador.
    assert.equal(REG.card(c.cardId)!.role ?? REG.player(c.playerId)!.role, c.role);
  }
});

test("D13 · lo no ofrecible (retirado) no se ofrece pero sigue resolviendo", () => {
  const retired = REG.cards[0].id;
  const pool = buildDraftPool({ ...INPUT, droppable: (id) => id !== retired }, DV);
  assert.ok(pool.byId.has(retired));
  assert.ok(!Object.values(pool.byRole).flat().some((c) => c.cardId === retired));
});

test("D14 · versión de datos elegida = la más común; mezclas descartadas", () => {
  const fake = REG.cards.slice(0, 5).map((c) => ({ ...c, dataVersion: "OLD" }) as CardDef);
  const cards = [...REG.cards.slice(5), ...fake];
  const input = { ...INPUT, cards };
  assert.equal(eligibleDataVersion(input), DV);
  const pool = buildDraftPool(input, DV);
  for (const f of fake) assert.ok(!pool.byId.has(f.id));
});

test("D15 · sin cartas elegibles no hay versión ni pool resoluble", () => {
  assert.equal(eligibleDataVersion({ ...INPUT, cards: [] }), null);
  assert.equal(poolIsSolvable(buildDraftPool({ ...INPUT, cards: [] }, DV)), false);
});

/* ─────────────── ofertas ─────────────── */

test("D16 · cada oferta: 3 cartas del rol del hueco, jugadores distintos", () => {
  for (let seed = 0; seed < 100; seed++) {
    const order = roleOrderFor(seed);
    const offer = offerFor(POOL, seed, 0, order[0], []);
    assert.equal(offer.length, 3);
    const cards = offer.map((id) => POOL.byId.get(id)!);
    for (const c of cards) assert.equal(c.role, order[0]);
    assert.equal(new Set(cards.map((c) => c.playerId)).size, 3);
  }
});

test("D17 · la oferta excluye cartas y jugadores ya elegidos", () => {
  for (let seed = 0; seed < 60; seed++) {
    const { picks, offers } = simulateDraft(POOL, seed, (o) => o[seed % o.length]);
    offers.forEach((offer, i) => {
      const before = picks.slice(0, i);
      const players = new Set(before.map((id) => POOL.byId.get(id)!.playerId));
      for (const id of offer) { assert.ok(!before.includes(id)); assert.ok(!players.has(POOL.byId.get(id)!.playerId)); }
    });
  }
});

test("D18 · la oferta prefiere equipos distintos cuando el rol lo permite", () => {
  let diverse = 0;
  for (let seed = 0; seed < 200; seed++) {
    const offer = offerFor(POOL, seed, 0, "Duelista", []);
    if (new Set(offer.map((id) => POOL.byId.get(id)!.teamKey)).size === 3) diverse++;
  }
  assert.equal(diverse, 200);
});

test("D19 · la oferta es determinista: misma semilla, hueco y elecciones → mismas cartas", () => {
  const a = offerFor(POOL, 99, 3, "Centinela", []);
  const b = offerFor(POOL, 99, 3, "Centinela", []);
  assert.deepEqual(a, b);
  assert.notDeepEqual(offerFor(POOL, 100, 3, "Centinela", []), a);
});

test("D20 · con pocos jugadores la oferta devuelve menos de 3 sin inventar cartas", () => {
  const two = POOL.byRole.Flex.filter((c, i, arr) => arr.findIndex((x) => x.playerId === c.playerId) === i).slice(0, 2);
  const tiny: DraftPool = { ...POOL, byRole: { ...POOL.byRole, Flex: two } };
  const offer = offerFor(tiny, 1, 0, "Flex", []);
  assert.equal(offer.length, 2);
  assert.equal(offerFor(tiny, 1, 1, "Flex", [offer[0]]).length, 1);
});

test("D21 · 2.000 drafts simulados: cero callejones sin salida", () => {
  for (let seed = 0; seed < 2000; seed++) assert.equal(simulateDraft(POOL, seed, (o, i) => o[(seed + i) % o.length]).deadEnd, false);
});

test("D22 · diversidad: las primeras ofertas cubren buena parte del pool del rol", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 500; seed++) for (const id of offerFor(POOL, seed, 0, "Duelista", [])) seen.add(id);
  assert.ok(seen.size > POOL.byRole.Duelista.length * 0.5, `solo ${seen.size}`);
});

/* ─────────────── legalidad con el validador canónico ─────────────── */

test("D23 · plantilla de 10 elecciones = mazo LEGAL para el validador canónico", () => {
  for (let seed = 0; seed < 150; seed++) {
    const s = draftAll(POOL, seed, seed % 3);
    const check = draftDeckCheck(RUN_ID, s.picks);
    assert.ok(check.valid, `seed ${seed}: ${check.errors.join(",")}`);
    assert.equal(check.snapshot!.cards.length, 10);
  }
});

test("D24 · el adaptador temporal no inventa propiedad: sin serial y uids con forma de UUID derivados de la run", () => {
  const s = draftAll(POOL, 5);
  const check = draftDeckCheck(RUN_ID, s.picks);
  for (const [i, c] of check.snapshot!.cards.entries()) {
    assert.equal(c.serial ?? null, null);
    assert.equal(c.uid, draftCardUid(RUN_ID, i));
    assert.match(c.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
});

test("D25 · el validador canónico rechaza mazos ilegales (tamaño, rol, jugador repetido)", () => {
  const s = draftAll(POOL, 8);
  assert.equal(draftDeckCheck(RUN_ID, s.picks.slice(0, 9)).valid, false);
  const dupCard = [...s.picks.slice(0, 9), s.picks[0]];
  assert.equal(draftDeckCheck(RUN_ID, dupCard).valid, false);
  const role = POOL.byId.get(s.picks[0])!.role;
  const sameRoleOther = POOL.byRole[role].find((c) => !s.picks.includes(c.cardId) && c.playerId !== POOL.byId.get(s.picks[0])!.playerId)!;
  const otherRoleIdx = s.picks.findIndex((id) => POOL.byId.get(id)!.role !== role);
  const bad = [...s.picks]; bad[otherRoleIdx] = sameRoleOther.cardId;
  assert.ok(draftDeckCheck(RUN_ID, bad).errors.includes("ROLE_COUNT") || !draftDeckCheck(RUN_ID, bad).valid);
});

test("D26 · rivales: 10 cartas reales, 2 por rol, jugadores distintos, legales", () => {
  for (let seed = 0; seed < 100; seed++) {
    for (let stage = 1; stage <= 5; stage++) {
      const deck = rivalDeckFor(POOL, seed, stage);
      assert.equal(deck.length, 10);
      for (const r of DUEL_ROLES) assert.equal(deck.filter((id) => POOL.byId.get(id)!.role === r).length, 2);
      assert.equal(new Set(deck.map((id) => POOL.byId.get(id)!.playerId)).size, 10);
      assert.ok(draftRivalCheck(deck, `t-${seed}-${stage}`).valid);
    }
  }
});

test("D27 · rival determinista por (semilla, etapa) y distinto entre etapas", () => {
  assert.deepEqual(rivalDeckFor(POOL, 77, 3), rivalDeckFor(POOL, 77, 3));
  assert.notDeepEqual(rivalDeckFor(POOL, 77, 1), rivalDeckFor(POOL, 77, 5));
});

test("D28 · la final trae de media más OVR que el primer combate (banda por etapa, sin tocar stats)", () => {
  let first = 0, final = 0;
  for (let seed = 0; seed < 200; seed++) {
    first += rivalDeckFor(POOL, seed, 1).reduce((s, id) => s + POOL.byId.get(id)!.ovr, 0);
    final += rivalDeckFor(POOL, seed, 5).reduce((s, id) => s + POOL.byId.get(id)!.ovr, 0);
  }
  assert.ok(final > first);
});

/* ─────────────── estado de la run ─────────────── */

test("D29 · run nueva: reglas, versión de datos, orden de roles y PRIMERA oferta persistida", () => {
  const s = createRunState(POOL, 11);
  assert.equal(s.rulesVersion, DRAFT_RULES_VERSION);
  assert.equal(s.dataVersion, DV);
  assert.deepEqual(s.roleOrder, roleOrderFor(11));
  assert.equal(s.offers.length, 1);
  assert.equal(currentRole(s), s.roleOrder[0]);
  assert.equal(s.rivals, null);
});

test("D30 · elegir: la carta entra, se persiste la siguiente oferta, y la anterior no cambia", () => {
  const s0 = createRunState(POOL, 12);
  const first = s0.offers[0];
  const r = applyPick(s0, POOL, 12, first[1]);
  assert.ok(r.ok);
  assert.deepEqual(r.state.picks, [first[1]]);
  assert.deepEqual(r.state.offers[0], first);
  assert.equal(r.state.offers.length, 2);
  assert.equal(r.complete, false);
});

test("D31 · no se puede elegir una carta fuera de la oferta actual", () => {
  const s0 = createRunState(POOL, 13);
  const outside = POOL.byRole[s0.roleOrder[0]].find((c) => !s0.offers[0].includes(c.cardId))!.cardId;
  const r = applyPick(s0, POOL, 13, outside);
  assert.deepEqual(r, { ok: false, code: "NOT_OFFERED" });
});

test("D32 · carta de la oferta desaparecida del catálogo → CARD_UNAVAILABLE", () => {
  const s0 = createRunState(POOL, 14);
  const gone = s0.offers[0][0];
  const byId = new Map(POOL.byId); byId.delete(gone);
  assert.deepEqual(applyPick(s0, { ...POOL, byId }, 14, gone), { ok: false, code: "CARD_UNAVAILABLE" });
});

test("D33 · oferta manipulada con otro rol → ROLE_MISMATCH", () => {
  const s0 = createRunState(POOL, 15);
  const other = DUEL_ROLES.find((r) => r !== s0.roleOrder[0])!;
  const alien = POOL.byRole[other][0].cardId;
  const tampered: DraftRunState = { ...s0, offers: [[alien]] };
  assert.deepEqual(applyPick(tampered, POOL, 15, alien), { ok: false, code: "ROLE_MISMATCH" });
});

test("D34 · jugador repetido en oferta manipulada → PLAYER_TAKEN; carta repetida → ALREADY_PICKED", () => {
  const s = createRunState(POOL, 16);
  const r1 = applyPick(s, POOL, 16, s.offers[0][0]);
  assert.ok(r1.ok);
  const taken = POOL.byId.get(r1.state.picks[0])!;
  const sibling = [...POOL.byId.values()].find((c) => c.playerId === taken.playerId && c.cardId !== taken.cardId);
  const role = r1.state.roleOrder[1];
  assert.deepEqual(applyPick({ ...r1.state, offers: [...r1.state.offers.slice(0, 1), [taken.cardId]] }, POOL, 16, taken.cardId), { ok: false, code: "ALREADY_PICKED" });
  if (sibling && sibling.role === role) {
    assert.deepEqual(applyPick({ ...r1.state, offers: [...r1.state.offers.slice(0, 1), [sibling.cardId]] }, POOL, 16, sibling.cardId), { ok: false, code: "PLAYER_TAKEN" });
  }
});

test("D35 · la décima elección completa el draft y fija los 5 rivales; una undécima se rechaza", () => {
  const s = draftAll(POOL, 17);
  assert.equal(s.picks.length, 10);
  assert.equal(s.offers.length, 10);
  assert.equal(s.rivals!.length, 5);
  assert.deepEqual(s.rivals!.map((r) => r.difficulty), [...STAGE_DIFFICULTY]);
  assert.deepEqual(applyPick(s, POOL, 17, s.picks[0]), { ok: false, code: "DRAFT_COMPLETE" });
  assert.deepEqual(currentOffer(s), []);
  assert.equal(currentRole(s), null);
});

test("D36 · reproducir las mismas elecciones reproduce EXACTAMENTE la run (ofertas y rivales)", () => {
  const a = draftAll(POOL, 18, 2);
  const b = draftAll(POOL, 18, 2);
  assert.deepEqual(a, b);
  assert.deepEqual(a.rivals, rivalsFor(POOL, 18));
});

test("D37 · un cambio de catálogo NO altera las ofertas ya persistidas", () => {
  const s0 = createRunState(POOL, 19);
  const persisted = JSON.parse(JSON.stringify(s0)) as DraftRunState;
  const shrunk = buildDraftPool({ ...INPUT, droppable: (id) => !s0.offers[0].slice(1).includes(id) }, DV);
  // La oferta mostrada sigue siendo la persistida; elegir una de sus cartas sigue siendo válido.
  const r = applyPick(persisted, shrunk, 19, persisted.offers[0][2]);
  assert.ok(r.ok);
  assert.deepEqual(r.state.offers[0], s0.offers[0]);
});

test("D38 · registro de acciones acotado e idempotente", () => {
  let s = createRunState(POOL, 20);
  for (let i = 0; i < MAX_ACTION_LOG + 15; i++) s = recordAction(s, { id: `a${i}`, kind: "pick", version: i });
  assert.equal(s.actions.length, MAX_ACTION_LOG);
  assert.equal(findAction(s, "a0"), undefined);
  assert.equal(findAction(s, `a${MAX_ACTION_LOG + 14}`)?.kind, "pick");
  const again = recordAction(s, { id: `a${MAX_ACTION_LOG + 14}`, kind: "pick", version: 1 });
  assert.equal(again.actions.filter((a) => a.id === `a${MAX_ACTION_LOG + 14}`).length, 1);
});

test("D39 · el estado persistido cabe de sobra en el límite de 32 KB de la BD", () => {
  let s = draftAll(POOL, 21);
  for (let i = 0; i < MAX_ACTION_LOG; i++) s = recordAction(s, { id: crypto.randomUUID(), kind: "pick", version: i });
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 16_000, `${Buffer.byteLength(JSON.stringify(s))} bytes`);
});

/* ─────────────── liquidación ─────────────── */

test("D40 · ganar avanza de etapa; ganar la 5 completa", () => {
  assert.deepEqual(settleTransition({ status: "IN_MATCH", stage: 1 }, "WIN"), { status: "READY", stage: 2 });
  assert.deepEqual(settleTransition({ status: "IN_MATCH", stage: 4 }, "WIN"), { status: "READY", stage: 5 });
  assert.deepEqual(settleTransition({ status: "IN_MATCH", stage: 5 }, "WIN"), { status: "COMPLETED", stage: 5 });
});

test("D41 · perder o empatar termina la run en su etapa", () => {
  assert.deepEqual(settleTransition({ status: "IN_MATCH", stage: 3 }, "LOSS"), { status: "FAILED", stage: 3 });
  assert.deepEqual(settleTransition({ status: "IN_MATCH", stage: 2 }, "DRAW"), { status: "FAILED", stage: 2 });
});

test("D42 · sin combate abierto no hay transición (liquidar dos veces es un no-op)", () => {
  for (const status of ["DRAFTING", "READY", "COMPLETED", "FAILED", "ABANDONED"] as const) {
    assert.deepEqual(settleTransition({ status, stage: 2 }, "WIN"), { status, stage: 2 });
  }
});

test("D43 · resultado para el humano (bando A) con el desempate canónico ya aplicado por el motor", () => {
  assert.equal(outcomeForHuman({ winner: "A", isDraw: false }), "WIN");
  assert.equal(outcomeForHuman({ winner: "B", isDraw: false }), "LOSS");
  assert.equal(outcomeForHuman({ winner: null, isDraw: true }), "DRAW");
  assert.equal(outcomeForHuman(null), null);
});

/* ─────────────── mapa y vista ─────────────── */

const row = (patch: Partial<DraftRunRow> = {}): DraftRunRow => ({
  id: RUN_ID, status: "READY", stage: 1, version: 11, rules_version: DRAFT_RULES_VERSION, data_version: DV,
  state: draftAll(POOL, 22), current_match_id: null, created_at: "2026-09-16T00:00:00.000Z", completed_at: null, ...patch,
});

test("D44 · mapa: 5 nodos; la etapa actual CURRENT y el resto bloqueado", () => {
  const b = stageBoard({ status: "READY", stage: 1 }, []);
  assert.deepEqual(b.map((n) => n.state), ["CURRENT", "LOCKED", "LOCKED", "LOCKED", "LOCKED"]);
  assert.deepEqual(b.map((n) => n.label), ["01", "02", "03", "04", "FINAL"]);
});

test("D45 · mapa con historial: superados, en combate, derrota y empate", () => {
  const m = (stage: number, result: "WIN" | "LOSS" | "DRAW" | null, status: "STARTED" | "SETTLED" = "SETTLED") => ({ stage, status, result, matchId: `m${stage}`, scoreYou: 6, scoreRival: 4 });
  assert.deepEqual(stageBoard({ status: "IN_MATCH", stage: 3 }, [m(1, "WIN"), m(2, "WIN"), m(3, null, "STARTED")]).map((n) => n.state), ["WON", "WON", "IN_MATCH", "LOCKED", "LOCKED"]);
  assert.deepEqual(stageBoard({ status: "FAILED", stage: 2 }, [m(1, "WIN"), m(2, "LOSS")]).map((n) => n.state), ["WON", "LOST", "LOCKED", "LOCKED", "LOCKED"]);
  assert.equal(stageBoard({ status: "FAILED", stage: 1 }, [m(1, "DRAW")])[0].state, "DRAW");
});

test("D46 · la vista NO filtra la semilla, las ofertas futuras ni los mazos rivales", () => {
  const v = toRunView({ ...row({ status: "DRAFTING" }), state: createRunState(POOL, 23) } as DraftRunRow, []);
  const json = JSON.stringify(v);
  assert.ok(!/seed/i.test(json));
  assert.ok(!json.includes("rivals"));
  assert.ok(!json.includes("actions"));
  assert.equal(v.offer.length, 3);
  const ready = JSON.stringify(toRunView(row(), []));
  for (const r of row().state.rivals!) for (const id of r.cardIds.filter((c) => !row().state.picks.includes(c))) assert.ok(!ready.includes(id));
});

test("D47 · la vista enseña oferta solo en DRAFTING y combate solo en IN_MATCH", () => {
  assert.deepEqual(toRunView(row(), []).offer, []);
  assert.equal(toRunView(row({ current_match_id: "x" }), []).currentMatchId, null);
  assert.equal(toRunView(row({ status: "IN_MATCH", current_match_id: "x" }), []).currentMatchId, "x");
});

test("D48 · victorias contadas desde el mapa", () => {
  const m = (stage: number) => ({ stage, status: "SETTLED" as const, result: "WIN" as const, matchId: `m${stage}`, scoreYou: 6, scoreRival: 3 });
  assert.equal(toRunView(row({ stage: 3 }), [m(1), m(2)]).wins, 2);
});

/* ─────────────── foto ─────────────── */

test("D49 · la foto solo trae cartas de la oferta y la plantilla, con datos públicos del catálogo", () => {
  const v = toRunView({ ...row({ status: "DRAFTING" }), state: createRunState(POOL, 24) } as DraftRunRow, []);
  const snap = buildDraftSnapshot({ run: v, history: [], resolver: REG, serverNow: 1 });
  assert.deepEqual(Object.keys(snap.cards).sort(), [...v.offer].sort());
  const c = Object.values(snap.cards)[0];
  assert.deepEqual(Object.keys(c).sort(), ["cardId", "combat", "country", "nick", "ovr", "playerId", "region", "role", "team", "teamTag", "variantId"].sort());
  assert.ok(!("serial" in c) && !("uid" in c));
});

test("D50 · la foto sin run activa trae la última run y su plantilla; con run activa, no", () => {
  const last = toRunView(row({ status: "COMPLETED", stage: 5, completed_at: "2026-09-16T01:00:00.000Z" }), []);
  const snap = buildDraftSnapshot({ run: null, lastRun: last, history: [], resolver: REG, serverNow: 1 });
  assert.equal(snap.lastRun!.status, "COMPLETED");
  assert.equal(Object.keys(snap.cards).length, 10);
  assert.equal(buildDraftSnapshot({ run: toRunView(row(), []), lastRun: last, history: [], resolver: REG, serverNow: 1 }).lastRun, null);
});

test("D51 · foto no disponible: sin run y con motivo", () => {
  const snap = buildDraftSnapshot({ run: null, history: [], resolver: REG, serverNow: 1, available: false, unavailableReason: "MIGRATION_PENDING" });
  assert.equal(snap.available, false);
  assert.equal(snap.unavailableReason, "MIGRATION_PENDING");
  assert.deepEqual(snap.economy, draftEconomyView());
});

test("D52 · victorias del historial sin leer combates", () => {
  assert.equal(winsOf("COMPLETED", 5), 5);
  assert.equal(winsOf("FAILED", 3), 2);
  assert.equal(winsOf("ABANDONED", 1), 0);
});

test("D53 · DTO de carta desconocida → null (nunca se inventa)", () => {
  assert.equal(draftCardDTO("nadie__gold", REG), null);
});
