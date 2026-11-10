/**
 * F82 · COLLECTION SETS — ADMIN (dentro del panel existente; mismas reglas: `runAdmin`, cuerpo cerrado, auditoría).
 *
 *   generate      crea BORRADORES desde la BD/catálogo real (equipos o ediciones). Nunca publica. Una familia que ya
 *                 tiene filas no se toca (para cambiar un set publicado: `newVersion`).
 *   update        edita un BORRADOR: título, insignia, quitar requisito, añadir jugador (TEAM) o carta (EDITION).
 *   preview       validación completa + cartas elegibles + jugadores + logo + cuántos usuarios ya lo cumplirían.
 *   publish       valida (dominio) → checksum sha256 → DRAFT→PUBLISHED. La BD congela el resto (disparador de 0062).
 *   retire        PUBLISHED→RETIRED. Lo completado sigue completado; deja de ser un objetivo.
 *   newVersion    borrador v+1 de una familia, regenerado desde el catálogo actual (cambio de plantilla/catálogo).
 *   deleteDraft   borra un borrador (lo publicado no se borra nunca).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import { serverCatalog } from "@/server/catalog";
import { pageAll } from "@/server/db/pageAll";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { generateEditionDrafts, generateTeamDrafts, isSkip, liveContext, type DraftProposal, type DraftResult } from "@/domain/collectionSets/generator";
import { validateForPublish, type PublishIssue } from "@/domain/collectionSets/validate";
import { canonicalPayload } from "@/domain/collectionSets/progress";
import { BADGE_ID_PATTERN, SET_ID_PATTERN, type CollectionSetDef, type SetRequirement } from "@/domain/collectionSets/types";
import { fromRow, SET_COLUMNS } from "@/server/services/collectionSets";

type Body = Record<string, unknown>;
const ENTITY = "collection_set";

async function loadSet(sb: SupabaseClient, id: unknown): Promise<CollectionSetDef | null> {
  if (typeof id !== "string" || !SET_ID_PATTERN.test(id)) return null;
  const { data, error } = await sb.from("collection_sets").select(SET_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as never) : null;
}

async function allSets(sb: SupabaseClient): Promise<CollectionSetDef[]> {
  const { data, error } = await sb.from("collection_sets").select(SET_COLUMNS).order("family").order("version");
  if (error) throw new Error(error.message);
  return ((data ?? []) as never[]).map(fromRow);
}

function dbError(message: string | undefined): AdminResult<never> {
  const m = message ?? "";
  if (m.includes("COLLECTION_SET_IMMUTABLE")) return fail(409, "Un set publicado o retirado no se puede modificar: crea una versión nueva");
  if (m.includes("COLLECTION_SET_TRANSITION")) return fail(409, "Ese cambio de estado no está permitido");
  if (m.includes("collection_sets_one_published_per_family")) return fail(409, "Ya hay una versión publicada de esta familia: retírala antes de publicar otra");
  if (m.includes("collection_sets_family_version") || m.includes("collection_sets_pkey")) return fail(409, "Ya existe un set con ese id o versión");
  if (/does not exist|PGRST205|schema cache/i.test(m)) return fail(503, "0062 no está aplicada: Collection Sets no disponible");
  throw new Error(m || "error de base de datos");
}

const expected = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null);

/** Actualización con concurrencia optimista sobre `row_version`. */
async function guardedUpdate(sb: SupabaseClient, id: string, rowVersion: number, patch: Record<string, unknown>): Promise<AdminResult<CollectionSetDef>> {
  const { data, error } = await sb.from("collection_sets").update(patch).eq("id", id).eq("row_version", rowVersion).select(SET_COLUMNS);
  if (error) return dbError(error.message);
  const rows = (data ?? []) as never[];
  if (!rows.length) return fail(409, "Otro administrador cambió este set. Recarga y revisa antes de seguir.");
  return ok(fromRow(rows[0]));
}

// ───────────────────────────── Lectura ─────────────────────────────

export interface AdminSetRow extends CollectionSetDef { completions: number }
export interface AdminSetsView {
  sets: AdminSetRow[];
  proposals: { result: DraftResult; exists: boolean }[];
}

