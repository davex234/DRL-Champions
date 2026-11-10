/**
 * FASE 63 · ONBOARDING — SERVICIO contra un Supabase EN MEMORIA (escrituras reales en tablas, sin red).
 *
 * Idempotencia del inventario (el starter NO se vuelve a conceder: ninguna orden toca sobres, créditos, cartas ni el
 * libro mayor), órdenes ×1/×2/×10/paralelas ×10, «crear mi primer equipo» (solo cartas poseídas, validador canónico, un
 * único equipo aunque se pida diez veces a la vez), `finish` sin partida real y aislamiento entre cuentas.
 * Lo que NO prueba: GoTrue real (`app_metadata`), RLS ni PostgREST — eso lo cubre la QA real (`_fase63-live.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
import { FIRST_TEAM_NAME } from "@/domain/onboarding";
import { MemSupabase, type Row } from "./testing/memSupabase";
import { ensureFirstTeam, memoryFlagStore, readOnboarding, readOnboardingFacts, runOnboardingCommand } from "./onboarding";

/** MemSupabase + lo que la tabla real pone sola en `duel_decks` (id, fechas) + el RPC de 0050. */
class Db extends MemSupabase {
  constructor() {
    super();
    this.tables.duel_active_deck = [];
  }
  insertRow(name: string, row: Row) {
    if (name === "duel_decks") { const at = this.now(); Object.assign(row, { id: row.id ?? randomUUID(), created_at: at, updated_at: at }); }
    return super.insertRow(name, row);
  }
  rpc_duel_deck_activate(a: Record<string, unknown>): string {
    const d = this.table("duel_decks").find((r) => r.id === a.p_deck && r.user_id === a.p_user);
    if (!d) return "NOT_FOUND";
    const t = this.table("duel_active_deck");
    const i = t.findIndex((r) => r.user_id === a.p_user);
    const row = { user_id: a.p_user, deck_id: a.p_deck, updated_at: this.now() };
    if (i >= 0) t[i] = row; else t.push(row);
    this.logWrite("upsert:duel_active_deck");
    return "OK";
  }
}

const roleOf = (c: (typeof CARDS)[number]): RoleId | undefined => c.role ?? getPlayer(c.playerId)?.role;
/** `per` jugadores DISTINTOS por rol (una carta cada uno, rol de la CARTA). */
function cardsFor(per: Partial<Record<RoleId, number>>, skip = 0): string[] {
  const out: string[] = []; const used = new Set<string>(); const count: Partial<Record<RoleId, number>> = {};
  let skipped = 0;
  for (const c of [...CARDS].filter((x) => !!x.combat).sort((a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : 1))) {
    const r = roleOf(c);
    if (!r || used.has(c.playerId) || (count[r] ?? 0) >= (per[r] ?? 0)) continue;
    if (skipped < skip) { skipped++; continue; }
    used.add(c.playerId); count[r] = (count[r] ?? 0) + 1; out.push(c.id);
  }
  return out;
}
const TWO_EACH = Object.fromEntries(DUEL_ROLES.map((r) => [r, 2])) as Record<RoleId, number>;

/** Una cuenta tal como la deja `handle_new_user` (0011): perfil 6.000, 3 Iniciales + 1 Bronce, asiento starter. */
function newAccount(db: Db, userId: string, cards: string[] = []) {
  db.table("profiles").push({ id: userId, credits: 6000, xp: 0 });
  db.table("user_game").push({ user_id: userId, packs_opened: cards.length ? 1 : 0 });
  db.table("user_packs").push({ user_id: userId, pack_id: "inicial", qty: 3 }, { user_id: userId, pack_id: "estandar", qty: 1 });
  db.table("credit_transactions").push({ user_id: userId, delta: 6000, reason: "starter_grant", ref: `starter:${userId}`, balance_after: 6000 });
  cards.forEach((cardId, i) => db.table("user_cards").push({ uid: randomUUID(), user_id: userId, card_id: cardId, serial: null, origin: "pack", locked: false, obtained_at: new Date(Date.UTC(2026, 8, 26, 10, i)).toISOString() }));
}
const inventory = (db: Db, userId: string) => JSON.stringify(["profiles", "user_game", "user_packs", "credit_transactions", "user_cards", "card_mints", "economy_ops"]
  .map((t) => db.table(t).filter((r) => r.user_id === userId || r.id === userId)));
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

