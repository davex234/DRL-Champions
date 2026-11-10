/**
 * ROAD TO CHAMPIONS · SERVICIO (Fase 35) — integración con la partida (51–60), seguridad e idempotencia
 * (61–74) y degradación sin 0051 (95–99), sobre `MemorySupabase`.
 *
 * La partida la «crea» un lanzador inyectado que inserta una fila en `duel_matches` como haría el PvE canónico;
 * el motor real está cubierto por sus propias pruebas. Postgres real (índices parciales, RLS, `app_grant_reward`):
 * NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CardRegistry } from "@/collection/registry";
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import type { DuelMatchView } from "@/lib/duel/types";
import { MemorySupabase } from "./testing/memorySupabase";
import {
  getCampaign, getCampaignDefinition, startCampaignNode, settleCampaignMatch, reconcileCampaign, syncCampaign,
  abandonCampaignAttempt, readCampaignSummary, opponentPlans, firstClearRefForMatch, RESERVATION_TTL_MS, UNAVAILABLE_MESSAGE, type CampaignLauncher,
} from "./campaign";

const REG = new CardRegistry();
const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const DECK = "00000000-0000-4000-8000-00000000d001";

function world() {
  const db = new MemorySupabase();
  db.unique.campaign_attempts = [
    { cols: ["user_id"], where: (r) => r.status === "STARTED" },
    { cols: ["match_id"], where: (r) => r.match_id != null },
    { cols: ["user_id", "campaign_id", "node_id"], where: (r) => r.first_clear === true },
  ];
  db.unique.campaign_progress = [{ cols: ["user_id", "campaign_id", "node_id"] }];
  let n = 0;
  db.defaults.campaign_attempts = () => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, status: "STARTED", match_id: null, result: null,
    first_clear: false, reward_granted: false, created_at: new Date(NOW).toISOString(), settled_at: null,
  });
  db.tables.duel_matches = [];
  const ledger = new Map<string, number>();
  let rewardFailures = 0;
  db.rpcHandlers.app_grant_reward = (a) => {
    if (rewardFailures > 0) { rewardFailures--; return { data: null, error: { message: "ledger down" } }; }
    const ref = String(a.p_ref);
    if (ledger.has(ref)) return { data: { applied: false, credits: 0 }, error: null };
    ledger.set(ref, Number(a.p_credits));
    return { data: { applied: true, credits: Number(a.p_credits) }, error: null };
  };
  const launches: { userId: string; deckId: string; level: string; cardIds: string[]; name: string }[] = [];
  let launchResult: "ok" | "deck" = "ok";
  const launch: CampaignLauncher = async (_sb, userId, deckId, level, rival) => {
    launches.push({ userId, deckId, level, cardIds: [...rival.cardIds], name: rival.name });
    if (launchResult === "deck") return { ok: false, status: 409, error: "Ese mazo no es legal" };
    const id = randomUUID();
    db.rows("duel_matches").push({ id, user_id: userId, mode: "PVE", status: "IN_PROGRESS", state: { result: null } });
    return { ok: true, status: 200, data: { view: { matchId: id, difficulty: level } as unknown as DuelMatchView } };
  };
  return {
    db, sb: db.client, ledger, launches,
    opts: { catalog: REG, now: NOW, launch },
    failRewards: (k: number) => { rewardFailures = k; },
    failLaunch: () => { launchResult = "deck"; },
  };
}
type World = ReturnType<typeof world>;

function finish(w: World, matchId: string, winner: "A" | "B" | null) {
  const m = w.db.rows("duel_matches").find((r) => r.id === matchId)!;
  m.status = winner === null ? "DRAW" : "COMPLETED";
  m.state = { result: { winner, isDraw: winner === null } };
}

async function play(w: World, nodeId: string, winner: "A" | "B" | null, viaHook = true) {
  const r = await startCampaignNode(w.sb, USER, { nodeId, deckId: DECK }, w.opts);
  assert.ok(r.ok, `${nodeId}: ${r.code} ${r.error}`);
  const id = r.data!.view.matchId;
  finish(w, id, winner);
  const s = viaHook
    ? await settleCampaignMatch(w.sb, USER, id, { status: winner === null ? "DRAW" : "COMPLETED", result: { winner, isDraw: winner === null } }, w.opts)
    : null;
  return { id, s, start: r };
}

const attempts = (w: World) => w.db.rows("campaign_attempts");
const progress = (w: World, nodeId: string) => w.db.rows("campaign_progress").find((r) => r.node_id === nodeId && r.user_id === USER);

/* ─────────────── 51–60 · integración con la partida ─────────────── */

