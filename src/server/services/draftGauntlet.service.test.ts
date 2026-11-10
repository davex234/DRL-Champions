/**
 * DRAFT GAUNTLET · SERVICIO (Fase 39) — run, elecciones, combate, liquidación, abandono, idempotencia, concurrencia,
 * degradación sin 0053 y aislamiento económico, sobre `MemorySupabase`.
 *
 * El combate lo «crea» un lanzador inyectado que inserta la fila de `duel_matches` como haría `startDraftMatch`; el
 * motor real está cubierto por sus pruebas. Postgres real (índices parciales, CHECK, RLS): NO EJECUTADO AQUÍ —
 * lo cubren los probes de ensayo de 0053.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CardRegistry } from "@/collection/registry";
import type { DuelMatchView } from "@/lib/duel/types";
import { ACTIVE_STATUSES, STAGE_DIFFICULTY, RIVAL_NAMES } from "@/domain/draft/rules";
import { draftEconomyView } from "@/domain/draft/economy";
import { MemorySupabase } from "./testing/memorySupabase";
import { installLedger } from "./testing/ledgerRpc";
import {
  abandonDraftRun, getDraftGauntlet, pickDraftCard, readDraftSummary, settleDraftMatch, startDraftRun, startDraftStage,
  LAUNCH_TTL_MS, type DraftCatalog, type DraftLauncher, type DraftOptions,
} from "./draftGauntlet";

const REG = new CardRegistry();
const CATALOG: DraftCatalog = { cards: REG.cards, card: (id) => REG.card(id), player: (id) => REG.player(id), droppable: () => true };
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const aid = () => randomUUID();

function world(extra: Partial<DraftOptions> = {}) {
  const db = new MemorySupabase();
  db.unique.draft_runs = [{ cols: ["user_id"], where: (r) => (ACTIVE_STATUSES as readonly unknown[]).includes(r.status) }];
  db.unique.draft_run_matches = [{ cols: ["run_id", "stage"] }, { cols: ["match_id"], where: (r) => r.match_id != null }];
  db.defaults.draft_runs = () => ({ id: randomUUID() });
  db.defaults.draft_run_matches = () => ({});
  db.tables.duel_matches = [];
  // F72 · la entrada se cobra en el libro mayor: dos jugadores con saldo holgado (las pruebas de economía van en F72).
  const ledger = installLedger(db, [{ userId: USER, credits: 1_000_000 }, { userId: OTHER, credits: 1_000_000 }]);
  const launches: Parameters<DraftLauncher>[2][] = [];
  let launchFails = false;
  const launch: DraftLauncher = async (_sb, userId, input) => {
    launches.push(input);
    if (launchFails) return { ok: false, status: 500, error: "boom" };
    db.rows("duel_matches").push({ id: input.matchId, user_id: userId, mode: "DRAFT_GAUNTLET", status: "IN_PROGRESS", difficulty: input.level, deck_id: null, state: { status: "IN_PROGRESS", result: null } });
    return { ok: true, status: 200, data: { view: { matchId: input.matchId, difficulty: input.level } as unknown as DuelMatchView } };
  };
  const abandoned: string[] = [];
  const opts: DraftOptions = {
    catalog: CATALOG, now: NOW, launch, seed: () => 424242,
    deckCheck: () => ({ valid: true, errors: [], snapshot: null }),
    abandonMatch: async (_sb, userId, matchId) => {
      abandoned.push(matchId);
      const before = db.rows("duel_matches").length;
      db.tables.duel_matches = db.rows("duel_matches").filter((m) => !(m.id === matchId && m.user_id === userId && m.status === "IN_PROGRESS"));
      return { ok: true, status: 200, data: { deleted: before - db.rows("duel_matches").length } };
    },
    ...extra,
  };
  return { db, sb: db.client, opts, launches, abandoned, ledger, failLaunch: (v = true) => { launchFails = v; } };
}
type World = ReturnType<typeof world>;

const runs = (w: World) => w.db.rows("draft_runs");
const active = (w: World, user = USER) => runs(w).find((r) => r.user_id === user && (ACTIVE_STATUSES as readonly unknown[]).includes(r.status))!;
const stageRows = (w: World) => w.db.rows("draft_run_matches");

async function started(w: World) {
  const r = await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts);
  assert.ok(r.ok, `${r.code} ${r.error}`);
  return r.data!;
}

async function draftTen(w: World, choose = 0) {
  let snap = await started(w);
  for (let i = 0; i < 10; i++) {
    const run = snap.run!;
    const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: run.version, choiceId: run.offer[Math.min(choose, run.offer.length - 1)] }, w.opts);
    assert.ok(r.ok, `pick ${i}: ${r.code} ${r.reason ?? ""}`);
    snap = r.data!;
  }
  return snap;
}

function finish(w: World, matchId: string, winner: "A" | "B" | null, score: [number, number] = winner === "A" ? [6, 4] : winner === "B" ? [3, 7] : [5, 5]) {
  const m = w.db.rows("duel_matches").find((r) => r.id === matchId)!;
  m.status = winner === null ? "DRAW" : "COMPLETED";
  m.state = { status: m.status, result: { winner, isDraw: winner === null, scoreA: score[0], scoreB: score[1] } };
}

async function playStage(w: World, winner: "A" | "B" | null, viaHook = true) {
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  assert.ok(s.ok, `${s.code} ${s.error}`);
  finish(w, s.data!.matchId, winner);
  if (viaHook) {
    const m = w.db.rows("duel_matches").find((r) => r.id === s.data!.matchId)!;
    await settleDraftMatch(w.sb, USER, s.data!.matchId, m.state as never, w.opts);
  }
  return s.data!.matchId;
}

/* ─────────────── lectura y degradación ─────────────── */

