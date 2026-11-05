/**
 * F79 · ADMIN — CONFIGURACIÓN DE NEXUS FORGE 2.0 (XP, curva, maestría, recetas avanzadas, cadenas, planos, extras de
 * proyectos, objetivos, logros, pity).
 *
 * Mismas garantías que el resto del panel (F58/F60/F73): `runAdmin` verifica admin en servidor, lista blanca de campos,
 * versión optimista (`expectedVersion`: 0 = primer guardado), auditoría append-only y validación PURA antes de escribir
 * (`domain/forge/validate`: contenido REAL, suelos económicos, nada activo que dependa de un borrador, sin ciclos).
 *
 * Cada receta avanzada tiene una fila ESPEJO kind CARD en `craft_recipes` (mismo id `forge-…`): es lo que lee la RPC
 * atómica `app_craft_card`. El espejo se escribe ANTES que el documento y su estado sigue al de la receta (DRAFT →
 * DISABLED). Si el documento no llegara a guardarse (versión vieja), el espejo nunca permite nada que el documento no
 * permita: la Forja exige la receta ACTIVA en el documento Y en el espejo, y el intercambio F73 rechaza siempre `forge-…`.
 * Nada se publica solo: guardar con contenido nuevo en DRAFT no lo enseña a nadie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type AdminResult } from "@/server/admin/http";
import { writeAudit } from "@/server/admin/audit";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { getPack } from "@/data/packs";
import { TEAM_IDENTITIES } from "@/data/teamIdentities";
import { DEFAULT_FORGE_CONFIG, mergeForgeConfig } from "@/domain/forge/defaults";
import { isForgeRecipeId, type ForgeConfig } from "@/domain/forge/types";
import { advancedFloor, lowestInputClass, outputClassOf, validateForgeConfig, type ForgeLookup } from "@/domain/forge/validate";
import { totalConsumed } from "@/domain/forge/requirements";
import { progressionRegressions, stampWindows, type ForgeImpact, type RegressionRisk } from "@/domain/forge/policy";
import { countFacts, forgeXp, levelFromXp, EMPTY_INVENTORY, type ForgeFacts } from "@/domain/forge/progression";
import { chainsCompleted } from "@/domain/forge/discovery";
import { objectivesCompleted } from "@/domain/forge/objectives";
import { loadF73Config, resetF73Cache } from "@/server/services/f73Config";
import { FORGE_CONFIG_ID, loadForgeConfig, resetForgeConfigCache } from "@/server/services/forgeConfig";
import { publishedOfClass } from "@/server/services/crafting";

const TEAMS = new Set(TEAM_IDENTITIES.map((t) => t.canonicalId));

async function lookup(sb: SupabaseClient): Promise<ForgeLookup> {
  await serverCatalog(sb);
  const cat = serverCatalogSync();
  const reg = cat.registry;
  const variants = new Set(cat.cards.map((c) => c.variantId as string));
  const f73 = await loadF73Config(sb, { fresh: true });
  return {
    card: (id) => reg.card(id), playerExists: (id) => !!reg.player(id), teamExists: (k) => TEAMS.has(k), variantExists: (v) => variants.has(v),
    projectExists: (id) => f73.projects.some((p) => p.id === id), missionExists: (id) => f73.missions.some((m) => m.id === id),
    packExists: (id) => !!getPack(id), classPool: (cls) => publishedOfClass(cls).length,
  };
}

/** Lo que enseña el panel: documento vigente, versión, problemas y el suelo de cada receta avanzada. */
export async function getForgeAdmin(sb: SupabaseClient): Promise<AdminResult<unknown>> {
  const load = await loadForgeConfig(sb, { fresh: true });
  const lk = await lookup(sb);
  const cfg = load.config;
  return ok({
    stored: load.stored, reason: load.reason, version: load.version, updatedAt: load.updatedAt,
    config: cfg, defaults: DEFAULT_FORGE_CONFIG, problems: validateForgeConfig(cfg, lk),
    floors: cfg.recipes.map((r) => { const f = advancedFloor(r, lk.card); return { id: r.id, consumes: totalConsumed(r.consume), floor: f ? { ratio: f.ratio, viable: f.viable } : null }; }),
  });
}

