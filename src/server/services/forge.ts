/**
 * F79 · NEXUS FORGE 2.0 (servidor) — SERVER-AUTHORITATIVE.
 *
 *   · LECTURA: reúne HECHOS de tablas ya idempotentes (crafteos en `economy_ops`, proyectos reclamados, misiones
 *     completadas, asientos `forge:*`, inventario, favoritas, vitrina, equipos) y calcula la Forja con el dominio PURO
 *     (`domain/forge`). XP, nivel, maestría, descubrimiento, cadenas, planos, objetivos y logros NO se escriben en
 *     ningún sitio: no se pueden duplicar ni desincronizar, y el cliente no puede mandarlos.
 *   · FORJAR (intercambio F73 o receta avanzada `forge-…`): el cliente manda SOLO receta + uids + gesto + las copias
 *     PROTEGIDAS que confirma. El servidor revalida desbloqueo, posesión, huecos, última copia y protección, decide la
 *     carta de salida (`randomInt`, criptográfico) y llama a la MISMA RPC atómica de F73 (`app_craft_card`), que
 *     bloquea todas las copias implicadas, comprueba lo que solo la BD puede y deja el asiento en `economy_ops` con la
 *     ref `craft:card:<usuario>:<gesto>` → doble clic, F5, reintento o dos pestañas = UNA operación.
 *   · RECLAMAR objetivo/logro: `award()` con clave `forge:obj:<id>:<periodo>` / `forge:ach:<id>` (idempotente).
 */
import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { VARIANTS } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import { recipeLive } from "@/domain/crafting/types";
import type { PackCardClass } from "@/domain/packs/packClass";
import { isForgeRecipeId, type ConsumeSlot, type ForgeConfig } from "@/domain/forge/types";
import type { CraftOpFact, ForgeFacts, InventorySummary } from "@/domain/forge/progression";
import { buildMaterials, validateSelection, type OwnedCopy, type SlotMaterials } from "@/domain/forge/selector";
import { evaluateForge, recipeGate, type ForgeCore } from "@/domain/forge/snapshot";
import { forgeHistory, type HistoryEntry } from "@/domain/forge/history";
import { achievementClaimRef, objectiveClaimRef } from "@/domain/forge/objectives";
import { projectStages, type ProjectStage } from "@/domain/forge/projects";
import { checkOwn, type Labels } from "@/domain/forge/requirements";
import { effectivePool, pickFrom } from "@/domain/forge/output";
import { progressEvents } from "@/domain/forge/events";
import type { MissionView, ProjectView } from "@/domain/missionEngine/state";
import { award } from "./rewards";
import { loadF73Config } from "./f73Config";
import { getMissionsState, settleMissionsForOp } from "./missionEngine";
import { craftRef, craftRpcError, publishedOfClass } from "./crafting";
import { loadForgeConfig, logForge } from "./forgeConfig";
import { GUARD_RPC_ERRORS, isMissingRpc, loadProtection } from "./cardProtection";

export interface ServiceOut<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = <T>(status: number, error: string, code?: string): ServiceOut<T> => ({ ok: false, status, error, code });
const done = <T>(data: T): ServiceOut<T> => ({ ok: true, status: 200, data });

/* ═══════════════════════════ HECHOS ═══════════════════════════ */

async function pages<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function ownedCopies(sb: SupabaseClient, userId: string): Promise<OwnedCopy[]> {
  const rows = await pages<{ uid: string; card_id: string; locked: boolean }>((a, b) => sb.from("user_cards").select("uid, card_id, locked").eq("user_id", userId).order("uid").range(a, b));
  return rows.map((r) => ({ uid: r.uid, cardId: r.card_id, locked: !!r.locked }));
}
async function craftOps(sb: SupabaseClient, userId: string): Promise<CraftOpFact[]> {
  const rows = await pages<{ ref: string; kind: string; result: Record<string, unknown> | null; created_at: string }>((a, b) =>
    sb.from("economy_ops").select("ref, kind, result, created_at").eq("user_id", userId).in("kind", ["craft_pack", "craft_card"]).order("created_at").range(a, b));
  return rows.map((r) => {
    const res = (r.result ?? {}) as { recipeId?: string; inputs?: CraftOpFact["inputs"]; outputs?: CraftOpFact["outputs"] };
    return { ref: r.ref, kind: (r.kind === "craft_pack" ? "PACK" : "CARD") as CraftOpFact["kind"], recipeId: String(res.recipeId ?? ""), at: Date.parse(r.created_at), inputs: res.inputs ?? [], outputs: res.outputs ?? [] };
  }).filter((o) => o.recipeId && Number.isFinite(o.at));
}