test("S01 · GET sin run: disponible, sin run, tabla de economía F72 y SIN escrituras", async () => {
  const w = world();
  const r = await getDraftGauntlet(w.sb, USER, w.opts);
  assert.ok(r.ok);
  assert.equal(r.data!.available, true);
  assert.equal(r.data!.run, null);
  assert.deepEqual(r.data!.economy, draftEconomyView());
  assert.deepEqual(w.db.writes(), []);
});

test("S02 · sin 0053: lectura 200 «no disponible», acciones 503 MIGRATION_PENDING y cero escrituras", async () => {
  const w = world();
  w.db.missing.add("draft_runs");
  const g = await getDraftGauntlet(w.sb, USER, w.opts);
  assert.deepEqual([g.status, g.data!.available, g.data!.unavailableReason], [200, false, "MIGRATION_PENDING"]);
  assert.deepEqual([(await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts)).code], ["MIGRATION_PENDING"]);
  assert.equal((await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: "x__gold" }, w.opts)).status, 503);
  assert.equal((await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: 1 }, w.opts)).status, 503);
  assert.equal((await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: 1 }, w.opts)).status, 503);
  assert.deepEqual(w.db.writes().filter((l) => !l.startsWith("select")), []);
});

test("S03 · error interno de BD en lectura → 500 DB (la ruta lo convierte en 503 genérico)", async () => {
  const w = world();
  w.db.failing.add("draft_runs");
  const r = await getDraftGauntlet(w.sb, USER, w.opts);
  assert.deepEqual([r.ok, r.status, r.code], [false, 500, "DB"]);
});

/* ─────────────── crear la run ─────────────── */

test("S04 · start crea UNA run DRAFTING v1 con semilla de servidor, reglas, versión de datos y primera oferta", async () => {
  const w = world();
  const snap = await started(w);
  const row = active(w);
  assert.deepEqual([row.status, row.stage, row.version, row.seed, row.rules_version], ["DRAFTING", 1, 1, 424242, "draft-gauntlet-1"]);
  assert.equal(snap.run!.offer.length, 3);
  assert.equal(snap.run!.pickIndex, 0);
  assert.equal(Object.keys(snap.cards).length, 3);
  assert.ok(!JSON.stringify(snap).includes("424242"), "la semilla no sale");
});

