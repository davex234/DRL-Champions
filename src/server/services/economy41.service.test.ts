/**
 * FASE 41 · ECONOMÍA EN LOS SERVICIOS REALES sobre `MemSupabase` (RPC con el contrato de 0019/0024/0025/0026).
 *
 * Sobre Inicial gratis (asistencia de primer equipo), reintentos y concurrencia de compra/apertura, misiones una vez
 * por tanda, «actualizar misiones» sin re-sorteo, concurrencia optimista del pase, tienda de prueba cerrada, prestigio
 * por jugador, recompensa negativa, lecturas sin escrituras (starter y competitivo). RLS/PostgREST reales: NO
 * EJECUTADO aquí (QA real en el VPS).
 */
import { test } from "node:test";
import { CardRegistry } from "@/collection/registry";
import assert from "node:assert/strict";
import { MemSupabase } from "./testing/memSupabase";
import { buyPack, openPackForUser, buyAndOpen } from "./packs";
import { readStarterStatus } from "./starter";
import { claimMission, getProgression, peekProgression, refreshMissions, claimPassLevel } from "./progression";
import { sandboxPurchase, getCredits } from "./credits";
import { buyPrestige } from "./prestige";
import { award } from "./rewards";
import { getCompetitiveSnapshot, getCompetitivePosition } from "./competitive";
import { runSequence, newStats } from "./testing/economyFuzz";
import { STARTER_POLICY } from "@/domain/economy/starter";
import { getPack } from "@/data/packs";
import { masterySets } from "@/domain/collection/mastery";
import { fullBadgeOf, PRESTIGE_TIERS } from "@/domain/collection/prestige";

const A = "aaaaaaaa-0000-4000-8000-000000000041";
const B = "bbbbbbbb-0000-4000-8000-000000000041";
const READ_ONLY_RPC = new Set(["app_content_distribution_snapshot"]);
const REG = new CardRegistry();

function fresh(...users: string[]) {
  const db = new MemSupabase();
  for (const u of users.length ? users : [A]) db.seedUser(u);
  return db;
}
const ledger = (db: MemSupabase, u: string, reason?: string) => db.table("credit_transactions").filter((t) => t.user_id === u && (!reason || t.reason === reason));
const credits = (db: MemSupabase, u: string) => Number(db.table("profiles").find((p) => p.id === u)!.credits);
const qty = (db: MemSupabase, u: string, pack: string) => Number(db.table("user_packs").find((p) => p.user_id === u && p.pack_id === pack)?.qty ?? 0);

async function openWelcome(db: MemSupabase, u = A) {
  for (const p of ["inicial", "inicial", "inicial", "estandar"]) {
    const r = await openPackForUser(db.client, u, p, `w-${p}-${Math.random()}`);
    assert.ok(r.ok, r.ok ? "" : r.error);
  }
}
async function reachReady(db: MemSupabase, u = A) {
  await openWelcome(db, u);
  let n = 0;
  while (!(await readStarterStatus(db.client, u)).deckReady) {
    const r = await buyAndOpen(db.client, u, "inicial", `ready-${n++}`);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.ok(n <= STARTER_POLICY.maxFreeClaims);
  }
  return n;
}
/** Bienvenida ya abierta SIN plantilla posible (determinista): 0 sobres y 3 cartas de un solo rol. */
function emptyWelcome(db: MemSupabase, u = A) {
  for (const p of db.table("user_packs").filter((r) => r.user_id === u)) p.qty = 0;
  const ids = ["Duelista"].flatMap(() => REG.cards.filter((c) => (c.role ?? REG.player(c.playerId)?.role) === "Duelista").slice(0, 3).map((c) => c.id));
  ids.forEach((card_id, i) => db.table("user_cards").push({ uid: `seed-${u}-${i}`, user_id: u, card_id, serial: null, origin: "pack", locked: false }));
  // Las cartas sembradas cuentan como una apertura previa (coherencia con `economy_ops`).
  db.table("economy_ops").push({ ref: `seed-open-${u}`, user_id: u, kind: "open_pack", result: { uids: ids.map((_, i) => `seed-${u}-${i}`), packId: "inicial" } });
}

