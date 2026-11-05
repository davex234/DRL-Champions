/**
 * F65 · INTEGRIDAD — la puerta de legalidad de PvP (`resolveDeckSnapshot`) lee la colección PAGINADA.
 *
 * PostgREST devuelve como mucho 1.000 filas por petición. La lectura antigua de `duelsPvp.ts` no paginaba: con más de
 * 1.000 ejemplares, las cartas propias más allá de la fila 1.000 salían «no es tuya» y un equipo legal no podía entrar en
 * cola. El doble de abajo aplica ese mismo tope a toda lectura sin `range`, que es exactamente lo que hace el servidor real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { resolveDeckSnapshot } from "./duelsPvp";

type Row = Record<string, unknown>;
const POSTGREST_MAX_ROWS = 1000;

class CappedDb {
  tables: Record<string, Row[]> = { user_cards: [], duel_decks: [] };
  from(name: string) { return new CappedQuery(this, name); }
  async rpc() { return { data: null, error: { code: "PGRST202", message: "no rpc" } }; }
  get sb() { return this as unknown as SupabaseClient; }
}
class CappedQuery implements PromiseLike<unknown> {
  private filters: [string, unknown][] = [];
  private preds: ((r: Row) => boolean)[] = [];
  private max: number | null = null;
  private span: [number, number] | null = null;
  private orderBy: string | null = null;
  private single = false;
  constructor(private db: CappedDb, private name: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filters.push([c, v]); return this; }
  order(c: string) { this.orderBy = c; return this; }
  range(a: number, b: number) { this.span = [a, b]; return this; }
  // COLECCIONES ILIMITADAS · lo que usa la lectura por cursor: `uid > último`, `in(...)` y `limit`.
  gt(c: string, v: string) { this.preds.push((r) => String(r[c]) > v); return this; }
  in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run() {
    const t = this.db.tables[this.name];
    if (!t) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.name}'` } };
    let rows = t.filter((r) => this.filters.every(([c, v]) => r[c] === v) && this.preds.every((f) => f(r)));
    if (this.orderBy) { const c = this.orderBy; rows = [...rows].sort((a, b) => String(a[c]).localeCompare(String(b[c]))); }
    const matched = rows.length;
    rows = this.span ? rows.slice(this.span[0], Math.min(this.span[1] + 1, this.span[0] + POSTGREST_MAX_ROWS)) : rows.slice(0, Math.min(this.max ?? POSTGREST_MAX_ROWS, POSTGREST_MAX_ROWS));
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null, count: matched };
  }
}

const U = "aaaaaaaa-0000-4000-8000-000000000065";
const uid = (i: number) => `cccc0000-0000-4000-8000-${String(i).padStart(12, "0")}`;

test("F65 INT · PvP: un equipo legal cuyas cartas están más allá de la fila 1.000 de la colección entra en cola", async () => {
  const db = new CappedDb();
  const filler = CARDS.find((c) => c.combat)!;
  for (let i = 0; i < 1500; i++) db.tables.user_cards.push({ uid: uid(i), user_id: U, card_id: filler.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
  // Equipo legal (2 por rol, jugador único) con uids que ordenan DESPUÉS del relleno.
  const used = new Set<string>([filler.playerId]);
  const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let inRole = 0;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (inRole === 2) break;
      if (used.has(c.playerId)) continue;
      inRole++;
      used.add(c.playerId);
      const u = uid(1500 + team.length);
      db.tables.user_cards.push({ uid: u, user_id: U, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      team.push(u);
    }
  }
  assert.equal(team.length, 10);
  db.tables.duel_decks.push({ id: "dddd0000-0000-4000-8000-000000000065", user_id: U, name: "Equipo", card_uids: team, created_at: new Date(0).toISOString() });
  const r = await resolveDeckSnapshot(db.sb, U, "dddd0000-0000-4000-8000-000000000065");
  assert.ok(r.ok, r.ok ? "" : r.error);
});