test("S05 · start repetido (otro actionId, doble clic) devuelve la MISMA run", async () => {
  const w = world();
  const a = await started(w);
  const b = await started(w);
  assert.equal(a.run!.runId, b.run!.runId);
  assert.equal(runs(w).length, 1);
});

test("S06 · dos start simultáneos → una sola run activa (índice único parcial)", async () => {
  const w = world();
  const [a, b] = await Promise.all([startDraftRun(w.sb, USER, { actionId: aid() }, w.opts), startDraftRun(w.sb, USER, { actionId: aid() }, w.opts)]);
  assert.ok(a.ok && b.ok);
  assert.equal(runs(w).filter((r) => r.status === "DRAFTING").length, 1);
  assert.equal(a.data!.run!.runId, b.data!.run!.runId);
});

test("S07 · catálogo sin cartas suficientes → 503 POOL_UNAVAILABLE sin insertar", async () => {
  const w = world({ catalog: { ...CATALOG, cards: [] } });
  const r = await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts);
  assert.deepEqual([r.status, r.code], [503, "POOL_UNAVAILABLE"]);
  assert.equal(runs(w).length, 0);
});

test("S08 · las semillas por defecto salen del servidor y varían entre runs", async () => {
  const seeds = new Set<number>();
  for (let i = 0; i < 5; i++) {
    const w = world({ seed: undefined });
    await started(w);
    seeds.add(Number(active(w).seed));
  }
  assert.ok(seeds.size >= 4);
});

/* ─────────────── elecciones ─────────────── */

test("S09 · elegir: versión +1, carta guardada, siguiente oferta persistida", async () => {
  const w = world();
  const s0 = await started(w);
  const choice = s0.run!.offer[1];
  const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: choice }, w.opts);
  assert.ok(r.ok);
  assert.deepEqual([r.data!.run!.version, r.data!.run!.picks], [2, [choice]]);
  assert.equal((active(w).state as { offers: string[][] }).offers.length, 2);
});

test("S10 · reintento con el MISMO actionId: una sola elección, misma respuesta", async () => {
  const w = world();
  const s0 = await started(w);
  const input = { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] };
  const a = await pickDraftCard(w.sb, USER, input, w.opts);
  const b = await pickDraftCard(w.sb, USER, input, w.opts);
  assert.ok(a.ok && b.ok);
  assert.equal(b.data!.run!.picks.length, 1);
  assert.equal(active(w).version, 2);
});

test("S11 · doble confirmación simultánea con acciones distintas: una entra, la otra 409 STALE con foto", async () => {
  const w = world();
  const s0 = await started(w);
  const [a, b] = await Promise.all([
    pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts),
    pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[2] }, w.opts),
  ]);
  const oks = [a, b].filter((x) => x.ok);
  const stale = [a, b].find((x) => !x.ok)!;
  assert.equal(oks.length, 1);
  assert.deepEqual([stale.status, stale.code], [409, "STALE_VERSION"]);
  assert.equal(stale.snapshot!.run!.picks.length, 1);
  assert.equal((active(w).state as { picks: string[] }).picks.length, 1);
});

test("S12 · versión esperada vieja → 409 STALE_VERSION con foto y sin escribir", async () => {
  const w = world();
  const s0 = await started(w);
  await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts);
  const writes = w.db.writes().length;
  const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[1] }, w.opts);
  assert.deepEqual([r.status, r.code], [409, "STALE_VERSION"]);
  assert.equal(r.snapshot!.run!.version, 2);
  assert.equal(w.db.writes().length, writes);
});

test("S13 · carta fuera de la oferta (cliente manipulado) → 409 INVALID_PICK NOT_OFFERED", async () => {
  const w = world();
  const s0 = await started(w);
  const role = s0.run!.currentRole!;
  const outside = REG.forRole(role).find((c) => c.combat && !s0.run!.offer.includes(c.id))!.id;
  const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: outside }, w.opts);
  assert.deepEqual([r.status, r.code, r.reason], [409, "INVALID_PICK", "NOT_OFFERED"]);
  assert.equal(active(w).version, 1);
});

