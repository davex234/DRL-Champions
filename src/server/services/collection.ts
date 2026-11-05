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
 *   · Sin N+1: favoritos, vitrina y equipos en paralelo y la colección RESUMIDA por carta (una consulta); ninguna por carta.
 *   · Favoritos: solo definiciones del catálogo real, tope 200, idempotente. Sin 0052 aplicada → no disponible.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCard } from "@/data/catalog";
import { isValidCardId, type DeckUsageFact, type OwnedInstanceFact } from "@/domain/collection/room";
import { serverCatalog } from "@/server/catalog";
import { readActive } from "./deckTeams";
import { loadCollectionSummary, readUserCardsByUid } from "./userCards";

export const FAVORITES_MAX = 200;
export const DECKS_MAX = 100;

export interface CollectionResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const done = <T,>(data: T): CollectionResult<T> => ({ ok: true, status: 200, data });
const fail = (status: number, error: string, code?: string): CollectionResult<never> => ({ ok: false, status, error, code });

export interface CollectionPersonalView {
  serverNow: number;
  /** El mejor ejemplar de cada carta + los que están en la vitrina o en un equipo. NO es la colección entera. */
  instances: OwnedInstanceFact[];
  /** Copias por carta (y cuántas numeradas). Exacto para cualquier tamaño. */
  holdings: Record<string, { count: number; numbered: number }>;
  /** Copias totales. */
  total: number;
  /** `null` = no disponible (sin 0052 o error): la interfaz apaga los favoritos, no los inventa. */
  favorites: string[] | null;
  showcase: { uids: string[]; version: number | null } | null;
  decks: DeckUsageFact[] | null;
}

const missingSchema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? ""));

/**
 * COLECCIONES ILIMITADAS · lo que el álbum necesita de la colección, con tamaño acotado por el catálogo:
 *   · `holdings`: por carta, cuántas copias y cuántas numeradas (exacto para cualquier tamaño),
 *   · `instances`: el mejor ejemplar de cada carta, más los que estén en la vitrina o en un equipo (para marcarlos).
 * El resto de copias se piden paginadas por carta (`/api/game/cards?card=`). Antes viajaban TODAS hasta un techo de
 * 20.000 con una marca `truncated` que nadie leía.
 */
async function readCollection(sb: SupabaseClient, userId: string, pinned: readonly string[]): Promise<{ instances: OwnedInstanceFact[]; holdings: Record<string, { count: number; numbered: number }>; total: number }> {
  const summary = await loadCollectionSummary(sb, userId);
  const fact = (i: { uid: string; cardId: string; serial: number | null; mintedVersion: number | null }): OwnedInstanceFact => ({ uid: i.uid, cardId: i.cardId, serial: i.serial, mintedVersion: i.mintedVersion });
  const out = new Map<string, OwnedInstanceFact>();
  const holdings: Record<string, { count: number; numbered: number }> = {};
  for (const c of summary.cards) { out.set(c.rep.uid, fact(c.rep)); holdings[c.cardId] = { count: c.count, numbered: c.numbered }; }
  const extra = [...new Set(pinned)].filter((u) => typeof u === "string" && !out.has(u));
  if (extra.length > 0) for (const i of await readUserCardsByUid(sb, userId, extra)) out.set(i.uid, fact(i));
  return { instances: [...out.values()].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)), holdings, total: summary.total };
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
    const [favorites, showcase, decks] = await Promise.all([
      readFavorites(sb, userId).catch(() => null),
      readShowcase(sb, userId).catch(() => null),
      readDecks(sb, userId).catch(() => null),
    ]);
    const pinned = [...(showcase?.uids ?? []), ...(decks ?? []).flatMap((d) => d.cardUids)];
    const col = await readCollection(sb, userId, pinned);
    return done({ serverNow: opts.now ?? Date.now(), instances: col.instances, holdings: col.holdings, total: col.total, favorites, showcase, decks });
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
