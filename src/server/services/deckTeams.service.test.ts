/**
 * FASE 32 · SERVICIO DE EQUIPOS contra un Supabase EN MEMORIA (sin red, sin Docker, sin BD real).
 *
 * El doble imita lo que el servicio usa de PostgREST —`select/eq/order/range/update/insert/delete/
 * maybeSingle`, `updated_at` que cambia en cada UPDATE (el trigger de 0014), el RPC de 0050 y el
 * `on delete cascade`— y responde «tabla desconocida» (PGRST205) a todo lo demás, que es justo lo que
 * hace el catálogo persistido caer al del código. Las cartas son del catálogo REAL.
 *
 * Tests 53–65 del brief (multi-equipo, concurrencia) + la batería de seguridad de la PARTE AP.
 * Lo que NO prueba: RLS, el RPC real en Postgres ni la precisión de `timestamptz` (REQUIERE BD DE PRUEBAS).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
import { DUPLICATE_PLAYER_TEXT } from "@/domain/deckBuilder/builder";
import {
  checkComposition, createTeam, deleteTeam, duplicateTeam, getDeckWorkspace, renameTeam, saveComposition, setActiveTeam,
  STALE_TEXT, NOT_READY_TO_ACTIVATE_TEXT,
} from "./deckTeams";
import { loadOwned, MAX_DECKS } from "./duels";

/* ───────────────────────── doble de Supabase ───────────────────────── */

type Row = Record<string, unknown>;
let clock = Date.UTC(2026, 8, 14, 10, 0, 0);
const stamp = () => { clock += 1234; return new Date(clock).toISOString().replace("Z", "321+00:00"); };
let idSeq = 0;
const nextId = () => `dddddddd-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;

class FakeDb {
  tables: Record<string, Row[]> = { user_cards: [], duel_decks: [], duel_active_deck: [] };
  constructor(opts: { with0050?: boolean } = {}) { if (opts.with0050 === false) delete this.tables.duel_active_deck; }
  from(name: string) { return new FakeQuery(this, name); }
  async rpc(fn: string, args: Row) {
    if (fn === "duel_deck_activate" && this.tables.duel_active_deck) {
      const d = this.tables.duel_decks.find((r) => r.id === args.p_deck && r.user_id === args.p_user);
      if (!d) return { data: "NOT_FOUND", error: null };
      if (args.p_expected_updated_at && d.updated_at !== args.p_expected_updated_at) return { data: "CONFLICT", error: null };
      const t = this.tables.duel_active_deck;
      const i = t.findIndex((r) => r.user_id === args.p_user);
      const row = { user_id: args.p_user, deck_id: args.p_deck, updated_at: stamp() };
      if (i >= 0) t[i] = row; else t.push(row);
      return { data: "OK", error: null };
    }
    return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
  }
  get sb() { return this as unknown as SupabaseClient; }
}

class FakeQuery implements PromiseLike<unknown> {
  private filters: [string, unknown][] = [];
  private op: "select" | "update" | "insert" | "delete" = "select";
  private payload: Row | null = null;
  private single = false;
  private span: [number, number] | null = null;
  private orderBy: [string, boolean] | null = null;
  private head = false;
  constructor(private db: FakeDb, private name: string) {}
  select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) this.head = true; return this; }
  eq(c: string, v: unknown) { this.filters.push([c, v]); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy = [c, o?.ascending !== false]; return this; }
  range(a: number, b: number) { this.span = [a, b]; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  maybeSingle() { this.single = true; return this; }
  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run() {
    const t = this.db.tables[this.name];
    if (!t) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.name}'` } };
    const match = (r: Row) => this.filters.every(([c, v]) => r[c] === v);
    let rows: Row[];
    if (this.op === "insert") {
      const at = stamp();
      const row: Row = { id: nextId(), created_at: at, updated_at: at, ...this.payload };
      t.push(row);
      rows = [row];
    } else if (this.op === "update") {
      rows = t.filter(match);
      for (const r of rows) Object.assign(r, this.payload, { updated_at: stamp() });
    } else if (this.op === "delete") {
      rows = t.filter(match);
      this.db.tables[this.name] = t.filter((r) => !rows.includes(r));
      if (this.name === "duel_decks" && this.db.tables.duel_active_deck) {
        this.db.tables.duel_active_deck = this.db.tables.duel_active_deck.filter((a) => !rows.some((r) => r.id === a.deck_id));
      }
    } else {
      rows = t.filter(match);
    }
    if (this.orderBy) {
      const [c, asc] = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.span) rows = rows.slice(this.span[0], this.span[1] + 1);
    const copy = rows.map((r) => ({ ...r, card_uids: Array.isArray(r.card_uids) ? [...(r.card_uids as string[])] : r.card_uids }));
    if (this.head) return { data: null, error: null, count: copy.length };
    if (this.single) return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null };
  }
}