export async function adminListSets(sb: SupabaseClient): Promise<AdminResult<AdminSetsView>> {
  await serverCatalog(sb);
  let sets: CollectionSetDef[];
  try { sets = await allSets(sb); } catch (e) { return dbError(e instanceof Error ? e.message : undefined); }
  const counts = new Map<string, number>();
  const rows = await pageAll<{ set_id: string; user_id: string }>((a, b) =>
    sb.from("user_collection_completions").select("set_id, user_id").order("set_id").order("user_id").range(a, b));
  for (const r of rows ?? []) counts.set(r.set_id, (counts.get(r.set_id) ?? 0) + 1);
  const families = new Set(sets.map((s) => s.family));
  const ctx = liveContext();
  const proposals = [...generateTeamDrafts(ctx), ...generateEditionDrafts(ctx)].map((result) => ({
    result, exists: !isSkip(result) && families.has(result.family),
  }));
  return ok({ sets: sets.map((s) => ({ ...s, completions: counts.get(s.id) ?? 0 })), proposals });
}

export interface PreviewView {
  set: CollectionSetDef;
  issues: PublishIssue[];
  players: number;
  requirements: (SetRequirement & { cards: { id: string; ovr: number; variantId: string; team: string; obtainable: boolean }[] })[];
  /** Usuarios que HOY ya cumplen todos los requisitos (lectura acotada a las cartas del set). */
  estimatedCompleters: number | null;
}

export async function adminPreview(sb: SupabaseClient, b: Body): Promise<AdminResult<PreviewView>> {
  await serverCatalog(sb);
  const set = await loadSet(sb, b.id);
  if (!set) return fail(404, "Set no encontrado");
  const ctx = liveContext();
  const byId = new Map(ctx.cards.map((c) => [c.id, c]));
  const issues = validateForPublish({ ...set, status: "DRAFT" }, ctx).filter((i) => i.code !== "NOT_DRAFT" || set.status === "DRAFT");
  const requirements = set.requirements.map((r) => ({
    ...r,
    cards: r.cardIds.map((id) => {
      const c = byId.get(id);
      return { id, ovr: c?.ovr ?? 0, variantId: c?.variantId ?? "?", team: c ? canonicalCardTeam(c, ctx.player(c.playerId)).label : "?", obtainable: c ? ctx.obtainable(c) : false };
    }),
  }));
  // Estimación barata: solo las filas de `user_cards` de las cartas de ESTE set (≤ cientos), nunca el inventario entero.
  const allIds = [...new Set(set.requirements.flatMap((r) => r.cardIds))];
  let estimatedCompleters: number | null = null;
  if (allIds.length && allIds.length <= 400) {
    const rows = await pageAll<{ user_id: string; card_id: string }>((a, z) =>
      sb.from("user_cards").select("user_id, card_id, uid").in("card_id", allIds).order("uid").range(a, z), 20);
    if (rows) {
      const per = new Map<string, Set<string>>();
      for (const r of rows) per.set(r.user_id, (per.get(r.user_id) ?? new Set()).add(r.card_id));
      estimatedCompleters = [...per.values()].filter((own) => set.requirements.every((r) => r.cardIds.some((c) => own.has(c)))).length;
    }
  }
  return ok({ set, issues, players: new Set(set.requirements.map((r) => r.playerId)).size, requirements, estimatedCompleters });
}

// ───────────────────────────── Escritura ─────────────────────────────

function toRow(p: DraftProposal, actor: string) {
  return {
    id: p.id, family: p.family, version: p.version, kind: p.kind, subject_id: p.subjectId, title: p.title, status: "DRAFT", row_version: 1,
    requirements: p.requirements, reward: p.reward, logo: p.logo, created_by: actor,
  };
}