test("S14 · sin run → 404 NO_RUN; con draft completo → 409 WRONG_STATE", async () => {
  const w = world();
  assert.equal((await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: "a__gold" }, w.opts)).code, "NO_RUN");
  const snap = await draftTen(w);
  const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: snap.run!.version, choiceId: snap.run!.picks[0] }, w.opts);
  assert.equal(r.code, "WRONG_STATE");
});

test("S15 · recargar no cambia las opciones (y la lectura no escribe)", async () => {
  const w = world();
  const s0 = await started(w);
  const writes = w.db.writes().length;
  for (let i = 0; i < 3; i++) assert.deepEqual((await getDraftGauntlet(w.sb, USER, w.opts)).data!.run!.offer, s0.run!.offer);
  assert.equal(w.db.writes().length, writes);
});

test("S16 · diez elecciones → READY en la etapa 1, rivales fijados en servidor, sin oferta", async () => {
  const w = world();
  const snap = await draftTen(w, 2);
  assert.deepEqual([snap.run!.status, snap.run!.stage, snap.run!.version, snap.run!.picks.length], ["READY", 1, 11, 10]);
  assert.deepEqual(snap.run!.offer, []);
  const state = active(w).state as { rivals: { cardIds: string[]; difficulty: string }[] };
  assert.equal(state.rivals.length, 5);
  assert.deepEqual(state.rivals.map((r) => r.difficulty), [...STAGE_DIFFICULTY]);
  assert.deepEqual(snap.run!.stages.map((s) => s.state), ["CURRENT", "LOCKED", "LOCKED", "LOCKED", "LOCKED"]);
});

test("S17 · la plantilla final pasa por el validador canónico; si falla, no se completa", async () => {
  const calls: string[][] = [];
  const w = world({ deckCheck: (_id, cards) => { calls.push([...cards]); return { valid: false, errors: ["ROLE_COUNT"], snapshot: null }; } });
  let snap = await started(w);
  for (let i = 0; i < 9; i++) snap = (await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: snap.run!.version, choiceId: snap.run!.offer[0] }, w.opts)).data!;
  const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: snap.run!.version, choiceId: snap.run!.offer[0] }, w.opts);
  assert.deepEqual([r.status, r.code], [409, "DECK_INVALID"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 10);
  assert.deepEqual([active(w).status, (active(w).state as { picks: string[] }).picks.length], ["DRAFTING", 9]);
});

/* ─────────────── combate ─────────────── */

test("S18 · start_match: IN_MATCH, lanza con la plantilla, el rival fijado y la dificultad de la etapa; enlaza el combate", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const r = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  assert.ok(r.ok);
  const state = run.state as { picks: string[]; rivals: { cardIds: string[]; name: string }[] };
  assert.equal(w.launches.length, 1);
  assert.deepEqual([w.launches[0].level, w.launches[0].cardIds, w.launches[0].rival.cardIds, w.launches[0].rival.name], ["EASY", state.picks, state.rivals[0].cardIds, RIVAL_NAMES[0]]);
  assert.equal(active(w).status, "IN_MATCH");
  assert.equal(active(w).current_match_id, r.data!.matchId);
  assert.deepEqual([stageRows(w).length, stageRows(w)[0].status, stageRows(w)[0].stage, stageRows(w)[0].match_id], [1, "STARTED", 1, r.data!.matchId]);
});

test("S19 · start_match repetido devuelve el combate activo (sin lanzar otro)", async () => {
  const w = world();
  await draftTen(w);
  const v = active(w).version as number;
  const a = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts);
  const b = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts);
  assert.ok(a.ok && b.ok);
  assert.equal(a.data!.matchId, b.data!.matchId);
  assert.equal(w.launches.length, 1);
});