/* ───────────────────────── cartas reales y dos usuarios ───────────────────────── */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

type Def = (typeof CARDS)[number];
const playersByRole = new Map<RoleId, { playerId: string; cards: Def[] }[]>();
// Rol de la CARTA (catálogo diseñado): un jugador con cartas de dos roles sólo se cuenta en el primero,
// para que las manos de prueba nunca repitan jugador entre roles.
const yaEnOtroRol = new Set<string>();
for (const role of DUEL_ROLES) {
  const byPlayer = new Map<string, Def[]>();
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    if (!c.combat || !p || (c.role ?? p.role) !== role || yaEnOtroRol.has(c.playerId)) continue;
    byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  }
  for (const pid of byPlayer.keys()) yaEnOtroRol.add(pid);
  playersByRole.set(role, [...byPlayer.entries()]
    .map(([playerId, cards]) => ({ playerId, cards: cards.sort((a, b) => b.ovr - a.ovr) }))
    .sort((a, b) => b.cards[0].ovr - a.cards[0].ovr || a.playerId.localeCompare(b.playerId)));
}
const twinRole = DUEL_ROLES.find((r) => playersByRole.get(r)!.some((p) => p.cards.length >= 2))!;
const twin = playersByRole.get(twinRole)!.find((p) => p.cards.length >= 2)!;

let uidSeq = 0;
const uidFor = (owner: "a" | "b") => `${owner === "a" ? "aaaa0000" : "bbbb0000"}-0000-4000-8000-${String(++uidSeq).padStart(12, "0")}`;

interface Seeded { db: FakeDb; a: Record<RoleId, string[]>; aTwin: string; aTwinFirst: string; b: Record<RoleId, string[]> }

function seed(opts: { with0050?: boolean } = {}): Seeded {
  const db = new FakeDb(opts);
  const put = (user: string, owner: "a" | "b", def: Def) => {
    const uid = uidFor(owner);
    db.tables.user_cards.push({ uid, user_id: user, card_id: def.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(clock).toISOString() });
    return uid;
  };
  const a = {} as Record<RoleId, string[]>;
  const b = {} as Record<RoleId, string[]>;
  let aTwin = "";
  let aTwinFirst = "";
  for (const role of DUEL_ROLES) {
    const ps = playersByRole.get(role)!;
    a[role] = ps.slice(0, 3).map((p) => {
      const uid = put(A, "a", p.cards[0]);
      if (p.playerId === twin.playerId) aTwinFirst = uid;
      return uid;
    });
    b[role] = ps.slice(0, 2).map((p) => put(B, "b", p.cards[0]));
  }
  if (!aTwinFirst) aTwinFirst = put(A, "a", twin.cards[0]);
  aTwin = put(A, "a", twin.cards[1]);
  return { db, a, aTwin, aTwinFirst, b };
}

const fullOf = (hand: Record<RoleId, string[]>) => DUEL_ROLES.flatMap((r) => hand[r].slice(0, 2));
const partialOf = (hand: Record<RoleId, string[]>) => [hand.Duelista[0], hand.Controlador[0], hand.Flex[0]];

async function makeDeck(db: FakeDb, user: string, uids: string[], name: string | null = null) {
  const r = await createTeam(db.sb, user, { name, cardUids: uids });
  assert.ok(r.ok, `crear: ${r.error}`);
  return r.data!.deck;
}

/* ───────────────────────── 53–60 · multi-equipo ───────────────────────── */