test("F63 S01 · cuenta recién creada: NOT_STARTED, recursos REALES del alta (6.000 créditos, 3 Iniciales + 1 Bronce)", async () => {
  const db = new Db(); newAccount(db, A);
  const v = await readOnboarding(db.client, A, (await memoryFlagStore().read(A)));
  assert.equal(v.status, "NOT_STARTED");
  assert.deepEqual(v.starter, { credits: 6000, packs: [{ packId: "estandar", qty: 1 }, { packId: "inicial", qty: 3 }] });
  assert.equal(v.context.firstPackId, "estandar", "la guía propone el Bronce primero (simulación F63)");
  assert.equal(db.writes, 0, "leer la guía no escribe");
});

test("F63 S02 · EMPEZAR ×1, ×2, ×10 y ×10 EN PARALELO: mismo inventario, guía en el paso 2 en todas las respuestas", async () => {
  for (const mode of ["x1", "x2", "x10", "par10"] as const) {
    const db = new Db(); newAccount(db, A);
    const store = memoryFlagStore();
    const before = inventory(db, A);
    const n = mode === "x1" ? 1 : mode === "x2" ? 2 : 10;
    const runs = mode === "par10"
      ? await Promise.all(Array.from({ length: n }, () => runOnboardingCommand(db.client, A, "start", store)))
      : await (async () => { const out = []; for (let i = 0; i < n; i++) out.push(await runOnboardingCommand(db.client, A, "start", store)); return out; })();
    for (const r of runs) { assert.ok(r.ok, mode); assert.equal(r.onboarding?.current, "open", mode); }
    assert.equal(inventory(db, A), before, `${mode}: el starter no se toca`);
    assert.equal(db.writes, 0, `${mode}: ni una escritura en tablas del juego`);
    if (mode !== "par10") assert.equal(runs.filter((r) => r.changed).length, 1, `${mode}: un solo acuse escrito`);
    assert.ok((await store.read(A)).startedAt !== null);
  }
});

test("F63 S03 · TERMINAR sin partida → 409 sin escribir; con una partida TERMINADA en la BD → cierra la guía", async () => {
  const db = new Db(); newAccount(db, A, cardsFor(TWO_EACH));
  const store = memoryFlagStore();
  await runOnboardingCommand(db.client, A, "start", store);
  const no = await runOnboardingCommand(db.client, A, "finish", store);
  assert.equal(no.ok, false);
  assert.equal(no.status, 409);
  assert.equal((await store.read(A)).finishedAt, null);
  // Una partida en curso NO cuenta; una abandonada tampoco; una de Draft tampoco.
  db.table("duel_matches").push({ id: "m0", user_id: A, status: "IN_PROGRESS", mode: "PVE" }, { id: "m1", user_id: A, status: "COMPLETED", mode: "DRAFT_GAUNTLET" });
  assert.equal((await runOnboardingCommand(db.client, A, "finish", store)).status, 409);
  db.table("duel_matches").push({ id: "m2", user_id: A, status: "COMPLETED", mode: "PVE", winner: "B" });
  const ok = await runOnboardingCommand(db.client, A, "finish", store);
  assert.ok(ok.ok);
  assert.equal(ok.onboarding?.status, "COMPLETED");
  assert.equal(ok.onboarding?.reason, "FINISHED");
  const again = await runOnboardingCommand(db.client, A, "finish", store);
  assert.ok(again.ok && !again.changed, "repetir el callback: mismo estado final");
});

test("F63 S04 · CREAR MI PRIMER EQUIPO: solo cartas POSEÍDAS, legal (2 por rol de CARTA, sin repetir jugador) y activo", async () => {
  const db = new Db();
  const owned = [...cardsFor(TWO_EACH), ...cardsFor({ Duelista: 1, Flex: 1 }, 10)];
  newAccount(db, A, owned);
  const before = inventory(db, A);
  const r = await ensureFirstTeam(db.client, A);
  assert.ok(r.ok, r.error);
  assert.equal(r.created, true, JSON.stringify({ created: r.created, activated: r.activated, decks: db.table("duel_decks").length }));
  assert.equal(r.activated, true);
  assert.equal(r.deck?.name, FIRST_TEAM_NAME);
  assert.equal(r.deck?.valid, true);
  assert.equal(r.deck?.cards.length, 10);
  const mine = new Set(db.table("user_cards").filter((c) => c.user_id === A).map((c) => c.uid));
  assert.ok(r.deck!.cardUids.every((u) => mine.has(u)), "ninguna carta ajena ni inventada");
  assert.equal(new Set(r.deck!.cards.map((c) => c.playerId)).size, 10, "sin repetir jugador");
  for (const role of DUEL_ROLES) assert.equal(r.deck!.cards.filter((c) => c.role === role).length, 2, role);
  assert.equal(db.table("duel_active_deck").find((x) => x.user_id === A)?.deck_id, r.deck!.id);
  assert.equal(inventory(db, A), before, "crear el equipo no toca el inventario");
});