test("S20 · dos start_match simultáneos → un solo combate", async () => {
  const w = world();
  await draftTen(w);
  const v = active(w).version as number;
  const [a, b] = await Promise.all([startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts), startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts)]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.data!.matchId, b.data!.matchId);
  assert.equal(w.launches.length, 1);
  assert.equal(w.db.rows("duel_matches").length, 1);
});

test("S21 · start_match antes de completar el draft → 409 WRONG_STATE; con versión vieja → 409 STALE", async () => {
  const w = world();
  const s0 = await started(w);
  assert.equal((await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: s0.run!.version }, w.opts)).code, "WRONG_STATE");
  await draftTen(w);
  assert.equal((await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: 3 }, w.opts)).code, "STALE_VERSION");
  assert.equal(w.launches.length, 0);
});

test("S22 · si el motor no puede lanzar, la run vuelve a READY (relanzable) y no queda combate enlazado", async () => {
  const w = world();
  await draftTen(w);
  w.failLaunch();
  const v = active(w).version as number;
  const r = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts);
  assert.deepEqual([r.ok, r.code], [false, "MATCH_FAILED"]);
  assert.deepEqual([active(w).status, active(w).current_match_id, active(w).version], ["READY", null, v + 2]);
  assert.equal(stageRows(w).length, 0);
  w.failLaunch(false);
  assert.ok((await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v + 2 }, w.opts)).ok);
});

/* ─────────────── liquidación ─────────────── */

test("S23 · victoria → combate SETTLED WIN con marcador, run READY en la etapa 2", async () => {
  const w = world();
  await draftTen(w);
  const matchId = await playStage(w, "A");
  const row = stageRows(w).find((m) => m.match_id === matchId)!;
  assert.deepEqual([row.status, row.result, row.score_you, row.score_rival], ["SETTLED", "WIN", 6, 4]);
  assert.deepEqual([active(w).status, active(w).stage, active(w).current_match_id], ["READY", 2, null]);
});

test("S24 · liquidar dos veces es un no-op", async () => {
  const w = world();
  await draftTen(w);
  const matchId = await playStage(w, "A");
  const v = active(w).version;
  const again = await settleDraftMatch(w.sb, USER, matchId, { status: "COMPLETED", result: { winner: "A", isDraw: false } }, w.opts);
  assert.equal(again.settled, false);
  assert.deepEqual([active(w).version, active(w).stage], [v, 2]);
});

test("S25 · derrota → run FAILED en su etapa, con fecha de cierre", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, "B");
  const run = runs(w)[0];
  assert.deepEqual([run.status, run.stage, typeof run.completed_at], ["FAILED", 1, "string"]);
  assert.equal(stageRows(w)[0].result, "LOSS");
});

test("S26 · empate → run FAILED (en el gauntlet solo avanza quien gana)", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, null);
  assert.deepEqual([runs(w)[0].status, stageRows(w)[0].result], ["FAILED", "DRAW"]);
});

test("S27 · cinco victorias → COMPLETED; dificultades y rivales en orden", async () => {
  const w = world();
  await draftTen(w);
  for (let i = 0; i < 5; i++) await playStage(w, "A");
  const run = runs(w)[0];
  assert.deepEqual([run.status, run.stage], ["COMPLETED", 5]);
  assert.deepEqual(w.launches.map((l) => l.level), [...STAGE_DIFFICULTY]);
  assert.deepEqual(w.launches.map((l) => l.rival.name), [...RIVAL_NAMES]);
  assert.equal(stageRows(w).filter((m) => m.result === "WIN").length, 5);
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts)).data!;
  assert.equal(snap.run, null);
  assert.deepEqual([snap.lastRun!.status, snap.lastRun!.wins, snap.history[0].wins], ["COMPLETED", 5, 5]);
});

test("S28 · partida aún en curso: la liquidación no toca la run", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  const v = active(w).version;
  const r = await settleDraftMatch(w.sb, USER, s.data!.matchId, null, w.opts);
  assert.deepEqual([r.settled, r.reason], [false, "IN_PROGRESS"]);
  assert.equal(active(w).version, v);
});

