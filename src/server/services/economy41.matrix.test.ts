/**
 * FASE 41 · MATRIZ DE 100 CASOS DE ECONOMÍA (M001–M100) sobre los servicios reales y `MemSupabase`.
 *
 *   S · Sobre Inicial gratis (24)  P · compra de sobres (20)  M · misiones una vez (16)  R · recompensas (10)
 *   V · reciclaje (10)  C · tienda de prueba cerrada (5)  X · prestigio (5)  G · lecturas sin escrituras (5)
 *   L · invariantes del libro mayor tras secuencias hostiles (5)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { MemSupabase } from "./testing/memSupabase";
import { buyPack } from "./packs";
import { readStarterStatus } from "./starter";
import { claimMission, peekProgression, assignMission } from "./progression";
import { sandboxPurchase, getCredits } from "./credits";
import { salvageCards } from "./economy";
import { buyPrestige } from "./prestige";
import { award } from "./rewards";
import { getCompetitiveSnapshot, getCompetitivePosition } from "./competitive";
import { runSequence, newStats } from "./testing/economyFuzz";
import { getPack } from "@/data/packs";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { bucketForRank } from "@/domain/packs/types";
import { salvageValue } from "@/domain/economy/salvage";
import { CREDIT_PRODUCTS } from "@/domain/economy/drlCredits";
import { CURRENT_SEASON } from "@/data/season";
import { freshPassState } from "@/battlepass/season";
import { masterySets } from "@/domain/collection/mastery";
import { fullBadgeOf, PRESTIGE_TIERS, prestigeId } from "@/domain/collection/prestige";
import { DUEL_ROLES } from "@/domain/cardgame/types";

const U = "dddddddd-0000-4000-8000-000000000041";
const V2 = "eeeeeeee-0000-4000-8000-000000000041";
const REG = new CardRegistry();
const READ_ONLY_RPC = new Set(["app_content_distribution_snapshot"]);
let n = 0;
const M = (label: string, fn: () => Promise<void>) => { n++; test(`M${String(n).padStart(3, "0")} · ${label}`, fn); };

const credits = (db: MemSupabase, u = U) => Number(db.table("profiles").find((p) => p.id === u)!.credits);
const ledger = (db: MemSupabase, u = U, reason?: string) => db.table("credit_transactions").filter((t) => t.user_id === u && (!reason || t.reason === reason));
function db0(creditsStart = 6000) { const db = new MemSupabase(); db.seedUser(U, creditsStart); return db; }
// `seen` compartido entre roles: un jugador puede tener cartas de roles distintos y nunca cuenta dos veces.
function playersOfRole(role: string, k: number, seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const c of REG.cards) { const p = REG.player(c.playerId); if ((c.role ?? p?.role) !== role || seen.has(c.playerId)) continue; seen.add(c.playerId); out.push(c.id); if (out.length >= k) break; }
  return out;
}
function giveCards(db: MemSupabase, ids: string[], u = U) {
  ids.forEach((card_id) => db.table("user_cards").push({ uid: `c-${db.table("user_cards").length}`, user_id: u, card_id, serial: null, origin: "pack", locked: false, minted_version: null }));
}
const COLLECTIONS: Record<string, () => string[]> = {
  "vacía": () => [],
  "3 duelistas": () => playersOfRole("Duelista", 3),
  "sin Centinela": () => { const seen = new Set<string>(); return DUEL_ROLES.filter((r) => r !== "Centinela").flatMap((r) => playersOfRole(r, 2, seen)); },
  "plantilla posible": () => { const seen = new Set<string>(); return DUEL_ROLES.flatMap((r) => playersOfRole(r, 2, seen)); },
};

/* ───────────── S · 24 ───────────── */
for (const [name, cards] of Object.entries(COLLECTIONS)) {
  for (const unopened of [0, 1]) {
    for (const claims of [0, 7, 8]) {
      M(`S · colección ${name} · Iniciales sin abrir ${unopened} · concesiones ${claims}`, async () => {
        const db = db0();
        for (const p of db.table("user_packs")) p.qty = p.pack_id === "inicial" ? unopened : 0;
        giveCards(db, cards());
        for (let i = 0; i < claims; i++) db.insertRow("credit_transactions", { user_id: U, delta: 0, reason: "buy_pack:inicial", ref: `old-${i}`, balance_after: 6000 });
        const ready = name === "plantilla posible";
        const expected = !ready && unopened === 0 && claims < 8;
        const r = await buyPack(db.client, U, "inicial", "try");
        assert.equal(r.ok, expected);
        assert.equal(ledger(db, U, "buy_pack:inicial").length, claims + (expected ? 1 : 0));
        assert.equal(credits(db), 6000);
        const st = await readStarterStatus(db.client, U);
        assert.equal(st.deckReady, ready);
      });
    }
  }
}