test("T51 · lanzar un nodo: reserva el intento, lanza el PvE con la dificultad y el rival del NODO y enlaza la partida", async () => {
  const w = world();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  assert.ok(r.ok);
  assert.equal(w.launches.length, 1);
  const plan = opponentPlans(ROAD_TO_CHAMPIONS, REG).get("c1-n1")!;
  assert.ok(plan.ok);
  assert.deepEqual(w.launches[0], { userId: USER, deckId: DECK, level: "EASY", cardIds: plan.cards.map((c) => c.cardId), name: plan.teamName });
  assert.equal(r.data!.view.rivalLabel, plan.teamName);
  assert.equal(r.data!.replay, false);
  const [att] = attempts(w);
  assert.equal(att.status, "STARTED");
  assert.equal(att.match_id, r.data!.view.matchId);
  assert.equal(att.campaign_version, "rtc-2");
});

test("T52 · la dificultad del bot la fija el nodo: el jefe del capítulo 2 va en HARD", async () => {
  const w = world();
  for (const id of ["c1-n1", "c1-n2", "c1-n3", "c1-n4", "c1-n5", "c2-n1", "c2-n2", "c2-n3", "c2-n4"]) await play(w, id, "A");
  await play(w, "c2-n5", "A");
  assert.deepEqual(w.launches.map((l) => l.level), ["EASY", "EASY", "EASY", "NORMAL", "NORMAL", "NORMAL", "NORMAL", "NORMAL", "HARD", "HARD"]);
});

test("T53 · victoria → NODO COMPLETADO, intento liquidado con primera victoria y pago único de 50", async () => {
  const w = world();
  const { id, s } = await play(w, "c1-n1", "A");
  assert.deepEqual({ settled: s!.settled, outcome: s!.outcome, first: s!.firstClear }, { settled: true, outcome: "WIN", first: true });
  assert.equal(progress(w, "c1-n1")!.status, "COMPLETED");
  const att = attempts(w).find((a) => a.match_id === id)!;
  assert.deepEqual({ st: att.status, r: att.result, fc: att.first_clear, rg: att.reward_granted }, { st: "SETTLED", r: "WIN", fc: true, rg: true });
  assert.deepEqual([...w.ledger], [["campaign:road-to-champions:c1-n1", 50]]);
});

test("T54 · liquidar dos veces la misma partida es un no-op (ni intento doble, ni pago doble)", async () => {
  const w = world();
  const { id } = await play(w, "c1-n1", "A");
  const again = await settleCampaignMatch(w.sb, USER, id, { status: "COMPLETED", result: { winner: "A", isDraw: false } }, w.opts);
  assert.equal(again.settled, false);
  const sync = await reconcileCampaign(w.sb, USER, w.opts);
  assert.equal(sync.settled.length, 0);
  assert.equal(progress(w, "c1-n1")!.attempts, 1);
  assert.equal(w.db.rpcCalls.length, 1);
});

test("T55 · derrota → INTÉNTALO DE NUEVO: intento contado, nodo disponible, sin pago", async () => {
  const w = world();
  await play(w, "c1-n1", "B");
  const p = progress(w, "c1-n1")!;
  assert.deepEqual({ s: p.status, a: p.attempts, b: p.best_result }, { s: "ATTEMPTED", a: 1, b: "LOSS" });
  const snap = await getCampaign(w.sb, USER, w.opts);
  assert.equal(snap.data!.chapters[0].nodes[0].status, "AVAILABLE");
  assert.equal(w.db.rpcCalls.length, 0);
});

