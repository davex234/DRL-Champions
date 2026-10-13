/**
 * DRAFT GAUNTLET · PRESENTACIÓN (Fase 39) — vista previa y confirmación, teclado sin confirmaciones accidentales,
 * comparación sin veredicto, copia del resultado desde la run liquidada y tarjeta del hub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { buildDraftPool, eligibleDataVersion } from "@/domain/draft/generate";
import { applyPick, createRunState, currentOffer, isDraftComplete, toRunView, type DraftRunRow, type DraftRunState } from "@/domain/draft/run";
import { buildDraftSnapshot } from "@/domain/draft/snapshot";
import { DRAFT_MATCH_HREF, DRAFT_ROUTE } from "@/domain/draft/rules";
import { draftModeFacts, gameModes, type ModeFacts } from "@/lib/campaign/presentation";
import {
  actionsDisabled, compareWithRole, draftKeyIntent, draftResultCopy, isFinal, pickUiReducer, roleProgress, rosterSlots, runHeadline,
  type PickUi,
} from "./presentation";

const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const POOL = buildDraftPool(INPUT, eligibleDataVersion(INPUT)!);

function stateAfter(n: number, seed = 3): DraftRunState {
  let s = createRunState(POOL, seed);
  for (let i = 0; i < n && !isDraftComplete(s); i++) {
    const r = applyPick(s, POOL, seed, currentOffer(s)[0]);
    assert.ok(r.ok);
    s = r.state;
  }
  return s;
}
const row = (state: DraftRunState, patch: Partial<DraftRunRow> = {}): DraftRunRow => ({
  id: "r1", status: state.picks.length === 10 ? "READY" : "DRAFTING", stage: 1, version: state.picks.length + 1, rules_version: "draft-gauntlet-1",
  data_version: state.dataVersion, state, current_match_id: null, created_at: "2026-09-16T00:00:00.000Z", completed_at: null, ...patch,
});
const snapOf = (r: DraftRunRow, matches = []) => { const v = toRunView(r, matches); return { v, s: buildDraftSnapshot({ run: v, history: [], resolver: REG, serverNow: 0 }) }; };

/* ─────────────── vista previa → confirmación ─────────────── */

test("P01 · un toque abre la vista previa; nada se envía sin confirmar", () => {
  let s: PickUi = { phase: "browse" };
  s = pickUiReducer(s, { type: "select", index: 1 }, 3);
  assert.deepEqual(s, { phase: "preview", index: 1 });
  s = pickUiReducer(s, { type: "select", index: 2 }, 3);
  assert.deepEqual(s, { phase: "preview", index: 2 });
});

test("P02 · cancelar cierra la vista previa; confirmar pasa a enviando; en vuelo no se cambia de carta", () => {
  let s: PickUi = pickUiReducer({ phase: "browse" }, { type: "select", index: 0 }, 3);
  assert.deepEqual(pickUiReducer(s, { type: "cancel" }, 3), { phase: "browse" });
  s = pickUiReducer(s, { type: "send" }, 3);
  assert.deepEqual(s, { phase: "sending", index: 0 });
  assert.deepEqual(pickUiReducer(s, { type: "select", index: 2 }, 3), s);
  assert.deepEqual(pickUiReducer(s, { type: "send" }, 3), s);
  assert.deepEqual(pickUiReducer(s, { type: "settled" }, 3), { phase: "browse" });
});

test("P03 · confirmar sin vista previa no hace nada; índices fuera de rango se ignoran", () => {
  assert.deepEqual(pickUiReducer({ phase: "browse" }, { type: "send" }, 3), { phase: "browse" });
  assert.deepEqual(pickUiReducer({ phase: "browse" }, { type: "select", index: 3 }, 3), { phase: "browse" });
  assert.deepEqual(pickUiReducer({ phase: "browse" }, { type: "select", index: -1 }, 3), { phase: "browse" });
});

/* ─────────────── teclado ─────────────── */