async function forgeClaimRefs(sb: SupabaseClient, userId: string): Promise<{ ref: string; at: number }[]> {
  const rows = await pages<{ ref: string | null; created_at: string }>((a, b) =>
    sb.from("credit_transactions").select("ref, created_at").eq("user_id", userId).like("ref", "forge:%").order("created_at").range(a, b));
  return rows.filter((r) => typeof r.ref === "string" && r.ref.startsWith("forge:")).map((r) => ({ ref: r.ref as string, at: Date.parse(r.created_at) }));
}

function inventorySummary(owned: readonly OwnedCopy[], cardOf: (id: string) => CardDef | undefined): InventorySummary {
  const ids = new Set(owned.map((o) => o.cardId));
  const byVariant: Record<string, number> = {};
  const players = new Set<string>();
  for (const id of ids) { const d = cardOf(id); if (!d) continue; byVariant[d.variantId] = (byVariant[d.variantId] ?? 0) + 1; players.add(d.playerId); }
  return { distinctCards: ids.size, distinctByVariant: byVariant, distinctPlayers: players.size, ownedCardIds: ids };
}

interface Facts {
  cfg: ForgeConfig;
  facts: ForgeFacts;
  owned: OwnedCopy[];
  decks: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
  showcase: ReadonlySet<string>;
  claims: { ref: string; at: number }[];
  missions: { missions: MissionView[]; projects: ProjectView[]; available: boolean };
  projectClaims: { projectId: string; at: number; cardUid: string | null }[];
}

const teamOf = (def: Pick<CardDef, "playerId"> & { team?: string }) => canonicalCardTeam(def, serverCatalogSync().registry.player(def.playerId)).key;
const cardOf = (id: string) => serverCatalogSync().registry.card(id);
export const forgeLabels: Labels = {
  variant: (v) => (VARIANTS as Record<string, { label?: string }>)[v]?.label ?? v,
  card: (id) => { const d = cardOf(id); const p = d ? serverCatalogSync().registry.player(d.playerId) : undefined; return p ? `${p.nick} (${d!.ovr})` : id; },
  team: (k) => k,
  player: (id) => serverCatalogSync().registry.player(id)?.nick ?? id,
};

async function gatherFacts(sb: SupabaseClient, userId: string): Promise<Facts> {
  await serverCatalog(sb);
  const [cfgLoad, ops, owned, prot, claims, ms, pc] = await Promise.all([
    loadForgeConfig(sb), craftOps(sb, userId), ownedCopies(sb, userId), loadProtection(sb, userId),
    forgeClaimRefs(sb, userId), getMissionsState(sb, userId),
    sb.from("user_project_claims").select("project_id, claimed_at, card_uid").eq("user_id", userId),
  ]);
  const projectClaims = pc.error ? [] : ((pc.data ?? []) as { project_id: string; claimed_at: string; card_uid: string | null }[]).map((r) => ({ projectId: r.project_id, at: Date.parse(r.claimed_at), cardUid: r.card_uid }));
  const mv = ms.data ?? { available: false, missions: [], projects: [] };
  const completedMissions = new Set(mv.missions.filter((m) => m.state === "COMPLETED" || m.state === "CLAIMED").map((m) => m.id));
  return {
    cfg: cfgLoad.config, owned, decks: prot.inDeck, favorites: prot.favoriteCardIds, showcase: prot.showcaseUids, claims, projectClaims,
    missions: { available: mv.available, missions: mv.missions, projects: mv.projects },
    facts: { ops, projectClaims: projectClaims.map((p) => ({ projectId: p.projectId, at: p.at })), completedMissions, inventory: inventorySummary(owned, cardOf) },
  };
}

const materialsFn = (f: Facts) => (slots: readonly ConsumeSlot[]): SlotMaterials[] =>
  buildMaterials({ owned: f.owned, inDeck: f.decks, favoriteCardIds: f.favorites, showcaseUids: f.showcase, slots, cardOf, teamOf });