test("T56 · empate → no completa ni paga; el siguiente sigue bloqueado", async () => {
  const w = world();
  await play(w, "c1-n1", null);
  assert.equal(progress(w, "c1-n1")!.status, "ATTEMPTED");
  const snap = (await getCampaign(w.sb, USER, w.opts)).data!;
  assert.equal(snap.chapters[0].nodes[1].status, "LOCKED");
  assert.equal(w.ledger.size, 0);
});

test("T57 · rejugar un nodo completado: permitido, `replay`, sin segunda primera victoria ni pago", async () => {
  const w = world();
  await play(w, "c1-n1", "A");
  const again = await play(w, "c1-n1", "A");
  assert.equal(again.start.data!.replay, true);
  assert.equal(again.s!.firstClear, false);
  const p = progress(w, "c1-n1")!;
  assert.deepEqual({ a: p.attempts, w: p.wins }, { a: 2, w: 2 });
  assert.equal(w.ledger.size, 1);
  assert.equal(attempts(w).filter((a) => a.first_clear).length, 1);
});

test("T58 · un nodo bloqueado no se lanza (409 LOCKED) y no reserva nada", async () => {
  const w = world();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n3", deckId: DECK }, w.opts);
  assert.deepEqual({ ok: r.ok, status: r.status, code: r.code }, { ok: false, status: 409, code: "LOCKED" });
  assert.equal(attempts(w).length, 0);
  assert.equal(w.launches.length, 0);
});

test("T59 · con una partida PvE en curso no se lanza otro nodo (409 ACTIVE_MATCH)", async () => {
  const w = world();
  w.db.rows("duel_matches").push({ id: randomUUID(), user_id: USER, mode: "PVE", status: "IN_PROGRESS", state: {} });
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  assert.equal(r.code, "ACTIVE_MATCH");
  assert.equal(attempts(w).length, 0);
});

test("T60 · el equipo lo valida el PvE canónico: equipo ilegal → 409 DECK_NOT_READY y la reserva se retira", async () => {
  const w = world();
  w.failLaunch();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  assert.deepEqual({ status: r.status, code: r.code }, { status: 409, code: "DECK_NOT_READY" });
  assert.equal(attempts(w).length, 0);
});

/* ─────────────── 61–74 · seguridad, concurrencia, reconciliación ─────────────── */

test("T61 · nodo inexistente → 404 sin lecturas de progreso ni escrituras", async () => {
  const w = world();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c9-n9", deckId: DECK }, w.opts);
  assert.equal(r.status, 404);
  assert.deepEqual(w.db.writes(), []);
});