test("P04 · 1/2/3 eligen; Enter confirma solo con vista previa; Escape cancela", () => {
  const o = { optionCount: 3, disabled: false };
  assert.deepEqual(draftKeyIntent({ key: "2" }, { phase: "browse" }, o), { type: "select", index: 1 });
  assert.equal(draftKeyIntent({ key: "4" }, { phase: "browse" }, o), null);
  assert.equal(draftKeyIntent({ key: "Enter" }, { phase: "browse" }, o), null);
  assert.deepEqual(draftKeyIntent({ key: "Enter" }, { phase: "preview", index: 0 }, o), { type: "confirm" });
  assert.deepEqual(draftKeyIntent({ key: "Escape" }, { phase: "preview", index: 0 }, o), { type: "cancel" });
  assert.equal(draftKeyIntent({ key: "Escape" }, { phase: "browse" }, o), null);
});

test("P05 · una tecla mantenida (repeat) NUNCA confirma ni vuelve a elegir", () => {
  const o = { optionCount: 3, disabled: false };
  assert.equal(draftKeyIntent({ key: "Enter", repeat: true }, { phase: "preview", index: 1 }, o), null);
  assert.equal(draftKeyIntent({ key: "1", repeat: true }, { phase: "browse" }, o), null);
});

test("P06 · sin acciones (sin conexión, en vuelo) o escribiendo en un campo, el teclado no hace nada", () => {
  assert.equal(draftKeyIntent({ key: "1" }, { phase: "browse" }, { optionCount: 3, disabled: true }), null);
  assert.equal(draftKeyIntent({ key: "1", editable: true }, { phase: "browse" }, { optionCount: 3, disabled: false }), null);
  assert.equal(draftKeyIntent({ key: "2" }, { phase: "sending", index: 0 }, { optionCount: 3, disabled: false }), null);
  assert.equal(draftKeyIntent({ key: "3" }, { phase: "browse" }, { optionCount: 2, disabled: false }), null);
});

/* ─────────────── cabecera, plantilla y comparación ─────────────── */

test("P07 · cabecera: PICK X/10 y ROL ACTUAL durante el draft; FINAL en la etapa 5", () => {
  const { v } = snapOf(row(stateAfter(3)));
  assert.equal(runHeadline(v).title, "PICK 4/10");
  assert.equal(runHeadline(v).detail, `ROL ACTUAL: ${v.currentRole!.toUpperCase()}`);
  assert.equal(runHeadline(toRunView(row(stateAfter(10), { stage: 5 }), [])).title, "FINAL");
  assert.equal(runHeadline(null).title, "Nueva run");
  for (const st of ["COMPLETED", "FAILED", "ABANDONED", "IN_MATCH"] as const) assert.ok(runHeadline(toRunView(row(stateAfter(10), { status: st }), [])).title.length > 0);
});

test("P08 · plantilla: 10 huecos en el orden de roles, el actual marcado", () => {
  const { v, s } = snapOf(row(stateAfter(4)));
  const slots = rosterSlots(v, s.cards);
  assert.equal(slots.length, 10);
  assert.equal(slots.filter((x) => x.card).length, 4);
  assert.deepEqual(slots.filter((x) => x.current).map((x) => x.index), [4]);
  assert.equal(roleProgress(v, s.cards).reduce((a, p) => a + p.have, 0), 4);
});

test("P09 · comparación con los ya elegidos del MISMO rol, números sin veredicto", () => {
  const st = stateAfter(10);
  const view = toRunView(row(stateAfter(9)), []);
  const snap = buildDraftSnapshot({ run: view, history: [], resolver: REG, serverNow: 0 });
  const option = snap.cards[view.offer[0]];
  const rows = compareWithRole(option, view, snap.cards);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].rows.map((r) => r.stat), ["ovr", "stronghold", "gamesense", "entryfrag"]);
  const text = JSON.stringify(rows);
  assert.ok(!/mejor|recomend|best|peor/i.test(text));
  assert.ok(st.picks.length === 10);
});

/* ─────────────── resultado en la arena ─────────────── */

const settled = (stage: number, result: "WIN" | "LOSS" | "DRAW") => ({ stage, status: "SETTLED" as const, result, matchId: `m${stage}`, scoreYou: 6, scoreRival: 4 });

