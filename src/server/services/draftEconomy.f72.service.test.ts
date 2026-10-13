/**
 * F72 · DRAFT GAUNTLET — ECONOMÍA (D1–D16) sobre `MemorySupabase` + el libro mayor en memoria (`ledgerRpc`, contrato de
 * `app_adjust_credits` 0019 y `app_grant_reward` 0026, con `credit_tx_ref_uniq`).
 *
 * Entrada cobrada una vez por run pase lo que pase (doble clic, reintento, recarga, dos pestañas, fallo a medias),
 * recompensas por victorias concedidas solo por el servidor y una sola vez, gran premio semanal con tope por la clave
 * del libro mayor, conciliación libro mayor ↔ saldo ↔ inventario y nada fuera del modo tocado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CardRegistry } from "@/collection/registry";
import type { DuelMatchView } from "@/lib/duel/types";
import { ACTIVE_STATUSES, FINAL_STATUSES } from "@/domain/draft/rules";
import {
  DRAFT_CHAMPION_TITLE, DRAFT_ENTRY_FEE, DRAFT_JACKPOT, DRAFT_REWARD_CREDITS, draftExpectedValue, draftRewardFor, entryRef,
  isoWeekKey, jackpotRef, rewardRef,
} from "@/domain/draft/economy";
import { MemorySupabase } from "./testing/memorySupabase";
import { installLedger } from "./testing/ledgerRpc";
import {
  abandonDraftRun, getDraftGauntlet, pickDraftCard, settleDraftMatch, startDraftRun, startDraftStage,
  type DraftCatalog, type DraftLauncher, type DraftOptions,
} from "./draftGauntlet";
import { BODY_KEYS } from "@/app/api/game/draft-gauntlet/route";
import { getPack } from "@/data/packs";
import { duelPayoutTable, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { salvageValue } from "@/domain/economy/salvage";

const REG = new CardRegistry();
const CATALOG: DraftCatalog = { cards: REG.cards, card: (id) => REG.card(id), player: (id) => REG.player(id), droppable: () => true };
const T0 = Date.parse("2026-09-29T12:00:00.000Z"); // martes, semana 2026-W40
const USER = "00000000-0000-4000-8000-0000000000f1";
const aid = () => randomUUID();

function world(credits = 20_000) {
  const db = new MemorySupabase();
  db.unique.draft_runs = [{ cols: ["user_id"], where: (r) => (ACTIVE_STATUSES as readonly unknown[]).includes(r.status) }];
  db.unique.draft_run_matches = [{ cols: ["run_id", "stage"] }, { cols: ["match_id"], where: (r) => r.match_id != null }];
  db.defaults.draft_runs = () => ({ id: randomUUID() });
  db.defaults.draft_run_matches = () => ({});
  db.tables.duel_matches = [];
  const ledger = installLedger(db, [{ userId: USER, credits }]);
  const clock = { now: T0 };
  const launch: DraftLauncher = async (_sb, userId, input) => {
    db.rows("duel_matches").push({ id: input.matchId, user_id: userId, mode: "DRAFT_GAUNTLET", status: "IN_PROGRESS", state: { status: "IN_PROGRESS", result: null } });
    return { ok: true, status: 200, data: { view: { matchId: input.matchId } as unknown as DuelMatchView } };
  };
  const opts = (): DraftOptions => ({
    catalog: CATALOG, now: clock.now, launch, seed: () => 777,
    deckCheck: () => ({ valid: true, errors: [], snapshot: null }),
    abandonMatch: async (_sb, userId, matchId) => {
      db.tables.duel_matches = db.rows("duel_matches").filter((m) => !(m.id === matchId && m.user_id === userId));
      return { ok: true, status: 200, data: { deleted: 1 } };
    },
  });
  return { db, sb: db.client, ledger, clock, opts };
}
type W = ReturnType<typeof world>;

const runs = (w: W) => w.db.rows("draft_runs");
const active = (w: W) => runs(w).find((r) => r.user_id === USER && (ACTIVE_STATUSES as readonly unknown[]).includes(r.status));
const entries = (w: W) => w.ledger.ledger(USER).filter((t) => t.reason === "draft_entry");
const rewards = (w: W) => w.ledger.ledger(USER).filter((t) => String(t.reason).startsWith("draft_reward:"));
const jackpots = (w: W) => w.ledger.ledger(USER).filter((t) => String(t.reason).startsWith("draft_jackpot:"));

async function enter(w: W) {
  const r = await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts());
  assert.ok(r.ok, `${r.code} ${r.error}`);
  return r.data!;
}

async function draftTen(w: W) {
  let snap = await enter(w);
  for (let i = 0; i < 10; i++) {
    const run = snap.run!;
    const r = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: run.version, choiceId: run.offer[0] }, w.opts());
    assert.ok(r.ok, `pick ${i}: ${r.code}`);
    snap = r.data!;
  }
  return snap;
}

async function playStage(w: W, winner: "A" | "B") {
  const run = active(w)!;
  const s = await startDraftStage(w.sb, USER, { actionId: aid(), expectedVersion: run.version as number }, w.opts());
  assert.ok(s.ok, `${s.code} ${s.error}`);
  const m = w.db.rows("duel_matches").find((r) => r.id === s.data!.matchId)!;
  m.status = "COMPLETED";
  m.state = { status: "COMPLETED", result: { winner, isDraw: false, scoreA: winner === "A" ? 6 : 3, scoreB: winner === "A" ? 4 : 7 } };
  await settleDraftMatch(w.sb, USER, s.data!.matchId, m.state as never, w.opts());
  return s.data!.matchId;
}

/** Una run completa: `wins` victorias y, si no son 5, una derrota. Devuelve el id de la run. */
async function runWith(w: W, wins: number): Promise<string> {
  await draftTen(w);
  const id = active(w)!.id as string;
  for (let i = 0; i < wins; i++) await playStage(w, "A");
  if (wins < 5) await playStage(w, "B");
  return id;
}

