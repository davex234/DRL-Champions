/**
 * FASE 41 · SUPABASE EN MEMORIA CON ESCRITURAS Y RPC ECONÓMICAS (para pruebas y el fuzzer de economía).
 *
 * A diferencia de `FakeSupabase` (solo lectura), aquí las escrituras MUTAN las tablas y las RPC de economía reproducen
 * el contrato de sus migraciones vigentes:
 *
 *   · `_ledger_apply` (0019): bloqueo del perfil, suelo 0 («Saldo insuficiente»), asiento con `balance_after`.
 *   · `app_buy_pack` (0019) · `app_apply_pack_open` (0019) · `app_salvage_cards` (0019)
 *   · `app_grant_reward` (0026: puerta de idempotencia por `(user_id, ref)` en el libro mayor, SIN suelo)
 *   · `app_sandbox_purchase` (0025) · `app_buy_cosmetic` (0024: clave buscada SIN filtrar por usuario, como en SQL)
 *
 * Restricciones únicas reales: `credit_transactions (user_id, ref)`, `economy_ops.ref` (global), `user_packs
 * (user_id, pack_id)`, `user_pass.user_id`, `user_cosmetics (user_id, cosmetic_id)`.
 *
 * Cada RPC es SÍNCRONA dentro de un `await`: equivale a una transacción serializable. Las carreras que se pueden
 * reproducir son las de verdad en producción: entre los `await` de los servicios (leer → decidir → escribir).
 * Lo que NO modela: RLS, PostgREST, triggers de columnas protegidas, `like` (se ignora), orden estable de `order()`
 * salvo por la columna pedida. NO sustituye a la BD real: la QA real se hace aparte contra el VPS.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
type Err = { code: string; message: string } | null;

const UNIQUE: Record<string, string[]> = {
  credit_transactions: ["user_id", "ref"],
  economy_ops: ["ref"],
  user_packs: ["user_id", "pack_id"],
  user_pass: ["user_id"],
  user_cosmetics: ["user_id", "cosmetic_id"],
  user_game: ["user_id"],
  profiles: ["id"],
  card_mints: ["card_id"],
  // F86.1 · `duel_matches.id` es clave primaria en Postgres: una partida con id RESERVADO (torneo, reto) no puede
  // insertarse dos veces aunque lleguen varias peticiones a la vez (la segunda recibe 23505 y la trata como «ya creada»).
  duel_matches: ["id"],
  // F66 · libro de acciones PvP (0031): `primary key (match_id, action_id)`.
  duel_match_actions: ["match_id", "action_id"],
  // F73 · 0059: un evento de misión por usuario, un progreso por (usuario, misión), un proyecto reclamado por usuario.
  mission_events: ["user_id", "event_key"],
  user_mission_progress: ["user_id", "mission_id"],
  user_project_claims: ["user_id", "project_id"],
  craft_recipes: ["id"],
  // F79 · 0061: un documento de configuración de la Forja por id.
  forge_config: ["id"],
};

export class MemSupabase {
  tables: Record<string, Row[]> = {};
  writes = 0;
  writeLog: string[] = [];
  rpcCalls: string[] = [];
  /**
   * COLECCIONES ILIMITADAS · `max_rows` de PostgREST (`supabase/config.toml`): una lectura sin paginar se corta aquí EN
   * SILENCIO, igual que en producción. Con el doble sin tope, un servicio que leía la colección de una vez pasaba
   * todos los tests y fallaba con la carta 1.001.
   */
  maxRows = 1000;
  /** Tablas que responden error (simula «tabla no disponible»: p. ej. `content_cards` → catálogo semilla). */
  failTables = new Set<string>(["content_cards", "content_catalog_versions", "content_pool_versions"]);
  /**
   * SANEAMIENTO POST F47 · COLUMNAS REALES POR TABLA (opt-in, vacío por defecto).
   *
   * Declarar una tabla aquí hace que filtrar por una columna que NO existe responda `42703` como
   * PostgREST, en vez de «0 filas» en silencio. Es lo que distingue un recuento legítimamente 0 de una
   * consulta rota: `pickem_answers.user_id` no existe (0012) y el silencio lo ocultó hasta que
   * `windowCounts` lo convirtió en un 500 de `/api/game/meta`. Solo afecta a las tablas declaradas.
   */
  columns: Record<string, Set<string>> = {};
  declareColumns(table: string, cols: readonly string[]): void { this.columns[table] = new Set(cols); }
  private seq = 0;

  get client(): SupabaseClient { return this as unknown as SupabaseClient; }
  table(name: string): Row[] { return (this.tables[name] ??= []); }
  /** Fase 42 · consultas lanzadas (para medir N+1: el número de lecturas no puede crecer con los datos). */
  reads = 0;
  from(name: string) { this.reads++; return new MemQuery(this, name); }

  now(): string { return new Date(Date.now() + this.seq++).toISOString(); }

  logWrite(what: string) { this.writes++; this.writeLog.push(what); }

  /** Inserta respetando las restricciones únicas. Devuelve error 23505 como PostgREST. */
  insertRow(name: string, row: Row): Err {
    const uniq = UNIQUE[name];
    const t = this.table(name);
    if (uniq && uniq.every((c) => row[c] !== undefined && row[c] !== null)) {
      if (t.some((r) => uniq.every((c) => r[c] === row[c]))) return { code: "23505", message: `duplicate key value violates unique constraint on ${name}` };
    }
    t.push({ ...row });
    this.logWrite(`insert:${name}`);
    return null;
  }

  // ───────────────────────────── RPC ─────────────────────────────
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: Err }> {
    this.rpcCalls.push(name);
    await Promise.resolve();
    try {
      const fn = (this as unknown as Record<string, (a: Record<string, unknown>) => unknown>)[`rpc_${name}`];
      if (typeof fn !== "function") return { data: null, error: { code: "PGRST202", message: `rpc ${name} no disponible` } };
      // Transacción: se trabaja sobre una copia y solo se confirma si no lanza.
      const snapshot = JSON.stringify(this.tables);
      const writesBefore = this.writes; const logLen = this.writeLog.length;
      try {
        return { data: fn.call(this, args), error: null };
      } catch (e) {
        this.tables = JSON.parse(snapshot); this.writes = writesBefore; this.writeLog.length = logLen;
        throw e;
      }
    } catch (e) {
      return { data: null, error: { code: "P0001", message: e instanceof Error ? e.message : String(e) } };
    }
  }

  // ───────────────────────────── F58 · RPC del Control Center (0055) ─────────────────────────────
  private assertAdmin(actor: unknown): void {
    if (!actor || !this.table("profiles").some((p) => p.id === actor && p.is_admin)) throw new Error("NOT_ADMIN");
  }
  private audit(actor: unknown, action: string, entityType: string, entityId: string, detail: Row): void {
    const t = this.table("content_audit_log");
    t.push({ id: t.length + 1, at: this.now(), actor, action, entity_type: entityType, entity_id: entityId, card_id: null, pool_id: null, detail });
    this.logWrite("insert:content_audit_log");
  }
  rpc_app_admin_audit(a: Record<string, unknown>): null {
    this.assertAdmin(a.p_actor);
    if (typeof a.p_action !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(a.p_action)) throw new Error("BAD_ACTION");
    this.audit(a.p_actor, a.p_action, String(a.p_entity_type ?? ""), String(a.p_entity_id ?? ""), (a.p_detail as Row) ?? {});
    return null;
  }
  rpc_app_admin_sanction(a: Record<string, unknown>): Row {
    this.assertAdmin(a.p_actor);
    if (a.p_user === a.p_actor) throw new Error("SELF_SANCTION");
    const target = this.table("profiles").find((p) => p.id === a.p_user);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.is_admin) throw new Error("TARGET_IS_ADMIN");
    if (a.p_type !== "ban" && a.p_type !== "suspension") throw new Error("BAD_TYPE");
    if (a.p_type === "suspension" && !a.p_expires_at) throw new Error("SUSPENSION_NEEDS_EXPIRY");
    const now = Date.now();
    if (a.p_expires_at && Date.parse(String(a.p_expires_at)) <= now) throw new Error("BAD_EXPIRY");
    if (this.table("user_sanctions").some((s) => s.user_id === a.p_user && !s.revoked_at && (!s.expires_at || Date.parse(String(s.expires_at)) > now))) throw new Error("ALREADY_SANCTIONED");
    const row: Row = { id: randomUUID(), user_id: a.p_user, type: a.p_type, reason: a.p_reason, created_at: this.now(), created_by: a.p_actor, expires_at: a.p_expires_at ?? null, revoked_at: null, revoked_by: null, revoke_reason: null };
    this.table("user_sanctions").push(row); this.logWrite("insert:user_sanctions");
    this.audit(a.p_actor, "user_sanction", "user", String(a.p_user), { sanctionId: row.id, type: a.p_type, reason: a.p_reason });
    return { ...row };
  }
  /** 0067/0068 · espejo de `app_admin_set_admin`: actor admin, inexistente, idempotente, sanción vigente, último admin, auditoría (con tag). */
  rpc_app_admin_set_admin(a: Record<string, unknown>): Row {
    this.assertAdmin(a.p_actor);
    if (typeof a.p_grant !== "boolean" || !a.p_target) throw new Error("BAD_ID");
    const reason = typeof a.p_reason === "string" && a.p_reason.trim() ? a.p_reason.trim() : null;
    if (reason && reason.length > 300) throw new Error("BAD_REASON");
    const target = this.table("profiles").find((p) => p.id === a.p_target);
    if (!target) throw new Error("USER_NOT_FOUND");
    const admins = () => this.table("profiles").filter((p) => p.is_admin).length;
    const tag = (target.public_tag as string | null | undefined) ?? null;
    if (a.p_grant) {
      if (target.is_admin) return { code: "ALREADY_ADMIN", username: target.username, tag, admins: admins() };
      const now = Date.now();
      if (this.table("user_sanctions").some((s) => s.user_id === a.p_target && !s.revoked_at && (!s.expires_at || Date.parse(String(s.expires_at)) > now))) throw new Error("TARGET_SANCTIONED");
    } else {
      if (!target.is_admin) return { code: "ALREADY_NOT_ADMIN", username: target.username, tag, admins: admins() };
      if (admins() <= 1) throw new Error("LAST_ADMIN");
    }
    target.is_admin = a.p_grant; this.logWrite("update:profiles");
    this.audit(a.p_actor, a.p_grant ? "GRANT_ADMIN" : "REVOKE_ADMIN", "user", String(a.p_target), { target_username: target.username, target_tag: tag, reason, admins_after: admins(), self: a.p_actor === a.p_target });
    return { code: a.p_grant ? "GRANTED" : "REVOKED", username: target.username, tag, admins: admins() };
  }
  rpc_app_admin_revoke_sanction(a: Record<string, unknown>): Row {
    this.assertAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.length < 8) throw new Error("REASON_REQUIRED");
    const s = this.table("user_sanctions").find((x) => x.id === a.p_id);
    if (!s) throw new Error("SANCTION_NOT_FOUND");
    if (s.revoked_at) throw new Error("ALREADY_REVOKED");
    Object.assign(s, { revoked_at: this.now(), revoked_by: a.p_actor, revoke_reason: a.p_reason }); this.logWrite("update:user_sanctions");
    this.audit(a.p_actor, "user_sanction_revoke", "user", String(s.user_id), { sanctionId: s.id, reason: a.p_reason });
    return { ...s };
  }
  rpc_app_admin_adjust_credits(a: Record<string, unknown>): Row {
    this.assertAdmin(a.p_actor);
    const ref = String(a.p_ref ?? "");
    if (!ref.startsWith("admin:credits:")) throw new Error("REF_REQUIRED");
    const delta = Number(a.p_delta);
    if (!delta || Math.abs(delta) > 100000) throw new Error("BAD_AMOUNT");
    if (typeof a.p_reason !== "string" || a.p_reason.length < 8) throw new Error("REASON_REQUIRED");
    const prev = this.table("credit_transactions").find((t) => t.user_id === a.p_user && t.ref === ref);
    if (prev) return { repeated: true, balanceAfter: prev.balance_after, delta: prev.delta };
    const p = this.table("profiles").find((x) => x.id === a.p_user);
    if (!p) throw new Error("USER_NOT_FOUND");
    const before = Number(p.credits);
    if (a.p_expected_balance !== null && a.p_expected_balance !== undefined && before !== Number(a.p_expected_balance)) throw new Error("STALE_BALANCE");
    const after = this.ledgerApply(a.p_user, delta, `admin_adjust: ${a.p_reason}`, ref);
    this.audit(a.p_actor, "user_credits_adjust", "user", String(a.p_user), { ref, delta, before: { credits: before }, after: { credits: after } });
    return { repeated: false, balanceBefore: before, balanceAfter: after, delta };
  }
  rpc_app_admin_publish_event(a: Record<string, unknown>): Row {
    this.assertAdmin(a.p_actor);
    const d = this.table("admin_event_drafts").find((x) => x.id === a.p_id);
    if (!d) throw new Error("EVENT_NOT_FOUND");
    if (d.status !== "draft") throw new Error("NOT_A_DRAFT");
    if (a.p_expected_updated_at && d.updated_at !== a.p_expected_updated_at) throw new Error("STALE_EVENT");
    if (Date.parse(String(d.ends_at)) <= Date.now()) throw new Error("EVENT_ALREADY_ENDED");
    const eventId = `adm-${String(d.id).replace(/-/g, "")}`;
    this.table("events").push({ id: eventId, name: d.name, type: d.type, region: d.region, status: Date.parse(String(d.starts_at)) > Date.now() ? "upcoming" : "ongoing", start_date: d.starts_at, end_date: d.ends_at, source: "admin" });
    Object.assign(d, { status: "published", event_id: eventId, published_at: this.now(), published_by: a.p_actor, updated_at: this.now() });
    this.audit(a.p_actor, "event_publish", "event", String(d.id), { eventId });
    return { ...d };
  }
  rpc_app_admin_search_users(a: Record<string, unknown>): Row[] {
    const q = typeof a.p_q === "string" ? a.p_q.toLowerCase() : null;
    const rows = this.table("profiles").filter((p) => !q || String(p.username ?? "").toLowerCase().includes(q) || String(p.email ?? "").toLowerCase().includes(q) || p.id === q);
    const lim = Number(a.p_limit ?? 25), off = Number(a.p_offset ?? 0);
    return rows.slice(off, off + lim).map((p) => ({ id: p.id, username: p.username, email: p.email ?? null, created_at: null, last_sign_in_at: null, last_seen_at: p.last_seen_at ?? null, is_admin: !!p.is_admin, credits: p.credits, level: p.level ?? 1, total: rows.length }));
  }
  rpc_app_admin_user_identity(a: Record<string, unknown>): Row | null {
    const p = this.table("profiles").find((x) => x.id === a.p_user);
    return p ? { email: p.email ?? null, createdAt: null, lastSignInAt: null, confirmedAt: null, provider: "email" } : null;
  }
  rpc_app_admin_dashboard_stats(): Row {
    const ps = this.table("profiles");
    return { users: ps.length, admins: ps.filter((p) => p.is_admin).length, newUsers7d: 0, seen24h: 0, seen7d: 0, creditsInCirculation: ps.reduce((a, p) => a + Number(p.credits ?? 0), 0),
      cardsOwned: this.table("user_cards").length, packsOpened: 0, unopenedPacks: 0, activeSanctions: this.table("user_sanctions").filter((s) => !s.revoked_at).length,
      ratedPlayers: 0, rankedResults: 0, catalogCards: 0, catalogPublished: 0, eventDrafts: this.table("admin_event_drafts").filter((d) => d.status === "draft").length };
  }
  rpc_app_admin_ledger_summary(): Row[] { return []; }
  // F60 · la sonda v2 (0057) también declara el estado de 0057.
  rpc_app_admin_schema_probe(): Row { return { "0055_user_sanctions": true, "0055_admin_event_drafts": true, "0057_content_packs": true, "0057_agents_lifecycle": true, "0057_card_presentation": true, "0057_entity_version": true }; }

  private profile(user: unknown): Row {
    const p = this.table("profiles").find((r) => r.id === user);
    if (!p) throw new Error("Perfil inexistente");
    return p;
  }

  private ledgerApply(user: unknown, delta: number, reason: string, ref: string, kind?: string): number {
    const p = this.profile(user);
    const balance = Number(p.credits);
    if (balance + delta < 0) throw new Error("Saldo insuficiente");
    const after = balance + delta;
    const err = this.insertRow("credit_transactions", { id: randomUUID(), user_id: user, delta, reason, ref, balance_after: after, kind: kind ?? (delta >= 0 ? "credit" : "debit"), created_at: this.now() });
    if (err) throw new Error(err.message);
    p.credits = after;
    return after;
  }

  private storedOp(ref: unknown): Row | null {
    const op = this.table("economy_ops").find((r) => r.ref === ref);
    return op ? (op.result as Row) : null;
  }

  private putOp(ref: unknown, user: unknown, kind: string, result: Row) {
    const err = this.insertRow("economy_ops", { ref, user_id: user, kind, result, created_at: this.now() });
    if (err) throw new Error(err.message);
  }

  rpc_app_buy_pack(a: Record<string, unknown>) {
    const price = Number(a.p_price);
    if (price < 0) throw new Error("Precio inválido");
    if (!a.p_ref) throw new Error("Una compra necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    const balance = this.ledgerApply(a.p_user, -price, `buy_pack:${a.p_pack_id}`, String(a.p_ref), "debit");
    const packs = this.table("user_packs");
    let row = packs.find((r) => r.user_id === a.p_user && r.pack_id === a.p_pack_id);
    if (row) row.qty = Number(row.qty) + 1; else { row = { user_id: a.p_user, pack_id: a.p_pack_id, qty: 1 }; this.insertRow("user_packs", row); row = packs[packs.length - 1]; }
    const result = { credits: balance, packId: a.p_pack_id, qty: row.qty };
    this.putOp(a.p_ref, a.p_user, "buy_pack", result);
    return result;
  }

  rpc_app_apply_pack_open(a: Record<string, unknown>) {
    if (a.p_ref) { const prev = this.storedOp(a.p_ref); if (prev) return { ...prev, repeated: true }; }
    const row = this.table("user_packs").find((r) => r.user_id === a.p_user && r.pack_id === a.p_pack_id);
    if (!row || Number(row.qty) < 1) throw new Error("No tienes ese sobre");
    row.qty = Number(row.qty) - 1;
    const uids: string[] = [];
    for (const inst of (a.p_instances as { cardId: string; serial: number | null; origin?: string }[]) ?? []) {
      const uid = randomUUID();
      this.insertRow("user_cards", { uid, user_id: a.p_user, card_id: inst.cardId, serial: inst.serial ?? null, origin: inst.origin ?? "pack", locked: false, obtained_at: this.now(), minted_version: null });
      uids.push(uid);
    }
    for (const [card, minted] of Object.entries((a.p_mint_delta as Record<string, number>) ?? {})) {
      const m = this.table("card_mints").find((r) => r.card_id === card);
      if (m) m.minted = Math.max(Number(m.minted), minted); else this.insertRow("card_mints", { card_id: card, minted });
    }
    const g = this.table("user_game").find((r) => r.user_id === a.p_user);
    if (g) { g.pity = a.p_pity ?? g.pity; g.packs_opened = Number(g.packs_opened) + 1; }
    else this.insertRow("user_game", { user_id: a.p_user, pity: a.p_pity ?? { version: 1, counters: {} }, packs_opened: 1 });
    if (Number(a.p_xp ?? 0) !== 0) { const p = this.profile(a.p_user); p.xp = Number(p.xp) + Number(a.p_xp); }
    const result = { uids, packId: a.p_pack_id };
    if (a.p_ref) this.putOp(a.p_ref, a.p_user, "open_pack", result);
    return result;
  }

  rpc_app_grant_reward(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("La recompensa necesita una clave de idempotencia");
    if (this.table("credit_transactions").some((r) => r.user_id === a.p_user && r.ref === a.p_ref)) {
      return { applied: false, credits: this.profile(a.p_user).credits };
    }
    const p = this.profile(a.p_user);
    const balance = Number(p.credits) + Number(a.p_credits ?? 0); // 0026: sin suelo
    p.credits = balance;
    p.xp = Number(p.xp ?? 0) + Number(a.p_xp ?? 0);
    p.points = Math.max(0, Number(p.points ?? 0) + Number(a.p_points ?? 0));
    const err = this.insertRow("credit_transactions", { id: randomUUID(), user_id: a.p_user, delta: Number(a.p_credits ?? 0), reason: a.p_reason, ref: a.p_ref, balance_after: balance, kind: "credit", created_at: this.now() });
    if (err) throw new Error(err.message);
    if (a.p_pack_id && Number(a.p_pack_count ?? 0) > 0) {
      const row = this.table("user_packs").find((r) => r.user_id === a.p_user && r.pack_id === a.p_pack_id);
      if (row) row.qty = Number(row.qty) + Number(a.p_pack_count); else this.insertRow("user_packs", { user_id: a.p_user, pack_id: a.p_pack_id, qty: Number(a.p_pack_count) });
    }
    const uids: string[] = [];
    for (const card of (a.p_card_ids as string[] | null) ?? []) { const uid = randomUUID(); this.insertRow("user_cards", { uid, user_id: a.p_user, card_id: card, serial: null, origin: "reward", locked: false, obtained_at: this.now() }); uids.push(uid); }
    for (const c of (a.p_cosmetics as string[] | null) ?? []) this.insertRow("user_cosmetics", { user_id: a.p_user, cosmetic_id: c, source: a.p_ref });
    return { applied: true, credits: balance, cardUids: uids };
  }

  rpc_app_salvage_cards(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("Un desguace necesita clave de idempotencia");
    if (Number(a.p_total) < 0) throw new Error("Importe inválido");
    const uids = (a.p_uids as string[]) ?? [];
    if (uids.length === 0) throw new Error("No hay cartas que desguazar");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    const cards = this.table("user_cards");
    const mine = cards.filter((r) => uids.includes(String(r.uid)) && r.user_id === a.p_user && r.locked === false);
    if (mine.length !== uids.length) throw new Error("Alguna de esas cartas no es tuya o está bloqueada");
    // 0060 · de cada carta implicada queda al menos una copia desbloqueada (la regla la impone la BD, no Node).
    for (const cardId of new Set(mine.map((r) => r.card_id))) {
      const kept = cards.filter((r) => r.user_id === a.p_user && r.card_id === cardId && r.locked === false && !uids.includes(String(r.uid))).length;
      if (kept < 1) throw new Error("LAST_COPY: te quedarías sin ninguna copia de esa carta");
    }
    this.tables.user_cards = cards.filter((r) => !mine.includes(r));
    this.logWrite("delete:user_cards");
    const balance = this.ledgerApply(a.p_user, Number(a.p_total), "salvage", String(a.p_ref), "credit");
    const result = { credits: balance, salvaged: mine.length, paid: Number(a.p_total) };
    this.putOp(a.p_ref, a.p_user, "salvage", result);
    return result;
  }

  /* ─────────── F73 · 0059 (misma semántica que el SQL; cada RPC es atómica aquí y se revierte si lanza) ─────────── */

  private liveRecipe(id: unknown, kind: "PACK" | "CARD"): Row {
    const r = this.table("craft_recipes").find((x) => x.id === id);
    if (!r) throw new Error("RECIPE_NOT_FOUND");
    if (r.kind !== kind) throw new Error("RECIPE_KIND");
    const now = Date.parse(this.now());
    if (r.status !== "ACTIVE" || (r.available_from && now < Date.parse(String(r.available_from))) || (r.available_to && now >= Date.parse(String(r.available_to)))) throw new Error("RECIPE_DISABLED");
    return r;
  }

  rpc_app_craft_pack(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("Un crafteo necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    const r = this.liveRecipe(a.p_recipe, "PACK");
    const packs = this.table("user_packs");
    const inRow = packs.find((x) => x.user_id === a.p_user && x.pack_id === r.input_pack_id);
    if (!inRow || Number(inRow.qty) < Number(r.input_qty)) throw new Error("INSUFFICIENT_PACKS");
    inRow.qty = Number(inRow.qty) - Number(r.input_qty);
    let outRow = packs.find((x) => x.user_id === a.p_user && x.pack_id === r.output_pack_id);
    if (outRow) outRow.qty = Number(outRow.qty) + 1; else { this.insertRow("user_packs", { user_id: a.p_user, pack_id: r.output_pack_id, qty: 1 }); outRow = packs[packs.length - 1]; }
    const result = { recipeId: r.id, kind: "PACK", inputs: [{ packId: r.input_pack_id, qty: Number(r.input_qty) }], outputs: [{ packId: r.output_pack_id, qty: 1 }],
      inventory: { [String(r.input_pack_id)]: inRow.qty, [String(r.output_pack_id)]: outRow.qty } };
    this.putOp(a.p_ref, a.p_user, "craft_pack", result);
    return result;
  }

  rpc_app_craft_card(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("Un crafteo necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    const r = this.liveRecipe(a.p_recipe, "CARD");
    const uids = ((a.p_uids as string[]) ?? []).map(String);
    const expected = (a.p_expected as Record<string, string>) ?? {};
    if (uids.length !== Number(r.input_qty)) throw new Error("WRONG_COUNT");
    if (new Set(uids).size !== uids.length) throw new Error("DUPLICATE_INPUT");
    if (!a.p_output_card_id) throw new Error("NO_OUTPUT");
    const cards = this.table("user_cards");
    const mine = cards.filter((c) => uids.includes(String(c.uid)) && c.user_id === a.p_user && c.locked === false && c.card_id === expected[String(c.uid)]);
    if (mine.length !== uids.length) throw new Error("NOT_ELIGIBLE");
    const decks = this.table("duel_decks").filter((d) => d.user_id === a.p_user);
    if (decks.some((d) => ((d.card_uids as string[]) ?? []).some((u) => uids.includes(String(u))))) throw new Error("IN_DECK");
    // 0061 · como el desguace (0060): de cada carta queda al menos una copia NO bloqueada (una en venta no cuenta).
    for (const cardId of new Set(Object.values(expected))) {
      const kept = cards.filter((c) => c.user_id === a.p_user && c.card_id === cardId && c.locked === false && !uids.includes(String(c.uid))).length;
      if (kept < 1) throw new Error("LAST_COPY");
    }
    this.tables.user_cards = cards.filter((c) => !mine.includes(c));
    this.logWrite("delete:user_cards");
    const uid = randomUUID();
    this.insertRow("user_cards", { uid, user_id: a.p_user, card_id: a.p_output_card_id, serial: null, origin: "craft", locked: false, obtained_at: this.now() });
    const result = { recipeId: r.id, kind: "CARD", inputs: uids.map((u) => ({ uid: u, cardId: expected[u] })), outputs: [{ uid, cardId: a.p_output_card_id }] };
    this.putOp(a.p_ref, a.p_user, "craft_card", result);
    return result;
  }

  /* ─────────── F79.1 · 0061 · RPC GUARDADAS (carta protegida, la misma regla que `domain/cards/protection`) ─────────── */

  /** `_card_consume_guard` de 0061: en un equipo = siempre fuera; favorita/vitrina = solo si viene en `p_confirm`. */
  private cardConsumeGuard(user: unknown, uids: string[], confirm: unknown): void {
    const decks = this.table("duel_decks").filter((d) => d.user_id === user);
    if (decks.some((d) => ((d.card_uids as string[]) ?? []).some((u) => uids.includes(String(u))))) throw new Error("IN_DECK");
    const ok = new Set(((confirm as string[] | null) ?? []).map(String));
    const favs = new Set(this.table("user_card_favorites").filter((f) => f.user_id === user).map((f) => String(f.card_id)));
    const show = new Set((((this.table("player_profile_customization").find((r) => r.user_id === user)?.showcase_card_uids) as string[] | undefined) ?? []).map(String));
    const mine = this.table("user_cards").filter((c) => c.user_id === user && uids.includes(String(c.uid)));
    if (mine.some((c) => (favs.has(String(c.card_id)) || show.has(String(c.uid))) && !ok.has(String(c.uid)))) throw new Error("PROTECTED_COPY");
  }
  rpc_app_craft_card_guarded(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("Un crafteo necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    this.cardConsumeGuard(a.p_user, ((a.p_uids as string[]) ?? []).map(String), a.p_confirm);
    return this.rpc_app_craft_card(a);
  }
  rpc_app_salvage_cards_guarded(a: Record<string, unknown>) {
    if (!a.p_ref) throw new Error("Un desguace necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref);
    if (prev) return { ...prev, repeated: true };
    this.cardConsumeGuard(a.p_user, ((a.p_uids as string[]) ?? []).map(String), a.p_confirm);
    return this.rpc_app_salvage_cards(a);
  }

  rpc_app_mission_apply(a: Record<string, unknown>) {
    const err = this.insertRow("mission_events", { user_id: a.p_user, event_key: a.p_event_key, kind: a.p_kind, evidence: a.p_evidence ?? {}, created_at: this.now() });
    if (err) return { repeated: true, completed: [] };
    const done: string[] = [];
    for (const o of ((a.p_ops as { mission: string; op: string; value?: number; target: number }[]) ?? [])) {
      if (!(o.target >= 1)) continue;
      const rows = this.table("user_mission_progress");
      let row = rows.find((x) => x.user_id === a.p_user && x.mission_id === o.mission);
      if (!row) { this.insertRow("user_mission_progress", { user_id: a.p_user, mission_id: o.mission, progress: 0, completed_at: null, claimed_at: null, updated_at: this.now() }); row = rows[rows.length - 1]; }
      if (row.completed_at) continue;
      const cur = Number(row.progress);
      row.progress = o.op === "INC" ? Math.min(cur + Math.max(0, Number(o.value ?? 0)), o.target) : o.op === "STREAK_WIN" ? Math.min(cur + 1, o.target) : o.op === "STREAK_RESET" ? 0 : cur;
      row.updated_at = this.now();
      if (Number(row.progress) >= o.target) { row.completed_at = this.now(); done.push(o.mission); }
    }
    return { repeated: false, completed: done };
  }

  rpc_app_sandbox_purchase(a: Record<string, unknown>) {
    if (!a.p_ref || !String(a.p_ref).trim()) throw new Error("Referencia obligatoria");
    if (!(Number(a.p_credits) > 0)) throw new Error("Cantidad inválida");
    const prev = this.storedOp(a.p_ref);
    if (prev) return prev;
    this.insertRow("payments", { user_id: a.p_user, product_id: a.p_product_id, status: "granted", idempotency_key: a.p_ref, credits_granted: a.p_credits });
    const balance = this.ledgerApply(a.p_user, Number(a.p_credits), `sandbox_purchase:${a.p_product_id}`, String(a.p_ref), "purchase");
    const result = { credits: balance, granted: Number(a.p_credits), productId: a.p_product_id, sandbox: true };
    this.putOp(a.p_ref, a.p_user, "sandbox_purchase", result);
    return result;
  }

  rpc_app_buy_cosmetic(a: Record<string, unknown>) {
    if (!(Number(a.p_price) > 0)) throw new Error("Precio inválido");
    if (!a.p_ref) throw new Error("Una compra necesita clave de idempotencia");
    const prev = this.storedOp(a.p_ref); // 0024: SIN filtrar por usuario
    if (prev) return { ...prev, repeated: true };
    const cos = this.table("user_cosmetics");
    if (cos.some((r) => r.user_id === a.p_user && r.cosmetic_id === a.p_cosmetic_id)) throw new Error("Ya tienes ese cosmético");
    if (a.p_requires && !cos.some((r) => r.user_id === a.p_user && r.cosmetic_id === a.p_requires)) throw new Error("Te falta el escalón anterior");
    const balance = this.ledgerApply(a.p_user, -Number(a.p_price), `prestige:${a.p_cosmetic_id}`, String(a.p_ref), "debit");
    this.insertRow("user_cosmetics", { user_id: a.p_user, cosmetic_id: a.p_cosmetic_id, source: "prestige" });
    const result = { credits: balance, cosmeticId: a.p_cosmetic_id, price: Number(a.p_price) };
    this.putOp(a.p_ref, a.p_user, "buy_cosmetic", result);
    return result;
  }

  /** Alta como el trigger `handle_new_user` (0011): 6.000, 3 Iniciales + 1 Estándar, asiento `starter_grant`. */
  seedUser(id: string, credits = 6000): void {
    this.insertRow("profiles", { id, credits, xp: 0, points: 0, packs_opened: 0, region: null, level: 1, equipped: {} });
    this.insertRow("user_game", { user_id: id, pity: { version: 1, counters: {} }, packs_opened: 0 });
    this.insertRow("user_packs", { user_id: id, pack_id: "inicial", qty: 3 });
    this.insertRow("user_packs", { user_id: id, pack_id: "estandar", qty: 1 });
    this.insertRow("credit_transactions", { id: randomUUID(), user_id: id, delta: credits, reason: "starter_grant", ref: `starter:${id}`, balance_after: credits, kind: "credit", created_at: this.now() });
  }
}

type Filter = (r: Row) => boolean;

class MemQuery implements PromiseLike<unknown> {
  private filters: Filter[] = [];
  private head = false;
  private single: "maybe" | "one" | null = null;
  private max: number | null = null;
  private from_: number | null = null;
  private to_: number | null = null;
  private orderBy: { col: string; asc: boolean }[] = [];
  private exact = false;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private upsertConflict: string[] | null = null;
  private returning = false;

  constructor(private db: MemSupabase, private name: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") { this.returning = true; return this; }
    if (opts?.head) this.head = true;
    if (opts?.count === "exact") this.exact = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = rows; this.upsertConflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : UNIQUE[this.name] ?? null; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  /** SANEAMIENTO POST F47 · columnas por las que se ha filtrado (para validar contra `db.columns`). */
  private cols: string[] = [];
  private col(c: string) { this.cols.push(c); }
  eq(c: string, v: unknown) { this.col(c); this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.col(c); this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: never) { this.col(c); this.filters.push((r) => (r[c] as never) > v); return this; }
  gte(c: string, v: never) { this.col(c); this.filters.push((r) => (r[c] as never) >= v); return this; }
  lt(c: string, v: never) { this.col(c); this.filters.push((r) => (r[c] as never) < v); return this; }
  lte(c: string, v: never) { this.col(c); this.filters.push((r) => (r[c] as never) <= v); return this; }
  in(c: string, vs: unknown[]) { this.col(c); this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.col(c); this.filters.push((r) => (r[c] ?? null) === v); return this; }
  /** F58 · `not(col, "is", null)` y `not(col, "eq", v)`: lo que usan los servicios del panel. */
  not(c: string, op: string, v: unknown) { this.col(c); this.filters.push((r) => (op === "is" ? (r[c] ?? null) !== v : r[c] !== v)); return this; }
  like() { return this; }
  ilike() { return this; }
  or() { return this; }
  /** Como PostgREST: varios `order()` encadenados ordenan por todas las columnas, en ese orden. */
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  limit(n: number) { this.max = n; return this; }
  maybeSingle() { this.single = "maybe"; return this; }
  single_() { this.single = "one"; return this; }

  then<A = unknown, B = never>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }

  private matches(): Row[] { return this.db.table(this.name).filter((r) => this.filters.every((f) => f(r))); }

  private run(): { data: unknown; count?: number | null; error: Err } {
    if (this.db.failTables.has(this.name)) return { data: null, count: null, error: { code: "42P01", message: `relation ${this.name} unavailable (mem)` } };
    // SANEAMIENTO POST F47 · columna inexistente → 42703. Con `head: true` PostgREST responde a un HEAD,
    // que va SIN cuerpo: por eso en producción el `message` llegaba VACÍO. Se reproduce igual.
    const known = this.db.columns[this.name];
    const bad = known ? this.cols.find((c) => !known.has(c)) : undefined;
    if (bad) return { data: null, count: null, error: { code: "42703", message: this.head ? "" : `column ${this.name}.${bad} does not exist` } };
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const out: Row[] = [];
      for (const r0 of rows) {
        // F73 · como Postgres: `duel_matches.id` tiene `default gen_random_uuid()`. Sin esto todas las partidas PvE del
        // doble compartían `id` indefinido (y cualquier clave derivada del id colisionaba).
        const r = this.name === "duel_matches" && (r0.id === undefined || r0.id === null) ? { ...r0, id: randomUUID() } : r0;
        const e = this.db.insertRow(this.name, r); if (e) return { data: null, error: e }; out.push(r);
      }
      // F63 · como PostgREST: `insert(...).select().maybeSingle()` devuelve LA fila, no una lista.
      if (this.returning && this.single) return { data: out[0] ?? null, error: null };
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const r of rows) {
        const key = this.upsertConflict;
        const hit = key ? this.db.table(this.name).find((x) => key.every((c) => x[c] === r[c])) : undefined;
        if (hit) { Object.assign(hit, r); this.db.logWrite(`upsert:${this.name}`); } else { const e = this.db.insertRow(this.name, r); if (e) return { data: null, error: e }; }
      }
      return { data: this.returning ? rows : null, error: null };
    }
    if (this.op === "update") {
      const hits = this.matches();
      for (const h of hits) Object.assign(h, this.payload);
      if (hits.length) this.db.logWrite(`update:${this.name}`);
      // F66 · como PostgREST: `update(...).select().maybeSingle()` devuelve LA fila o null (no una lista, que sería
      // «verdadera» aunque esté vacía y haría pasar por éxito un UPDATE condicionado que no tocó nada).
      if (this.returning && this.single) return { data: hits[0] ? { ...hits[0] } : null, error: null };
      return { data: this.returning ? hits.map((h) => ({ ...h })) : null, error: null };
    }
    if (this.op === "delete") {
      const hits = new Set(this.matches());
      this.db.tables[this.name] = this.db.table(this.name).filter((r) => !hits.has(r));
      if (hits.size) this.db.logWrite(`delete:${this.name}`);
      return { data: null, error: null };
    }
    let rows = this.matches();
    if (this.head) return { data: null, count: rows.length, error: null };
    const matched = rows.length;
    if (this.orderBy.length) {
      const by = this.orderBy;
      rows = [...rows].sort((a, b) => { for (const { col, asc } of by) { const d = (a[col] as never) < (b[col] as never) ? -1 : (a[col] as never) > (b[col] as never) ? 1 : 0; if (d) return asc ? d : -d; } return 0; });
    }
    if (this.from_ !== null && this.to_ !== null) rows = rows.slice(this.from_, this.to_ + 1);
    if (this.max !== null) rows = rows.slice(0, this.max);
    // COLECCIONES ILIMITADAS · como PostgREST: ninguna respuesta trae más de `max_rows` filas, y no avisa.
    if (rows.length > this.db.maxRows) rows = rows.slice(0, this.db.maxRows);
    const copy = rows.map((r) => structuredClone(r));
    if (this.single) {
      if (copy.length > 1 && this.single === "one") return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      return { data: copy[0] ?? null, error: null };
    }
    return { data: copy, count: this.exact ? matched : copy.length, error: null };
  }
}
