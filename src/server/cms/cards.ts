/**
 * F60 · CARTAS DEL PANEL (SOLO SERVIDOR) — asistente de alta, vista previa exacta, publicación, retiro y borrado.
 *
 * Reutiliza la tubería de cartas que ya existía (0040–0043): derivación del trío en el dominio, `content_cards` con
 * versiones inmutables, ciclo de vida `app_content_set_lifecycle`, ancla de mercado. Lo nuevo es la PRESENTACIÓN
 * impresa (0057) y que el alta es ATÓMICA (definición + presentación en una transacción).
 *
 * Nada de lo que se crea aquí entra en el juego hasta publicarlo: el catálogo servido sólo carga PUBLISHED/RETIRED y
 * el sorteo sólo PUBLISHED; un borrador tampoco puede entrar en un pool ACTIVO (0039/0042).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "@/server/admin/http";
import { listAudit, type AuditRow } from "@/server/admin/audit";
import { resolveAssets, type CmsAsset } from "./assets";
import { playerCombatBase, CATALOG_GENERATED_AT } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";
import { cardChecksum, fromCardRow, fromPlayerRow, storagePublicUrl, type CardPresentation, type ContentCardRow, type ContentPlayerRow } from "@/server/catalog/rows";
import { deriveDefinition, validateCombat } from "@/server/services/cardDerivation";
import { serverCatalog, resetServerCatalog } from "@/server/catalog";
import { validateCardDraft, cardIdOf, economicClass, cardPublishChecklist, PRINTED_KEYS } from "@/domain/cms/cards";
import type { CardDef, PrintedStats, RoleId, VariantId } from "@/domain/cards/types";
import type { CombatStats } from "@/domain/cards/combat";

interface CardInputBody {
  playerId?: unknown; variantId?: unknown; role?: unknown; ovr?: unknown; stats?: unknown; team?: unknown; imageAssetId?: unknown;
  editorial?: unknown; reason?: unknown;
}

function readPresentation(b: CardInputBody, art: CmsAsset | null): { errors: Record<string, string>; pres: CardPresentation | null } {
  const stats = (b.stats && typeof b.stats === "object" ? b.stats : {}) as Record<string, unknown>;
  const input = {
    playerId: typeof b.playerId === "string" ? b.playerId : undefined,
    variantId: typeof b.variantId === "string" ? b.variantId : undefined,
    role: typeof b.role === "string" ? b.role : undefined,
    ovr: typeof b.ovr === "number" ? b.ovr : undefined,
    stats: Object.fromEntries(PRINTED_KEYS.map((k) => [k, typeof stats[k] === "number" ? stats[k] as number : NaN])),
    team: typeof b.team === "string" ? b.team : undefined,
    imageAssetId: typeof b.imageAssetId === "string" ? b.imageAssetId : null,
  };
  const errors = validateCardDraft(input, { requireArt: true }) as Record<string, string>;
  if (input.imageAssetId && (!art || art.kind !== "card_artwork" || art.status !== "approved")) errors.imageAssetId = "El arte no existe o no es un arte de carta aprobado";
  if (Object.keys(errors).length) return { errors, pres: null };
  const storagePath = (art as CmsAsset & { storagePath?: string }).storagePath;
  return {
    errors,
    pres: {
      role: input.role as RoleId, team: input.team!.trim(),
      printed: { ovr: input.ovr!, stats: input.stats as unknown as PrintedStats },
      imageAssetId: art!.id, imagePath: storagePath,
    },
  };
}

async function assetWithPath(sb: SupabaseClient, id: unknown): Promise<(CmsAsset & { storagePath: string }) | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await sb.from("assets").select("storage_path").eq("id", id).maybeSingle();
  const a = (await resolveAssets(sb, [id])).get(id);
  const path = (data as { storage_path: string | null } | null)?.storage_path;
  return a && path ? { ...a, storagePath: path } : null;
}

/** Datos del asistente: jugadores (con su estado de derivación), ediciones diseñadas y roles. */
export async function cardWizardOptions(sb: SupabaseClient, q?: string): Promise<AdminResult<unknown>> {
  if (q && !/^[\w .-]{1,40}$/.test(q)) return fail(400, "Búsqueda inválida");
  let query = sb.from("content_players").select("*").order("nick").limit(40);
  if (q?.trim()) query = query.ilike("nick", `%${q.trim()}%`);
  const { data, error } = await query;
  if (error) return fail(500, "No se pudieron leer los jugadores");
  const rows = (data ?? []) as ContentPlayerRow[];
  const { data: existing } = await sb.from("content_cards").select("card_id, player_id").in("player_id", rows.map((r) => r.id));
  const byPlayer = new Map<string, string[]>();
  for (const e of (existing ?? []) as { card_id: string; player_id: string }[]) byPlayer.set(e.player_id, [...(byPlayer.get(e.player_id) ?? []), e.card_id]);
  return ok({
    players: rows.map((r) => {
      const p = fromPlayerRow(r); const base = playerCombatBase(p);
      return { id: p.id, nick: p.nick, team: p.team, region: p.region, role: p.role, status: r.status, derivable: base.ok, existing: byPlayer.get(p.id) ?? [] };
    }),
  });
}

