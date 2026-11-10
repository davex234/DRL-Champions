/**
 * F73 · ADMIN — RECETAS DE CRAFTEO, MISIONES y PROYECTOS DE CARTA.
 *
 * Mismas garantías que el resto del panel (F58/F60): `runAdmin` verifica admin en servidor, lista blanca de campos,
 * versión optimista (`expectedVersion`: 0 = crear), auditoría append-only (`app_admin_audit`) con antes/después, y
 * validación PURA antes de escribir:
 *   · receta — tipo, sobres/clases existentes, sube de categoría, no circular, cantidad 2–100 y, para ACTIVARLA,
 *     por encima de su suelo económico seguro (`domain/crafting/floors`); clase de salida no escasa;
 *   · misión — condición conocida con sus parámetros, carta/jugador/equipo/sobre reales, objetivo 1–500, recompensa
 *     real y acotada, dependencias existentes, activas y SIN ciclos;
 *   · proyecto — carta objetivo REAL del catálogo; para activarlo, al menos una misión activa.
 * No se crea contenido: se configura contenido que ya existe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { getPack } from "@/data/packs";
import { TEAM_IDENTITIES } from "@/data/teamIdentities";
import { recipeFloor, validateRecipe } from "@/domain/crafting/floors";
import type { CraftRecipe } from "@/domain/crafting/types";
import { validateMission, validateProject, type Lookup } from "@/domain/missionEngine/validate";
import { CONDITION_TYPES, type MissionDef, type ProjectDef } from "@/domain/missionEngine/types";
import { loadF73Config, resetF73Cache, toMission, toProject, toRecipe } from "@/server/services/f73Config";

const TEAMS = new Set(TEAM_IDENTITIES.map((t) => t.canonicalId));

async function lookup(sb: SupabaseClient): Promise<Lookup> {
  await serverCatalog(sb);
  const reg = serverCatalogSync().registry;
  return { cardExists: (id) => !!reg.card(id), playerExists: (id) => !!reg.player(id), packExists: (id) => !!getPack(id), teamExists: (k) => TEAMS.has(k) };
}

const iso = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString() : typeof v === "string" && v ? new Date(v).toISOString() : null);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const nullable = (v: unknown) => (typeof v === "string" && v ? v : null);
const toMs = (v: string | null) => (v ? Date.parse(v) : null);

export async function listF73(sb: SupabaseClient): Promise<AdminResult<unknown>> {
  const cfg = await loadF73Config(sb, { fresh: true });
  if (!cfg.available) return ok({ available: false, reason: cfg.reason, recipes: [], missions: [], projects: [], conditionTypes: CONDITION_TYPES });
  return ok({
    available: true, reason: "OK", conditionTypes: CONDITION_TYPES,
    recipes: cfg.recipes.map((r) => { const f = recipeFloor(r); return { ...r, floor: f ? { ratio: f.ratio, viable: f.viable, lossCost: f.lossCost, lossValue: f.lossValue } : null, problems: validateRecipe(r, { forActivation: r.status === "ACTIVE" }) }; }),
    missions: cfg.missions, projects: cfg.projects,
  });
}

type Saved<T> = { item: T };

async function writeVersioned(
  sb: SupabaseClient, table: string, id: string, expectedVersion: number, row: Record<string, unknown>, userId: string,
): Promise<{ ok: true; before: Record<string, unknown> | null; after: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const prev = await sb.from(table).select("*").eq("id", id).maybeSingle();
  if (prev.error) return { ok: false, status: 500, error: "No se pudo leer" };
  const before = (prev.data as Record<string, unknown> | null) ?? null;
  if (expectedVersion === 0) {
    if (before) return { ok: false, status: 409, error: "Ya existe con ese id" };
    const ins = await sb.from(table).insert({ ...row, id, version: 1, created_by: userId, updated_by: userId }).select("*").maybeSingle();
    if (ins.error || !ins.data) return { ok: false, status: 409, error: "No se pudo crear" };
    return { ok: true, before: null, after: ins.data as Record<string, unknown> };
  }
  if (!before) return { ok: false, status: 404, error: "No existe" };
  if (Number(before.version) !== expectedVersion) return { ok: false, status: 409, error: "Alguien lo cambió antes: recarga (STALE_CONTENT)" };
  const upd = await sb.from(table).update({ ...row, version: expectedVersion + 1, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("version", expectedVersion).select("*").maybeSingle();
  if (upd.error || !upd.data) return { ok: false, status: 409, error: "Alguien lo cambió antes: recarga (STALE_CONTENT)" };
  return { ok: true, before, after: upd.data as Record<string, unknown> };
}

/* ───────────── RECETAS ───────────── */
export async function saveRecipe(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<AdminResult<Saved<CraftRecipe>>> {
  const cfg = await loadF73Config(sb, { fresh: true });
  if (!cfg.available) return fail(503, "Falta la migración 0059");
  const id = str(b.id); const p = (b.patch ?? {}) as Record<string, unknown>; const expected = num(b.expectedVersion, -1);
  if (expected < 0) return fail(400, "expectedVersion obligatorio");
  // F79 · las recetas `forge-…` son espejo de la configuración de la Forja: se gestionan SOLO desde ahí.
  if (id.startsWith("forge-")) return fail(409, "Las recetas forge-… se gestionan desde la pestaña Forge 2.0");
  const cur = cfg.recipes.find((r) => r.id === id);
  if (cur && expected !== 0 && p.kind !== undefined && p.kind !== cur.kind) return fail(400, "El tipo de una receta no se cambia");
  const draft: CraftRecipe = {
    id, kind: (p.kind ?? cur?.kind) as CraftRecipe["kind"], name: str(p.name ?? cur?.name),
    inputPackId: nullable(p.inputPackId !== undefined ? p.inputPackId : cur?.inputPackId), outputPackId: nullable(p.outputPackId !== undefined ? p.outputPackId : cur?.outputPackId),
    inputClass: nullable(p.inputClass !== undefined ? p.inputClass : cur?.inputClass) as CraftRecipe["inputClass"], outputClass: nullable(p.outputClass !== undefined ? p.outputClass : cur?.outputClass) as CraftRecipe["outputClass"],
    inputQty: num(p.inputQty ?? cur?.inputQty), status: (p.status ?? cur?.status ?? "DISABLED") as CraftRecipe["status"], sortOrder: num(p.sortOrder ?? cur?.sortOrder),
    availableFrom: p.availableFrom !== undefined ? toMs(iso(p.availableFrom)) : cur?.availableFrom ?? null, availableTo: p.availableTo !== undefined ? toMs(iso(p.availableTo)) : cur?.availableTo ?? null,
    version: expected,
  };
  const problems = validateRecipe(draft, { forActivation: draft.status === "ACTIVE" });
  if (problems.length) return fail(422, problems.map((x) => x.message).join(" · "));
  const w = await writeVersioned(sb, "craft_recipes", id, expected, {
    kind: draft.kind, name: draft.name, input_pack_id: draft.inputPackId, output_pack_id: draft.outputPackId, input_class: draft.inputClass, output_class: draft.outputClass,
    input_qty: draft.inputQty, status: draft.status, sort_order: draft.sortOrder, available_from: iso(draft.availableFrom), available_to: iso(draft.availableTo),
  }, userId);
  if (!w.ok) return fail(w.status, w.error);
  await writeAudit(sb, userId, expected === 0 ? "f73_recipe_create" : "f73_recipe_save", "craft_recipe", id, { before: w.before, after: w.after, reason: str(b.reason) || null });
  resetF73Cache();
  return ok({ item: toRecipe(w.after) });
}

/* ───────────── MISIONES ───────────── */
export async function saveMission(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<AdminResult<Saved<MissionDef>>> {
  const cfg = await loadF73Config(sb, { fresh: true });
  if (!cfg.available) return fail(503, "Falta la migración 0059");
  const id = str(b.id); const p = (b.patch ?? {}) as Record<string, unknown>; const expected = num(b.expectedVersion, -1);
  if (expected < 0) return fail(400, "expectedVersion obligatorio");
  const cur = cfg.missions.find((m) => m.id === id);
  const draft: MissionDef = {
    id, name: str(p.name ?? cur?.name), description: str(p.description ?? cur?.description ?? ""),
    condition: (p.condition ?? cur?.condition) as MissionDef["condition"], target: num(p.target ?? cur?.target),
    dependsOn: Array.isArray(p.dependsOn) ? (p.dependsOn as unknown[]).map(String) : cur?.dependsOn ?? [],
    reward: (p.reward ?? cur?.reward ?? {}) as MissionDef["reward"], projectId: p.projectId !== undefined ? nullable(p.projectId) : cur?.projectId ?? null,
    status: (p.status ?? cur?.status ?? "DRAFT") as MissionDef["status"], sortOrder: num(p.sortOrder ?? cur?.sortOrder),
    availableFrom: p.availableFrom !== undefined ? toMs(iso(p.availableFrom)) : cur?.availableFrom ?? null, availableTo: p.availableTo !== undefined ? toMs(iso(p.availableTo)) : cur?.availableTo ?? null,
    version: expected,
  };
  const others = cfg.missions.filter((m) => m.id !== id);
  const problems = validateMission(draft, [...others, draft], await lookup(sb), cfg.projects);
  if (draft.status === "ACTIVE") for (const d of draft.dependsOn) if (others.find((m) => m.id === d)?.status !== "ACTIVE") problems.push({ code: "INACTIVE_DEPENDENCY", message: `La dependencia ${d} no está activa` });
  if (draft.status !== "ACTIVE" && cur?.status === "ACTIVE" && others.some((m) => m.status === "ACTIVE" && m.dependsOn.includes(id))) problems.push({ code: "HAS_DEPENDENTS", message: "Otras misiones activas dependen de esta" });
  if (problems.length) return fail(422, problems.map((x) => x.message).join(" · "));
  const w = await writeVersioned(sb, "content_missions", id, expected, {
    name: draft.name, description: draft.description, condition: draft.condition, target: draft.target, depends_on: draft.dependsOn, reward: draft.reward,
    project_id: draft.projectId, status: draft.status, sort_order: draft.sortOrder, available_from: iso(draft.availableFrom), available_to: iso(draft.availableTo),
  }, userId);
  if (!w.ok) return fail(w.status, w.error);
  await writeAudit(sb, userId, expected === 0 ? "f73_mission_create" : "f73_mission_save", "mission", id, { before: w.before, after: w.after, reason: str(b.reason) || null });
  resetF73Cache();
  return ok({ item: toMission(w.after) });
}

/* ───────────── PROYECTOS ───────────── */
export async function saveProject(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<AdminResult<Saved<ProjectDef>>> {
  const cfg = await loadF73Config(sb, { fresh: true });
  if (!cfg.available) return fail(503, "Falta la migración 0059");
  const id = str(b.id); const p = (b.patch ?? {}) as Record<string, unknown>; const expected = num(b.expectedVersion, -1);
  if (expected < 0) return fail(400, "expectedVersion obligatorio");
  const cur = cfg.projects.find((x) => x.id === id);
  const draft: ProjectDef = {
    id, name: str(p.name ?? cur?.name), description: str(p.description ?? cur?.description ?? ""), targetCardId: str(p.targetCardId ?? cur?.targetCardId),
    status: (p.status ?? cur?.status ?? "DRAFT") as ProjectDef["status"], sortOrder: num(p.sortOrder ?? cur?.sortOrder),
    availableFrom: p.availableFrom !== undefined ? toMs(iso(p.availableFrom)) : cur?.availableFrom ?? null, availableTo: p.availableTo !== undefined ? toMs(iso(p.availableTo)) : cur?.availableTo ?? null,
    version: expected,
  };
  const problems = validateProject(draft, cfg.missions, await lookup(sb), { forActivation: draft.status === "ACTIVE" });
  if (problems.length) return fail(422, problems.map((x) => x.message).join(" · "));
  const w = await writeVersioned(sb, "content_card_projects", id, expected, {
    name: draft.name, description: draft.description, target_card_id: draft.targetCardId, status: draft.status, sort_order: draft.sortOrder,
    available_from: iso(draft.availableFrom), available_to: iso(draft.availableTo),
  }, userId);
  if (!w.ok) return fail(w.status, w.error);
  await writeAudit(sb, userId, expected === 0 ? "f73_project_create" : "f73_project_save", "card_project", id, { before: w.before, after: w.after, reason: str(b.reason) || null });
  resetF73Cache();
  return ok({ item: toProject(w.after) });
}