test("53 · crear: «Equipo N» por defecto, nombre validado en servidor y tope de equipos", async () => {
  const { db, a } = seed();
  assert.equal((await makeDeck(db, A, [])).name, "Equipo 1");
  assert.equal((await makeDeck(db, A, partialOf(a))).name, "Equipo 2");
  const bad = await createTeam(db.sb, A, { name: "<script>", cardUids: [] });
  assert.equal(bad.status, 400);
  assert.equal(bad.code, "BAD_NAME");
  for (let i = 0; i < MAX_DECKS - 2; i++) await makeDeck(db, A, []);
  const over = await createTeam(db.sb, A, { name: null, cardUids: [] });
  assert.equal(over.status, 409);
  assert.equal(over.code, "LIMIT");
});

test("54 · renombrar con versión; versión vieja ⇒ conflicto; mismo nombre repetido ⇒ sin cambios", async () => {
  const { db } = seed();
  const d = await makeDeck(db, A, [], "Principal");
  const r = await renameTeam(db.sb, A, { id: d.id, name: "  Rojo   Fuego ", expectedVersion: d.version! });
  assert.ok(r.ok);
  assert.equal(r.data!.deck.name, "Rojo Fuego");
  const stale = await renameTeam(db.sb, A, { id: d.id, name: "Otro", expectedVersion: d.version! });
  assert.equal(stale.status, 409);
  assert.equal(stale.error, STALE_TEXT);
  const same = await renameTeam(db.sb, A, { id: d.id, name: "Rojo Fuego", expectedVersion: d.version! });
  assert.ok(same.ok && same.data!.unchanged);
});

test("55 · duplicar copia REFERENCIAS (mismos uids), no cartas; nombre «copia»", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, fullOf(a), "Principal");
  const cardsBefore = db.tables.user_cards.length;
  const r = await duplicateTeam(db.sb, A, d.id);
  assert.ok(r.ok);
  assert.notEqual(r.data!.deck.id, d.id);
  assert.equal(r.data!.deck.name, "Principal copia");
  assert.deepEqual(r.data!.deck.cardUids, d.cardUids);
  assert.equal(r.data!.deck.valid, true);
  assert.equal(db.tables.user_cards.length, cardsBefore, "no se crea ni una carta");
});

test("56 · borrar: la fila desaparece; las cartas no se tocan", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, partialOf(a));
  const cards = db.tables.user_cards.length;
  const r = await deleteTeam(db.sb, A, { id: d.id, expectedVersion: d.version!, confirmActive: false });
  assert.ok(r.ok && r.data!.wasActive === false);
  assert.equal(db.tables.duel_decks.length, 0);
  assert.equal(db.tables.user_cards.length, cards);
});

test("57 · activar un equipo completo: la foto lo marca activo", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, fullOf(a));
  const r = await setActiveTeam(db.sb, A, { id: d.id, expectedVersion: d.version! });
  assert.ok(r.ok, r.error);
  const ws = await getDeckWorkspace(db.sb, A);
  assert.equal(ws.data!.activeDeckId, d.id);
  assert.equal(ws.data!.activeSupported, true);
  assert.equal(ws.data!.decks.find((x) => x.id === d.id)!.active, true);
});

test("58 · un equipo incompleto no se puede activar", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, partialOf(a));
  const r = await setActiveTeam(db.sb, A, { id: d.id, expectedVersion: null });
  assert.equal(r.status, 409);
  assert.equal(r.code, "DECK_NOT_READY");
  assert.equal(r.error, NOT_READY_TO_ACTIVATE_TEXT);
  assert.equal(db.tables.duel_active_deck.length, 0);
});