/** Construye la definición (servidor) con el OVR IMPRESO y el trío derivado del jugador (o editorial si no deriva). */
async function buildDefinition(sb: SupabaseClient, b: CardInputBody, pres: CardPresentation): Promise<AdminResult<{ row: Record<string, unknown>; card: CardDef; source: string }>> {
  const { data: pRow } = await sb.from("content_players").select("*").eq("id", String(b.playerId)).maybeSingle();
  if (!pRow) return fail(404, "Jugador inexistente");
  const player = fromPlayerRow(pRow as ContentPlayerRow);
  const variant = getVariant(String(b.variantId) as VariantId);
  const base = playerCombatBase(player);
  let combat: CombatStats; let source: "vlr" | "editorial";
  if (base.ok) { combat = base.combat; source = base.source as "vlr" | "editorial"; }
  else {
    const ed = b.editorial as { combat?: unknown; reason?: unknown } | undefined;
    if (!ed || typeof ed.reason !== "string" || ed.reason.trim().length < 8) return fail(400, `${player.nick} no tiene métricas: hace falta el trío de combate editorial con su justificación`);
    const v = validateCombat(ed.combat);
    if (!v.ok) return fail(400, `Trío editorial no válido: ${v.error}`);
    combat = v.combat; source = "editorial";
  }
  const derived = deriveDefinition({ player, variant, baseCombat: combat, source, generatedAt: CATALOG_GENERATED_AT });
  // LA CARTA ES EL ASSET: el OVR de juego es el IMPRESO (como en las 331). La huella describe lo que se guarda.
  const card: CardDef = { ...derived.card, ovr: pres.printed.ovr };
  return ok({ row: { ...derived.row, ovr: pres.printed.ovr, checksum: cardChecksum(card) }, card: withPres(card, pres), source });
}

const withPres = (card: CardDef, pres: CardPresentation): CardDef => ({
  ...card, printed: { ovr: pres.printed.ovr, role: pres.role, stats: { ...pres.printed.stats } }, role: pres.role, team: pres.team,
  ...(storagePublicUrl(pres.imagePath) ? { image: storagePublicUrl(pres.imagePath)! } : {}),
});

