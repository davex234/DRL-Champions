/**
 * F60 · DOBLE DE PRUEBA DEL CMS — `MemSupabase` + las RPC de 0057 reproducidas con su contrato (admin, lista blanca,
 * versión, transiciones, referencias, auditoría en la misma transacción, latido por entidad) + un Storage en memoria.
 *
 * NO sustituye a la BD: el esquema real se prueba con el ensayo en transacción contra el VPS (smoke de 0057). Esto fija
 * el CONTRATO que el servidor espera de esas RPC, para que las rutas y servicios se prueben sin red.
 */
import { randomUUID } from "node:crypto";
import { MemSupabase, type Row } from "@/server/services/testing/memSupabase";
import { VALORANT_ROSTER } from "@/domain/tactics/valorantRoster";
import { CARDS } from "@/data/catalog";

const ADMIN_KEYS_AGENT = ["name", "role", "code", "abilities", "face_asset_id", "full_asset_id"];
const ADMIN_KEYS_PACK = ["name", "description", "template_pack_id", "price", "card_count", "art_asset_id", "accent", "available_from", "available_to", "sim_summary"];
const ADMIN_KEYS_PLAYER = ["nick", "full_name", "team", "team_tag", "region", "role", "country", "stats", "status", "photo_asset_id"];

export class CmsMemSupabase extends MemSupabase {
  /** Storage en memoria: ruta → bytes. `failUploadsAfter` simula un fallo a mitad de una subida. */
  objects = new Map<string, Uint8Array>();
  failUploadsAfter: number | null = null;
  private uploads = 0;

  constructor() {
    super();
    this.failTables.delete("content_cards");
  }

