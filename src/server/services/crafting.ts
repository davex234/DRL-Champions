/**
 * F73 · CRAFTEO (servidor) — SERVER-AUTHORITATIVE, atómico e idempotente.
 *
 *   · El cliente manda SOLO: receta, (en cartas) los uids que entrega y su gesto de idempotencia. Nunca cantidades,
 *     saldo, inventario, carta de salida, jugador, OVR ni semilla.
 *   · La operación la hace UNA RPC (`app_craft_pack` / `app_craft_card`, 0059) en una transacción: bloquea filas,
 *     comprueba, consume exactamente las entradas, entrega exactamente la salida y registra en `economy_ops`.
 *   · Idempotencia: ref = `craft:<tipo>:<usuario>:<gesto>`. Misma ref → misma respuesta (doble clic, F5, reintento,
 *     dos pestañas). Dos gestos distintos simultáneos con inventario para uno → uno falla por inventario.
 *   · La carta de salida del intercambio la sortea AQUÍ el servidor (`randomInt`, criptográfico) entre las cartas
 *     PUBLICADAS de la clase de salida; la RPC la inserta y la deja en el ledger.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import { getPack } from "@/data/packs";
import { recipeLive, type CraftRecipe } from "@/domain/crafting/types";
import { isForgeRecipeId } from "@/domain/forge/types";
import { checkSelection, exchangeCandidates, pickOutput, type ExchangeCandidate, type OwnedCopy } from "@/domain/crafting/cardExchange";
import { packCardClass } from "@/domain/packs/packClass";
import { loadF73Config, logF73 } from "./f73Config";
import { GUARD_RPC_ERRORS, deckUids, isMissingRpc, loadProtection } from "./cardProtection";
import { copyProtection } from "@/domain/cards/protection";
import { settleMissionsForOp } from "./missionEngine";

export interface ServiceOut<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = <T>(status: number, error: string, code?: string): ServiceOut<T> => ({ ok: false, status, error, code });
const done = <T>(data: T): ServiceOut<T> => ({ ok: true, status: 200, data });

export const craftRef = (kind: "pack" | "card", userId: string, gesture: string) => `craft:${kind}:${userId}:${gesture}`;

/** Traducción de los errores de la RPC (mensajes-código) a respuestas. */
const RPC_ERRORS: Record<string, { status: number; error: string }> = {
  RECIPE_NOT_FOUND: { status: 404, error: "Esa receta no existe" },
  RECIPE_KIND: { status: 400, error: "Esa receta no es de este tipo" },
  RECIPE_DISABLED: { status: 409, error: "Esa receta no está activa" },
  INSUFFICIENT_PACKS: { status: 409, error: "No tienes sobres suficientes" },
  WRONG_COUNT: { status: 400, error: "Número de cartas incorrecto" },
  DUPLICATE_INPUT: { status: 400, error: "Una carta no puede entregarse dos veces" },
  NOT_ELIGIBLE: { status: 409, error: "Alguna carta ya no es tuya, está bloqueada o cambió" },
  IN_DECK: { status: 409, error: "Alguna carta está en uno de tus equipos" },
  LAST_COPY: { status: 409, error: "No puedes entregar tu última copia de una carta" },
  NO_OUTPUT: { status: 500, error: "No se pudo decidir la carta" },
};
/** F79 · la Forja reutiliza la misma traducción de errores de `app_craft_card`. */
export function craftRpcError(e: { message?: string } | null): { code: string; status: number; error: string } | null {
  const code = Object.keys(RPC_ERRORS).find((k) => (e?.message ?? "").includes(k));
  return code ? { code, ...RPC_ERRORS[code] } : null;
}
function rpcFail<T>(e: { message?: string } | null, scope: string): ServiceOut<T> {
  const code = Object.keys(RPC_ERRORS).find((k) => (e?.message ?? "").includes(k));
  if (code) { logF73("warn", "craft_rejected", { scope, code }); return fail(RPC_ERRORS[code].status, RPC_ERRORS[code].error, code); }
  logF73("error", "craft_failed", { scope, error: (e?.message ?? "").slice(0, 160) });
  return fail(500, "No se pudo completar el crafteo");
}

/* ═══════════════════════════ LECTURAS ═══════════════════════════ */

async function ownedCopies(sb: SupabaseClient, userId: string): Promise<OwnedCopy[]> {
  const out: OwnedCopy[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("user_cards").select("uid, card_id, locked").eq("user_id", userId).order("uid").range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { uid: string; card_id: string; locked: boolean }[];
    for (const r of rows) out.push({ uid: r.uid, cardId: r.card_id, locked: !!r.locked });
    if (rows.length < 1000) break;
  }
  return out;
}
async function packInventory(sb: SupabaseClient, userId: string): Promise<Record<string, number>> {
  const { data, error } = await sb.from("user_packs").select("pack_id, qty").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return Object.fromEntries(((data ?? []) as { pack_id: string; qty: number }[]).map((r) => [r.pack_id, Number(r.qty)]));
}