/* ───────────── P · 20 ───────────── */
for (const packId of ["estandar", "premium", "masters", "icon", "emea", "prime", "team-loud", "no-existe"]) {
  for (const start of [700, 30_000]) {
    M(`P · comprar ${packId} con ${start} créditos`, async () => {
      const db = db0(start);
      const pack = getPack(packId);
      const buyable = !!pack && packLifecycle(pack) === "ACTIVE" && pack.price <= start;
      const r = await buyPack(db.client, U, packId, `b-${packId}`);
      assert.equal(r.ok, buyable);
      assert.equal(credits(db), buyable ? start - pack!.price : start);
      assert.ok(credits(db) >= 0);
    });
  }
}
for (const [label, times] of [["mismo gesto ×2", 2], ["mismo gesto ×5", 5]] as const) {
  M(`P · reintento Estándar ${label}: un cobro`, async () => {
    const db = db0();
    for (let i = 0; i < times; i++) await buyPack(db.client, U, "estandar", "same");
    assert.equal(credits(db), 6000 - getPack("estandar")!.price); // Fase 57.4: el precio canónico, no un literal
  });
}
M("P · 4 compras simultáneas con saldo para 2: saldo nunca negativo", async () => {
  const db = db0(2 * getPack("estandar")!.price);
  await Promise.all([0, 1, 2, 3].map((i) => buyPack(db.client, U, "estandar", `c${i}`)));
  assert.equal(credits(db), 0);
  assert.equal(ledger(db, U, "buy_pack:estandar").length, 2);
});
M("P · el precio lo pone el servidor: el asiento es exactamente −precio canónico", async () => {
  const db = db0();
  await buyPack(db.client, U, "estandar", "x");
  assert.equal(Number(ledger(db, U, "buy_pack:estandar")[0].delta), -getPack("estandar")!.price);
});

/* ───────────── M · 16 ───────────── */
function withMission(db: MemSupabase, id: string) {
  const def = CURRENT_SEASON.missionPool.find((m) => m.id === id)!;
  const state = freshPassState(CURRENT_SEASON.id);
  state.missions = [assignMission(def, {}, Date.now())];
  db.insertRow("user_pass", { user_id: U, season_id: CURRENT_SEASON.id, state, updated_at: "2026-09-16T00:00:00.000Z" });
  return def;
}
function progress(db: MemSupabase, metric: string, goal: number) {
  for (let i = 0; i < goal; i++) {
    if (metric === "duels_played" || metric === "duels_won") db.table("duel_matches").push({ id: `m${db.table("duel_matches").length}`, user_id: U, status: "COMPLETED", winner: "A", mode: "PVE" });
    // SANEAMIENTO POST F47 · `pickem_answers` no tiene `user_id` (0012): cuelga de `pickem_submissions`.
    if (metric === "picks_made") {
      if (!db.table("pickem_submissions").some((r) => r.id === `s-${U}`)) db.table("pickem_submissions").push({ id: `s-${U}`, user_id: U, pickem_event_id: "ev-m" });
      db.table("pickem_answers").push({ id: `p${db.table("pickem_answers").length}`, submission_id: `s-${U}`, created_at: new Date().toISOString() });
    }
    if (metric === "decks_saved") db.table("duel_decks").push({ id: `d${i}`, user_id: U });
  }
  if (metric === "packs_opened") db.table("user_game").find((g) => g.user_id === U)!.packs_opened = goal;
  if (metric === "distinct_cards") giveCards(db, REG.cards.slice(0, goal).map((c) => c.id));
  if (metric === "region_set") db.table("profiles").find((p) => p.id === U)!.region = "EMEA";
  if (metric === "points") db.table("profiles").find((p) => p.id === U)!.points = goal;
}
for (const def of CURRENT_SEASON.missionPool) {
  M(`M · ${def.id} (${def.kind}): se cobra UNA vez aunque el progreso se triplique`, async () => {
    const db = db0();
    withMission(db, def.id);
    progress(db, def.metric, def.goal);
    const r1 = await claimMission(db.client, U, def.id);
    assert.ok(r1.ok, r1.error);
    progress(db, def.metric, def.goal * 3);
    const r2 = await claimMission(db.client, U, def.id);
    assert.equal(r2.ok, false);
    assert.equal(ledger(db, U, "mission_reward").length, 1);
    assert.equal(Number((db.table("user_pass")[0].state as { xp: number }).xp) >= (def.xp ?? 0), true);
  });
}
M("M · progreso insuficiente (goal − 1): 409 sin pago ni XP", async () => {
  const db = db0(); const def = withMission(db, "w-duelos-5");
  progress(db, def.metric, def.goal - 1);
  assert.equal((await claimMission(db.client, U, def.id)).ok, false);
  assert.equal(ledger(db, U, "mission_reward").length, 0);
  assert.equal(Number((db.table("user_pass")[0].state as { xp: number }).xp), 0);
});
M("M · misión inexistente: 409 sin pago", async () => {
  const db = db0(); withMission(db, "d-abrir-1");
  assert.equal((await claimMission(db.client, U, "no-existe")).ok, false);
  assert.equal(ledger(db, U, "mission_reward").length, 0);
});