test("T62 · doble clic / dos pestañas: dos lanzamientos simultáneos → una sola partida", async () => {
  const w = world();
  const [a, b] = await Promise.all([
    startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts),
    startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.ok(["ACTIVE_ATTEMPT", "ACTIVE_MATCH"].includes(([a, b].find((r) => !r.ok)!.code)!));
  assert.equal(w.launches.length, 1);
  assert.equal(attempts(w).filter((x) => x.status === "STARTED").length, 1);
});

test("T63 · liquidación concurrente (gancho de la partida + sync de otra pestaña) → una sola", async () => {
  const w = world();
  const { id } = await play(w, "c1-n1", "A", false);
  const facts = { status: "COMPLETED", result: { winner: "A" as const, isDraw: false } };
  const [x, y] = await Promise.all([settleCampaignMatch(w.sb, USER, id, facts, w.opts), reconcileCampaign(w.sb, USER, w.opts)]);
  assert.equal(Number(x.settled) + y.settled.length, 1);
  assert.equal(progress(w, "c1-n1")!.attempts, 1);
  assert.equal(w.ledger.size, 1);
});

test("T64 · reconexión: una partida terminada sin gancho se liquida al sincronizar", async () => {
  const w = world();
  await play(w, "c1-n1", "A", false);
  const snap = await syncCampaign(w.sb, USER, w.opts);
  assert.equal(snap.data!.chapters[0].nodes[0].status, "COMPLETED");
  assert.equal(snap.data!.lastAttempt!.result, "WIN");
  assert.equal(snap.data!.lastAttempt!.firstClear, true);
});

test("T65 · partida borrada (abandonada en la arena) → intento ABANDONED, sin intento contado", async () => {
  const w = world();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  w.db.tables.duel_matches = w.db.rows("duel_matches").filter((m) => m.id !== r.data!.view.matchId);
  await reconcileCampaign(w.sb, USER, w.opts);
  assert.equal(attempts(w)[0].status, "ABANDONED");
  assert.equal(progress(w, "c1-n1"), undefined);
});

test("T66 · reserva huérfana: más vieja que el TTL se abandona; reciente se respeta", async () => {
  const w = world();
  w.db.rows("campaign_attempts").push({ id: "old", user_id: USER, campaign_id: "road-to-champions", campaign_version: "rtc-1", node_id: "c1-n1", status: "STARTED", match_id: null, result: null, first_clear: false, reward_granted: false, created_at: new Date(NOW - RESERVATION_TTL_MS - 1).toISOString(), settled_at: null });
  w.db.rows("campaign_attempts").push({ id: "new", user_id: OTHER, campaign_id: "road-to-champions", campaign_version: "rtc-1", node_id: "c1-n1", status: "STARTED", match_id: null, result: null, first_clear: false, reward_granted: false, created_at: new Date(NOW - 1000).toISOString(), settled_at: null });
  await reconcileCampaign(w.sb, USER, w.opts);
  await reconcileCampaign(w.sb, OTHER, w.opts);
  assert.equal(attempts(w).find((a) => a.id === "old")!.status, "ABANDONED");
  assert.equal(attempts(w).find((a) => a.id === "new")!.status, "STARTED");
});

test("T67 · abandonar el nodo: partida en curso → se abandona; partida ya terminada → se liquida, no se borra", async () => {
  const w = world();
  const deleted: string[] = [];
  // Como `abandonMatch`: borra la fila de la partida.
  const abandon = async (_sb: unknown, _u: string, matchId: string) => {
    deleted.push(matchId);
    w.db.tables.duel_matches = w.db.rows("duel_matches").filter((m) => m.id !== matchId);
    return { ok: true, status: 200, data: { id: matchId } };
  };
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  await abandonCampaignAttempt(w.sb, USER, { ...w.opts, abandon });
  assert.deepEqual(deleted, [r.data!.view.matchId]);
  assert.equal(attempts(w)[0].status, "ABANDONED");

  const r2 = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  finish(w, r2.data!.view.matchId, "A");
  const snap = await abandonCampaignAttempt(w.sb, USER, { ...w.opts, abandon });
  assert.equal(deleted.length, 1);
  assert.equal(snap.data!.chapters[0].nodes[0].status, "COMPLETED");
});

test("T68 · el pago falla → progreso completo y pago pendiente; la reconciliación lo cobra UNA vez", async () => {
  const w = world();
  w.failRewards(1);
  await play(w, "c1-n1", "A");
  assert.equal(progress(w, "c1-n1")!.status, "COMPLETED");
  assert.equal(attempts(w)[0].reward_granted, false);
  await reconcileCampaign(w.sb, USER, w.opts);
  await reconcileCampaign(w.sb, USER, w.opts);
  assert.equal(attempts(w)[0].reward_granted, true);
  assert.deepEqual([...w.ledger.values()], [50]);
});

test("T69 · el progreso de un usuario no afecta a otro", async () => {
  const w = world();
  await play(w, "c1-n1", "A");
  const other = (await getCampaign(w.sb, OTHER, w.opts)).data!;
  assert.equal(other.summary.completed, 0);
  assert.equal(other.chapters[0].nodes[1].status, "LOCKED");
});

test("T70 · GET sin efectos: leer el mapa no escribe, no liquida y no paga", async () => {
  const w = world();
  await play(w, "c1-n1", "A", false);
  const before = w.db.writes().length;
  const snap = await getCampaign(w.sb, USER, w.opts);
  assert.ok(snap.ok);
  assert.equal(w.db.writes().length, before);
  assert.equal(w.db.rpcCalls.length, 0);
  assert.equal(snap.data!.activeAttempt!.nodeId, "c1-n1");
});

test("T71 · la foto no filtra ids internos, usuario ni el mazo del rival carta a carta", async () => {
  const w = world();
  const { id } = await play(w, "c1-n1", "A");
  const json = JSON.stringify((await getCampaign(w.sb, USER, w.opts)).data);
  const plan = opponentPlans(ROAD_TO_CHAMPIONS, REG).get("c1-n1")!;
  assert.ok(plan.ok);
  assert.ok(!json.includes(USER) && !json.includes("user_id") && !json.includes(String(attempts(w)[0].id)));
  for (const c of plan.cards) assert.ok(!json.includes(c.cardId), c.cardId);
  assert.ok(json.includes(id)); // el id de SU partida sí: sirve para enlazar el resultado
});

test("T72 · campaña ≠ ranked: solo se escribe en tablas de campaña y la única RPC es la de recompensa", async () => {
  const w = world();
  await play(w, "c1-n1", "A");
  await play(w, "c1-n2", "B");
  await syncCampaign(w.sb, USER, w.opts);
  const tables = new Set(w.db.writes().filter((l) => !l.startsWith("rpc:")).map((l) => l.split(":")[1]));
  assert.deepEqual([...tables].sort(), ["campaign_attempts", "campaign_progress"]);
  assert.deepEqual([...new Set(w.db.rpcCalls.map((c) => c.name))], ["app_grant_reward"]);
});

test("T73 · versión nueva sin reset: progreso escrito con rtc-0 sigue contando", async () => {
  const w = world();
  w.db.rows("campaign_progress").push({ user_id: USER, campaign_id: "road-to-champions", node_id: "c1-n1", campaign_version: "rtc-0", status: "COMPLETED", best_result: "WIN", attempts: 3, wins: 1, first_cleared_at: new Date(NOW - 1e6).toISOString(), first_clear_match_id: null, updated_at: new Date(NOW - 1e6).toISOString() });
  const snap = (await getCampaign(w.sb, USER, w.opts)).data!;
  assert.equal(snap.chapters[0].nodes[0].status, "COMPLETED");
  assert.equal(snap.chapters[0].nodes[1].status, "AVAILABLE");
});

test("T74 · un intento de un nodo retirado se liquida sin tocar progreso ni pagar", async () => {
  const w = world();
  const matchId = randomUUID();
  w.db.rows("duel_matches").push({ id: matchId, user_id: USER, mode: "PVE", status: "COMPLETED", state: { result: { winner: "A", isDraw: false } } });
  w.db.rows("campaign_attempts").push({ id: "gone", user_id: USER, campaign_id: "road-to-champions", campaign_version: "rtc-0", node_id: "c9-n9", status: "STARTED", match_id: matchId, result: null, first_clear: false, reward_granted: false, created_at: new Date(NOW).toISOString(), settled_at: null });
  const s = await settleCampaignMatch(w.sb, USER, matchId, null, w.opts);
  assert.deepEqual({ settled: s.settled, first: s.firstClear }, { settled: true, first: false });
  assert.equal(w.db.rows("campaign_progress").length, 0);
  assert.equal(w.ledger.size, 0);
});

/* ─────────────── 95–99 · sin 0051 aplicada ─────────────── */

function missing() {
  const w = world();
  w.db.missing.add("campaign_progress");
  w.db.missing.add("campaign_attempts");
  return w;
}

test("T95 · sin 0051: el mapa responde «no disponible» (200) con todo bloqueado", async () => {
  const w = missing();
  const r = await getCampaign(w.sb, USER, w.opts);
  assert.ok(r.ok);
  assert.deepEqual({ a: r.data!.available, why: r.data!.unavailableReason }, { a: false, why: "MIGRATION_PENDING" });
  assert.ok(r.data!.chapters.flatMap((c) => c.nodes).every((n) => n.status === "LOCKED"));
});

test("T96 · sin 0051: lanzar un nodo → 503 MIGRATION_PENDING, sin partida", async () => {
  const w = missing();
  const r = await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts);
  assert.deepEqual({ status: r.status, code: r.code, error: r.error }, { status: 503, code: "MIGRATION_PENDING", error: UNAVAILABLE_MESSAGE });
  assert.equal(w.launches.length, 0);
});