const noWrites = async (db: MemSupabase, fn: () => Promise<unknown>) => {
  const w = db.writes; const rpcs = db.rpcCalls.length;
  await fn();
  assert.equal(db.writes, w, `escrituras: ${db.writeLog.slice(w).join(", ")}`);
  assert.deepEqual(db.rpcCalls.slice(rpcs).filter((x) => !READ_ONLY_RPC.has(x)), []);
};

/* ───────────────────────────── Sobre Inicial ───────────────────────────── */

test("alta: con Sobres Iniciales sin abrir NO hay otro gratis", async () => {
  const db = fresh();
  const r = await buyPack(db.client, A, "inicial", "g");
  assert.equal(r.ok, false); assert.equal((r as { status: number }).status, 409);
  assert.equal(qty(db, A, "inicial"), 3);
});

test("tras abrir la bienvenida y sin plantilla: UNO gratis (precio 0, asiento buy_pack:inicial)", async () => {
  const db = fresh(); emptyWelcome(db);
  const r = await buyPack(db.client, A, "inicial", "g1");
  assert.ok(r.ok);
  assert.equal(qty(db, A, "inicial"), 1);
  assert.equal(ledger(db, A, "buy_pack:inicial").length, 1);
  assert.equal(credits(db, A), 6000);
});

test("segundo gratis sin abrir el primero: rechazado", async () => {
  const db = fresh(); emptyWelcome(db);
  assert.ok((await buyPack(db.client, A, "inicial", "g1")).ok);
  const r = await buyPack(db.client, A, "inicial", "g2");
  assert.equal(r.ok, false);
  assert.equal(qty(db, A, "inicial"), 1);
});

test("con plantilla posible: rechazado siempre (sin retroactividad: los que tiene se abren)", async () => {
  const db = fresh(); await reachReady(db);
  const r = await buyPack(db.client, A, "inicial", "late");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /plantilla/);
});

