/**
 * SUPABASE DE MENTIRA EN MEMORIA (Fase 24.6) — para probar el pipeline entero sin base de datos.
 *
 * Implementa el subconjunto de PostgREST que usan `syncTournament`, `pickemLifecycle`,
 * `scorePickemEvent`, `services/rewards`, el lock, la salud y el runner: `from().select/insert/
 * upsert/update` con `eq/neq/in/is/not/or/order/limit/maybeSingle/single`, `count: exact, head`,
 * embed `teams(name)` y las RPC del dominio (`app_set_correct_option`, `app_score_pickem_event`,
 * `app_grant_reward`, `recompute_*`) con su semántica de idempotencia.
 *
 * Además ANOTA cada escritura (`writes`) y cada RPC (`rpcCalls`) para poder afirmar «cero
 * escrituras» en dry run, y puede simular un esquema PRE-0045 (`schema.matches` sin columnas de
 * estructura → 42703) y fallos inyectados (`failNext`).
 *
 * No es un test: es la infraestructura que los tests y el QA comparten.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
interface PgError { code?: string; message: string }
interface Result { data: unknown; error: PgError | null; count?: number | null }

export interface FakeDbOptions {
  /** Columnas permitidas por tabla. Una columna fuera de la lista → 42703 (simula PRE-0045). */
  schema?: Record<string, string[]>;
  /** Reloj para `created_at`/`scored_at`. */
  now?: () => number;
}

const UUID_TABLES = new Set(["pickem_events", "pickem_questions", "pickem_submissions", "pickem_answers", "stages", "match_maps", "notifications", "pickem_scores"]);