/* ───────────────────────────── D1–D7 · entrada ───────────────────────────── */

test("D1 · entrada normal: se crea la run, se cobra EXACTAMENTE la entrada con la clave de la run y queda pagada", async () => {
  const w = world(20_000);
  const snap = await enter(w);
  const run = active(w)!;
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE);
  assert.deepEqual(entries(w).map((t) => [t.ref, t.delta, t.balance_after]), [[entryRef(run.id as string), -DRAFT_ENTRY_FEE, 18_000]]);
  assert.deepEqual(snap.run!.entry, { fee: DRAFT_ENTRY_FEE, paid: true });
  assert.equal(snap.run!.status, "DRAFTING");
  assert.equal(snap.run!.version, 1);
});

test("D2 · saldo insuficiente: 402, sin run y sin tocar el libro mayor (también si el saldo cae entre comprobar y cobrar)", async () => {
  const w = world(DRAFT_ENTRY_FEE - 1);
  const r = await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts());
  assert.deepEqual([r.status, r.code], [402, "INSUFFICIENT_CREDITS"]);
  assert.equal(runs(w).length, 0);
  assert.equal(w.ledger.ledger(USER).length, 0);
  assert.equal(w.ledger.credits(USER), DRAFT_ENTRY_FEE - 1);

  // Carrera: pasa la comprobación con 2.000 y otro gasto se lleva el saldo antes del cobro.
  const w2 = world(DRAFT_ENTRY_FEE);
  const real = w2.db.rpcHandlers.app_adjust_credits;
  w2.db.rpcHandlers.app_adjust_credits = (a) => { w2.db.rows("profiles")[0].credits = 500; return real(a); };
  const r2 = await startDraftRun(w2.sb, USER, { actionId: aid() }, w2.opts());
  assert.deepEqual([r2.status, r2.code], [402, "INSUFFICIENT_CREDITS"]);
  assert.equal(runs(w2).length, 0, "la run creada se borra");
  assert.equal(w2.ledger.ledger(USER).length, 0);
});

test("D3 · doble clic (dos peticiones a la vez, acciones distintas): UNA run y UN cargo", async () => {
  const w = world();
  const [a, b] = await Promise.all([
    startDraftRun(w.sb, USER, { actionId: aid() }, w.opts()),
    startDraftRun(w.sb, USER, { actionId: aid() }, w.opts()),
  ]);
  assert.ok(a.ok && b.ok);
  assert.equal(runs(w).length, 1);
  // La perdedora pudo ver la run aún sin pagar; volver a entrar la completa sin cobrar otra vez.
  await enter(w);
  assert.equal(entries(w).length, 1);
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE);
});

