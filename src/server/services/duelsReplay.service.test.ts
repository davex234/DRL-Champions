/**
 * FASE 33 · REPETICIÓN EN SERVIDOR contra un Supabase EN MEMORIA (tests 26, 64, 65, 87 y errores).
 *
 * Partidas reales del motor puro (`qaSimulation`) guardadas como filas `duel_matches` con la forma de
 * 0014/0031/0048. Se prueba `getReplay`: solo participantes, perspectiva del jugador B, sin cartas no
 * jugadas del rival y sin mensajes internos. RLS y PostgREST reales: REQUIERE BD DE PRUEBAS.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qaSnapshot, qaSimulate, qaFindMatch } from "@/lib/duel/qaSimulation";
import { getReplay } from "./duels";

type Row = Record<string, unknown>;

class FakeDb {
  fail = false;
  tables: Record<string, Row[]> = { duel_matches: [], profiles: [] };
  from(name: string) { return new Q(this, name); }
  async rpc() { return { data: null, error: { code: "PGRST202", message: "fake" } }; }
  get sb() { return this as unknown as SupabaseClient; }
}

class Q implements PromiseLike<unknown> {
  private eqs: [string, unknown][] = [];
  private ors: [string, unknown][][] = [];
  private single = false;
  constructor(private db: FakeDb, private name: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.eqs.push([c, v]); return this; }
  or(expr: string) { this.ors.push(expr.split(",").map((p) => { const [c, , v] = p.split("."); return [c, v]; })); return this; }
  order() { return this; }
  range() { return this; }
  limit() { return this; }
  neq() { return this; }
  maybeSingle() { this.single = true; return this; }
  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run() {
    const t = this.db.tables[this.name];
    if (!t) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.name}'` } };
    if (this.db.fail && this.name === "duel_matches") return { data: null, error: { code: "XX000", message: "relation internal detail: secret_column" } };
    const rows = t.filter((r) => this.eqs.every(([c, v]) => r[c] === v) && this.ors.every((alts) => alts.some(([c, v]) => r[c] === v)));
    return this.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
  }
}

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const id = (n: number) => `0000a1a1-0000-4000-8000-${String(n).padStart(12, "0")}`;

const mine = qaSnapshot(0, "qa-you", "QA A");
const rival = qaSnapshot(1, "qa-rival", "QA B");
const finished = qaFindMatch((m) => m.status !== "IN_PROGRESS", 3, 40)!;
const partial = qaSimulate(mine, rival, 4, "A", 9);
const running = qaSimulate(mine, rival, 2, "A", 5);

function seed() {
  const db = new FakeDb();
  const row = (n: number, mode: string, state: unknown, o: Row = {}) => ({
    id: id(n), user_id: A, player_b_id: mode === "PVE" ? null : B, mode, difficulty: "NORMAL", status: (state as { status: string }).status,
    state: { ...(state as object), id: id(n) }, rules_version: "duel-combat-2", closed_reason: null, ...o,
  });
  db.tables.duel_matches.push(
    row(1, "PVE", finished),
    row(2, "PVP", finished),
    row(3, "PVP_PRIVATE", finished),
    row(4, "PVP", running),
    row(5, "PVP", partial, { closed_reason: "ABANDONED" }),
  );
  db.tables.profiles.push({ id: A, username: "Jugadora A" }, { id: B, username: "Jugador B" });
  return db;
}

test("64 · repetición privada: solo los dos participantes; un tercero recibe 404", async () => {
  const db = seed();
  assert.equal((await getReplay(db.sb, A, id(3))).status, 200);
  assert.equal((await getReplay(db.sb, B, id(3))).status, 200);
  const c = await getReplay(db.sb, C, id(3));
  assert.equal(c.status, 404);
  assert.equal(c.error, "Partida no encontrada");
});

test("87 · A no accede a partidas ajenas; B no puede abrir la partida PvE de A", async () => {
  const db = seed();
  assert.equal((await getReplay(db.sb, C, id(2))).status, 404);
  assert.equal((await getReplay(db.sb, B, id(1))).status, 404);
  assert.equal((await getReplay(db.sb, A, "0000a1a1-0000-4000-8000-000000009999")).status, 404);
});

test("el jugador B ve la partida desde SU lado (antes no podía abrirla)", async () => {
  const db = seed();
  const ra = (await getReplay(db.sb, A, id(2))).data!;
  const rb = (await getReplay(db.sb, B, id(2))).data!;
  assert.equal(rb.mode, "PVP");
  assert.equal(rb.rivalName, "Jugadora A");
  assert.equal(ra.rivalName, "Jugador B");
  ra.turns.forEach((t, i) => {
    const o = rb.turns[i].outcome;
    assert.equal(o, t.outcome === "TIE" ? "TIE" : t.outcome === "A" ? "B" : "A");
    assert.equal(rb.turns[i].scoreAfterYou, t.scoreAfterRival);
  });
  assert.equal(rb.yourDeckName, finished.snapshotB.deckName);
});

test("26/65 · la repetición no trae cartas no jugadas del rival (PvP abandonado a medias)", async () => {
  const db = seed();
  const rb = (await getReplay(db.sb, B, id(5))).data!;
  const unplayedA = partial.snapshotA.cards.map((c) => c.uid).filter((u) => !partial.usedA.includes(u));
  const json = JSON.stringify(rb);
  for (const u of unplayedA) assert.ok(!json.includes(u), u);
  assert.ok(rb.rivalCards.every((c) => partial.usedA.includes(c.uid)));
  assert.equal(rb.turns.length, 4, "abandonada: se sirve lo que se jugó");
  const pve = (await getReplay(db.sb, A, id(1))).data!;
  assert.ok(pve.rivalCards.every((c) => finished.usedB.includes(c.uid)), "PvE: tampoco el mazo entero del bot");
});

test("en curso: 409; los errores de base de datos no viajan crudos", async () => {
  const db = seed();
  assert.equal((await getReplay(db.sb, A, id(4))).status, 409);
  db.fail = true;
  const r = await getReplay(db.sb, A, id(2));
  assert.equal(r.status, 500);
  assert.ok(!/secret_column|relation/.test(r.error ?? ""));
});