/* ───────────── R · 10 ───────────── */
for (const c of [0, 1, 120, 350]) {
  M(`R · recompensa de ${c} créditos: se concede una vez`, async () => {
    const db = db0();
    await award(db.client, { userId: U, ref: `r:${c}`, reason: "t", reward: { credits: c } });
    await award(db.client, { userId: U, ref: `r:${c}`, reason: "t", reward: { credits: c } });
    assert.equal(credits(db), 6000 + c);
  });
}
for (const [label, reward] of [["créditos −1", { credits: -1 }], ["XP −10", { xp: -10 }], ["sobres −2", { packId: "estandar", packCount: -2 }]] as const) {
  M(`R · recompensa negativa (${label}): rechazada sin asiento`, async () => {
    const db = db0();
    await assert.rejects(award(db.client, { userId: U, ref: "neg", reason: "t", reward }));
    assert.equal(ledger(db).length, 1);
  });
}
M("R · recompensa sin clave: rechazada", async () => {
  const db = db0();
  await assert.rejects(award(db.client, { userId: U, ref: "", reason: "t", reward: { credits: 10 } }));
});
M("R · puntos negativos: el suelo de puntos es 0 (no afecta a créditos)", async () => {
  const db = db0();
  await award(db.client, { userId: U, ref: "pts", reason: "t", reward: {}, points: -50 });
  assert.equal(Number(db.table("profiles")[0].points), 0); assert.equal(credits(db), 6000);
});
M("R · recompensa con sobre: el sobre llega al inventario, una vez", async () => {
  const db = db0();
  for (let i = 0; i < 3; i++) await award(db.client, { userId: U, ref: "pk", reason: "t", reward: { packId: "premium", packCount: 1 } });
  assert.equal(Number(db.table("user_packs").find((p) => p.pack_id === "premium")!.qty), 1);
});

/* ───────────── V · 10 ───────────── */
const byBucket = (b: string) => REG.cards.find((c) => bucketForRank(REG.variant(c.variantId).rank) === b)!;
for (const b of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
  M(`V · reciclar duplicada ${b}: paga ${salvageValue(byBucket(b))} (salvageValue del servidor, F57.5)`, async () => {
    const db = db0();
    const card = byBucket(b);
    giveCards(db, [card.id, card.id]);
    const r = await salvageCards(db.client, U, ["c-0", "c-1"], `salvage:${U}:v-${b}`);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.equal(credits(db), 6000 + salvageValue(card));
    assert.equal(db.table("user_cards").length, 1);
  });
}
M("V · única copia: no se recicla", async () => {
  const db = db0(); giveCards(db, [REG.cards[0].id]);
  assert.equal((await salvageCards(db.client, U, ["c-0"], `salvage:${U}:one`)).ok, false);
  assert.equal(credits(db), 6000);
});
M("V · cartas de otro jugador: no se tocan ni se pagan", async () => {
  const db = db0(); db.seedUser(V2);
  giveCards(db, [REG.cards[0].id, REG.cards[0].id], V2);
  assert.equal((await salvageCards(db.client, U, ["c-0", "c-1"], `salvage:${U}:foreign`)).ok, false);
  assert.equal(db.table("user_cards").length, 2); assert.equal(credits(db), 6000);
});
M("V · reintento con la misma clave: +0", async () => {
  const db = db0(); const c = byBucket("rare"); giveCards(db, [c.id, c.id, c.id]);
  // Se conserva una copia (la vista previa ofrece las otras dos).
  await salvageCards(db.client, U, ["c-0", "c-1", "c-2"], `salvage:${U}:same`);
  await salvageCards(db.client, U, ["c-0", "c-1", "c-2"], `salvage:${U}:same`);
  assert.equal(credits(db), 6000 + 2 * salvageValue(c));
});
M("V · carta bloqueada (listada): no se recicla", async () => {
  const db = db0(); const c = byBucket("common"); giveCards(db, [c.id, c.id]);
  db.table("user_cards")[1].locked = true;
  const r = await salvageCards(db.client, U, ["c-1"], `salvage:${U}:locked`);
  assert.equal(r.ok, false); assert.equal(credits(db), 6000);
});
M("V · lista vacía: rechazada", async () => {
  const db = db0();
  assert.equal((await salvageCards(db.client, U, [], `salvage:${U}:empty`)).ok, false);
});