export interface PackRecipeView { id: string; name: string; inputPackId: string; outputPackId: string; inputQty: number; have: number; live: boolean; canCraft: boolean }
export interface CardRecipeView { id: string; name: string; inputClass: string; outputClass: string; inputQty: number; live: boolean; available: number; canCraft: boolean; candidates: ExchangeCandidate[]; outputPoolSize: number }
export interface CraftingSnapshot { available: boolean; reason: string; serverNow: number; packs: Record<string, number>; packRecipes: PackRecipeView[]; cardRecipes: CardRecipeView[] }

export const publishedOfClass = (cls: string) => {
  const cat = serverCatalogSync();
  return cat.cards.filter((c) => cat.lifecycleOf(c.id) === "PUBLISHED" && packCardClass(c) === cls).sort((a, b) => a.id.localeCompare(b.id));
};

export async function getCraftingState(sb: SupabaseClient, userId: string): Promise<ServiceOut<CraftingSnapshot>> {
  const cfg = await loadF73Config(sb);
  const now = Date.now();
  if (!cfg.available) return done({ available: false, reason: cfg.reason, serverNow: now, packs: {}, packRecipes: [], cardRecipes: [] });
  await serverCatalog(sb);
  const reg = serverCatalogSync().registry;
  const [packs, owned, decks] = await Promise.all([packInventory(sb, userId), ownedCopies(sb, userId), deckUids(sb, userId)]);
  const visible = cfg.recipes.filter((r) => r.status === "ACTIVE");
  const packRecipes: PackRecipeView[] = visible.filter((r) => r.kind === "PACK" && r.inputPackId && r.outputPackId && getPack(r.inputPackId) && getPack(r.outputPackId)).map((r) => {
    const have = packs[r.inputPackId!] ?? 0; const live = recipeLive(r, now);
    return { id: r.id, name: r.name, inputPackId: r.inputPackId!, outputPackId: r.outputPackId!, inputQty: r.inputQty, have, live, canCraft: live && have >= r.inputQty };
  });
  // F79 · las recetas avanzadas (`forge-…`) solo existen en la Forja (que comprueba desbloqueos), nunca en el intercambio.
  const cardRecipes: CardRecipeView[] = visible.filter((r) => r.kind === "CARD" && r.inputClass && r.outputClass && !isForgeRecipeId(r.id)).map((r) => {
    const candidates = exchangeCandidates(owned, decks, r.inputClass!, (id) => reg.card(id));
    const available = candidates.reduce((s, c) => s + c.available, 0);
    const pool = publishedOfClass(r.outputClass!).length;
    const live = recipeLive(r, now) && pool > 0;
    return { id: r.id, name: r.name, inputClass: r.inputClass!, outputClass: r.outputClass!, inputQty: r.inputQty, live, available, canCraft: live && available >= r.inputQty, candidates, outputPoolSize: pool };
  });
  return done({ available: true, reason: "OK", serverNow: now, packs, packRecipes, cardRecipes });
}

/* ═══════════════════════════ CRAFTEO DE SOBRES ═══════════════════════════ */

export interface PackCraftResult { recipeId: string; inputs: { packId: string; qty: number }[]; outputs: { packId: string; qty: number }[]; inventory: Record<string, number>; repeated: boolean }

export async function craftPack(sb: SupabaseClient, userId: string, recipeId: string, gesture?: string): Promise<ServiceOut<PackCraftResult>> {
  const cfg = await loadF73Config(sb);
  if (!cfg.available) return fail(503, "El crafteo aún no está disponible", "MIGRATION_PENDING");
  const recipe = cfg.recipes.find((r) => r.id === recipeId);
  if (!recipe) return fail(404, "Esa receta no existe", "RECIPE_NOT_FOUND");
  if (recipe.kind !== "PACK") return fail(400, "Esa receta no es de sobres", "RECIPE_KIND");
  const ref = craftRef("pack", userId, gesture ?? randomUUID());
  const { data, error } = await sb.rpc("app_craft_pack", { p_user: userId, p_recipe: recipeId, p_ref: ref });
  if (error) return rpcFail(error, "pack");
  const r = data as Omit<PackCraftResult, "repeated"> & { repeated?: boolean };
  if (!r.repeated) {
    logF73("info", "craft_ok", { kind: "pack", recipeId });
    await settleMissionsForOp(sb, userId, { kind: "CRAFT_PACK", key: ref, packId: recipe.outputPackId ?? "" });
  }
  return done({ recipeId: r.recipeId, inputs: r.inputs, outputs: r.outputs, inventory: r.inventory ?? {}, repeated: !!r.repeated });
}

/* ═══════════════════════════ INTERCAMBIO DE CARTAS ═══════════════════════════ */

export interface CardCraftResult { recipeId: string; inputs: { uid: string; cardId: string }[]; outputs: { uid: string; cardId: string }[]; repeated: boolean }

