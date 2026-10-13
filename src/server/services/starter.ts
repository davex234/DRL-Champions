/**
 * FASE 41 · ASISTENCIA DE PRIMER EQUIPO — lado servidor (solo lectura aquí; la concesión va por `app_buy_pack`).
 *
 * Lee los hechos que deciden la política pura (`domain/economy/starter`):
 *   · cartas propias (`user_cards.card_id`) → ¿puede formar plantilla? (`deckReadiness`, catálogo del servidor)
 *   · Sobres Iniciales sin abrir (`user_packs`)
 *   · Sobres Iniciales gratis ya concedidos (asientos `buy_pack:inicial` del libro mayor, históricos incluidos)
 *
 * Ninguna función de este módulo escribe. El cliente no aporta ningún hecho.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import type { ReadinessCard } from "@/domain/journey";
import { deckReadiness } from "@/domain/journey";
import {
  STARTER_POLICY, starterEligibility, starterAssistFor, type StarterEligibility,
} from "@/domain/economy/starter";
import type { StarterAssist } from "@/domain/packs/openPack";

export interface StarterStatus extends StarterEligibility {
  deckReady: boolean;
  unopenedStarter: number;
  freeClaims: number;
  maxFreeClaims: number;
  /** Roles que faltan (texto además de color en la interfaz). */
  missingRoles: { role: string; have: number; need: number }[];
}

export async function readinessResolver(sb: SupabaseClient): Promise<(cardId: string) => ReadinessCard | null> {
  const reg = (await serverCatalog(sb)).registry;
  return (id) => {
    const c = reg.card(id);
    const p = c ? reg.player(c.playerId) : undefined;
    return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
  };
}

/** Asientos de Sobre Inicial gratis ya concedidos (incluye los de antes de la Fase 41: el tope es histórico). */
export const STARTER_LEDGER_REASON = `buy_pack:${STARTER_POLICY.packId}`;

export async function readStarterStatus(sb: SupabaseClient, userId: string): Promise<StarterStatus> {
  const [cardsRes, packRes, claimsRes, resolve] = await Promise.all([
    sb.from("user_cards").select("card_id").eq("user_id", userId),
    sb.from("user_packs").select("qty").eq("user_id", userId).eq("pack_id", STARTER_POLICY.packId).maybeSingle(),
    sb.from("credit_transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("reason", STARTER_LEDGER_REASON),
    readinessResolver(sb),
  ]);
  if (cardsRes.error) throw new Error(cardsRes.error.message);
  if (claimsRes.error) throw new Error(claimsRes.error.message);
  const ids = ((cardsRes.data ?? []) as { card_id: string }[]).map((r) => r.card_id);
  const r = deckReadiness(ids, resolve);
  const unopenedStarter = Math.max(0, Number((packRes.data as { qty: number } | null)?.qty ?? 0));
  const freeClaims = claimsRes.count ?? 0;
  return {
    ...starterEligibility({ deckReady: r.ready, unopenedStarter, freeClaims }),
    deckReady: r.ready, unopenedStarter, freeClaims, maxFreeClaims: STARTER_POLICY.maxFreeClaims,
    missingRoles: r.shortages.map((s) => ({ role: s.role, have: s.have, need: s.need })),
  };
}

/** Asistencia para la apertura de un sobre con las cartas YA leídas por la apertura (sin lecturas extra de usuario). */
export async function assistForOpen(sb: SupabaseClient, packId: string, ownedCardIds: readonly string[]): Promise<StarterAssist | null> {
  if (packId !== STARTER_POLICY.packId) return null;
  return starterAssistFor(packId, ownedCardIds, await readinessResolver(sb));
}