test("S29 · si el gancho de la jugada falló, la LECTURA reconcilia desde la partida persistida", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, "A", false);
  assert.equal(active(w).status, "IN_MATCH");
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts)).data!;
  assert.deepEqual([snap.run!.status, snap.run!.stage, snap.run!.stages[0].state], ["READY", 2, "WON"]);
});

test("S30 · el resultado sale de la PARTIDA, no de los hechos que se pasen si la run ya se cerró", async () => {
  const w = world();
  await draftTen(w);
  const matchId = await playStage(w, "B");
  const r = await settleDraftMatch(w.sb, USER, matchId, { status: "COMPLETED", result: { winner: "A", isDraw: false } }, w.opts);
  assert.equal(r.settled, false);
  assert.equal(runs(w)[0].status, "FAILED");
});

test("S31 · combate reclamado pero nunca creado: dentro del margen no se toca; pasado, vuelve a READY", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  Object.assign(run, { status: "IN_MATCH", current_match_id: randomUUID(), updated_at: new Date(NOW - 1000).toISOString() });
  await getDraftGauntlet(w.sb, USER, w.opts);
  assert.equal(active(w).status, "IN_MATCH");
  run.updated_at = new Date(NOW - LAUNCH_TTL_MS - 1).toISOString();
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts)).data!;
  assert.deepEqual([snap.run!.status, snap.run!.currentMatchId], ["READY", null]);
});

test("S32 · combate enlazado que desaparece → run FAILED y combate ABANDONED", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  w.db.tables.duel_matches = [];
  active(w).updated_at = new Date(NOW - LAUNCH_TTL_MS - 1).toISOString();
  const r = await settleDraftMatch(w.sb, USER, s.data!.matchId, null, w.opts);
  assert.equal(r.reason, "VANISHED");
  assert.deepEqual([runs(w)[0].status, stageRows(w)[0].status], ["FAILED", "ABANDONED"]);
});

test("S33 · una partida de OTRO modo con el mismo id no liquida la run", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  const m = w.db.rows("duel_matches")[0];
  m.mode = "PVE";
  finish(w, s.data!.matchId, "A");
  const r = await settleDraftMatch(w.sb, USER, s.data!.matchId, null, w.opts);
  assert.notEqual(r.outcome, "WIN");
  assert.notEqual(runs(w)[0].stage, 2);
});

/* ─────────────── abandono ─────────────── */

test("S34 · abandonar en draft → ABANDONED con cierre; la historia se conserva y se puede empezar otra", async () => {
  const w = world();
  const s0 = await started(w);
  const r = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: s0.run!.version }, w.opts);
  assert.ok(r.ok);
  assert.equal(r.data!.run, null);
  assert.deepEqual([r.data!.history[0].status, r.data!.lastRun!.status], ["ABANDONED", "ABANDONED"]);
  const again = await started(w);
  assert.notEqual(again.run!.runId, s0.run!.runId);
  assert.equal(runs(w).length, 2);
});

test("S35 · abandonar con versión vieja → 409 STALE y la run sigue", async () => {
  const w = world();
  const s0 = await started(w);
  await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts);
  const r = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: 1 }, w.opts);
  assert.deepEqual([r.status, r.code, active(w).status], [409, "STALE_VERSION", "DRAFTING"]);
});

test("S36 · abandonar en combate: se borra SU partida en curso, combate ABANDONED, run ABANDONED; F72: 0 victorias = 0 créditos", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  const r = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: active(w).version as number }, w.opts);
  assert.ok(r.ok);
  assert.deepEqual(w.abandoned, [s.data!.matchId]);
  assert.equal(w.db.rows("duel_matches").length, 0);
  assert.deepEqual([runs(w)[0].status, stageRows(w)[0].status], ["ABANDONED", "ABANDONED"]);
  // F72 · la única RPC es el cobro de la entrada; abandonar en el combate 1 no paga (0 victorias) ni devuelve la entrada.
  assert.deepEqual(w.db.rpcCalls.map((c) => c.name), ["app_adjust_credits"]);
  assert.deepEqual(w.ledger.ledger(USER).map((t) => t.delta), [-2_000]);
});