test("D4 · reintento de red (misma acción repetida, respuesta perdida): nunca un segundo cargo", async () => {
  const w = world();
  const id = aid();
  for (let i = 0; i < 4; i++) assert.ok((await startDraftRun(w.sb, USER, { actionId: id }, w.opts())).ok);
  assert.equal(entries(w).length, 1);
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE);
});

test("D5 · recargar (GET repetido) no cobra ni escribe", async () => {
  const w = world();
  await enter(w);
  const before = w.db.writes().length;
  for (let i = 0; i < 5; i++) assert.ok((await getDraftGauntlet(w.sb, USER, w.opts())).ok);
  assert.equal(w.db.writes().length, before);
  assert.equal(entries(w).length, 1);
});

test("D6 · dos pestañas y cobro que falla a medias: la run queda pendiente (no se puede elegir) y la siguiente entrada cobra UNA vez", async () => {
  const w = world();
  w.ledger.failNext("app_adjust_credits");
  const first = await startDraftRun(w.sb, USER, { actionId: aid() }, w.opts());
  assert.deepEqual([first.status, first.code], [503, "ENTRY_FAILED"]);
  const pending = active(w)!;
  assert.equal(entries(w).length, 0);
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts())).data!;
  assert.deepEqual(snap.run!.entry, { fee: DRAFT_ENTRY_FEE, paid: false });
  const pick = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: 1, choiceId: snap.run!.offer[0] }, w.opts());
  assert.deepEqual([pick.status, pick.code], [402, "ENTRY_PENDING"]);
  // Pestaña A y pestaña B vuelven a entrar a la vez.
  const [a, b] = await Promise.all([
    startDraftRun(w.sb, USER, { actionId: aid() }, w.opts()),
    startDraftRun(w.sb, USER, { actionId: aid() }, w.opts()),
  ]);
  assert.ok(a.ok && b.ok);
  assert.equal(runs(w).length, 1);
  assert.equal(active(w)!.id, pending.id, "misma run");
  assert.equal(entries(w).length, 1);
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE);
  const ok = await pickDraftCard(w.sb, USER, { actionId: aid(), expectedVersion: active(w)!.version as number, choiceId: snap.run!.offer[0] }, w.opts());
  assert.ok(ok.ok, `${ok.code}`);
});

test("D7 · run activa = CONTINUAR: entrar otra vez devuelve la misma run y no cobra", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, "A");
  const before = w.ledger.credits(USER);
  const again = await enter(w);
  assert.equal(again.run!.runId, active(w)!.id);
  assert.equal(again.run!.wins, 1);
  assert.equal(w.ledger.credits(USER), before);
  assert.equal(entries(w).length, 1);
});

/* ───────────────────────────── D8–D12 · recompensas ───────────────────────────── */

test("D8 · abandono = perder en esa etapa: durante el draft 0; tras 2 victorias, la tabla de 2; nunca devuelve la entrada", async () => {
  const w = world();
  await enter(w);
  const r0 = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: 1 }, w.opts());
  assert.ok(r0.ok);
  assert.equal(rewards(w).length, 0);
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE);
  assert.deepEqual(r0.data!.lastRun!.reward, { wins: 0, credits: 0, title: false, jackpot: false, jackpotPack: null, granted: true });

  await draftTen(w);
  await playStage(w, "A");
  await playStage(w, "A");
  const r2 = await abandonDraftRun(w.sb, USER, { actionId: aid(), expectedVersion: active(w)!.version as number }, w.opts());
  assert.ok(r2.ok);
  assert.deepEqual(rewards(w).map((t) => [t.reason, t.delta]), [["draft_reward:2W", DRAFT_REWARD_CREDITS[2]]]);
  assert.equal(w.ledger.credits(USER), 20_000 - 2 * DRAFT_ENTRY_FEE + DRAFT_REWARD_CREDITS[2]);
});

test("D9 · cada escalón paga su tabla (0–4 victorias y derrota)", async () => {
  for (let k = 0; k <= 4; k++) {
    const w = world();
    const runId = await runWith(w, k);
    assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE + DRAFT_REWARD_CREDITS[k], `k=${k}`);
    assert.deepEqual(rewards(w).map((t) => t.ref), k > 0 ? [rewardRef(runId)] : [], `k=${k}`);
    assert.equal(jackpots(w).length, 0);
    const final = runs(w).find((r) => r.id === runId)!;
    assert.equal(final.status, "FAILED");
    assert.equal((final.state as { reward: { grantedAt: string | null } }).reward.grantedAt !== null, true);
  }
});