test("P10 · resultado: victoria intermedia, gauntlet superado, derrota y empate", () => {
  const st = stateAfter(10);
  assert.equal(draftResultCopy(toRunView(row(st, { stage: 2 }), [settled(1, "WIN")]), "m1").tone, "win");
  const done = toRunView(row(st, { status: "COMPLETED", stage: 5 }), [1, 2, 3, 4, 5].map((s) => settled(s, "WIN")));
  assert.equal(draftResultCopy(done, "m5").title, "GAUNTLET SUPERADO");
  assert.equal(draftResultCopy(toRunView(row(st, { status: "FAILED", stage: 3 }), [settled(1, "WIN"), settled(2, "WIN"), settled(3, "LOSS")]), "m3").tone, "loss");
  assert.equal(draftResultCopy(toRunView(row(st, { status: "FAILED", stage: 1 }), [settled(1, "DRAW")]), "m1").tone, "draw");
});

test("P11 · sin run liquidada todavía, el resultado dice «registrando» y no inventa nada", () => {
  const st = stateAfter(10);
  assert.equal(draftResultCopy(null, "m1").tone, "pending");
  assert.equal(draftResultCopy(toRunView(row(st, { status: "IN_MATCH", current_match_id: "m1" }), [{ stage: 1, status: "STARTED", result: null, matchId: "m1", scoreYou: null, scoreRival: null }]), "m1").tone, "pending");
});

test("P12 · sin conexión o no disponible, todo es de solo lectura", () => {
  const { s } = snapOf(row(stateAfter(1)));
  assert.equal(actionsDisabled(s, true), true);
  assert.equal(actionsDisabled({ ...s, available: false }, false), true);
  assert.equal(actionsDisabled(null, false), true);
  assert.equal(actionsDisabled(s, false), false);
  assert.deepEqual((["COMPLETED", "FAILED", "ABANDONED", "READY"] as const).map((s) => isFinal(s)), [true, true, true, false]);
});

/* ─────────────── hub de modos ─────────────── */

const FACTS: ModeFacts = { signedIn: true, hasValidDeck: false, activePve: false, activePvp: false, rankedProvisional: false, campaign: null };
const card = (draft: ModeFacts["draft"], extra: Partial<ModeFacts> = {}) => gameModes({ ...FACTS, ...extra, draft }).find((c) => c.id === "DRAFT_GAUNTLET")!;

test("P13 · hub: línea del modo y estados Nueva run / Draft X/10 / Combate X/5 / completada", () => {
  const base = { available: true, pick: 0, stage: 0, lastStatus: null, status: null } as const;
  assert.equal(card(base).line, "Construye un equipo carta a carta y supera cinco rivales."); // F64 · «equipo»
  assert.deepEqual([card(base).status, card(base).detail, card(base).cta.href], ["DISPONIBLE", "Nueva run", DRAFT_ROUTE]);
  assert.equal(card({ ...base, status: "DRAFTING", pick: 4 }).detail, "Draft 4/10");
  assert.equal(card({ ...base, status: "READY", stage: 3 }).detail, "Combate 3/5");
  const inMatch = card({ ...base, status: "IN_MATCH", stage: 2 });
  assert.deepEqual([inMatch.status, inMatch.cta.href], ["EN PARTIDA", DRAFT_MATCH_HREF]);
  assert.equal(card({ ...base, lastStatus: "COMPLETED" }).detail, "Última run: completada");
});

test("P14 · hub: sin equipo válido el draft sigue DISPONIBLE (no usa tu colección); sin sesión, invita a entrar", () => {
  assert.equal(card({ available: true, status: null, pick: 0, stage: 0, lastStatus: null }).status, "DISPONIBLE");
  assert.equal(card(null, { signedIn: false }).status, "INICIA SESIÓN");
  assert.equal(card(null).status, "NO DISPONIBLE");
  assert.equal(card("loading").status, "CARGANDO");
  assert.equal(card({ available: false, status: null, pick: 0, stage: 0, lastStatus: null }).status, "NO DISPONIBLE");
});

test("P15 · hechos del hub desde la foto real", () => {
  const { s } = snapOf(row(stateAfter(2)));
  assert.deepEqual(draftModeFacts(s), { available: true, status: "DRAFTING", pick: 2, stage: 1, lastStatus: null, wins: 0, entryPending: false });
  assert.equal(draftModeFacts(null), null);
  assert.equal(draftModeFacts({ available: true, run: null, history: [{ status: "FAILED" }] })!.lastStatus, "FAILED");
});