/** VISTA PREVIA EXACTA (no escribe): el `CardDef` que pintará `CardArt`, su clase económica y el impacto en pools. */
export async function previewCmsCard(sb: SupabaseClient, b: CardInputBody): Promise<AdminResult<unknown>> {
  const art = await assetWithPath(sb, b.imageAssetId);
  const { errors, pres } = readPresentation(b, art);
  if (!pres) return ok({ valid: false, errors, card: null });
  const def = await buildDefinition(sb, b, pres);
  if (!def.ok) return ok({ valid: false, errors: { playerId: def.error }, card: null });
  const cardId = cardIdOf(String(b.playerId), String(b.variantId));
  const { count } = await sb.from("content_cards").select("card_id", { count: "exact", head: true }).eq("card_id", cardId);
  const dup = (count ?? 0) > 0;
  return ok({
    valid: !dup, errors: dup ? { variantId: `Ya existe ${cardId}` } : {}, card: def.data.card, economy: economicClass(def.data.card),
    pools: { explicit: 0, note: "Una carta nueva no entra en ningún sobre hasta que se añade a un pool (y se publica)." },
  });
}

export async function createCmsCard(sb: SupabaseClient, actor: string, b: CardInputBody): Promise<AdminResult<unknown>> {
  if (typeof b.reason !== "string" || b.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  const art = await assetWithPath(sb, b.imageAssetId);
  const { errors, pres } = readPresentation(b, art);
  if (!pres) return fail(400, Object.values(errors)[0]);
  const def = await buildDefinition(sb, b, pres);
  if (!def.ok) return def;
  const { data, error } = await sb.rpc("app_admin_card_create_draft", { p_actor: actor, p_def: def.data.row, p_presentation: pres, p_reason: b.reason.slice(0, 300) });
  if (error) return /ya existe/i.test(error.message) ? fail(409, "Esa carta ya existe") : rpcFailure(error.message);
  return ok(data);
}

export async function updateCmsCardPresentation(sb: SupabaseClient, actor: string, b: CardInputBody & { cardId?: unknown; expectedRev?: unknown }): Promise<AdminResult<unknown>> {
  const art = await assetWithPath(sb, b.imageAssetId);
  const { errors, pres } = readPresentation(b, art);
  if (!pres) return fail(400, Object.values(errors)[0]);
  const { data, error } = await sb.rpc("app_admin_card_set_presentation", {
    p_actor: actor, p_card_id: String(b.cardId ?? ""), p_presentation: pres, p_expected_rev: Number(b.expectedRev), p_reason: typeof b.reason === "string" ? b.reason.slice(0, 300) : "edición",
  });
  if (error) return rpcFailure(error.message);
  return ok(data);
}

export interface CmsCardDetail {
  cardId: string; lifecycle: string; origin: string; presentationRev: number; definitionVersion: number;
  presentation: CardPresentation | null; card: CardDef | null; economy: ReturnType<typeof economicClass> | null;
  art: CmsAsset | null; references: Record<string, number>; checklist: { key: string; label: string; ok: boolean }[]; history: AuditRow[];
}

export async function cmsCardDetail(sb: SupabaseClient, cardId: string): Promise<AdminResult<CmsCardDetail>> {
  if (!/^[a-z0-9_-]{1,40}__[a-z0-9-]{1,40}$/.test(cardId)) return fail(400, "Id inválido");
  const { data } = await sb.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  const r = data as (ContentCardRow & { presentation_rev?: number }) | null;
  if (!r) return fail(404, "Carta no encontrada");
  const pres = r.presentation ?? null;
  const [assets, refs, hist] = await Promise.all([
    resolveAssets(sb, [pres?.imageAssetId]), sb.rpc("app_admin_card_references", { p_id: cardId }),
    listAudit(sb, { entityType: "card", entityId: cardId, pageSize: 20 }),
  ]);
  if (refs.error) return rpcFailure(refs.error.message);
  const art = pres?.imageAssetId ? assets.get(pres.imageAssetId) ?? null : null;
  const card = fromCardRow(r);
  return ok({
    cardId, lifecycle: r.lifecycle, origin: r.origin, presentationRev: r.presentation_rev ?? 0, definitionVersion: r.definition_version,
    presentation: pres, card, economy: economicClass(card), art, references: refs.data as Record<string, number>,
    checklist: r.origin === "admin" ? cardPublishChecklist(r as unknown as Parameters<typeof cardPublishChecklist>[0], !!art && art.status === "approved") : [],
    history: hist.ok ? hist.data.rows : [],
  });
}

/** Publicar una carta del panel: puerta (presentación completa + arte), ciclo de vida existente y ancla de mercado. */
export async function publishCmsCard(sb: SupabaseClient, actor: string, b: { cardId?: unknown; reason?: unknown; confirm?: unknown; expectedRev?: unknown }): Promise<AdminResult<unknown>> {
  const cardId = String(b.cardId ?? "");
  if (typeof b.reason !== "string" || b.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (b.confirm !== cardId) return fail(400, "Escribe el id de la carta para confirmar la publicación");
  const d = await cmsCardDetail(sb, cardId);
  if (!d.ok) return d;
  if (d.data.origin !== "admin") return fail(409, "Las cartas del catálogo diseñado se publican con su propio flujo");
  if (d.data.presentationRev !== Number(b.expectedRev)) return fail(409, "Este contenido ha cambiado desde que lo abriste. Recarga y revisa antes de guardar.");
  const missing = d.data.checklist.filter((c) => !c.ok);
  if (missing.length) return fail(409, `Falta: ${missing.map((c) => c.label).join(", ")}`);
  const { data, error } = await sb.rpc("app_content_set_lifecycle", { p_card_id: cardId, p_state: "PUBLISHED", p_reason: b.reason.slice(0, 300), p_actor: actor });
  if (error) return /CONTENT_INCOMPLETE/.test(error.message) ? rpcFailure(error.message) : fail(409, "No se pudo publicar (transición no permitida)");
  resetServerCatalog();
  // Ancla del mercado con la MISMA función que usa el mercado (como el flujo existente de publicación).
  try {
    const cat = await serverCatalog(sb);
    const def = cat.card(cardId);
    if (def) {
      const player = cat.player(def.playerId);
      await sb.from("card_reference").upsert({
        card_id: def.id, player_id: def.playerId, nick: player?.nick ?? null, team: def.team ?? player?.team ?? null,
        region: player?.region ?? null, rank: getVariant(def.variantId).rank, ovr: def.ovr, fair_value: marketValue(def), updated_at: new Date().toISOString(),
      }, { onConflict: "card_id" });
    }
  } catch { /* se corrige en la siguiente publicación o con sync-reference */ }
  return ok(data);
}

/** RETIRAR (cualquier carta publicada): deja de salir en sobres; quien la tiene la conserva y se sigue pintando. */
export async function retireCard(sb: SupabaseClient, actor: string, b: { cardId?: unknown; reason?: unknown; confirm?: unknown }): Promise<AdminResult<unknown>> {
  const cardId = String(b.cardId ?? "");
  if (typeof b.reason !== "string" || b.reason.trim().length < 8) return fail(400, "El motivo es obligatorio (8 caracteres o más)");
  if (b.confirm !== cardId) return fail(400, "Escribe el id de la carta para confirmar");
  const { data, error } = await sb.rpc("app_content_set_lifecycle", { p_card_id: cardId, p_state: "RETIRED", p_reason: b.reason.slice(0, 300), p_actor: actor });
  if (error) return fail(409, "No se pudo retirar (sólo se retira una carta publicada)");
  resetServerCatalog();
  return ok(data);
}

export async function deleteCmsCardDraft(sb: SupabaseClient, actor: string, b: { cardId?: unknown; reason?: unknown; confirm?: unknown; expectedRev?: unknown }): Promise<AdminResult<unknown>> {
  const cardId = String(b.cardId ?? "");
  if (typeof b.reason !== "string" || b.reason.trim().length < 4) return fail(400, "El motivo es obligatorio");
  if (b.confirm !== cardId) return fail(400, "Escribe el id de la carta para confirmar");
  const { data, error } = await sb.rpc("app_admin_card_delete_draft", { p_actor: actor, p_card_id: cardId, p_expected_rev: Number(b.expectedRev), p_reason: b.reason.slice(0, 300) });
  if (error) return rpcFailure(error.message);
  resetServerCatalog();
  return ok(data);
}