test("D10 · gauntlet completado: 2.100 + título + Sobre Masters (el primero de la semana); el segundo de la semana sin sobre; la semana siguiente, otra vez", async () => {
  const w = world(50_000);
  const r1 = await runWith(w, 5);
  assert.deepEqual(rewards(w).map((t) => [t.ref, t.delta]), [[rewardRef(r1), DRAFT_REWARD_CREDITS[5]]]);
  assert.deepEqual(jackpots(w).map((t) => [t.ref, t.reason]), [[jackpotRef(USER, isoWeekKey(T0)), `draft_jackpot:${r1}`]]);
  assert.equal(w.ledger.packs(USER, DRAFT_JACKPOT.packId), 1);
  assert.deepEqual(w.ledger.cosmetics(USER), [DRAFT_CHAMPION_TITLE]);
  const snap1 = (await getDraftGauntlet(w.sb, USER, w.opts())).data!;
  assert.deepEqual(snap1.lastRun!.reward, { wins: 5, credits: 2_100, title: true, jackpot: true, jackpotPack: "Sobre Masters", granted: true });

  w.clock.now = T0 + 2 * 86_400_000; // jueves, misma semana
  const r2 = await runWith(w, 5);
  assert.equal(w.ledger.packs(USER, DRAFT_JACKPOT.packId), 1, "un sobre por semana");
  assert.equal(jackpots(w).length, 1);
  assert.equal((runs(w).find((r) => r.id === r2)!.state as { reward: { jackpot: boolean } }).reward.jackpot, false);
  assert.deepEqual(w.ledger.cosmetics(USER), [DRAFT_CHAMPION_TITLE], "el título, una vez");

  w.clock.now = T0 + 7 * 86_400_000; // semana siguiente
  await runWith(w, 5);
  assert.equal(w.ledger.packs(USER, DRAFT_JACKPOT.packId), 2);
  assert.equal(w.ledger.credits(USER), 50_000 - 3 * DRAFT_ENTRY_FEE + 3 * DRAFT_REWARD_CREDITS[5]);
});

test("D11 · reclamar otra vez (recarga, liquidación repetida, otra pestaña): la recompensa no se duplica", async () => {
  const w = world();
  await draftTen(w);
  for (let i = 0; i < 4; i++) await playStage(w, "A");
  const matchId = await playStage(w, "A");
  const m = w.db.rows("duel_matches").find((r) => r.id === matchId)!;
  const credits = w.ledger.credits(USER);
  await Promise.all([
    settleDraftMatch(w.sb, USER, matchId, m.state as never, w.opts()),
    getDraftGauntlet(w.sb, USER, w.opts()), getDraftGauntlet(w.sb, USER, w.opts()),
    startDraftRun(w.sb, USER, { actionId: aid() }, w.opts()).then(() => undefined),
  ]);
  assert.equal(rewards(w).length, 1);
  assert.equal(jackpots(w).length, 1);
  assert.equal(w.ledger.packs(USER, DRAFT_JACKPOT.packId), 1);
  // La entrada nueva (la de `start`) es lo único que movió saldo.
  assert.equal(w.ledger.credits(USER), credits - DRAFT_ENTRY_FEE);
});

test("D12 · fallo durante la recompensa: la run se cierra con la recompensa PENDIENTE y la siguiente lectura la concede una vez", async () => {
  const w = world();
  await draftTen(w);
  await playStage(w, "A");
  w.ledger.failNext("app_grant_reward");
  await playStage(w, "B");
  const closed = runs(w).find((r) => (FINAL_STATUSES as readonly unknown[]).includes(r.status))!;
  assert.equal((closed.state as { reward: { grantedAt: string | null } }).reward.grantedAt, null);
  assert.equal(rewards(w).length, 0);
  const snap = (await getDraftGauntlet(w.sb, USER, w.opts())).data!;
  assert.equal(snap.lastRun!.reward!.granted, true);
  assert.equal(rewards(w).length, 1);
  await getDraftGauntlet(w.sb, USER, w.opts());
  assert.equal(rewards(w).length, 1);
  assert.equal(w.ledger.credits(USER), 20_000 - DRAFT_ENTRY_FEE + DRAFT_REWARD_CREDITS[1]);
});