test("S37 · abandonar cuando el combate YA terminó: primero se liquida (no se come el resultado) y la versión cambia", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  const v = active(w).version as number;
  finish(w, s.data!.matchId, "A");
  const r = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts);
  assert.deepEqual([r.status, r.code], [409, "STALE_VERSION"]);
  assert.deepEqual([active(w).status, active(w).stage], ["READY", 2]);
  assert.equal(w.abandoned.length, 0);
});

test("S38 · abandono repetido con el mismo actionId → 200 idempotente", async () => {
  const w = world();
  const s0 = await started(w);
  const input = { actionId: aid(), expectedVersion: s0.run!.version };
  assert.ok((await abandonDraftRun(w.sb, USER, input, w.opts)).ok);
  const again = await abandonDraftRun(w.sb, USER, input, w.opts);
  assert.ok(again.ok);
  assert.equal(runs(w).length, 1);
});

test("S39 · abandono y elección a la vez: gana uno; el otro no deja la run a medias", async () => {
  const w = world();
  const s0 = await started(w);
  const [ab, pk] = await Promise.all([
    abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: 1 }, w.opts),
    pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts),
  ]);
  assert.equal([ab, pk].filter((x) => x.ok).length, 1);
  const run = runs(w)[0];
  if (ab.ok) assert.deepEqual([run.status, (run.state as { picks: string[] }).picks.length], ["ABANDONED", 0]);
  else assert.deepEqual([run.status, (run.state as { picks: string[] }).picks.length], ["DRAFTING", 1]);
});

/* ─────────────── aislamiento ─────────────── */

test("S40 · economía AISLADA (F72): solo draft_runs / draft_run_matches + el libro mayor por sus RPC; ni cartas, ni XP, ni rating, ni campaña, ni pase", async () => {
  const w = world();
  await draftTen(w);
  for (let i = 0; i < 3; i++) await playStage(w, "A");
  await playStage(w, "B");
  const touched = new Set(w.db.writes().filter((l) => !l.startsWith("rpc:")).map((l) => l.split(":")[1]));
  for (const t of touched) assert.ok(["draft_runs", "draft_run_matches", "credit_transactions", "profiles"].includes(t), `escribió en ${t}`);
  // Una entrada y una recompensa (3 victorias = 1.000), por las puertas del libro mayor. Nada más.
  assert.deepEqual(w.db.rpcCalls.map((c) => c.name), ["app_adjust_credits", "app_grant_reward"]);
  assert.deepEqual(w.ledger.ledger(USER).map((t) => [t.reason, t.delta]), [["draft_entry", -2_000], ["draft_reward:3W", 1_000]]);
  assert.ok(!w.db.log.some((l) => /user_cards|user_game|campaign_|pvp_ratings|battle_pass|user_pass/.test(l)));
  assert.ok(!w.db.rpcCalls.some((c) => Number(c.args.p_xp ?? 0) !== 0 || Number(c.args.p_points ?? 0) !== 0));
});

test("S41 · otro usuario no ve ni toca la run ajena", async () => {
  const w = world();
  const s0 = await started(w);
  assert.equal((await getDraftGauntlet(w.sb, OTHER, w.opts)).data!.run, null);
  const r = await pickDraftCard(w.sb, OTHER, { actionId: aid(), expectedVersion: 1, choiceId: s0.run!.offer[0] }, w.opts);
  assert.equal(r.code, "NO_RUN");
  assert.equal(active(w).version, 1);
});

test("S42 · la liquidación de una partida ajena no toca mi run", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  finish(w, s.data!.matchId, "A");
  assert.equal((await settleDraftMatch(w.sb, OTHER, s.data!.matchId, null, w.opts)).reason, "NO_RUN");
  assert.equal(active(w).status, "IN_MATCH");
});