let seq = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: { table: string; op: "insert" | "upsert" | "update" | "delete"; rows: number }[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  /** Fallos inyectados: la próxima operación sobre la tabla/RPC falla con este mensaje. */
  failNext: Record<string, PgError> = {};
  /** Recompensas concedidas (libro mayor de mentira): `usuario::ref` → veces que se pidió (se aplica una). */
  ledger = new Map<string, number>();
  /** Veces que una recompensa se APLICÓ de verdad a un usuario (clave `usuario::ref`). */
  granted(userId: string, ref: string): number { return this.ledger.has(`${userId}::${ref}`) ? 1 : 0; }
  private schema: Record<string, Set<string>>;
  private now: () => number;

  constructor(opts: FakeDbOptions = {}) {
    this.schema = Object.fromEntries(Object.entries(opts.schema ?? {}).map(([t, cols]) => [t, new Set(cols)]));
    this.now = opts.now ?? (() => Date.now());
  }

  seed(table: string, rows: Row[]): this {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((r) => ({ ...r }))];
    return this;
  }
  rows(table: string): Row[] { return this.tables[table] ?? []; }
  writesTo(table?: string): number {
    return this.writes.filter((w) => !table || w.table === table).reduce((n, w) => n + w.rows, 0);
  }

  private columnError(table: string, cols: string[]): PgError | null {
    const allowed = this.schema[table];
    if (!allowed) return null;
    for (const c of cols) {
      if (c === "*" || c.includes("(")) continue;
      if (!allowed.has(c)) return { code: "42703", message: `column ${table}.${c} does not exist` };
    }
    return null;
  }

  private takeFailure(key: string): PgError | null {
    const f = this.failNext[key];
    if (f) delete this.failNext[key];
    return f ?? null;
  }

  client(): SupabaseClient {
    const self = this;
    return {
      from: (table: string) => new Builder(self, table),
      rpc: async (name: string, args: Row = {}) => self.rpc(name, args),
    } as unknown as SupabaseClient;
  }

  /* ── RPC del dominio (semántica mínima, fiel a las migraciones) ── */
  async rpc(name: string, args: Row): Promise<Result> {
    this.rpcCalls.push({ name, args });
    const fail = this.takeFailure(`rpc:${name}`);
    if (fail) return { data: null, error: fail };
    switch (name) {
      case "recompute_standings":
      case "recompute_team_stats":
      case "recompute_player_event_stats":
        return { data: null, error: null };
      case "app_set_correct_option": {
        const q = this.rows("pickem_questions").find((r) => r.id === args.p_question_id);
        if (!q) return { data: null, error: { message: "Pregunta inexistente" } };
        q.correct_option = args.p_correct;
        return { data: null, error: null };
      }
      case "app_score_pickem_event": {
        const evId = args.p_pickem_event_id;
        const questions = this.rows("pickem_questions").filter((q) => q.pickem_event_id === evId);
        const subs = this.rows("pickem_submissions").filter((s) => s.pickem_event_id === evId);
        let users = 0; let total = 0;
        for (const s of subs) {
          const answers = this.rows("pickem_answers").filter((a) => a.submission_id === s.id);
          let points = 0; let correct = 0;
          for (const a of answers) {
            const q = questions.find((x) => x.id === a.question_id);
            const ok = !!q?.correct_option && a.option_key === q.correct_option;
            a.is_correct = ok; a.points_award = ok ? (q?.points as number) : 0;
            if (ok) { points += q?.points as number; correct++; }
          }
          const scores = this.tables.pickem_scores ??= [];
          const prev = scores.find((x) => x.user_id === s.user_id && x.pickem_event_id === evId);
          const prevPoints = (prev?.points as number) ?? 0;
          if (prev) { prev.points = points; prev.correct = correct; prev.total = answers.length; prev.scored_at = new Date(this.now()).toISOString(); }
          else scores.push({ id: uuid(), user_id: s.user_id, pickem_event_id: evId, points, correct, total: answers.length, scored_at: new Date(this.now()).toISOString() });
          const profile = this.rows("profiles").find((p) => p.id === s.user_id);
          if (profile) profile.points = Math.max(0, ((profile.points as number) ?? 0) + (points - prevPoints));
          users++; total += points;
        }
        const ev = this.rows("pickem_events").find((e) => e.id === evId);
        if (ev) ev.status = "scored";
        this.writes.push({ table: "pickem_scores", op: "upsert", rows: users });
        return { data: { users, pointsAwarded: total }, error: null };
      }
      case "app_grant_reward": {
        // Idempotencia POR USUARIO Y CLAVE, como el libro mayor real: el mismo ref lo comparten todos
        // los usuarios del escalón; lo que no se repite es (usuario, ref).
        const ref = `${String(args.p_user)}::${String(args.p_ref)}`;
        const applied = !this.ledger.has(ref);
        this.ledger.set(ref, (this.ledger.get(ref) ?? 0) + 1);
        if (applied) this.writes.push({ table: "credit_transactions", op: "insert", rows: 1 });
        return { data: { applied, credits: applied ? (args.p_credits as number) ?? 0 : 0, cardUids: [] }, error: null };
      }
      default:
        return { data: null, error: { message: `RPC desconocida en el fake: ${name}` } };
    }
  }

  /* ── Ejecución de una consulta construida ── */
  exec(b: Builder): Result {
    const table = b.table;
    const fail = this.takeFailure(table);
    if (fail) return { data: null, error: fail };
    const rows = this.tables[table] ??= [];
    const apply = (list: Row[]): Row[] => {
      let out = list.filter((r) => b.filters.every((f) => f(r)));
      for (const o of b.orders) {
        out = [...out].sort((x, y) => {
          const a = x[o.col] as string | number | null; const c = y[o.col] as string | number | null;
          if (a === c) return 0;
          if (a == null) return 1; if (c == null) return -1;
          return (a < c ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      if (b.limitN != null) out = out.slice(0, b.limitN);
      return out;
    };
    const project = (list: Row[]): Row[] => {
      if (!b.selectCols || b.selectCols.includes("*")) return list.map((r) => ({ ...r }));
      return list.map((r) => {
        const o: Row = {};
        for (const c of b.selectCols!) {
          const embed = /^(\w+)\((\w+)\)$/.exec(c);
          if (embed) {
            const [, rel, col] = embed;
            const fk = `${rel.replace(/s$/, "")}_id`;
            const target = this.rows(rel).find((t) => t.id === r[fk]);
            o[rel] = target ? { [col]: target[col] } : null;
          } else o[c] = r[c] ?? null;
        }
        return o;
      });
    };
    const selCheck = b.selectCols ? this.columnError(table, b.selectCols) : null;
    if (selCheck) return { data: null, error: selCheck };

    if (b.op === "select") {
      const out = apply(rows);
      if (b.head) return { data: null, error: null, count: out.length };
      return this.shape(b, project(out), out.length);
    }
    if (b.op === "insert" || b.op === "upsert") {
      const payload = b.payload!;
      const keyErr = this.columnError(table, [...new Set(payload.flatMap((r) => Object.keys(r)))]);
      if (keyErr) return { data: null, error: keyErr };
      const conflict = b.op === "upsert" ? (b.onConflict ?? "id").split(",").map((s) => s.trim()) : null;
      const affected: Row[] = [];
      for (const r of payload) {
        const row: Row = { ...r };
        if (UUID_TABLES.has(table) && row.id == null) row.id = uuid();
        if (row.created_at == null && (UUID_TABLES.has(table) || table === "events")) row.created_at = new Date(this.now()).toISOString();
        const existing = conflict ? rows.find((x) => conflict.every((k) => x[k] === row[k])) : rows.find((x) => x.id === row.id && row.id != null);
        if (existing) {
          if (b.op === "insert") return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${table})` } };
          if (b.ignoreDuplicates) continue;
          Object.assign(existing, row);
          affected.push(existing);
        } else {
          rows.push(row);
          affected.push(row);
        }
      }
      this.writes.push({ table, op: b.op, rows: affected.length });
      return this.shape(b, project(affected), affected.length);
    }
    if (b.op === "update") {
      const keyErr = this.columnError(table, Object.keys(b.patch!));
      if (keyErr) return { data: null, error: keyErr };
      const targets = apply(rows);
      for (const r of targets) Object.assign(r, b.patch);
      this.writes.push({ table, op: "update", rows: targets.length });
      return this.shape(b, project(targets), targets.length);
    }
    if (b.op === "delete") {
      const targets = apply(rows);
      this.tables[table] = rows.filter((r) => !targets.includes(r));
      this.writes.push({ table, op: "delete", rows: targets.length });
      return this.shape(b, project(targets), targets.length);
    }
    return { data: null, error: { message: "op desconocida" } };
  }

  private shape(b: Builder, list: Row[], count: number): Result {
    if (!b.selectCols && b.op !== "select") return { data: null, error: null };
    if (b.singleMode === "maybe") return { data: list[0] ?? null, error: null };
    if (b.singleMode === "strict") {
      if (list.length !== 1) return { data: null, error: { code: "PGRST116", message: `${list.length} rows` } };
      return { data: list[0], error: null };
    }
    return { data: list, error: null, count: b.count ? count : null };
  }
}

/** Constructor de consulta encadenable y «thenable», como el de supabase-js. */
class Builder implements PromiseLike<Result> {
  op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  selectCols: string[] | null = null;
  filters: Filter[] = [];
  orders: { col: string; asc: boolean }[] = [];
  limitN: number | null = null;
  singleMode: "maybe" | "strict" | null = null;
  head = false;
  count = false;
  payload: Row[] | null = null;
  patch: Row | null = null;
  onConflict: string | null = null;
  ignoreDuplicates = false;

  constructor(private db: FakeDb, public table: string) {}

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    this.selectCols = cols.split(",").map((s) => s.trim()).filter(Boolean);
    if (opts.head) this.head = true;
    if (opts.count) this.count = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts.onConflict ?? null; this.ignoreDuplicates = !!opts.ignoreDuplicates;
    return this;
  }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  neq(col: string, v: unknown) { this.filters.push((r) => r[col] !== v); return this; }
  in(col: string, vs: unknown[]) { const set = new Set(vs); this.filters.push((r) => set.has(r[col])); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return this; }
  not(col: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (v === null ? r[col] != null : r[col] !== v));
    else if (op === "eq") this.filters.push((r) => r[col] !== v);
    return this;
  }
  /** `status.neq.running,updated_at.lt.2026-…` → cualquiera de las condiciones. */
  or(expr: string) {
    const conds = expr.split(",").map((c) => {
      const m = /^(\w+)\.(eq|neq|lt|lte|gt|gte|is)\.(.*)$/.exec(c.trim());
      if (!m) throw new Error(`or() no soportado en el fake: ${c}`);
      const [, col, op, raw] = m;
      const val: unknown = raw === "null" ? null : raw;
      return (r: Row): boolean => {
        const x = r[col] as string | number | null;
        switch (op) {
          case "eq": return x === val;
          case "neq": return x !== val;
          case "is": return val === null ? x == null : x === val;
          case "lt": return x != null && String(x) < String(val);
          case "lte": return x != null && String(x) <= String(val);
          case "gt": return x != null && String(x) > String(val);
          case "gte": return x != null && String(x) >= String(val);
        }
        return false;
      };
    });
    this.filters.push((r) => conds.some((c) => c(r)));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "strict"; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<T1 = Result, T2 = never>(res?: ((v: Result) => T1 | PromiseLike<T1>) | null, rej?: ((e: unknown) => T2 | PromiseLike<T2>) | null): Promise<T1 | T2> {
    return Promise.resolve().then(() => this.db.exec(this)).then(res as any, rej as any);
  }
}