  get storage() {
    const self = this;
    return {
      from(bucket: string) {
        return {
          async upload(path: string, bytes: Uint8Array | ArrayBuffer, opts?: { upsert?: boolean }) {
            self.uploads++;
            if (self.failUploadsAfter !== null && self.uploads > self.failUploadsAfter) return { data: null, error: { message: "fallo simulado" } };
            const key = `${bucket}/${path}`;
            if (self.objects.has(key) && !opts?.upsert) return { data: null, error: { message: "The resource already exists" } };
            self.objects.set(key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
            return { data: { path }, error: null };
          },
          async remove(paths: string[]) { for (const p of paths) self.objects.delete(`${bucket}/${p}`); return { data: paths, error: null }; },
          getPublicUrl(path: string) { return { data: { publicUrl: `http://mem.local/storage/v1/object/public/${bucket}/${path}` } }; },
        };
      },
      async listBuckets() { return { data: [{ id: "assets" }], error: null }; },
    };
  }

  /** Estado inicial realista: 29 agentes publicados (la instantánea), versiones por entidad, cartas y jugadores semilla. */
  seedContent(opts: { cards?: number } = {}): void {
    for (const e of ["agents", "packs", "players"]) this.table("content_entity_version").push({ entity: e, version: 1 });
    this.table("content_catalog_version").push({ id: true, version: 1 });
    for (const r of VALORANT_ROSTER) {
      this.table("agents").push({ id: r.id, name: r.name, role: r.role, icon: null, code: r.code, abilities: r.abilities.map((a) => ({ slot: a.slot, name: a.name })),
        lifecycle: "PUBLISHED", face_asset_id: null, full_asset_id: null, origin: "seed", version: 1, created_at: this.now(), updated_at: this.now(), published_at: null, retired_at: null });
    }
    const cards = CARDS.slice(0, opts.cards ?? 12);
    const players = new Set<string>();
    cards.forEach((c, i) => {
      players.add(c.playerId);
      this.table("content_cards").push({ card_id: c.id, player_id: c.playerId, variant_id: c.variantId, ordinal: i, ovr: c.ovr, stats: c.stats, combat: c.combat, stat_boost: c.statBoost,
        rarity_rank: 1, rarity_bucket: "common", data_version: c.dataVersion, source: c.source, generated_at: c.generatedAt, origin: "seed-generator", lifecycle: "PUBLISHED",
        definition_version: 1, checksum: "x", presentation: null, presentation_rev: 0 });
    });
    for (const id of players) this.table("content_players").push({ id, nick: id, full_name: null, team: "", team_tag: "", region: "EMEA", role: "Duelista", country: "", stats: { dmg: 50, scr: 50, com: 50, hs: 50, ast: 50, clu: 50 }, status: "active", origin: "seed", version: 1, photo_asset_id: null, updated_at: this.now() });
  }

  // ───────────────────────── utilidades con el contrato de 0057 ─────────────────────────
  protected requireAdmin(actor: unknown): void {
    if (!actor || !this.table("profiles").some((p) => p.id === actor && p.is_admin)) throw new Error("NOT_ADMIN");
  }
  protected cmsAudit(actor: unknown, action: string, entityType: string, entityId: string, detail: Row, cardId: string | null = null): void {
    const t = this.table("content_audit_log");
    t.push({ id: t.length + 1, at: this.now(), actor, action, entity_type: entityType, entity_id: entityId, card_id: cardId, pool_id: null, detail });
    this.logWrite("insert:content_audit_log");
  }
  protected bumpEntity(entity: string): number {
    const r = this.table("content_entity_version").find((x) => x.entity === entity);
    if (r) r.version = Number(r.version) + 1;
    return Number(r?.version ?? 0);
  }
  protected bumpCatalog(): number {
    const r = this.table("content_catalog_version")[0];
    if (r) r.version = Number(r.version) + 1;
    return Number(r?.version ?? 0);
  }
  private checkKeys(patch: unknown, allowed: string[]): Row {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("BAD_FIELD");
    for (const k of Object.keys(patch as Row)) if (!allowed.includes(k)) throw new Error("BAD_FIELD");
    return patch as Row;
  }
  private assetOk(id: unknown, kind: string): boolean {
    return id == null || this.table("assets").some((a) => a.id === id && a.kind === kind && a.status === "approved");
  }
  private agentJson(a: Row): Row {
    return { id: a.id, name: a.name, role: a.role, code: a.code, abilities: a.abilities, lifecycle: a.lifecycle, faceAssetId: a.face_asset_id ?? null, fullAssetId: a.full_asset_id ?? null, version: a.version };
  }
  private packJson(p: Row): Row {
    return { id: p.id, name: p.name, description: p.description, templatePackId: p.template_pack_id, price: p.price, cardCount: p.card_count, artAssetId: p.art_asset_id ?? null,
      accent: p.accent ?? null, lifecycle: p.lifecycle, availableFrom: p.available_from ?? null, availableTo: p.available_to ?? null, version: p.version };
  }

  // ───────────────────────── Agentes ─────────────────────────
  rpc_app_admin_agent_save(a: Row): Row {
    this.requireAdmin(a.p_actor);
    const patch = this.checkKeys(a.p_patch, ADMIN_KEYS_AGENT);
    if ("role" in patch && !["duelist", "initiator", "sentinel", "controller"].includes(String(patch.role))) throw new Error("BAD_ROLE");
    if ("abilities" in patch) {
      const ab = patch.abilities as Row[];
      if (!Array.isArray(ab) || ab.length !== 4 || ab.map((x) => x.slot).join("") !== "CQEX" || ab.some((x) => Object.keys(x).length !== 2 || String(x.name ?? "").trim().length < 2 || String(x.name).trim().length > 48)) throw new Error("BAD_ABILITIES");
    }
    if ("face_asset_id" in patch && !this.assetOk(patch.face_asset_id, "agent_face")) throw new Error("BAD_ASSET");
    if ("full_asset_id" in patch && !this.assetOk(patch.full_asset_id, "agent_full")) throw new Error("BAD_ASSET");
    const t = this.table("agents");
    const old = t.find((x) => x.id === a.p_id);
    let row: Row;
    if (!old) {
      if (a.p_expected_version != null) throw new Error("CONTENT_NOT_FOUND");
      if (typeof a.p_id !== "string" || !/^[a-z0-9]{2,24}$/.test(a.p_id)) throw new Error("BAD_ID");
      row = { id: a.p_id, name: String(patch.name ?? "").trim(), role: patch.role, icon: null, code: patch.code ?? null, abilities: patch.abilities ?? [],
        face_asset_id: patch.face_asset_id ?? null, full_asset_id: patch.full_asset_id ?? null, lifecycle: "DRAFT", origin: "admin", version: 1, created_at: this.now(), updated_at: this.now(), published_at: null, retired_at: null };
      if (String(row.name).length < 2) throw new Error("check agents_name_check");
      t.push(row);
    } else {
      if (a.p_expected_version == null || old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
      const before = { ...old };
      for (const k of Object.keys(patch)) old[k] = k === "name" ? String(patch.name).trim() : patch[k];
      old.version = Number(old.version) + 1; old.updated_at = this.now();
      row = old;
      this.cmsAudit(a.p_actor, "agent_update", "agent", String(a.p_id), { reason: a.p_reason, before: this.agentJson(before), after: this.agentJson(row) });
      this.bumpEntity("agents");
      return this.agentJson(row);
    }
    this.cmsAudit(a.p_actor, "agent_create", "agent", String(a.p_id), { reason: a.p_reason, before: null, after: this.agentJson(row) });
    this.bumpEntity("agents");
    return this.agentJson(row);
  }

  rpc_app_admin_agent_lifecycle(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const old = this.table("agents").find((x) => x.id === a.p_id);
    if (!old) throw new Error("CONTENT_NOT_FOUND");
    if (a.p_expected_version == null || old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    const ok = (old.lifecycle === "DRAFT" && a.p_to === "PUBLISHED") || (old.lifecycle === "PUBLISHED" && a.p_to === "RETIRED") || (old.lifecycle === "RETIRED" && a.p_to === "PUBLISHED");
    if (!ok) throw new Error("BAD_TRANSITION");
    if (a.p_to === "PUBLISHED" && old.origin === "admin" && (!old.face_asset_id || !old.full_asset_id)) throw new Error("CONTENT_INCOMPLETE");
    if (a.p_to === "PUBLISHED" && (!old.code || (old.abilities as unknown[]).length !== 4)) throw new Error("CONTENT_INCOMPLETE");
    const before = { ...old };
    old.lifecycle = a.p_to; old.version = Number(old.version) + 1; old.updated_at = this.now();
    this.cmsAudit(a.p_actor, `agent_${String(a.p_to).toLowerCase()}`, "agent", String(a.p_id), { reason: a.p_reason, before: this.agentJson(before), after: this.agentJson(old) });
    this.bumpEntity("agents");
    return this.agentJson(old);
  }

  rpc_app_admin_agent_references(a: Row): Row {
    const id = String(a.p_id);
    return {
      mapPlayerStats: this.table("map_player_stats").filter((r) => r.agent_id === id).length,
      playerStats: this.table("player_stats").filter((r) => r.agent_id === id).length,
      compositions: this.table("user_compositions").filter((r) => ((r.agent_ids as string[]) ?? []).includes(id)).length,
      strats: this.table("user_strats").filter((r) => JSON.stringify(r.plan ?? {}).includes(`"agentId":"${id}"`)).length,
    };
  }

  rpc_app_admin_agent_delete_draft(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const t = this.table("agents");
    const old = t.find((x) => x.id === a.p_id);
    if (!old) throw new Error("CONTENT_NOT_FOUND");
    if (old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    if (old.lifecycle !== "DRAFT") throw new Error("NOT_A_DRAFT");
    const refs = this.rpc_app_admin_agent_references(a);
    if (Object.values(refs).reduce((s: number, n) => s + Number(n), 0) > 0) throw new Error("HAS_REFERENCES");
    t.splice(t.indexOf(old), 1);
    this.cmsAudit(a.p_actor, "agent_delete_draft", "agent", String(a.p_id), { reason: a.p_reason, before: this.agentJson(old), after: null, references: refs });
    this.bumpEntity("agents");
    return { deleted: a.p_id };
  }

  // ───────────────────────── Sobres ─────────────────────────
  rpc_app_admin_pack_save(a: Row): Row {
    this.requireAdmin(a.p_actor);
    const patch = this.checkKeys(a.p_patch, ADMIN_KEYS_PACK);
    if (patch.art_asset_id != null && !this.assetOk(patch.art_asset_id, "pack_art")) throw new Error("BAD_ASSET");
    const t = this.table("content_packs");
    const old = t.find((x) => x.id === a.p_id);
    if (!old) {
      if (a.p_expected_version != null) throw new Error("CONTENT_NOT_FOUND");
      if (typeof a.p_id !== "string" || !/^cms-[a-z0-9]+(-[a-z0-9]+)*$/.test(a.p_id)) throw new Error("check content_packs_id");
      const row: Row = { id: a.p_id, name: String(patch.name ?? "").trim(), description: patch.description ?? "", template_pack_id: patch.template_pack_id, price: patch.price, card_count: patch.card_count,
        art_asset_id: patch.art_asset_id ?? null, accent: patch.accent ?? null, lifecycle: "DRAFT", available_from: patch.available_from ?? null, available_to: patch.available_to ?? null,
        sim_summary: null, version: 1, created_at: this.now(), updated_at: this.now(), published_at: null, retired_at: null };
      t.push(row);
      this.cmsAudit(a.p_actor, "pack_create", "pack", String(a.p_id), { reason: a.p_reason, before: null, after: this.packJson(row) });
      this.bumpEntity("packs");
      return this.packJson(row);
    }
    if (a.p_expected_version == null || old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    if (old.lifecycle !== "DRAFT" && ((("template_pack_id" in patch) && patch.template_pack_id !== old.template_pack_id) || (("price" in patch) && patch.price !== old.price) || (("card_count" in patch) && patch.card_count !== old.card_count))) throw new Error("ECONOMY_FROZEN");
    const before = { ...old };
    for (const k of Object.keys(patch)) old[k] = patch[k];
    old.version = Number(old.version) + 1; old.updated_at = this.now();
    this.cmsAudit(a.p_actor, "pack_update", "pack", String(a.p_id), { reason: a.p_reason, before: this.packJson(before), after: this.packJson(old) });
    this.bumpEntity("packs");
    return this.packJson(old);
  }

  private hasUsablePool(pack: string): boolean {
    return this.table("content_pack_pools").some((b) => b.pack_id === pack && b.enabled && this.table("content_pools").some((p) => p.id === b.pool_id && p.lifecycle === "ACTIVE"
      && (p.mode === "RULE" || this.table("content_pool_entries").some((e) => e.pool_id === p.id && e.mode === "INCLUDE"))));
  }

  rpc_app_admin_pack_lifecycle(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const old = this.table("content_packs").find((x) => x.id === a.p_id);
    if (!old) throw new Error("CONTENT_NOT_FOUND");
    if (a.p_expected_version == null || old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    const ok = (old.lifecycle === "DRAFT" && a.p_to === "ACTIVE") || (old.lifecycle === "ACTIVE" && a.p_to === "RETIRED") || (old.lifecycle === "RETIRED" && a.p_to === "ACTIVE");
    if (!ok) throw new Error("BAD_TRANSITION");
    if (a.p_to === "ACTIVE" && (!old.art_asset_id || !old.sim_summary || !this.hasUsablePool(String(a.p_id)))) throw new Error("CONTENT_INCOMPLETE");
    const before = { ...old };
    old.lifecycle = a.p_to; old.version = Number(old.version) + 1; old.updated_at = this.now();
    this.cmsAudit(a.p_actor, `pack_${String(a.p_to).toLowerCase()}`, "pack", String(a.p_id), { reason: a.p_reason, before: this.packJson(before), after: this.packJson(old) });
    this.bumpEntity("packs");
    return this.packJson(old);
  }

  rpc_app_admin_pack_references(a: Row): Row {
    const id = String(a.p_id);
    return {
      inventories: this.table("user_packs").filter((r) => r.pack_id === id && Number(r.qty) > 0).length,
      inventoryUnits: this.table("user_packs").filter((r) => r.pack_id === id).reduce((s, r) => s + Number(r.qty), 0),
      purchases: this.table("credit_transactions").filter((r) => r.reason === `buy_pack:${id}`).length,
      opens: this.table("economy_ops").filter((r) => r.kind === "open_pack" && (r.result as Row | null)?.packId === id).length,
      poolBindings: this.table("content_pack_pools").filter((r) => r.pack_id === id).length,
    };
  }

  rpc_app_admin_pack_delete_draft(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const t = this.table("content_packs");
    const old = t.find((x) => x.id === a.p_id);
    if (!old) throw new Error("CONTENT_NOT_FOUND");
    if (old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    if (old.lifecycle !== "DRAFT") throw new Error("NOT_A_DRAFT");
    const refs = this.rpc_app_admin_pack_references(a);
    if (Number(refs.inventories) + Number(refs.purchases) + Number(refs.opens) > 0) throw new Error("HAS_REFERENCES");
    const pool = `pack-${a.p_id}`;
    this.tables.content_pack_pools = this.table("content_pack_pools").filter((b) => b.pack_id !== a.p_id);
    let poolDeleted = false;
    if (this.table("content_pools").some((p) => p.id === pool && p.lifecycle === "DRAFT") && !this.table("content_pack_pools").some((b) => b.pool_id === pool)) {
      this.tables.content_pool_entries = this.table("content_pool_entries").filter((e) => e.pool_id !== pool);
      this.tables.content_pools = this.table("content_pools").filter((p) => p.id !== pool);
      poolDeleted = true;
    }
    t.splice(t.indexOf(old), 1);
    this.cmsAudit(a.p_actor, "pack_delete_draft", "pack", String(a.p_id), { reason: a.p_reason, before: this.packJson(old), after: null, references: refs, poolDeleted });
    this.bumpEntity("packs");
    return { deleted: a.p_id, poolDeleted };
  }

  // ───────────────────────── Pools (contrato 0039/0042, sin comprobar admin: lo hace la ruta) ─────────────────────────
  rpc_app_content_pool_upsert(a: Row): Row {
    const p = a.p_pool as Row;
    const t = this.table("content_pools");
    const old = t.find((x) => x.id === p.id);
    if (!old) t.push({ id: p.id, name: p.name ?? p.id, mode: p.mode ?? "RULE", rules: p.rules ?? {}, lifecycle: "DRAFT", revision: 1 });
    else { if (a.p_expected_revision != null && a.p_expected_revision !== old.revision) throw new Error("El pool ha cambiado mientras lo editabas"); old.revision = Number(old.revision) + 1; }
    return { poolId: p.id };
  }
  rpc_app_content_pack_bind(a: Row): Row {
    const t = this.table("content_pack_pools");
    if (a.p_action === "bind" && !t.some((b) => b.pack_id === a.p_pack_id && b.pool_id === a.p_pool_id)) t.push({ pack_id: a.p_pack_id, pool_id: a.p_pool_id, priority: a.p_priority ?? 100, enabled: true });
    if (a.p_action === "unbind") this.tables.content_pack_pools = t.filter((b) => !(b.pack_id === a.p_pack_id && b.pool_id === a.p_pool_id));
    return { ok: true };
  }
  rpc_app_content_pool_set_entries(a: Row): Row {
    const pool = this.table("content_pools").find((x) => x.id === a.p_pool_id);
    if (!pool) throw new Error("Pool no encontrado");
    if (a.p_expected_revision != null && a.p_expected_revision !== pool.revision) throw new Error("El pool ha cambiado mientras lo editabas");
    for (const e of a.p_entries as Row[]) {
      const card = this.table("content_cards").find((c) => c.card_id === e.card_id);
      if (!card) throw new Error(`Carta inexistente: ${e.card_id}`);
      if (pool.lifecycle === "ACTIVE" && (e.mode ?? "INCLUDE") === "INCLUDE" && card.lifecycle !== "PUBLISHED") throw new Error("solo entran cartas PUBLISHED");
    }
    this.tables.content_pool_entries = [...this.table("content_pool_entries").filter((e) => e.pool_id !== a.p_pool_id),
      ...(a.p_entries as Row[]).map((e) => ({ pool_id: a.p_pool_id, card_id: e.card_id, weight: e.weight ?? 1, mode: e.mode ?? "INCLUDE" }))];
    pool.revision = Number(pool.revision) + 1;
    return { poolId: a.p_pool_id };
  }
  rpc_app_content_pool_publish(a: Row): Row {
    const pool = this.table("content_pools").find((x) => x.id === a.p_pool_id);
    if (!pool) throw new Error("Pool no encontrado");
    if (a.p_expected_revision != null && a.p_expected_revision !== pool.revision) throw new Error("El pool ha cambiado mientras lo editabas");
    pool.lifecycle = a.p_state; pool.revision = Number(pool.revision) + 1;
    return { poolId: a.p_pool_id };
  }

  // ───────────────────────── Cartas ─────────────────────────
  private presentationOk(p: Row): void {
    const keys = Object.keys(p);
    if (keys.some((k) => !["role", "printed", "team", "imageAssetId", "imagePath"].includes(k))) throw new Error("BAD_FIELD");
    if (!["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"].includes(String(p.role))) throw new Error("BAD_ROLE");
    const pr = p.printed as { ovr?: number; stats?: Record<string, number> } | undefined;
    if (!pr || !(Number(pr.ovr) >= 40 && Number(pr.ovr) <= 99)) throw new Error("BAD_STATS");
    for (const k of ["dmg", "scr", "fks", "hs", "ast", "clu"]) if (!(Number(pr.stats?.[k]) >= 1 && Number(pr.stats?.[k]) <= 99)) throw new Error("BAD_STATS");
    const team = String(p.team ?? "");
    if (team.length < 2 || team.length > 12) throw new Error("BAD_TEAM");
    if (p.imageAssetId != null && !this.table("assets").some((x) => x.id === p.imageAssetId && x.kind === "card_artwork" && x.status === "approved" && x.storage_path === (p.imagePath ?? null))) throw new Error("BAD_ASSET");
    if (p.imageAssetId == null && "imagePath" in p) throw new Error("BAD_ASSET");
  }
  rpc_app_admin_card_set_presentation(a: Row): Row {
    this.requireAdmin(a.p_actor);
    this.presentationOk(a.p_presentation as Row);
    const c = this.table("content_cards").find((x) => x.card_id === a.p_card_id);
    if (!c) throw new Error("CONTENT_NOT_FOUND");
    if (Number(c.presentation_rev ?? 0) !== (a.p_expected_rev ?? -1)) throw new Error("STALE_CONTENT");
    if (!["DRAFT", "REVIEW"].includes(String(c.lifecycle))) throw new Error("NOT_A_DRAFT");
    const before = c.presentation ?? null;
    c.presentation = a.p_presentation; c.presentation_rev = Number(c.presentation_rev ?? 0) + 1;
    this.cmsAudit(a.p_actor, "card_presentation", "card", String(a.p_card_id), { reason: a.p_reason, before, after: a.p_presentation }, String(a.p_card_id));
    return { cardId: a.p_card_id, presentationRev: c.presentation_rev, catalogVersion: this.bumpCatalog() };
  }
  rpc_app_content_create_card(a: Row): Row {
    const d = a.p_def as Row;
    const id = `${d.player_id}__${d.variant_id}`;
    if (!this.table("content_players").some((p) => p.id === d.player_id)) throw new Error(`Jugador inexistente: ${d.player_id}`);
    if (this.table("content_cards").some((c) => c.card_id === id)) throw new Error(`Esa carta ya existe: ${id}`);
    const ord = Math.max(-1, ...this.table("content_cards").map((c) => Number(c.ordinal))) + 1;
    this.table("content_cards").push({ ...d, card_id: id, ordinal: ord, origin: "admin", lifecycle: "DRAFT", definition_version: 1, presentation: null, presentation_rev: 0 });
    this.table("content_card_versions").push({ ...d, card_id: id, version: 1 });
    return { cardId: id, lifecycle: "DRAFT", version: 1, catalogVersion: this.bumpCatalog() };
  }
  rpc_app_admin_card_create_draft(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const r = this.rpc_app_content_create_card(a);
    this.rpc_app_admin_card_set_presentation({ p_actor: a.p_actor, p_card_id: r.cardId, p_presentation: a.p_presentation, p_expected_rev: 0, p_reason: a.p_reason });
    return { ...r, presentationRev: 1 };
  }
  rpc_app_content_set_lifecycle(a: Row): Row {
    const c = this.table("content_cards").find((x) => x.card_id === a.p_card_id);
    if (!c) throw new Error("Carta inexistente");
    const allowed: Record<string, string[]> = { DRAFT: ["REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["RETIRED"], RETIRED: ["PUBLISHED", "ARCHIVED"], REVIEW: ["APPROVED", "REJECTED", "DRAFT"], APPROVED: ["PUBLISHED", "DRAFT"] };
    if (!(allowed[String(c.lifecycle)] ?? []).includes(String(a.p_state))) throw new Error("Transicion ilegal");
    // Trigger de 0057: una carta del panel no se publica sin su presentación completa.
    const p = c.presentation as Row | null;
    if (a.p_state === "PUBLISHED" && c.lifecycle !== "PUBLISHED" && c.origin === "admin" && (!p || !p.imageAssetId || !p.imagePath || !p.printed)) throw new Error("CONTENT_INCOMPLETE");
    c.lifecycle = a.p_state;
    return { cardId: a.p_card_id, to: a.p_state, catalogVersion: this.bumpCatalog() };
  }
  rpc_app_admin_card_references(a: Row): Row {
    const id = String(a.p_id);
    const uids = new Set(this.table("user_cards").filter((u) => u.card_id === id).map((u) => u.uid));
    return {
      copies: uids.size, owners: new Set(this.table("user_cards").filter((u) => u.card_id === id).map((u) => u.user_id)).size,
      decks: this.table("duel_decks").filter((d) => ((d.card_uids as string[]) ?? []).some((u) => uids.has(u))).length,
      pools: new Set(this.table("content_pool_entries").filter((e) => e.card_id === id).map((e) => e.pool_id)).size,
      favorites: this.table("user_card_favorites").filter((f) => f.card_id === id).length,
      listings: this.table("market_listings").filter((l) => l.card_id === id).length,
      versions: this.table("content_card_versions").filter((v) => v.card_id === id).length,
    };
  }
  rpc_app_admin_card_delete_draft(a: Row): Row {
    this.requireAdmin(a.p_actor);
    if (typeof a.p_reason !== "string" || a.p_reason.trim().length < 4) throw new Error("REASON_REQUIRED");
    const c = this.table("content_cards").find((x) => x.card_id === a.p_card_id);
    if (!c) throw new Error("CONTENT_NOT_FOUND");
    if (Number(c.presentation_rev ?? 0) !== (a.p_expected_rev ?? -1)) throw new Error("STALE_CONTENT");
    if (!["DRAFT", "REVIEW", "REJECTED"].includes(String(c.lifecycle)) || c.origin !== "admin") throw new Error("NOT_A_DRAFT");
    const refs = this.rpc_app_admin_card_references({ p_id: a.p_card_id });
    if (Number(refs.copies) + Number(refs.pools) + Number(refs.favorites) + Number(refs.listings) > 0 || this.table("card_mints").some((m) => m.card_id === a.p_card_id)) throw new Error("HAS_REFERENCES");
    this.cmsAudit(a.p_actor, "card_delete_draft", "card", String(a.p_card_id), { reason: a.p_reason, references: refs, after: null, before: { presentation: c.presentation } }, String(a.p_card_id));
    this.tables.content_card_versions = this.table("content_card_versions").filter((v) => v.card_id !== a.p_card_id);
    this.tables.content_cards = this.table("content_cards").filter((x) => x.card_id !== a.p_card_id);
    this.bumpCatalog();
    return { deleted: a.p_card_id };
  }

  // ───────────────────────── Jugadores ─────────────────────────
  rpc_app_admin_player_save(a: Row): Row {
    this.requireAdmin(a.p_actor);
    const patch = this.checkKeys(a.p_patch, ADMIN_KEYS_PLAYER);
    if ("stats" in patch) for (const k of ["dmg", "scr", "com", "hs", "ast", "clu"]) if (!(Number((patch.stats as Row)?.[k]) >= 1 && Number((patch.stats as Row)?.[k]) <= 99)) throw new Error("BAD_STATS");
    const t = this.table("content_players");
    const old = t.find((x) => x.id === a.p_id);
    if (!old) {
      if (a.p_expected_version != null) throw new Error("CONTENT_NOT_FOUND");
      if (typeof a.p_id !== "string" || !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(a.p_id)) throw new Error("BAD_ID");
      const row: Row = { id: a.p_id, nick: patch.nick, full_name: patch.full_name ?? null, team: patch.team ?? "", team_tag: patch.team_tag ?? "", region: patch.region, role: patch.role, country: patch.country ?? "",
        stats: patch.stats, status: patch.status ?? "active", origin: "admin", version: 1, photo_asset_id: patch.photo_asset_id ?? null, updated_at: this.now() };
      t.push(row);
      this.cmsAudit(a.p_actor, "player_create", "player", String(a.p_id), { reason: a.p_reason, before: null, after: row });
      this.bumpEntity("players"); this.bumpCatalog();
      return row;
    }
    if (a.p_expected_version == null || old.version !== a.p_expected_version) throw new Error("STALE_CONTENT");
    const before = { ...old };
    for (const k of Object.keys(patch)) old[k] = patch[k];
    old.version = Number(old.version) + 1; old.updated_at = this.now();
    this.cmsAudit(a.p_actor, "player_update", "player", String(a.p_id), { reason: a.p_reason, before, after: { ...old } });
    this.bumpEntity("players"); this.bumpCatalog();
    return old;
  }
}

/** Crea un asset aprobado directamente (para pruebas que no pasan por la subida). */
export function seedAsset(db: CmsMemSupabase, kind: string, path = `cms/${kind}/${randomUUID()}/original.png`): string {
  const id = randomUUID();
  db.table("assets").push({ id, group_id: id, version: 1, is_current: true, name: `${kind}.png`, kind, subject_type: "none", subject_id: null, width: 800, height: 1100,
    format: "png", bytes: 1000, checksum: randomUUID().replace(/-/g, ""), status: "approved", storage_path: path, url: null, meta: { derived: {} }, created_by: null, created_at: db.now() });
  db.objects.set(`assets/${path}`, new Uint8Array([1]));
  return id;
}