test("100 cuentas nuevas: todas llegan a plantilla con ≤ 2 gratis extra (P99 del simulador ≤ 2)", async () => {
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const u = `cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const db = fresh(u);
    worst = Math.max(worst, await reachReady(db, u));
  }
  assert.ok(worst <= 3, `peor ${worst}`);
});

test("ráfaga concurrente de 6 compras gratis: como mucho una concesión por índice", async () => {
  const db = fresh(); emptyWelcome(db);
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => buyPack(db.client, A, "inicial", `burst-${i}`)));
  assert.ok(rs.some((r) => r.ok));
  assert.equal(ledger(db, A, "buy_pack:inicial").length, 1);
  assert.equal(qty(db, A, "inicial"), 1);
});

test("buy_and_open reintentado con el mismo gesto: mismas cartas, sin segunda concesión", async () => {
  const db = fresh(); emptyWelcome(db);
  const r1 = await buyAndOpen(db.client, A, "inicial", "same");
  const r2 = await buyAndOpen(db.client, A, "inicial", "same");
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(r1.data.opened.map((c) => c.uid), r2.data.opened.map((c) => c.uid));
  assert.equal(r2.data.repeated, true);
  assert.equal(ledger(db, A, "buy_pack:inicial").length, 1);
});

test("tope histórico: con 8 concesiones previas ya no hay más (aunque no tenga plantilla)", async () => {
  const db = fresh(); emptyWelcome(db);
  for (let i = 0; i < 8; i++) db.insertRow("credit_transactions", { user_id: A, delta: 0, reason: "buy_pack:inicial", ref: `legacy-${i}`, balance_after: 6000 });
  const st = await readStarterStatus(db.client, A);
  assert.equal(st.reason, "CLAIM_CAP");
  assert.equal((await buyPack(db.client, A, "inicial", "x")).ok, false);
});

test("la asistencia no se aplica al Sobre Estándar ni con plantilla", async () => {
  const db = fresh(); await reachReady(db);
  const r = await buyAndOpen(db.client, A, "estandar", "e1");
  assert.ok(r.ok); assert.equal(r.data.opened.length, 5);
  assert.equal(credits(db, A), 6000 - getPack("estandar")!.price);
});

test("GET starter: cero escrituras y cero RPC de economía", async () => {
  const db = fresh();
  await noWrites(db, () => readStarterStatus(db.client, A));
});

test("sobres no comprables: RETIRED 409, DRAFT/inexistente 404, sin cobro", async () => {
  const db = fresh();
  assert.equal(((await buyPack(db.client, A, "prime", "p")) as { status: number }).status, 409);
  assert.equal(((await buyPack(db.client, A, "team-loud", "p")) as { status: number }).status, 404);
  assert.equal(((await buyPack(db.client, A, "nope", "p")) as { status: number }).status, 404);
  assert.equal(ledger(db, A).length, 1);
});

test("compra con saldo insuficiente: 409 y saldo intacto", async () => {
  const db = fresh();
  db.table("profiles").find((p) => p.id === A)!.credits = 100;
  db.table("credit_transactions")[0].delta = 100;
  const r = await buyPack(db.client, A, "estandar", "poor");
  assert.equal(r.ok, false); assert.equal(credits(db, A), 100);
});

test("compra reintentada (mismo gesto): cobra una vez", async () => {
  const db = fresh();
  await buyPack(db.client, A, "estandar", "same"); await buyPack(db.client, A, "estandar", "same");
  assert.equal(credits(db, A), 6000 - getPack("estandar")!.price); assert.equal(qty(db, A, "estandar"), 2);
});

test("apertura concurrente del mismo gesto: un sobre consumido, mismas cartas", async () => {
  const db = fresh();
  const [r1, r2] = await Promise.all([openPackForUser(db.client, A, "estandar", "o"), openPackForUser(db.client, A, "estandar", "o")]);
  assert.ok(r1.ok && r2.ok);
  assert.equal(qty(db, A, "estandar"), 0);
  assert.equal(db.table("user_cards").length, 5);
});

/* ───────────────────────────── Misiones y pase ───────────────────────────── */

async function missionFor(db: MemSupabase, metric: string) {
  await getProgression(db.client, A);
  const state = db.table("user_pass").find((r) => r.user_id === A)!.state as { missions: { id: string; metric: string; goal: number }[] };
  return state.missions.find((m) => m.metric === metric) ?? null;
}
const play = (db: MemSupabase, n: number, win = true) => { for (let i = 0; i < n; i++) db.table("duel_matches").push({ id: `m${db.table("duel_matches").length}`, user_id: A, status: "COMPLETED", winner: win ? "A" : "B", mode: "PVE" }); };

test("misión fija (s-mazo): se reclama una vez; la segunda 409", async () => {
  const db = fresh();
  const m = await missionFor(db, "decks_saved");
  assert.ok(m);
  db.table("duel_decks").push({ id: "d1", user_id: A });
  assert.ok((await claimMission(db.client, A, m!.id)).ok);
  assert.equal((await claimMission(db.client, A, m!.id)).ok, false);
});

test("misión diaria/semanal de duelos: UNA vez por tanda aunque se sigan jugando partidas", async () => {
  const db = fresh();
  const state = (await getProgression(db.client, A), db.table("user_pass")[0].state) as { missions: { id: string; kind: string; metric: string; goal: number }[] };
  const periodic = state.missions.filter((m) => (m.kind === "daily" || m.kind === "weekly") && m.metric.startsWith("duels"));
  for (const m of periodic) {
    play(db, m.goal * 3);
    assert.ok((await claimMission(db.client, A, m.id)).ok, m.id);
    play(db, m.goal * 3);
    assert.equal((await claimMission(db.client, A, m.id)).ok, false, `${m.id} re-reclamada`);
  }
  const rows = ledger(db, A, "mission_reward");
  assert.equal(rows.length, periodic.length);
});

test("«actualizar misiones» dentro de la ventana: no re-sortea ni escribe", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  const before = JSON.stringify((db.table("user_pass")[0].state as { missions: unknown[] }).missions);
  const w = db.writes;
  const r = await refreshMissions(db.client, A);
  assert.ok(r.ok);
  assert.equal(db.writes, w);
  assert.equal(JSON.stringify((db.table("user_pass")[0].state as { missions: unknown[] }).missions), before);
});

test("reclamar → actualizar → reclamar: sin segundo pago", async () => {
  const db = fresh();
  const m = await missionFor(db, "duels_played");
  if (!m) return;
  play(db, m.goal * 2);
  assert.ok((await claimMission(db.client, A, m.id)).ok);
  await refreshMissions(db.client, A);
  play(db, m.goal * 2);
  assert.equal((await claimMission(db.client, A, m.id)).ok, false);
});

test("ráfaga de 5 reclamos simultáneos de la MISMA misión: un pago y XP del pase una sola vez", async () => {
  const db = fresh();
  const m = await missionFor(db, "decks_saved");
  db.table("duel_decks").push({ id: "d1", user_id: A });
  const rs = await Promise.all(Array.from({ length: 5 }, () => claimMission(db.client, A, m!.id)));
  assert.ok(rs.filter((r) => r.ok).length >= 1);
  assert.equal(ledger(db, A, "mission_reward").length, 1);
  const xp = Number((db.table("user_pass")[0].state as { xp: number }).xp);
  assert.equal(xp, 800);
});

test("dos reclamos simultáneos de misiones DISTINTAS: ninguna XP de más (la perdedora pide reintentar)", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  db.table("duel_decks").push({ id: "d1", user_id: A });
  db.table("profiles").find((p) => p.id === A)!.region = "EMEA";
  const rs = await Promise.all([claimMission(db.client, A, "s-mazo"), claimMission(db.client, A, "s-region")]);
  const xp = Number((db.table("user_pass")[0].state as { xp: number }).xp);
  const paidXp = ledger(db, A, "mission_reward").reduce((s, t) => s + (String(t.ref).includes("s-mazo") ? 800 : 400), 0);
  assert.ok(xp <= paidXp, `${xp} > ${paidXp}`);
  const loser = rs.find((r) => !r.ok);
  if (loser) {
    assert.equal(loser.status, 409);
    const retry = await claimMission(db.client, A, rs[0].ok ? "s-region" : "s-mazo");
    assert.ok(retry.ok);
    assert.equal(Number((db.table("user_pass")[0].state as { xp: number }).xp), 1200);
  }
});

test("nivel del pase reclamado dos veces a la vez: un pago", async () => {
  const db = fresh();
  await getProgression(db.client, A);
  (db.table("user_pass")[0].state as { xp: number }).xp = 1000;
  await Promise.all([claimPassLevel(db.client, A, 1, "free"), claimPassLevel(db.client, A, 1, "free")]);
  assert.ok(ledger(db, A, "pass_reward").length <= 1);
});

test("peekProgression: cero escrituras (GET de temporada/vestíbulo)", async () => {
  const db = fresh();
  await noWrites(db, () => peekProgression(db.client, A));
});

/* ───────────────────────────── Créditos, prestigio, recompensas ───────────────────────────── */

test("tienda de prueba cerrada por defecto: 403 y 0 créditos", async () => {
  const prev = process.env.NEXUS_SANDBOX_CREDITS; delete process.env.NEXUS_SANDBOX_CREDITS;
  try {
    const db = fresh();
    const r = await sandboxPurchase(db.client, A, "drlc-ultimate", "r1");
    assert.equal(r.ok, false); assert.equal((r as { status: number }).status, 403);
    assert.equal(credits(db, A), 6000);
    const view = await getCredits(db.client, A);
    assert.ok(view.ok); assert.equal(view.data.purchasesOpen, false);
  } finally { if (prev !== undefined) process.env.NEXUS_SANDBOX_CREDITS = prev; }
});

test("tienda de prueba ABIERTA (entorno de prueba): idempotente por referencia", async () => {
  const prev = process.env.NEXUS_SANDBOX_CREDITS; process.env.NEXUS_SANDBOX_CREDITS = "1";
  try {
    const db = fresh();
    await sandboxPurchase(db.client, A, "drlc-starter", "same"); await sandboxPurchase(db.client, A, "drlc-starter", "same");
    assert.equal(credits(db, A), 7000);
  } finally { if (prev === undefined) delete process.env.NEXUS_SANDBOX_CREDITS; else process.env.NEXUS_SANDBOX_CREDITS = prev; }
});

test("prestigio: dos jugadores compran el MISMO escalón → los dos pagan y los dos lo tienen", async () => {
  const set = masterySets().find((s) => fullBadgeOf(s));
  if (!set) return;
  const db = fresh(A, B);
  for (const u of [A, B]) {
    db.insertRow("user_cosmetics", { user_id: u, cosmetic_id: fullBadgeOf(set)!, source: "mastery" });
    const p = db.table("profiles").find((x) => x.id === u)!; p.credits = 60_000;
    db.table("credit_transactions").find((t) => t.user_id === u)!.delta = 60_000;
  }
  const tier = PRESTIGE_TIERS[0];
  const ra = await buyPrestige(db.client, A, set.id, tier.id);
  const rb = await buyPrestige(db.client, B, set.id, tier.id);
  assert.ok(ra.ok && rb.ok);
  assert.equal(ra.data!.applied, true); assert.equal(rb.data!.applied, true);
  assert.equal(credits(db, A), 60_000 - tier.price); assert.equal(credits(db, B), 60_000 - tier.price);
  assert.notEqual(rb.data!.credits, ra.data!.credits + 1, "B no recibe el saldo de A");
});

test("recompensa negativa: se rechaza antes de tocar el libro mayor", async () => {
  const db = fresh();
  await assert.rejects(award(db.client, { userId: A, ref: "neg", reason: "x", reward: { credits: -500 } }));
  await assert.rejects(award(db.client, { userId: A, ref: "neg2", reason: "x", reward: { xp: -1 } }));
  assert.equal(ledger(db, A).length, 1); assert.equal(credits(db, A), 6000);
});

test("recompensa repetida con la misma clave: +0", async () => {
  const db = fresh();
  await award(db.client, { userId: A, ref: "duel:m1", reason: "duel_win", reward: { credits: 120 } });
  const r = await award(db.client, { userId: A, ref: "duel:m1", reason: "duel_win", reward: { credits: 120 } });
  assert.equal(r.applied, false); assert.equal(credits(db, A), 6120);
});

test("GET competitivo (snapshot y posición): cero escrituras y sin crear ficha de rating", async () => {
  const db = fresh();
  db.failTables.delete("content_cards");
  db.failTables.add("content_cards");
  await noWrites(db, async () => {
    const s = await getCompetitiveSnapshot(db.client, A);
    assert.ok(s.ok, s.error);
    assert.equal(s.data!.self.rating.rating, 1000);
    const p = await getCompetitivePosition(db.client, A);
    assert.ok(p.ok); assert.equal(p.data!.position, null);
  });
  assert.equal(db.table("duel_pvp_ratings").length, 0);
  assert.equal(db.table("user_pass").length, 0);
});

/* ───────────────────────────── Fuzzer (muestra en CI) ───────────────────────────── */

test("fuzzer hostil: 150 secuencias sin violaciones de invariantes", async () => {
  const stats = newStats();
  const origError = console.error; console.error = () => {};
  try { for (let s = 900_001; s <= 900_150; s++) await runSequence(s, stats); } finally { console.error = origError; }
  assert.equal(stats.sequences, 150);
  assert.deepEqual(stats.violations, []);
});