function core(f: Facts, now: number): ForgeCore {
  return evaluateForge({ cfg: f.cfg, facts: f.facts, now, claimedRefs: new Set(f.claims.map((c) => c.ref)), materials: materialsFn(f), labels: forgeLabels });
}

/* ═══════════════════════════ FOTO ═══════════════════════════ */

export interface ExchangeView { id: string; name: string; inputClass: PackCardClass; outputClass: PackCardClass; inputQty: number; live: boolean; outputPoolSize: number; materials: SlotMaterials[] }
export interface ForgeProjectView extends ProjectView { stages: ProjectStage[]; extrasMet: boolean }
export interface ForgeSnapshot {
  available: boolean;
  reason: string;
  serverNow: number;
  configStored: boolean;
  core: ForgeCore;
  exchange: ExchangeView[];
  projects: ForgeProjectView[];
  history: HistoryEntry[];
}

function projectViews(f: Facts): ForgeProjectView[] {
  const claimed = new Set(f.projectClaims.map((p) => p.projectId));
  const recipesDone = new Set(f.facts.ops.map((o) => o.recipeId));
  return f.missions.projects.map((p) => {
    const extras = f.cfg.projects.find((x) => x.projectId === p.id);
    const own = (extras?.own ?? []).map((o) => checkOwn(o, f.facts.inventory, forgeLabels));
    const fab = extras?.fabricateRecipeId ? { recipeId: extras.fabricateRecipeId, name: f.cfg.recipes.find((r) => r.id === extras.fabricateRecipeId)?.name ?? extras.fabricateRecipeId, done: recipesDone.has(extras.fabricateRecipeId) } : null;
    const { stages, extrasMet } = projectStages(f.missions.missions.filter((m) => m.projectId === p.id), extras, own, fab, claimed.has(p.id));
    return { ...p, stages, extrasMet };
  });
}

export async function getForgeState(sb: SupabaseClient, userId: string): Promise<ServiceOut<ForgeSnapshot>> {
  const f73 = await loadF73Config(sb);
  const now = Date.now();
  const f = await gatherFacts(sb, userId);
  const cfgLoad = await loadForgeConfig(sb);
  const exchange: ExchangeView[] = f73.available ? f73.recipes.filter((r) => r.kind === "CARD" && r.status === "ACTIVE" && !isForgeRecipeId(r.id) && r.inputClass && r.outputClass).map((r) => {
    const pool = publishedOfClass(r.outputClass!).length;
    return { id: r.id, name: r.name, inputClass: r.inputClass!, outputClass: r.outputClass!, inputQty: r.inputQty, live: recipeLive(r, now) && pool > 0, outputPoolSize: pool,
      materials: materialsFn(f)([{ qty: r.inputQty, class: r.inputClass! }]) };
  }) : [];
  const history = forgeHistory({
    ops: f.facts.ops,
    projectClaims: f.projectClaims.map((p) => ({ projectId: p.projectId, at: p.at, cardId: f.missions.projects.find((x) => x.id === p.projectId)?.targetCardId })),
    rewardClaims: f.claims,
  }, 40);
  return done({ available: f73.available, reason: f73.reason, serverNow: now, configStored: cfgLoad.stored, core: core(f, now), exchange, projects: projectViews(f), history });
}

/* ═══════════════════════════ FORJAR ═══════════════════════════ */

export interface ForgeCraftResult { recipeId: string; inputs: { uid: string; cardId: string }[]; outputs: { uid: string; cardId: string }[]; repeated: boolean; protectedUsed: string[]; advanced: boolean }

const SELECTION_ERRORS = {
  WRONG_COUNT: { status: 400, error: "Número de cartas incorrecto" },
  DUPLICATE_INPUT: { status: 400, error: "Una carta no puede entregarse dos veces" },
  NOT_ELIGIBLE: { status: 409, error: "Alguna carta ya no es tuya, está en un equipo o en venta" },
  LAST_COPY: { status: 409, error: "No puedes entregar tu última copia de una carta" },
  PROTECTED: { status: 409, error: "Has elegido una carta protegida (favorita o en tu vitrina): confírmalo antes de forjar" },
  SLOT_MISMATCH: { status: 400, error: "Alguna carta no encaja en ningún hueco de la receta" },
} as const;
const GATE_ERRORS = {
  RECIPE_LOCKED: { status: 409, error: "Esa receta aún está bloqueada" },
  RECIPE_COMPLETED: { status: 409, error: "Ya completaste esa receta" },
  OWN_UNMET: { status: 409, error: "Te falta poseer lo que pide la receta" },
  RECIPE_UNAVAILABLE: { status: 404, error: "Esa receta no está disponible" },
} as const;

