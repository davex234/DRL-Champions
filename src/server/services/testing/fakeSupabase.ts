/**
 * SUPABASE EN MEMORIA PARA PRUEBAS DE LECTURA (Fase 34). NO es una base de datos: filtra filas con
 * `eq/neq/gt/gte/lt/lte/in`, cuenta con `head`, y REGISTRA toda escritura (`insert/update/upsert/delete`)
 * y toda RPC, que es lo que permite probar «un GET no tiene efectos». RLS, `or()` y PostgREST reales:
 * NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  writes: string[] = [];
  rpcs: string[] = [];
  reads: string[] = [];
  failTables = new Set<string>();
  from(name: string) { this.reads.push(name); return new FakeQuery(this, name); }
  async rpc(name: string) { this.rpcs.push(name); return { data: null, error: { code: "PGRST202", message: "fake rpc" } }; }
  get client(): SupabaseClient { return this as unknown as SupabaseClient; }
}

type Filter = (r: Row) => boolean;

class FakeQuery implements PromiseLike<unknown> {
  private filters: Filter[] = [];
  private head = false;
  private single = false;
  private max: number | null = null;
  constructor(private db: FakeSupabase, private name: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this; }
  private write(op: string) { this.db.writes.push(`${op}:${this.name}`); return this; }
  insert() { return this.write("insert"); }
  upsert() { return this.write("upsert"); }
  update() { return this.write("update"); }
  delete() { return this.write("delete"); }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: never) { this.filters.push((r) => (r[c] as never) > v); return this; }
  gte(c: string, v: never) { this.filters.push((r) => (r[c] as never) >= v); return this; }
  lt(c: string, v: never) { this.filters.push((r) => (r[c] as never) < v); return this; }
  lte(c: string, v: never) { this.filters.push((r) => (r[c] as never) <= v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  like() { return this; }
  or() { return this; }
  order() { return this; }
  range() { return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = true; return this; }
  singleRow() { this.single = true; return this; }
  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run() {
    if (this.db.failTables.has(this.name)) return { data: null, count: null, error: { code: "XX000", message: `internal detail of ${this.name}: secret_column` } };
    let rows = (this.db.tables[this.name] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.head) return { data: null, count: rows.length, error: null };
    if (this.max !== null) rows = rows.slice(0, this.max);
    return this.single ? { data: rows[0] ?? null, error: null } : { data: rows, count: rows.length, error: null };
  }
}
