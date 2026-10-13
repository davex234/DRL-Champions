/**
 * COLLECTION ROOM — SERVICIO (Fase 37, SOLO SERVIDOR).
 *
 * Lo PERSONAL de la colección en una sola lectura acotada: instancias propias (uid, carta, serial, versión), favoritos,
 * vitrina (uids + versión) y equipos (para «usada en N equipos» / «en tu equipo activo»). Las DEFINICIONES son el
 * catálogo público y no viajan aquí.
 *
 * GARANTÍAS
 *   · El usuario sale del token (lo pasa la ruta); nunca de un parámetro.
 *   · Leer no escribe nada: ni rating, ni misiones, ni campaña, ni equipo activo, ni vitrina, ni favoritos, ni sobres.
 *   · Aislamiento: favoritos, vitrina o equipos caídos → `null` (su bloque se apaga); solo las instancias son esenciales.
 *   · Sin N+1: cuatro consultas en paralelo (las instancias paginadas por rango), ninguna por carta.
 *   · Favoritos: solo definiciones del catálogo real, tope 200, idempotente. Sin 0052 aplicada → no disponible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCard } from "@/data/catalog";
import { isValidCardId, type DeckUsageFact, type OwnedInstanceFact } from "@/domain/collection/room";
import { serverCatalog } from "@/server/catalog";
import { readActive } from "./deckTeams";

export const COLLECTION_MAX_INSTANCES = 20_000;
const PAGE = 1000;
export const FAVORITES_MAX = 200;
export const DECKS_MAX = 100;

export interface CollectionResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const done = <T,>(data: T): CollectionResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string, code?: string): CollectionResult<never> => ({ ok: false, status, error, code });

export interface CollectionPersonalView {
  serverNow: number;
  instances: OwnedInstanceFact[];
  /** `null` = no disponible (sin 0052 o error): la interfaz apaga los favoritos, no los inventa. */
  favorites: string[] | null;
  showcase: { uids: string[]; version: number | null } | null;
  decks: DeckUsageFact[] | null;
  truncated: boolean;
}

const missingSchema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? ""));

async function readInstances(sb: SupabaseClient, userId: string): Promise<{ rows: OwnedInstanceFact[]; truncated: boolean }> {
  const rows: OwnedInstanceFact[] = [];
  for (let from = 0; from < COLLECTION_MAX_INSTANCES; from += PAGE) {
    const { data, error } = await sb.from("user_cards").select("uid, card_id, serial, minted_version")
      .eq("user_id", userId).order("uid", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as { uid: string; card_id: string; serial: number | null; minted_version: number | null }[];
    for (const r of page) rows.push({ uid: r.uid, cardId: r.card_id, serial: r.serial ?? null, mintedVersion: r.minted_version ?? null });
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function readFavorites(sb: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await sb.from("user_card_favorites").select("card_id").eq("user_id", userId).order("created_at", { ascending: false }).limit(FAVORITES_MAX);
  if (error) return null;
  return ((data ?? []) as { card_id: string }[]).map((r) => r.card_id).filter(isValidCardId);
}

async function readShowcase(sb: SupabaseClient, userId: string): Promise<CollectionPersonalView["showcase"]> {
  const { data, error } = await sb.from("player_profile_customization").select("showcase_card_uids, version").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const row = data as { showcase_card_uids: string[] | null; version: number } | null;
  return { uids: row?.showcase_card_uids ?? [], version: row ? row.version : null };
}

async function readDecks(sb: SupabaseClient, userId: string): Promise<DeckUsageFact[] | null> {
  const [decks, active] = await Promise.all([
    sb.from("duel_decks").select("id, name, card_uids").eq("user_id", userId).order("updated_at", { ascending: false }).limit(DECKS_MAX),
    readActive(sb, userId).catch(() => ({ supported: false, deckId: null as string | null })),
  ]);
  if (decks.error) return null;
  return ((decks.data ?? []) as { id: string; name: string; card_uids: string[] | null }[])
    .map((d) => ({ id: d.id, name: d.name, active: d.id === active.deckId, cardUids: d.card_uids ?? [] }));
}

export async function getCollectionPersonal(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<CollectionResult<CollectionPersonalView>> {
  try {
    const [instances, favorites, showcase, decks] = await Promise.all([
      readInstances(sb, userId),
      readFavorites(sb, userId).catch(() => null),
      readShowcase(sb, userId).catch(() => null),
      readDecks(sb, userId).catch(() => null),
    ]);
    return done({ serverNow: opts.now ?? Date.now(), instances: instances.rows, favorites, showcase, decks, truncated: instances.truncated });
  } catch (e) {
    console.error("[collection]", e instanceof Error ? e.message : "error");
    return fail(500, "No se pudo leer tu colección", "UNAVAILABLE");
  }
}

/** Marca o desmarca una DEFINICIÓN del catálogo como favorita. Idempotente. */
export async function setFavorite(sb: SupabaseClient, userId: string, cardId: unknown, favorite: unknown): Promise<CollectionResult<{ cardId: string; favorite: boolean }>> {
  if (!isValidCardId(cardId)) return fail(400, "Carta no válida", "INVALID_CARD");
  if (typeof favorite !== "boolean") return fail(400, "Valor no válido", "BAD_BODY");
  try {
    await serverCatalog(sb);
    if (!getCard(cardId)) return fail(404, "Esa carta no existe", "UNKNOWN_CARD");
    if (favorite) {
      const { count, error: countError } = await sb.from("user_card_favorites").select("card_id", { count: "exact", head: true }).eq("user_id", userId);
      if (countError) return missingSchema(countError) ? fail(503, "Los favoritos no están disponibles todavía", "FAVORITES_UNAVAILABLE") : fail(500, "No se pudo guardar", "UNAVAILABLE");
      const { data: already } = await sb.from("user_card_favorites").select("card_id").eq("user_id", userId).eq("card_id", cardId).maybeSingle();
      if (already) return done({ cardId, favorite: true });
      if ((count ?? 0) >= FAVORITES_MAX) return fail(409, `Como mucho ${FAVORITES_MAX} favoritas`, "FAVORITES_LIMIT");
      const { error } = await sb.from("user_card_favorites").insert({ user_id: userId, card_id: cardId });
      if (error) {
        if (error.code === "23505") return done({ cardId, favorite: true });
        if (missingSchema(error)) return fail(503, "Los favoritos no están disponibles todavía", "FAVORITES_UNAVAILABLE");
        if (/FAVORITES_LIMIT/.test(error.message ?? "")) return fail(409, `Como mucho ${FAVORITES_MAX} favoritas`, "FAVORITES_LIMIT");
        return fail(500, "No se pudo guardar", "UNAVAILABLE");
      }
      return done({ cardId, favorite: true });
    }
    const { error } = await sb.from("user_card_favorites").delete().eq("user_id", userId).eq("card_id", cardId);
    if (error) return missingSchema(error) ? fail(503, "Los favoritos no están disponibles todavía", "FAVORITES_UNAVAILABLE") : fail(500, "No se pudo guardar", "UNAVAILABLE");
    return done({ cardId, favorite: false });
  } catch (e) {
    console.error("[collection:favorite]", e instanceof Error ? e.message : "error");
    return fail(500, "No se pudo guardar", "UNAVAILABLE");
  }
}