export async function forgeCraft(
  sb: SupabaseClient, userId: string, recipeId: string, uids: string[], gesture: string | undefined, confirmProtected: string[],
): Promise<ServiceOut<ForgeCraftResult>> {
  const f73 = await loadF73Config(sb);
  if (!f73.available) return fail(503, "El crafteo aún no está disponible", "MIGRATION_PENDING");
  const advanced = isForgeRecipeId(recipeId);
  /*
   * Receta avanzada NO repetible (paso de cadena): la clave del libro mayor es la de la RECETA, no la del gesto. Dos
   * pestañas con gestos distintos pasan las dos la puerta de Node a la vez (aún no hay asiento), pero `economy_ops.ref`
   * es clave primaria: la segunda RPC espera a la primera y recibe su resultado (o choca con 23505 y se revierte entera).
   * Una sola forja, y las dos pestañas enseñan la MISMA carta.
   */
  const once = advanced && (await loadForgeConfig(sb)).config.recipes.some((r) => r.id === recipeId && !r.repeatable);
  const ref = once ? onceRef(userId, recipeId) : craftRef("card", userId, gesture ?? randomUUID());
  logForge("info", "craft_attempt", { recipeId, advanced, n: uids.length });
  const failWith = <T>(status: number, error: string, code: string): ServiceOut<T> => { logForge("warn", "craft_failure", { recipeId, code }); return fail(status, error, code); };

  // Reintento de una forja YA hecha → lo guardado, sin revalidar con el inventario nuevo.
  const stored = await sb.from("economy_ops").select("result, user_id").eq("ref", ref).maybeSingle();
  if (stored.data && (stored.data as { user_id: string }).user_id === userId) {
    const r = (stored.data as { result: Omit<ForgeCraftResult, "repeated" | "protectedUsed" | "advanced"> }).result;
    return done({ ...r, repeated: true, protectedUsed: [], advanced });
  }

  const f = await gatherFacts(sb, userId);
  const now = Date.now();
  let slots: ConsumeSlot[];
  let pool: CardDef[];
  if (advanced) {
    const r = f.cfg.recipes.find((x) => x.id === recipeId && x.status === "ACTIVE");
    if (!r) return failWith(404, GATE_ERRORS.RECIPE_UNAVAILABLE.error, "RECIPE_UNAVAILABLE");
    const gate = recipeGate(core(f, now), recipeId);
    if (!gate.ok) return failWith(GATE_ERRORS[gate.code].status, GATE_ERRORS[gate.code].error, gate.code);
    slots = r.consume;
    if (r.output.type === "CARD") {
      const d = cardOf(r.output.cardId);
      if (!d || serverCatalogSync().lifecycleOf(d.id) !== "PUBLISHED") return failWith(409, "La carta de esta receta no está disponible", "EMPTY_POOL");
      pool = [d];
    } else pool = publishedOfClass(r.output.class);
  } else {
    const r = f73.recipes.find((x) => x.id === recipeId);
    if (!r) return failWith(404, "Esa receta no existe", "RECIPE_NOT_FOUND");
    if (r.kind !== "CARD" || !r.inputClass || !r.outputClass) return failWith(400, "Esa receta no es de cartas", "RECIPE_KIND");
    if (!recipeLive(r, now)) return failWith(409, "Esa receta no está activa", "RECIPE_DISABLED");
    slots = [{ qty: r.inputQty, class: r.inputClass }];
    pool = publishedOfClass(r.outputClass);
  }

  const sel = validateSelection(uids, materialsFn(f)(slots), confirmProtected);
  if (!sel.ok) return failWith(SELECTION_ERRORS[sel.error].status, SELECTION_ERRORS[sel.error].error, sel.error === "PROTECTED" ? "PROTECTED_COPY" : sel.error);

  const eff = effectivePool(pool, f.facts.inventory.ownedCardIds, f.cfg.pity);
  const out = pickFrom(eff.pool, eff.pool.length > 0 ? randomInt(0, eff.pool.length) : -1);
  if (!out) return failWith(409, "No hay cartas disponibles para esta forja", "EMPTY_POOL");

  // 0061 · RPC GUARDADA: la BD vuelve a imponer protección (favorita/vitrina confirmada), equipos y última copia.
  const { data, error } = await sb.rpc("app_craft_card_guarded", {
    p_user: userId, p_recipe: recipeId, p_uids: uids, p_expected: sel.cardIdByUid, p_output_card_id: out.id, p_ref: ref,
    p_confirm: sel.protectedUsed,
  });
  if (error) {
    // Otra petición dejó el asiento de esta misma clave a la vez (no repetible): la operación es la suya.
    if (isUniqueViolation(error)) {
      const won = await sb.from("economy_ops").select("result, user_id").eq("ref", ref).maybeSingle();
      if (won.data && (won.data as { user_id: string }).user_id === userId) {
        const r = (won.data as { result: Omit<ForgeCraftResult, "repeated" | "protectedUsed" | "advanced"> }).result;
        return done({ ...r, repeated: true, protectedUsed: [], advanced });
      }
    }
    if (isMissingRpc(error)) return failWith(503, "La forja necesita la migración 0061", "MIGRATION_PENDING");
    const guard = Object.keys(GUARD_RPC_ERRORS).find((k) => (error.message ?? "").includes(k));
    if (guard) return failWith(GUARD_RPC_ERRORS[guard].status, GUARD_RPC_ERRORS[guard].error, guard === "PROTECTED_COPY" ? "PROTECTED_COPY" : guard);
    const mapped = craftRpcError(error);
    if (mapped) return failWith(mapped.status, mapped.error, mapped.code);
    logForge("error", "craft_failure", { recipeId, code: "RPC_ERROR", error: (error.message ?? "").slice(0, 160) });
    return fail(500, "No se pudo completar la forja");
  }
  const res = data as { recipeId: string; inputs: { uid: string; cardId: string }[]; outputs: { uid: string; cardId: string }[]; repeated?: boolean };
  if (!res.repeated) {
    logForge("info", "craft_success", { recipeId, advanced, pity: eff.pityApplied, protectedUsed: sel.protectedUsed.length });
    logProgress(f, now, { ref, kind: "CARD", recipeId, at: now, inputs: res.inputs, outputs: res.outputs });
    await settleMissionsForOp(sb, userId, { kind: "CRAFT_CARD", key: ref, recipeId });
  }
  return done({ recipeId: res.recipeId, inputs: res.inputs, outputs: res.outputs, repeated: !!res.repeated, protectedUsed: sel.protectedUsed, advanced });
}