/* ───────────────────────────── D13–D16 · conciliación y fronteras ───────────────────────────── */

test("D13 · conciliación del libro mayor: saldo = inicial + Σ asientos; una entrada por run; ≤ 1 recompensa por run; ≤ 1 sobre por semana", async () => {
  const w = world(100_000);
  const plan = [0, 3, 5, 1, 5, 4, 2, 5];
  const ids: string[] = [];
  for (const [i, k] of plan.entries()) { w.clock.now = T0 + i * 36 * 3_600_000; ids.push(await runWith(w, k)); }
  const tx = w.ledger.ledger(USER);
  assert.equal(w.ledger.credits(USER), 100_000 + tx.reduce((s, t) => s + Number(t.delta), 0));
  for (let i = 1; i < tx.length; i++) assert.equal(Number(tx[i].balance_after), Number(tx[i - 1].balance_after) + Number(tx[i].delta));
  for (const id of ids) {
    assert.equal(tx.filter((t) => t.ref === entryRef(id)).length, 1);
    assert.ok(tx.filter((t) => t.ref === rewardRef(id)).length <= 1);
  }
  const weeks = jackpots(w).map((t) => String(t.ref));
  assert.equal(new Set(weeks).size, weeks.length);
  const expected = plan.reduce((s, k) => s - DRAFT_ENTRY_FEE + DRAFT_REWARD_CREDITS[k], 100_000);
  assert.equal(w.ledger.credits(USER), expected);
});

test("D14 · conciliación del inventario: sobres Masters = asientos de gran premio aplicados", async () => {
  const w = world(100_000);
  for (let i = 0; i < 4; i++) { w.clock.now = T0 + i * 4 * 86_400_000; await runWith(w, 5); }
  assert.equal(w.ledger.packs(USER, DRAFT_JACKPOT.packId), jackpots(w).length);
  assert.equal(new Set(jackpots(w).map((t) => t.ref)).size, jackpots(w).length);
});

test("D15 · el cliente no decide nada: ninguna acción admite recompensa, victorias, créditos, entrada ni sobre", () => {
  const forbidden = ["reward", "wins", "credits", "fee", "entry", "jackpot", "pack", "packId", "amount", "price", "result", "stage"];
  for (const keys of Object.values(BODY_KEYS)) for (const f of forbidden) assert.ok(!keys.includes(f), f);
  assert.deepEqual(BODY_KEYS.start, ["action", "actionId"]);
});

test("D16 · nada fuera del modo cambia: precios de sobres, pago de duelos, tope diario y desguace intactos", () => {
  assert.deepEqual(["estandar", "premium", "oro", "masters", "champions", "icon"].map((id) => getPack(id)?.price), [2_500, 6_000, 12_000, 20_000, 35_000, 80_000]); // F80 + ICON Premium 80.000 (2026-10-09)
  assert.equal(getPack(DRAFT_JACKPOT.packId)?.price, DRAFT_JACKPOT.packPrice);
  const t = duelPayoutTable();
  assert.deepEqual([t.win.EASY.credits, t.win.NORMAL.credits, t.win.HARD.credits, t.loss.HARD.credits], [120, 220, 350, 60]);
  assert.equal(DAILY_DUEL_AWARD_CAP, 20);
  assert.ok(salvageValue(REG.cards[0]) >= 5);
  // El valor esperado de la tabla base es negativo incluso para la cota ORACLE medida (motor real, 5.000 runs).
  assert.ok(draftExpectedValue([0, 0.0054, 0.0052, 0.0924, 0.0762, 0.8208]).ev < 0);
  assert.deepEqual(draftRewardFor(7), draftRewardFor(5));
  assert.deepEqual(draftRewardFor(-3), draftRewardFor(0));
});

test("D17 · runs anteriores a F72 (sin entrada) siguen gratis y sin recompensa", async () => {
  const w = world();
  await draftTen(w);
  const run = active(w)!;
  delete (run.state as { entry?: unknown }).entry; // así quedaron las runs de la Fase 39
  await playStage(w, "A");
  await playStage(w, "B");
  assert.equal(rewards(w).length, 0);
  assert.equal((runs(w)[0].state as { reward?: unknown }).reward, undefined);
});