test("F63 S05 · PRIMER EQUIPO ×2 y ×10 EN PARALELO → UN solo equipo (F5 / dos pestañas)", async () => {
  const db = new Db(); newAccount(db, A, cardsFor(TWO_EACH));
  await ensureFirstTeam(db.client, A);
  const second = await ensureFirstTeam(db.client, A);
  assert.equal(second.created, false);
  assert.equal(db.table("duel_decks").filter((d) => d.user_id === A).length, 1);

  const par = new Db(); newAccount(par, B, cardsFor(TWO_EACH));
  const results = await Promise.all(Array.from({ length: 10 }, () => ensureFirstTeam(par.client, B)));
  assert.ok(results.every((x) => x.ok));
  const decks = par.table("duel_decks").filter((d) => d.user_id === B);
  assert.equal(decks.length, 1, "la carrera deja UN equipo");
  assert.ok(results.every((x) => x.deck?.id === decks[0].id), "todas las respuestas apuntan al que queda");
  assert.equal(par.table("duel_active_deck").find((x) => x.user_id === B)?.deck_id, decks[0].id);
});

test("F63 S06 · colección insuficiente → 409 con los roles que faltan; ni equipo a medias ni cartas inventadas", async () => {
  const db = new Db();
  newAccount(db, A, cardsFor({ ...TWO_EACH, Flex: 1 }));
  const r = await ensureFirstTeam(db.client, A);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.code, "NOT_READY");
  assert.ok(r.shortages?.some((s) => s.role === "Flex"));
  assert.equal(db.table("duel_decks").length, 0);
  assert.equal(db.table("user_cards").length, 9);
});

test("F63 S07 · con un equipo legal ya guardado NO se crea otro: se devuelve y se activa si no había activo", async () => {
  const db = new Db(); newAccount(db, A, cardsFor(TWO_EACH));
  const uids = db.table("user_cards").map((c) => c.uid as string);
  db.table("duel_decks").push({ id: "mine", user_id: A, name: "Hecho a mano", card_uids: uids, created_at: db.now(), updated_at: db.now() });
  const r = await ensureFirstTeam(db.client, A);
  assert.ok(r.ok);
  assert.equal(r.created, false);
  assert.equal(r.deck?.id, "mine");
  assert.equal(db.table("duel_decks").length, 1);
  assert.equal(db.table("duel_active_deck")[0]?.deck_id, "mine");
});

test("F63 S08 · aislamiento: las órdenes de A no cambian nada de B (ni hechos ni acuses)", async () => {
  const db = new Db(); newAccount(db, A, cardsFor(TWO_EACH)); newAccount(db, B);
  const store = memoryFlagStore();
  const invB = inventory(db, B);
  for (const c of ["start", "first-team", "skip", "resume"] as const) await runOnboardingCommand(db.client, A, c, store);
  assert.equal(inventory(db, B), invB);
  assert.equal(db.table("duel_decks").filter((d) => d.user_id === B).length, 0);
  assert.deepEqual(await store.read(B), { startedAt: null, skippedAt: null, finishedAt: null });
  assert.equal((await readOnboarding(db.client, B, await store.read(B))).status, "NOT_STARTED");
});

test("F63 S09 · el recorrido completo por el servicio: sobre → equipo → partida → progreso → terminado", async () => {
  const db = new Db(); newAccount(db, A);
  const store = memoryFlagStore();
  assert.equal((await runOnboardingCommand(db.client, A, "start", store)).onboarding?.current, "open");
  // El sobre lo abre el flujo real (`app_apply_pack_open`); aquí se simula su huella: cartas + packs_opened − sobre.
  for (const [i, id] of cardsFor(TWO_EACH).entries()) db.table("user_cards").push({ uid: randomUUID(), user_id: A, card_id: id, serial: null, origin: "pack", locked: false, obtained_at: new Date(Date.UTC(2026, 8, 26, 11, i)).toISOString() });
  db.table("user_game")[0].packs_opened = 4;
  db.table("user_packs").forEach((p) => { p.qty = 0; });
  const facts = await readOnboardingFacts(db.client, A);
  assert.equal(facts.journey.readiness.ready, true);
  const team = await runOnboardingCommand(db.client, A, "first-team", store);
  assert.equal(team.onboarding?.current, "match");
  assert.equal(team.onboarding?.context.readyDeck?.cardIds.length, 10);
  db.table("duel_matches").push({ id: "m", user_id: A, status: "COMPLETED", mode: "PVE", winner: "A" });
  const after = await readOnboarding(db.client, A, await store.read(A));
  assert.equal(after.current, "progress");
  const fin = await runOnboardingCommand(db.client, A, "finish", store);
  assert.equal(fin.onboarding?.status, "COMPLETED");
  assert.equal(fin.onboarding?.active, false);
});