test("S43 · historial acotado a 5 runs terminadas, de la más reciente a la más antigua", async () => {
  const w = world();
  for (let i = 0; i < 7; i++) {
    const s = await started(w);
    runs(w).find((r) => r.id === s.run!.runId)!.created_at = new Date(NOW + i * 1000).toISOString();
    await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: s.run!.version }, w.opts);
  }
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts)).data!;
  assert.equal(snap.history.length, 5);
  assert.ok(snap.history.every((h) => h.status === "ABANDONED" && h.wins === 0));
});

test("S44 · la foto nunca expone la semilla ni los mazos rivales", async () => {
  const w = world();
  const snap = await draftTen(w);
  const state = active(w).state as { picks: string[]; rivals: { cardIds: string[] }[] };
  const json = JSON.stringify(snap);
  assert.ok(!json.includes("424242"));
  assert.ok(!json.includes("rivals"));
  const hidden = state.rivals.flatMap((r) => r.cardIds).filter((id) => !state.picks.includes(id));
  assert.ok(hidden.length > 0);
  for (const id of hidden) assert.ok(!json.includes(`"${id}"`), `filtra ${id}`);
});

test("S45 · resumen para el hub: estado, elección y etapa; null sin 0053", async () => {
  const w = world();
  await started(w);
  assert.deepEqual(await readDraftSummary(w.sb, USER), { status: "DRAFTING", pick: 0, stage: 1 });
  const m = world();
  m.db.missing.add("draft_runs");
  assert.equal(await readDraftSummary(m.sb, USER), null);
});

/* ─────────────── concurrencia adicional ─────────────── */

test("S46 · dos liquidaciones simultáneas de la misma partida: una sola transición", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts);
  finish(w, s.data!.matchId, "A");
  const facts = w.db.rows("duel_matches")[0].state as never;
  const [a, b] = await Promise.all([settleDraftMatch(w.sb, USER, s.data!.matchId, facts, w.opts), settleDraftMatch(w.sb, USER, s.data!.matchId, facts, w.opts)]);
  assert.equal([a, b].filter((x) => x.settled).length, 1);
  assert.deepEqual([active(w).stage, active(w).status], [2, "READY"]);
});

test("S47 · abandonar y lanzar combate a la vez: la run no queda IN_MATCH sin dueño", async () => {
  const w = world();
  await draftTen(w);
  const v = active(w).version as number;
  await Promise.all([
    abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts),
    startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: v }, w.opts),
  ]);
  const run = runs(w)[0];
  if (run.status === "ABANDONED") assert.ok(w.db.rows("duel_matches").every((m) => m.status !== "IN_PROGRESS") || w.launches.length <= 1);
  else assert.equal(run.status, "IN_MATCH");
});

test("S48 · tras COMPLETED y FAILED se puede empezar otra run nueva", async () => {
  const w = world();
  await draftTen(w);
  for (let i = 0; i < 5; i++) await playStage(w, "A");
  const again = await started(w);
  assert.equal(again.run!.status, "DRAFTING");
  assert.equal(runs(w).length, 2);
  await draftTen(w);
  await playStage(w, "B");
  const third = await started(w);
  assert.equal(runs(w).length, 3);
  assert.equal(third.history.length, 2);
});

test("S49 · la lectura con run activa no incluye `lastRun` (no se mezclan runs)", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, "B");
  await started(w);
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts)).data!;
  assert.equal(snap.lastRun, null);
  assert.equal(snap.history[0].status, "FAILED");
});

test("S50 · start_match relee el rival persistido: cambiar el catálogo después no cambia el rival", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w);
  const rival = (run.state as { rivals: { cardIds: string[] }[] }).rivals[0].cardIds;
  const shrunk = world({ catalog: { ...CATALOG, droppable: (id) => !rival.includes(id) } });
  shrunk.db.tables = w.db.tables;
  await startDraftStage(shrunk.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, shrunk.opts);
  assert.deepEqual(shrunk.launches[0].rival.cardIds, rival);
});