/**
 * Analítica de progresión tras una forja: la MISMA evaluación pura con el asiento nuevo (y la carta nueva en la
 * colección), sin otra lectura de BD. Nunca puede romper la forja: ya está hecha.
 */
function logProgress(f: Facts, now: number, op: CraftOpFact): void {
  try {
    const before = core(f, now);
    const owned = new Set(f.facts.inventory.ownedCardIds);
    for (const o of op.outputs) if (o.cardId) owned.add(o.cardId);
    const inv = inventorySummary([...owned].map((cardId) => ({ uid: cardId, cardId, locked: false })), cardOf);
    const after = core({ ...f, facts: { ...f.facts, ops: [...f.facts.ops, op], inventory: inv } }, now);
    for (const e of progressEvents(before, after)) { const { msg, ...ctx } = e; logForge("info", msg, ctx); }
    for (const p of f.cfg.projects.filter((x) => x.fabricateRecipeId === op.recipeId)) logForge("info", "project_progress", { projectId: p.projectId, stage: "FABRICATE" });
  } catch { /* solo analítica */ }
}

/** Clave del libro mayor de una receta avanzada NO repetible: una por jugador y receta, la use quien la use. */
export const onceRef = (userId: string, recipeId: string) => `craft:card:${userId}:once:${recipeId}`;
const isUniqueViolation = (e: { code?: string; message?: string }) => e.code === "23505" || /duplicate key/i.test(e.message ?? "");

