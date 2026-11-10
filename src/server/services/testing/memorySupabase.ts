/**
 * SUPABASE EN MEMORIA QUE SÍ ESCRIBE (Fase 35) — solo para pruebas de servicio.
 *
 * `FakeSupabase` (Fase 34) registra escrituras sin aplicarlas: sirve para demostrar «un GET no escribe». Para
 * probar idempotencia y concurrencia hace falta que `update … eq(status,'STARTED')` devuelva 0 filas la segunda
 * vez y que un índice único rechace un segundo intento abierto. Esto lo simula con restricciones declaradas.
 *
 * NO es PostgreSQL: sin transacciones, sin RLS, sin tipos. Lo que dependa de la base real (CHECK, FK, índices
 * parciales de verdad, `app_grant_reward`): NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export interface UniqueConstraint { cols: string[]; where?: (r: Row) => boolean }

export class MemorySupabase {
  tables: Record<string, Row[]> = {};
  /** Tablas que «no existen» (migración sin aplicar): responden PGRST205. */
  missing = new Set<string>();
  /** Tablas que fallan con un error interno. */
  failing = new Set<string>();
  unique: Record<string, UniqueConstraint[]> = {};
  defaults: Record<string, () => Row> = {};
  log: string[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  rpcHandlers: Record<string, (args: Row) => { data: unknown; error: { code?: string; message: string } | null }> = {};

  from(name: string) { return new MemQuery(this, name); }
  async rpc(name: string, args: Row = {}) {
    this.rpcCalls.push({ name, args });
    this.log.push(`rpc:${name}`);
    const h = this.rpcHandlers[name];
    return h ? h(args) : { data: null, error: { code: "PGRST202", message: `rpc ${name} no simulada` } };
  }
  get client(): SupabaseClient { return this as unknown as SupabaseClient; }
  rows(name: string): Row[] { return (this.tables[name] ??= []); }
  writes(): string[] { return this.log.filter((l) => !l.startsWith("select:")); }
}

type Op = "select" | "insert" | "update" | "upsert" | "delete";