export async function craftCard(sb: SupabaseClient, userId: string, recipeId: string, uids: string[], gesture?: string): Promise<ServiceOut<CardCraftResult>> {
  const cfg = await loadF73Config(sb);
  if (!cfg.available) return fail(503, "El crafteo aún no está disponible", "MIGRATION_PENDING");
  const ref = craftRef("card", userId, gesture ?? randomUUID());
  // Un reintento de un crafteo YA hecho devuelve lo guardado (la misma carta), sin revalidar con el inventario nuevo.
  const stored = await sb.from("economy_ops").select("result, user_id").eq("ref", ref).maybeSingle();
  if (stored.data && (stored.data as { user_id: string }).user_id === userId) {
    const r = (stored.data as { result: Omit<CardCraftResult, "repeated"> }).result;
    return done({ ...r, repeated: true });
  }
  const recipe: CraftRecipe | undefined = cfg.recipes.find((r) => r.id === recipeId);
  if (!recipe) return fail(404, "Esa receta no existe", "RECIPE_NOT_FOUND");
  if (recipe.kind !== "CARD" || !recipe.inputClass || !recipe.outputClass) return fail(400, "Esa receta no es de cartas", "RECIPE_KIND");
  // F79 · una receta avanzada SOLO por la Forja (`/api/game/forge`), que comprueba desbloqueos, posesión y protección.
  if (isForgeRecipeId(recipe.id)) return fail(409, "Esa receta se forja desde NEXUS FORGE", "USE_FORGE");
  if (!recipeLive(recipe, Date.now())) return fail(409, "Esa receta no está activa", "RECIPE_DISABLED");
  await serverCatalog(sb);
  const reg = serverCatalogSync().registry;
  const [owned, decks] = await Promise.all([ownedCopies(sb, userId), deckUids(sb, userId)]);
  const candidates = exchangeCandidates(owned, decks, recipe.inputClass, (id) => reg.card(id));
  const sel = checkSelection(uids, recipe.inputQty, candidates);
  if (!sel.ok) {
    logF73("warn", "craft_rejected", { scope: "card", code: sel.error });
    const map = { WRONG_COUNT: RPC_ERRORS.WRONG_COUNT, DUPLICATE_INPUT: RPC_ERRORS.DUPLICATE_INPUT, NOT_ELIGIBLE: RPC_ERRORS.NOT_ELIGIBLE, LAST_COPY: RPC_ERRORS.LAST_COPY }[sel.error];
    return fail(map.status, map.error, sel.error);
  }
  // F79.1 · esta ruta no tiene paso de confirmación: una copia PROTEGIDA (favorita o en tu vitrina) no se entrega por
  // aquí (la Forja sí, confirmándolo copia a copia). La regla es la canónica (`domain/cards/protection`) y la RPC
  // guardada la vuelve a imponer dentro de la transacción con confirmación vacía.
  const prot = await loadProtection(sb, userId);
  if (uids.some((u) => copyProtection(u, sel.cardIdByUid[u], prot).length > 0)) {
    logF73("warn", "craft_rejected", { scope: "card", code: "PROTECTED_COPY" });
    return fail(409, "Has elegido una carta protegida (favorita o en tu vitrina): fórjala desde NEXUS FORGE para confirmarlo", "PROTECTED_COPY");
  }
  const pool = publishedOfClass(recipe.outputClass);
  const out = pickOutput(pool, pool.length > 0 ? randomInt(0, pool.length) : -1);
  if (!out) { logF73("error", "craft_failed", { scope: "card", error: "empty_output_pool", recipeId }); return fail(409, "No hay cartas disponibles de esa clase", "EMPTY_POOL"); }
  const { data, error } = await sb.rpc("app_craft_card_guarded", {
    p_user: userId, p_recipe: recipeId, p_uids: uids, p_expected: sel.cardIdByUid, p_output_card_id: out.id, p_ref: ref, p_confirm: [],
  });
  if (error) {
    if (isMissingRpc(error)) return fail(503, "El intercambio necesita la migración 0061", "MIGRATION_PENDING");
    const guard = Object.keys(GUARD_RPC_ERRORS).find((k) => (error.message ?? "").includes(k));
    if (guard) { logF73("warn", "craft_rejected", { scope: "card", code: guard }); return fail(GUARD_RPC_ERRORS[guard].status, GUARD_RPC_ERRORS[guard].error, guard); }
    return rpcFail(error, "card");
  }
  const r = data as Omit<CardCraftResult, "repeated"> & { repeated?: boolean };
  if (!r.repeated) {
    logF73("info", "craft_ok", { kind: "card", recipeId });
    await settleMissionsForOp(sb, userId, { kind: "CRAFT_CARD", key: ref, recipeId });
  }
  return done({ recipeId: r.recipeId, inputs: r.inputs, outputs: r.outputs, repeated: !!r.repeated });
}