export async function adminGenerate(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<{ created: string[]; existing: string[]; skipped: { subjectId: string; skip: string[] }[] }>> {
  if (b.kind !== "TEAM" && b.kind !== "EDITION") return fail(400, "Tipo inválido (TEAM o EDITION)");
  await serverCatalog(sb);
  const only = Array.isArray(b.subjects) ? new Set(b.subjects.filter((s): s is string => typeof s === "string")) : null;
  const results = b.kind === "TEAM" ? generateTeamDrafts() : generateEditionDrafts();
  let sets: CollectionSetDef[];
  try { sets = await allSets(sb); } catch (e) { return dbError(e instanceof Error ? e.message : undefined); }
  const families = new Set(sets.map((s) => s.family));
  const created: string[] = [], existing: string[] = [];
  const skipped = results.filter(isSkip).filter((s) => !only || only.has(s.subjectId)).map((s) => ({ subjectId: s.subjectId, skip: s.skip }));
  const fresh = results.filter((r): r is DraftProposal => !isSkip(r)).filter((r) => !only || only.has(r.subjectId));
  for (const p of fresh) {
    if (families.has(p.family)) { existing.push(p.id); continue; }
    const { error } = await sb.from("collection_sets").insert(toRow(p, actor));
    if (error) return dbError(error.message);
    created.push(p.id);
  }
  if (created.length) await writeAudit(sb, actor, "f82_set_generate", ENTITY, b.kind, { created, existing: existing.length, skipped: skipped.length });
  return ok({ created, existing, skipped });
}

export async function adminNewVersion(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<CollectionSetDef>> {
  if (typeof b.family !== "string") return fail(400, "Familia inválida");
  await serverCatalog(sb);
  const sets = (await allSets(sb)).filter((s) => s.family === b.family);
  if (!sets.length) return fail(404, "Familia no encontrada: genera primero el borrador");
  if (sets.some((s) => s.status === "DRAFT")) return fail(409, "Esta familia ya tiene un borrador abierto");
  const last = sets.reduce((a, s) => (s.version > a.version ? s : a));
  const gen = (last.kind === "TEAM" ? generateTeamDrafts() : generateEditionDrafts()).find((r) => r.subjectId === last.subjectId);
  if (!gen || isSkip(gen)) return fail(409, `El catálogo actual no permite un set válido para ${last.subjectId}${gen && isSkip(gen) ? ` (${gen.skip.join(", ")})` : ""}`);
  const version = last.version + 1;
  const id = gen.id.replace(/-v1$/, `-v${version}`);
  const { data, error } = await sb.from("collection_sets").insert(toRow({ ...gen, id, version, reward: last.reward }, actor)).select(SET_COLUMNS);
  if (error) return dbError(error.message);
  await writeAudit(sb, actor, "f82_set_new_version", ENTITY, id, { family: last.family, from: last.id, version });
  return ok(fromRow((data as never[])[0]));
}

export async function adminUpdateDraft(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<CollectionSetDef>> {
  await serverCatalog(sb);
  const set = await loadSet(sb, b.id);
  if (!set) return fail(404, "Set no encontrado");
  if (set.status !== "DRAFT") return fail(409, "Solo se edita un borrador: crea una versión nueva");
  const rv = expected(b.expectedVersion);
  if (rv === null) return fail(400, "Falta la versión del set (expectedVersion)");
  const patch = (b.patch && typeof b.patch === "object" && !Array.isArray(b.patch) ? b.patch : {}) as Body;
  const allowed = ["title", "badgeId", "removeKey", "addPlayerId", "addCardId"];
  if (Object.keys(patch).some((k) => !allowed.includes(k))) return fail(400, "Cambio no permitido");
  const out: Record<string, unknown> = {};
  let reqs = [...set.requirements];
  const ctx = liveContext();

  if (patch.title !== undefined) {
    if (typeof patch.title !== "string" || !patch.title.trim() || patch.title.length > 80) return fail(400, "Título inválido");
    out.title = patch.title.trim();
  }
  if (patch.badgeId !== undefined) {
    if (typeof patch.badgeId !== "string" || !BADGE_ID_PATTERN.test(patch.badgeId)) return fail(400, "La insignia debe ser insignia:coleccion:<slug>");
    out.reward = { badgeId: patch.badgeId };
  }
  if (patch.removeKey !== undefined) {
    if (typeof patch.removeKey !== "string" || !reqs.some((r) => r.key === patch.removeKey)) return fail(404, "Requisito no encontrado");
    reqs = reqs.filter((r) => r.key !== patch.removeKey);
  }
  if (patch.addPlayerId !== undefined) {
    if (set.kind !== "TEAM") return fail(400, "En una edición se añaden cartas, no jugadores");
    const pid = typeof patch.addPlayerId === "string" ? patch.addPlayerId : "";
    const player = ctx.player(pid);
    if (!player) return fail(404, "Jugador no encontrado");
    if (reqs.some((r) => r.playerId === pid)) return fail(409, "Ese jugador ya es un requisito");
    const cards = ctx.cards.filter((c) => c.playerId === pid && canonicalCardTeam(c, player).key === set.subjectId && ctx.obtainable(c));
    if (!cards.length) return fail(409, `Ese jugador no tiene ninguna carta obtenible impresa con ${set.title}`);
    reqs.push({ key: `player:${pid}`, type: "PLAYER_ANY_CARD", playerId: pid, label: player.nick, cardIds: cards.map((c) => c.id).sort() });
  }
  if (patch.addCardId !== undefined) {
    if (set.kind !== "EDITION") return fail(400, "En un equipo se añaden jugadores, no cartas");
    const card = ctx.cards.find((c) => c.id === patch.addCardId);
    if (!card) return fail(404, "Carta no encontrada");
    if (card.variantId !== set.subjectId) return fail(409, "Esa carta no es de esta edición");
    if (reqs.some((r) => r.key === `card:${card.id}`)) return fail(409, "Esa carta ya es un requisito");
    reqs.push({ key: `card:${card.id}`, type: "SPECIFIC_CARD", playerId: card.playerId, label: ctx.player(card.playerId)?.nick ?? card.playerId, cardIds: [card.id] });
  }
  const touched = patch.removeKey !== undefined || patch.addPlayerId !== undefined || patch.addCardId !== undefined;
  if (touched) out.requirements = reqs.sort((a, z) => a.label.localeCompare(z.label, "es") || a.key.localeCompare(z.key));
  if (!Object.keys(out).length) return fail(400, "Nada que cambiar");
  const r = await guardedUpdate(sb, set.id, rv, out);
  if (r.ok) await writeAudit(sb, actor, "f82_set_update", ENTITY, set.id, { patch: Object.keys(patch) });
  return r;
}

export async function adminPublish(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<CollectionSetDef | { issues: PublishIssue[] }>> {
  await serverCatalog(sb);
  const set = await loadSet(sb, b.id);
  if (!set) return fail(404, "Set no encontrado");
  const rv = expected(b.expectedVersion);
  if (rv === null) return fail(400, "Falta la versión del set (expectedVersion)");
  const issues = validateForPublish(set, liveContext());
  if (issues.length) return { ok: false, status: 409, error: `No se puede publicar: ${issues.slice(0, 4).map((i) => `${i.code}${i.detail ? ` (${i.detail})` : ""}`).join(" · ")}${issues.length > 4 ? ` y ${issues.length - 4} más` : ""}` };
  const checksum = createHash("sha256").update(canonicalPayload(set)).digest("hex");
  const r = await guardedUpdate(sb, set.id, rv, { status: "PUBLISHED", checksum, published_at: new Date().toISOString(), published_by: actor });
  if (r.ok) await writeAudit(sb, actor, "f82_set_publish", ENTITY, set.id, { family: set.family, version: set.version, requirements: set.requirements.length, checksum });
  return r;
}

export async function adminRetire(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<CollectionSetDef>> {
  const set = await loadSet(sb, b.id);
  if (!set) return fail(404, "Set no encontrado");
  if (set.status !== "PUBLISHED") return fail(409, "Solo se retira un set publicado");
  const rv = expected(b.expectedVersion);
  if (rv === null) return fail(400, "Falta la versión del set (expectedVersion)");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 8) return fail(400, "Explica el motivo (8 caracteres o más)");
  const r = await guardedUpdate(sb, set.id, rv, { status: "RETIRED", retired_at: new Date().toISOString() });
  if (r.ok) await writeAudit(sb, actor, "f82_set_retire", ENTITY, set.id, { reason: reason.slice(0, 300) });
  return r;
}

export async function adminDeleteDraft(sb: SupabaseClient, actor: string, b: Body): Promise<AdminResult<{ deleted: string }>> {
  const set = await loadSet(sb, b.id);
  if (!set) return fail(404, "Set no encontrado");
  if (set.status !== "DRAFT") return fail(409, "Lo publicado no se borra: retíralo");
  const rv = expected(b.expectedVersion);
  if (rv === null) return fail(400, "Falta la versión del set (expectedVersion)");
  const { data, error } = await sb.from("collection_sets").delete().eq("id", set.id).eq("row_version", rv).select("id");
  if (error) return dbError(error.message);
  if (!((data ?? []) as unknown[]).length) return fail(409, "Otro administrador cambió este set. Recarga.");
  await writeAudit(sb, actor, "f82_set_delete", ENTITY, set.id, { family: set.family });
  return ok({ deleted: set.id });
}