class MemQuery implements PromiseLike<unknown> {
  private op: Op = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: ((r: Row) => boolean)[] = [];
  private sorts: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private skip = 0;
  private single = false;
  private head = false;
  private onConflict: string[] = [];
  constructor(private db: MemorySupabase, private name: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(p) ? p : [p]; return this; }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = Array.isArray(p) ? p : [p]; this.onConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim()); return this; }
  update(p: Row) { this.op = "update"; this.patch = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: never) { this.filters.push((r) => (r[c] as never) > v); return this; }
  gte(c: string, v: never) { this.filters.push((r) => (r[c] as never) >= v); return this; }
  lt(c: string, v: never) { this.filters.push((r) => (r[c] as never) < v); return this; }
  lte(c: string, v: never) { this.filters.push((r) => (r[c] as never) <= v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  /** F85 · `ilike` de PostgREST/LIKE: `%` cualquier cadena, `_` un carácter, `\x` literal; sin distinguir mayúsculas. */
  ilike(c: string, pattern: string) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let src = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) src += esc(pattern[++i]);
      else src += ch === "%" ? ".*" : ch === "_" ? "." : esc(ch);
    }
    const re = new RegExp(`^${src}$`, "i");
    this.filters.push((r) => typeof r[c] === "string" && re.test(r[c] as string)); return this;
  }
  /** Varias llamadas = claves de orden sucesivas (como PostgREST): la primera manda, las siguientes desempatan. */
  order(col: string, opts?: { ascending?: boolean }) { this.sorts.push({ col, asc: opts?.ascending !== false }); return this; }
  /**
   * F89 · subconjunto de `or()` de PostgREST: condiciones separadas por comas (`col.eq.v`, `col.in.(a,b)`,
   * `col.is.null`, `col.not.is.null`) y grupos `and(...)`. Dos `or()` seguidos se combinan con AND, como en PostgREST.
   */
  or(expr: string) { const f = parseOr(expr); this.filters.push(f); return this; }
  limit(n: number) { this.max = n; return this; }
  /** Fase 37 · paginación por rango (inclusive), como PostgREST. */
  range(from: number, to: number) { this.skip = from; this.max = to - from + 1; return this; }
  maybeSingle() { this.single = true; return this; }

  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }

  private violates(candidate: Row, others: Row[]): boolean {
    for (const u of this.db.unique[this.name] ?? []) {
      if (u.where && !u.where(candidate)) continue;
      if (others.some((o) => o !== candidate && (!u.where || u.where(o)) && u.cols.every((c) => o[c] === candidate[c]))) return true;
    }
    return false;
  }

  private out(rows: Row[]) {
    const copy = rows.map((r) => ({ ...r }));
    if (this.head) return { data: null, count: copy.length, error: null };
    return this.single ? { data: copy[0] ?? null, error: null } : { data: copy, count: copy.length, error: null };
  }

  private run() {
    this.db.log.push(`${this.op}:${this.name}`);
    if (this.db.missing.has(this.name)) return { data: null, count: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.name}' in the schema cache` } };
    if (this.db.failing.has(this.name)) return { data: null, count: null, error: { code: "XX000", message: `internal detail of ${this.name}` } };
    const table = this.db.rows(this.name);
    const dup = { data: null, count: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };

    switch (this.op) {
      case "select": {
        let rows = table.filter((r) => this.filters.every((f) => f(r)));
        if (this.sorts.length) {
          rows = [...rows].sort((a, b) => {
            for (const { col, asc } of this.sorts) {
              const c = (a[col] as never) > (b[col] as never) ? 1 : (a[col] as never) < (b[col] as never) ? -1 : 0;
              if (c !== 0) return c * (asc ? 1 : -1);
            }
            return 0;
          });
        }
        if (this.max !== null || this.skip > 0) rows = rows.slice(this.skip, this.max !== null ? this.skip + this.max : undefined);
        return this.out(rows);
      }
      case "insert": {
        const added: Row[] = [];
        for (const p of this.payload) {
          const row = { ...(this.db.defaults[this.name]?.() ?? {}), ...p };
          if (!("id" in row) && this.db.defaults[this.name] === undefined) row.id = randomUUID();
          if (this.violates(row, [...table, ...added])) return dup;
          added.push(row);
        }
        table.push(...added);
        return this.out(added);
      }
      case "upsert": {
        const touched: Row[] = [];
        for (const p of this.payload) {
          const existing = table.find((r) => this.onConflict.every((c) => r[c] === p[c]));
          if (existing) {
            const next = { ...existing, ...p };
            if (this.violates(next, table.filter((r) => r !== existing))) return dup;
            Object.assign(existing, p);
            touched.push(existing);
          } else {
            const row = { ...(this.db.defaults[this.name]?.() ?? {}), ...p };
            if (this.violates(row, table)) return dup;
            table.push(row);
            touched.push(row);
          }
        }
        return this.out(touched);
      }
      case "update": {
        const rows = table.filter((r) => this.filters.every((f) => f(r)));
        for (const r of rows) if (this.violates({ ...r, ...this.patch }, table.filter((o) => o !== r))) return dup;
        for (const r of rows) Object.assign(r, this.patch);
        return this.out(rows);
      }
      case "delete": {
        const rows = table.filter((r) => this.filters.every((f) => f(r)));
        this.db.tables[this.name] = table.filter((r) => !rows.includes(r));
        return this.out(rows);
      }
    }
  }
}

/* ───────────── F89 · `or()` (subconjunto de PostgREST) ───────────── */

/** Parte por comas de primer nivel (respeta paréntesis). */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseCond(c: string): (r: Row) => boolean {
  if (c.startsWith("and(") && c.endsWith(")")) {
    const parts = splitTop(c.slice(4, -1)).map(parseCond);
    return (r) => parts.every((f) => f(r));
  }
  const [col, ...rest] = c.split(".");
  const op = rest.join(".");
  if (op === "is.null") return (r) => (r[col] ?? null) === null;
  if (op === "not.is.null") return (r) => (r[col] ?? null) !== null;
  if (op.startsWith("eq.")) { const v = op.slice(3); return (r) => String(r[col] ?? "") === v; }
  if (op.startsWith("in.(") && op.endsWith(")")) { const vs = op.slice(4, -1).split(","); return (r) => vs.includes(String(r[col] ?? "")); }
  // F85 · comparaciones (el latido condicionado usa `last_seen_at.lt.<iso>`; ISO se compara como texto).
  if (op.startsWith("lt.")) { const v = op.slice(3); return (r) => r[col] != null && String(r[col]) < v; }
  if (op.startsWith("gt.")) { const v = op.slice(3); return (r) => r[col] != null && String(r[col]) > v; }
  throw new Error(`MemorySupabase.or: condición no soportada «${c}»`);
}

function parseOr(expr: string): (r: Row) => boolean {
  const parts = splitTop(expr).map(parseCond);
  return (r) => parts.some((f) => f(r));
}
