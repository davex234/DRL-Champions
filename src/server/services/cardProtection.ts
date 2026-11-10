/**
 * F79.1 · CARTA PROTEGIDA en el servidor — UN solo sitio que lee lo que protege una copia (favoritas 0052, vitrina 0049,
 * equipos) para TODAS las operaciones que destruyen copias: desguace, intercambio F73 y forja avanzada.
 *
 * La regla es la de `domain/cards/protection`. Node la comprueba primero (mensaje claro, sin tocar la BD) y la RPC
 * guardada de 0061 (`app_craft_card_guarded` / `app_salvage_cards_guarded`) la vuelve a imponer DENTRO de la
 * transacción, serializada con las altas de favoritas (mismo cerrojo consultivo de 0052) y con los cambios de vitrina
 * (`FOR SHARE` sobre la fila de 0049). Si una tabla no existe (entorno antiguo) cuenta como vacía.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProtectionContext } from "@/domain/cards/protection";

export async function deckUids(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await sb.from("duel_decks").select("card_uids").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { card_uids: string[] | null }[]).flatMap((d) => d.card_uids ?? []).map(String));
}

/** Favoritas (0052, por carta). Sin la tabla → ninguna. */
export async function favoriteCardIds(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await sb.from("user_card_favorites").select("card_id").eq("user_id", userId);
  if (error) return new Set();
  return new Set(((data ?? []) as { card_id: string }[]).map((r) => r.card_id));
}

/** Copias en la vitrina del perfil (0049, por copia). Sin la tabla → ninguna. */
export async function showcaseUids(sb: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await sb.from("player_profile_customization").select("showcase_card_uids").eq("user_id", userId).maybeSingle();
  if (error || !data) return new Set();
  return new Set(((data as { showcase_card_uids: string[] | null }).showcase_card_uids ?? []).map(String));
}

export async function loadProtection(sb: SupabaseClient, userId: string): Promise<ProtectionContext> {
  const [inDeck, favs, show] = await Promise.all([deckUids(sb, userId), favoriteCardIds(sb, userId), showcaseUids(sb, userId)]);
  return { inDeck, favoriteCardIds: favs, showcaseUids: show };
}

/** Errores de las RPC guardadas (0061) que no existían en F73. */
export const GUARD_RPC_ERRORS: Record<string, { status: number; error: string }> = {
  PROTECTED_COPY: { status: 409, error: "Has elegido una carta protegida (favorita o en tu vitrina): confírmalo antes" },
  IN_DECK: { status: 409, error: "Alguna carta está en uno de tus equipos" },
};

/** ¿La RPC guardada aún no existe (0061 sin aplicar)? */
export const isMissingRpc = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|no disponible|does not exist/i.test(e.message ?? ""));