test("59 · A no puede leer, editar, activar, duplicar ni borrar el equipo de B (404, sin tocar la fila)", async () => {
  const { db, b, a } = seed();
  const bd = await makeDeck(db, B, fullOf(b), "De B");
  const snapshot = JSON.stringify(db.tables.duel_decks);
  const wsA = await getDeckWorkspace(db.sb, A);
  assert.ok(!wsA.data!.decks.some((d) => d.id === bd.id), "A no ve el equipo de B");
  assert.ok(!wsA.data!.collection.some((c) => fullOf(b).includes(c.uid)), "ni las cartas de B");
  const results = [
    await saveComposition(db.sb, A, { id: bd.id, name: "Mío", cardUids: partialOf(a), expectedVersion: bd.version! }),
    await renameTeam(db.sb, A, { id: bd.id, name: "Mío", expectedVersion: bd.version! }),
    await setActiveTeam(db.sb, A, { id: bd.id, expectedVersion: null }),
    await duplicateTeam(db.sb, A, bd.id),
    await deleteTeam(db.sb, A, { id: bd.id, expectedVersion: null, confirmActive: true }),
  ];
  for (const r of results) { assert.equal(r.status, 404); assert.equal(r.code, "NOT_FOUND"); }
  assert.equal(JSON.stringify(db.tables.duel_decks), snapshot);
});

test("60 · duplicar revalida la propiedad: si una carta ya no es tuya, no se duplica", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, fullOf(a));
  db.tables.user_cards = db.tables.user_cards.filter((c) => c.uid !== a.Flex[0]); // vendida / perdida
  const r = await duplicateTeam(db.sb, A, d.id);
  assert.equal(r.status, 409);
  assert.equal(r.code, "CARD_NOT_OWNED");
  assert.equal(db.tables.duel_decks.length, 1);
});

/* ───────────────────────── 61–65 · concurrencia ───────────────────────── */

test("61 · guardado idempotente: repetir el mismo guardado con la versión vieja es «sin cambios»", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, []);
  const first = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: fullOf(a), expectedVersion: d.version! });
  assert.ok(first.ok && !first.data!.unchanged);
  const again = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: fullOf(a), expectedVersion: d.version! });
  assert.ok(again.ok && again.data!.unchanged);
  assert.equal(again.data!.deck.version, first.data!.deck.version);
});

test("62 · versión antigua con otra composición ⇒ 409 con la versión vigente para revisar", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, []);
  const saved = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: fullOf(a), expectedVersion: d.version! });
  assert.ok(saved.ok);
  const stale = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: partialOf(a), expectedVersion: d.version! });
  assert.equal(stale.status, 409);
  assert.equal(stale.code, "CONFLICT");
  assert.equal(stale.error, "Este equipo cambió en otra pestaña.");
  assert.deepEqual((stale.data as { deck: { cardUids: string[] } }).deck.cardUids, fullOf(a));
  assert.deepEqual(db.tables.duel_decks[0].card_uids, fullOf(a), "no se sobrescribe en silencio");
});

test("63 · un guardado rechazado no toca lo guardado (el borrador vive en el cliente)", async () => {
  const { db, a, aTwin, aTwinFirst } = seed();
  const d = await makeDeck(db, A, partialOf(a));
  const r = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: [aTwinFirst, aTwin], expectedVersion: d.version! });
  assert.equal(r.ok, false);
  assert.deepEqual(db.tables.duel_decks[0].card_uids, partialOf(a));
  assert.equal(db.tables.duel_decks[0].updated_at, d.version);
});

test("64 · dos pestañas: la segunda que guarda con la versión leída pierde de forma determinista y recupera", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, partialOf(a));
  const tab1 = await saveComposition(db.sb, A, { id: d.id, name: "Pestaña 1", cardUids: fullOf(a), expectedVersion: d.version! });
  assert.ok(tab1.ok);
  const tab2 = await saveComposition(db.sb, A, { id: d.id, name: "Pestaña 2", cardUids: partialOf(a), expectedVersion: d.version! });
  assert.equal(tab2.code, "CONFLICT");
  const current = (tab2.data as { deck: { version: string } }).deck.version;
  const retry = await saveComposition(db.sb, A, { id: d.id, name: "Pestaña 2", cardUids: partialOf(a), expectedVersion: current });
  assert.ok(retry.ok);
  assert.equal(retry.data!.deck.name, "Pestaña 2");
});