/* ───────────── C · 5 ───────────── */
for (const p of CREDIT_PRODUCTS) {
  M(`C · tienda de prueba cerrada: ${p.productId} (${p.credits}) → 403, +0`, async () => {
    const prev = process.env.NEXUS_SANDBOX_CREDITS; delete process.env.NEXUS_SANDBOX_CREDITS;
    try {
      const db = db0();
      const r = await sandboxPurchase(db.client, U, p.productId, `s-${p.productId}`);
      assert.equal(r.ok, false); assert.equal((r as { status: number }).status, 403); assert.equal(credits(db), 6000);
    } finally { if (prev !== undefined) process.env.NEXUS_SANDBOX_CREDITS = prev; }
  });
}

/* ───────────── X · 5 ───────────── */
const SET = masterySets().find((s) => fullBadgeOf(s)) ?? null;
function prestigeDb(start = 200_000, u = U) {
  const db = new MemSupabase(); db.seedUser(u, start);
  if (SET) db.insertRow("user_cosmetics", { user_id: u, cosmetic_id: fullBadgeOf(SET)!, source: "mastery" });
  return db;
}
for (const tier of PRESTIGE_TIERS) {
  M(`X · escalón ${tier.id}: cobra ${tier.price} solo con el anterior`, async () => {
    if (!SET) return;
    const db = prestigeDb();
    for (const t of PRESTIGE_TIERS.filter((x) => x.rank < tier.rank)) db.insertRow("user_cosmetics", { user_id: U, cosmetic_id: prestigeId(fullBadgeOf(SET)!, t.id), source: "prestige" });
    const r = await buyPrestige(db.client, U, SET.id, tier.id);
    assert.ok(r.ok, r.error);
    assert.equal(credits(db), 200_000 - tier.price);
  });
}
M("X · sin la insignia base: 409 y +0", async () => {
  if (!SET) return;
  const db = new MemSupabase(); db.seedUser(U, 200_000);
  assert.equal((await buyPrestige(db.client, U, SET.id, "plata")).ok, false);
  assert.equal(credits(db), 200_000);
});
M("X · dos jugadores, mismo escalón: los dos pagan (clave por jugador)", async () => {
  if (!SET) return;
  const db = prestigeDb(); db.seedUser(V2, 200_000); db.insertRow("user_cosmetics", { user_id: V2, cosmetic_id: fullBadgeOf(SET)!, source: "mastery" });
  await buyPrestige(db.client, U, SET.id, "plata"); await buyPrestige(db.client, V2, SET.id, "plata");
  assert.equal(credits(db, U), 185_000); assert.equal(credits(db, V2), 185_000);
});

/* ───────────── G · 5 ───────────── */
const reads: [string, (db: MemSupabase) => Promise<unknown>][] = [
  ["GET starter", (db) => readStarterStatus(db.client, U)],
  ["peekProgression (temporada/vestíbulo)", (db) => peekProgression(db.client, U)],
  ["GET competitivo (snapshot)", (db) => getCompetitiveSnapshot(db.client, U)],
  ["GET competitivo (posición)", (db) => getCompetitivePosition(db.client, U)],
  ["GET créditos", (db) => getCredits(db.client, U)],
];
for (const [label, fn] of reads) {
  M(`G · ${label}: cero escrituras y cero RPC económicas`, async () => {
    const db = db0(); const w = db.writes; const r = db.rpcCalls.length;
    await fn(db);
    assert.equal(db.writes, w, db.writeLog.slice(w).join(","));
    assert.deepEqual(db.rpcCalls.slice(r).filter((x) => !READ_ONLY_RPC.has(x)), []);
  });
}

/* ───────────── L · 5 ───────────── */
for (const seed of [41_001, 41_002, 41_003, 41_004, 41_005]) {
  M(`L · secuencia hostil ${seed}: saldo = libro mayor, sin negativos, claves únicas`, async () => {
    const stats = newStats(); const e = console.error; console.error = () => {};
    try { await runSequence(seed, stats); } finally { console.error = e; }
    assert.deepEqual(stats.violations, []);
  });
}

test("la matriz tiene exactamente 100 casos", () => { assert.equal(n, 100); });