test("T97 · sin 0051: el gancho de la partida no rompe nada y no escribe", async () => {
  const w = missing();
  const s = await settleCampaignMatch(w.sb, USER, randomUUID(), { status: "COMPLETED", result: { winner: "A", isDraw: false } }, w.opts);
  assert.equal(s.reason, "MIGRATION_PENDING");
  assert.deepEqual(w.db.writes().filter((l) => !l.startsWith("select")), []);
});

test("T98 · sin 0051: el vestíbulo no propone la campaña (resumen `null`)", async () => {
  const w = missing();
  assert.equal(await readCampaignSummary(w.sb, USER, w.opts), null);
  const ok = world();
  await play(ok, "c1-n1", "A");
  const s = await readCampaignSummary(ok.sb, USER, ok.opts);
  assert.deepEqual({ c: s!.completed, t: s!.total, next: s!.next!.nodeId }, { c: 1, t: 15, next: "c1-n2" });
});

test("T99 · definición inválida o error interno: no disponible / 500 sin detalle en la foto", async () => {
  const w = world();
  const bad = structuredClone(ROAD_TO_CHAMPIONS);
  bad.chapters[0].nodes[0].difficulty = "CHAMPION";
  const r = await getCampaign(w.sb, USER, { ...w.opts, def: bad });
  assert.equal(r.data!.unavailableReason, "INVALID_DEFINITION");
  assert.equal((await startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, { ...w.opts, def: bad })).status, 503);
  const f = world();
  f.db.failing.add("campaign_progress");
  const e = await getCampaign(f.sb, USER, f.opts);
  assert.deepEqual({ ok: e.ok, status: e.status, code: e.code }, { ok: false, status: 500, code: "DB" });
  // La vista previa pública no lee progreso ni intentos: ni una consulta.
  const before = f.db.log.length;
  const pub = await getCampaignDefinition(f.sb, f.opts);
  assert.ok(pub.ok && pub.data!.available);
  assert.equal(f.db.log.length, before);
});

test("UX2 · recibo de campaña: la clave de la PRIMERA victoria solo para la partida que la consiguió y se pagó, de su dueño", async () => {
  const w = world();
  const won = await play(w, "c1-n1", "A");
  assert.equal(await firstClearRefForMatch(w.sb, USER, won.id), "campaign:road-to-champions:c1-n1");
  assert.ok(w.ledger.has("campaign:road-to-champions:c1-n1"), "es la misma clave con la que se concedió");
  assert.equal(await firstClearRefForMatch(w.sb, OTHER, won.id), null, "otra persona no obtiene nada");
  const replay = await play(w, "c1-n1", "A");
  assert.equal(await firstClearRefForMatch(w.sb, USER, replay.id), null, "repetir el nodo no vuelve a ser primera victoria");
  const lost = await play(w, "c1-n2", "B");
  assert.equal(await firstClearRefForMatch(w.sb, USER, lost.id), null, "una derrota no tiene primera victoria");
});