/**
 * F79.1 · IMPACTO REAL de un cambio de reglas: nivel de cada jugador con crafteos o proyectos, con las reglas vigentes y
 * con las nuevas (misma evaluación pura que la Forja, sobre el libro mayor). Solo lectura.
 */
export async function forgeImpact(sb: SupabaseClient, prev: ForgeConfig, next: ForgeConfig): Promise<ForgeImpact> {
  const ops: { user_id: string; ref: string; kind: string; result: Record<string, unknown> | null; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("economy_ops").select("user_id, ref, kind, result, created_at").in("kind", ["craft_pack", "craft_card"]).order("created_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    ops.push(...((data ?? []) as typeof ops));
    if ((data ?? []).length < 1000) break;
  }
  const claims = await sb.from("user_project_claims").select("user_id, project_id, claimed_at");
  const byUser = new Map<string, ForgeFacts>();
  const factsOf = (u: string) => { let f = byUser.get(u); if (!f) { f = { ops: [], projectClaims: [], completedMissions: new Set(), inventory: EMPTY_INVENTORY }; byUser.set(u, f); } return f; };
  for (const o of ops) {
    const r = (o.result ?? {}) as { recipeId?: string };
    if (!r.recipeId) continue;
    factsOf(o.user_id).ops.push({ ref: o.ref, kind: o.kind === "craft_pack" ? "PACK" : "CARD", recipeId: String(r.recipeId), at: Date.parse(o.created_at), inputs: [], outputs: [] });
  }
  for (const c of ((claims.error ? [] : claims.data) ?? []) as { user_id: string; project_id: string; claimed_at: string }[]) factsOf(c.user_id).projectClaims.push({ projectId: c.project_id, at: Date.parse(c.claimed_at) });
  const levelOf = (cfg: ForgeConfig, f: ForgeFacts) => {
    const done = countFacts(f).recipesDone;
    return levelFromXp(forgeXp(cfg, f, chainsCompleted(cfg, done), objectivesCompleted(cfg, f.ops)).total, cfg.curve).level;
  };
  let levelDrops = 0, maxDrop = 0, levelGains = 0;
  for (const f of byUser.values()) {
    const d = levelOf(next, f) - levelOf(prev, f);
    if (d < 0) { levelDrops++; maxDrop = Math.max(maxDrop, -d); } else if (d > 0) levelGains++;
  }
  return { players: byUser.size, levelDrops, maxDrop, levelGains };
}

/** F79.1 · Vista previa SIN escribir: qué cambios serían regresivos y a cuántos jugadores reales bajaría. */
export async function previewForgeChange(sb: SupabaseClient, b: Record<string, unknown>): Promise<AdminResult<{ regressions: RegressionRisk[]; impact: ForgeImpact; problems: unknown[] }>> {
  if (!b.doc || typeof b.doc !== "object" || Array.isArray(b.doc)) return fail(400, "Documento inválido");
  const load = await loadForgeConfig(sb, { fresh: true });
  const cfg = stampWindows(load.config, mergeForgeConfig(b.doc), Date.now());
  const lk = await lookup(sb);
  return ok({ regressions: progressionRegressions(load.config, cfg), impact: await forgeImpact(sb, load.config, cfg), problems: validateForgeConfig(cfg, lk) });
}

const statusOfMirror = (s: string) => (s === "ACTIVE" ? "ACTIVE" : s === "RETIRED" ? "RETIRED" : "DISABLED");

export async function saveForgeConfig(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<AdminResult<{ version: number; config: ForgeConfig }>> {
  const load = await loadForgeConfig(sb, { fresh: true });
  if (!load.stored) return fail(503, "Falta la migración 0061 (configuración de la Forja)");
  const expected = typeof b.expectedVersion === "number" && Number.isInteger(b.expectedVersion) ? b.expectedVersion : -1;
  if (expected < 0) return fail(400, "expectedVersion obligatorio");
  if (expected !== load.version) return fail(409, "Alguien lo cambió antes: recarga (STALE_CONTENT)");
  if (!b.doc || typeof b.doc !== "object" || Array.isArray(b.doc)) return fail(400, "Documento inválido");
  const cfg = stampWindows(load.config, mergeForgeConfig(b.doc), Date.now());
  const lk = await lookup(sb);
  const problems = validateForgeConfig(cfg, lk);
  if (problems.length) return fail(422, problems.slice(0, 12).map((p) => `${p.path}: ${p.message}`).join(" · "));
  // F79.1 · una edición normal NO puede bajar la progresión ganada. Lo regresivo exige acción explícita + motivo.
  const regressions = progressionRegressions(load.config, cfg);
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (regressions.length > 0 && !(b.confirmRegression === true && reason.length >= 8)) {
    return fail(409, `PROGRESSION_REGRESSION: este cambio puede BAJAR la progresión de jugadores (${regressions.map((r) => r.message).join(" · ")}). Revisa el impacto y confirma el recálculo con un motivo.`);
  }
  const impact = regressions.length > 0 ? await forgeImpact(sb, load.config, cfg) : null;

  const f73 = await loadF73Config(sb, { fresh: true });
  if (!f73.available) return fail(503, "Falta la migración 0059 (crafteo)");
  // 1 · espejos en craft_recipes (lo que lee la RPC). Los que ya no están en el documento se retiran.
  for (const r of cfg.recipes) {
    const inCls = lowestInputClass(r); const outCls = outputClassOf(r, lk.card);
    if (!inCls || !outCls) return fail(422, `${r.id}: no se puede derivar su fila de crafteo`);
    const row = { kind: "CARD", name: r.name, input_class: inCls, output_class: outCls, input_pack_id: null, output_pack_id: null, input_qty: totalConsumed(r.consume), status: statusOfMirror(r.status), sort_order: 1000 + r.sortOrder, updated_by: userId };
    const cur = f73.recipes.find((x) => x.id === r.id);
    const w = cur
      ? await sb.from("craft_recipes").update({ ...row, version: cur.version + 1, updated_at: new Date().toISOString() }).eq("id", r.id)
      : await sb.from("craft_recipes").insert({ ...row, id: r.id, version: 1, created_by: userId });
    if (w.error) return fail(500, "No se pudo escribir la receta espejo");
  }
  for (const old of f73.recipes.filter((x) => isForgeRecipeId(x.id) && !cfg.recipes.some((r) => r.id === x.id) && x.status !== "RETIRED")) {
    const w = await sb.from("craft_recipes").update({ status: "RETIRED", version: old.version + 1, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", old.id);
    if (w.error) return fail(500, "No se pudo retirar una receta espejo");
  }
  // 2 · el documento (versión optimista).
  const before = load.version === 0 ? null : { version: load.version };
  let version: number;
  if (expected === 0) {
    const ins = await sb.from("forge_config").insert({ id: FORGE_CONFIG_ID, doc: cfg, version: 1, updated_by: userId }).select("version").maybeSingle();
    if (ins.error || !ins.data) return fail(409, "Alguien lo guardó antes: recarga (STALE_CONTENT)");
    version = 1;
  } else {
    const upd = await sb.from("forge_config").update({ doc: cfg, version: expected + 1, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", FORGE_CONFIG_ID).eq("version", expected).select("version").maybeSingle();
    if (upd.error || !upd.data) return fail(409, "Alguien lo cambió antes: recarga (STALE_CONTENT)");
    version = expected + 1;
  }
  const summary = (c: ForgeConfig) => ({
    recipes: c.recipes.map((r) => `${r.id}:${r.status}`), chains: c.chains.map((x) => `${x.id}:${x.status}`), blueprints: c.blueprints.map((x) => `${x.id}:${x.status}`),
    objectives: c.objectives.map((x) => `${x.id}:${x.status}`), achievements: c.achievements.map((x) => `${x.id}:${x.status}`), pity: c.pity.enabled, xp: c.xp, curve: c.curve,
  });
  await writeAudit(sb, userId, regressions.length ? "f79_forge_progression_recalc" : "f79_forge_config_save", "forge_config", FORGE_CONFIG_ID, {
    before: before ? { ...before, ...summary(load.config) } : null, after: { version, ...summary(cfg) }, reason: reason ? reason.slice(0, 200) : null,
    ...(regressions.length ? { regressions: regressions.map((r) => r.code + ":" + r.path), impact } : {}),
  });
  resetForgeConfigCache(); resetF73Cache();
  return ok({ version, config: cfg });
}