/* ═══════════════════════════ RECLAMOS ═══════════════════════════ */

export async function claimObjective(sb: SupabaseClient, userId: string, objectiveId: string): Promise<ServiceOut<{ repeated: boolean; snapshot: ForgeSnapshot }>> {
  const f = await gatherFacts(sb, userId);
  const now = Date.now();
  const v = core(f, now).objectives.find((o) => o.id === objectiveId);
  if (!v) return fail(404, "Objetivo no encontrado", "OBJECTIVE_NOT_FOUND");
  if (!v.hasReward) return fail(409, "Este objetivo no tiene recompensa que reclamar", "NO_REWARD");
  if (v.state === "ACTIVE") return fail(409, "El objetivo todavía no está completado", "NOT_COMPLETED");
  const def = f.cfg.objectives.find((o) => o.id === objectiveId)!;
  let repeated = v.state === "CLAIMED";
  if (!repeated) {
    const out = await award(sb, { userId, ref: objectiveClaimRef(objectiveId, v.periodKey), reason: `forge_objective: ${def.name}`, reward: rewardOf(def.reward) });
    repeated = !out.applied;
    logForge("info", repeated ? "claim_duplicate" : "objective_claim", { objectiveId, period: v.periodKey });
  }
  const snap = await getForgeState(sb, userId);
  return done({ repeated, snapshot: snap.data! });
}

export async function claimAchievement(sb: SupabaseClient, userId: string, achievementId: string): Promise<ServiceOut<{ repeated: boolean; snapshot: ForgeSnapshot }>> {
  const f = await gatherFacts(sb, userId);
  const v = core(f, Date.now()).achievements.find((a) => a.id === achievementId);
  if (!v) return fail(404, "Logro no encontrado", "ACHIEVEMENT_NOT_FOUND");
  if (!v.hasReward) return fail(409, "Este logro no tiene recompensa que reclamar", "NO_REWARD");
  if (v.state === "ACTIVE") return fail(409, "El logro todavía no está conseguido", "NOT_COMPLETED");
  const def = f.cfg.achievements.find((a) => a.id === achievementId)!;
  let repeated = v.state === "CLAIMED";
  if (!repeated) {
    const out = await award(sb, { userId, ref: achievementClaimRef(achievementId), reason: `forge_achievement: ${def.name}`, reward: rewardOf(def.reward) });
    repeated = !out.applied;
    logForge("info", repeated ? "claim_duplicate" : "achievement_claim", { achievementId });
  }
  const snap = await getForgeState(sb, userId);
  return done({ repeated, snapshot: snap.data! });
}

const rewardOf = (r: { credits?: number; xp?: number; packId?: string; packCount?: number }) =>
  ({ credits: r.credits ?? 0, xp: r.xp ?? 0, ...(r.packId && (r.packCount ?? 0) > 0 ? { packId: r.packId, packCount: r.packCount } : {}) });

/* ═══════════════════════════ PROYECTOS 2.0 ═══════════════════════════ */

/**
 * Lo que Forge AÑADE al reclamo de un proyecto F73: requisitos de posesión y de fabricación del documento de Forja.
 * Sin extras configurados → siempre OK (el proyecto es exactamente el de F73).
 */
export async function projectForgeGate(sb: SupabaseClient, userId: string, projectId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const cfg = (await loadForgeConfig(sb)).config;
  const extras = cfg.projects.find((x) => x.projectId === projectId);
  if (!extras || (extras.own.length === 0 && !extras.fabricateRecipeId)) return { ok: true };
  await serverCatalog(sb);
  const [owned, ops] = await Promise.all([ownedCopies(sb, userId), craftOps(sb, userId)]);
  const inv = inventorySummary(owned, cardOf);
  const ownOk = extras.own.every((o) => checkOwn(o, inv).met);
  const fabOk = !extras.fabricateRecipeId || ops.some((o) => o.recipeId === extras.fabricateRecipeId);
  if (ownOk && fabOk) return { ok: true };
  logForge("info", "project_gate_blocked", { projectId, ownOk, fabOk });
  return { ok: false, message: !ownOk ? "Te falta reunir lo que pide el proyecto" : "Te falta la fabricación del proyecto" };
}