test("65 · propiedad perdida: el equipo aparece inválido (no se borra) y guardar con esa carta se rechaza", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, fullOf(a));
  db.tables.user_cards = db.tables.user_cards.filter((c) => c.uid !== a.Duelista[0]);
  const ws = await getDeckWorkspace(db.sb, A);
  const deck = ws.data!.decks.find((x) => x.id === d.id)!;
  assert.equal(deck.valid, false);
  assert.ok(deck.errors.some((e) => e.code === "CARD_NOT_OWNED"));
  assert.deepEqual(deck.cardUids, fullOf(a), "la referencia se conserva: nada se borra en silencio");
  const r = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: fullOf(a), expectedVersion: deck.version! });
  assert.equal(r.status, 403);
  assert.equal(r.code, "CARD_NOT_OWNED");
  assert.equal((await setActiveTeam(db.sb, A, { id: d.id, expectedVersion: null })).code, "DECK_NOT_READY");
});

/* ───────────────────────── seguridad (PARTE AP) ───────────────────────── */

test("seguridad · cardUid de otro usuario rechazada (403) y la inexistente responde igual", async () => {
  const { db, a, b } = seed();
  const d = await makeDeck(db, A, []);
  const foreign = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: [a.Duelista[0], b.Duelista[0]], expectedVersion: d.version! });
  const ghost = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: ["12345678-1234-4234-8234-123456789012"], expectedVersion: d.version! });
  assert.equal(foreign.status, 403);
  assert.equal(ghost.status, 403);
  assert.equal(foreign.error, ghost.error, "no se filtra si la carta existe");
  assert.equal((await createTeam(db.sb, A, { name: null, cardUids: [b.Flex[0]] })).status, 403);
});

test("seguridad · jugador repetido (dos variantes) y rol ilegal (3 de un rol) se rechazan al guardar", async () => {
  const { db, a, aTwin, aTwinFirst } = seed();
  const d = await makeDeck(db, A, []);
  const dup = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: [aTwinFirst, aTwin], expectedVersion: d.version! });
  assert.equal(dup.status, 422);
  assert.equal(dup.error, DUPLICATE_PLAYER_TEXT);
  const three = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: a.Centinela, expectedVersion: d.version! });
  assert.equal(three.status, 422);
  assert.equal(three.code, "DECK_ILLEGAL");
  assert.equal(checkComposition([a.Flex[0], a.Flex[0]], [])?.code, "DUPLICATE_UID");
});

test("seguridad · borrar el equipo ACTIVO exige confirmación explícita y deja sin activo", async () => {
  const { db, a } = seed();
  const d = await makeDeck(db, A, fullOf(a));
  assert.ok((await setActiveTeam(db.sb, A, { id: d.id, expectedVersion: null })).ok);
  const noConfirm = await deleteTeam(db.sb, A, { id: d.id, expectedVersion: null, confirmActive: false });
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.code, "ACTIVE_DECK");
  const ok = await deleteTeam(db.sb, A, { id: d.id, expectedVersion: null, confirmActive: true });
  assert.ok(ok.ok && ok.data!.wasActive);
  const ws = await getDeckWorkspace(db.sb, A);
  assert.equal(ws.data!.activeDeckId, null);
  assert.equal(db.tables.duel_active_deck.length, 0, "cascade: no queda referencia colgando");
});

test("degradación · sin 0050: la foto dice activeSupported=false, guardar funciona y activar responde NOT_READY", async () => {
  const { db, a } = seed({ with0050: false });
  const d = await makeDeck(db, A, []);
  const ws = await getDeckWorkspace(db.sb, A);
  assert.equal(ws.ok, true);
  assert.equal(ws.data!.activeSupported, false);
  const saved = await saveComposition(db.sb, A, { id: d.id, name: d.name, cardUids: fullOf(a), expectedVersion: d.version! });
  assert.ok(saved.ok);
  const act = await setActiveTeam(db.sb, A, { id: d.id, expectedVersion: null });
  assert.equal(act.status, 503);
  assert.equal(act.code, "NOT_READY");
});

test("rendimiento · la propiedad se lee paginada (más de 1.000 ejemplares no se truncan)", async () => {
  const db = new FakeDb();
  const def = playersByRole.get("Flex")![0].cards[0];
  for (let i = 0; i < 2345; i++) db.tables.user_cards.push({ uid: `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`, user_id: A, card_id: def.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(clock).toISOString() });
  assert.equal((await loadOwned(db.sb, A)).length, 2345);
});
