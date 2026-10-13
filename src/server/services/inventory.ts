/**
 * INVENTARIO SERVER-AUTHORITATIVE (SOLO SERVIDOR).
 *
 * Lee el estado de juego real del usuario desde las tablas de 0011 y lo proyecta a
 * las MISMAS formas que ya consume el dominio (`OwnedCard[]`, `PityState`,
 * `mintCounts`), para poder alimentar `PackEngine` sin tocarlo.
 *
 * Regla: aquí solo se LEE. Toda mutación pasa por las RPC `app_*`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnedCard } from "@/domain/cards/types";
import type { CardOrigin } from "@/collection";
import { migratePity, type PityState } from "@/domain/packs/pity";
import { pageAll } from "@/server/db/pageAll";
import { IncompleteReadError } from "@/server/db/keyset";
import { loadCollectionSummary, type CollectionSummary } from "./userCards";

export interface UserCardRow {
  uid: string;
  card_id: string;
  serial: number | null;
  origin: string;
  locked: boolean;
  obtained_at: string;
  /** Bloque 8.2 — versión de la definición bajo la que se acuñó. La estampa un trigger. */
  minted_version?: number | null;
}

/** Estado de juego del usuario, tal y como lo necesita el motor de sobres. */
export interface ServerGameState {
  credits: number;
  xp: number;
  /**
   * COLECCIONES ILIMITADAS · UN ejemplar por carta poseída (el mejor: serie más baja), no la colección entera. Su
   * tamaño lo acota el catálogo. Basta para todo lo que pregunta «¿qué cartas tiene?» (antiduplicados y novedad del
   * motor de sobres, álbum, logros). Las copias se cuentan en `ownedCounts`; los ejemplares concretos se piden
   * paginados (`/api/game/cards`) o por `uid`.
   */
  ownedCards: OwnedCard[];
  /** Copias por carta. Exacto para cualquier tamaño de colección. */
  ownedCounts: Record<string, number>;
  /** Copias totales. */
  ownedTotal: number;
  /** Procedencia de los ejemplares de `ownedCards`. */
  origins: Record<string, CardOrigin>;
  /** Ejemplares de `ownedCards` que están en venta. */
  lockedUids: string[];
  /** Copias en venta por carta (solo las cartas que tienen alguna). */
  lockedCounts: Record<string, number>;
  unopenedPacks: Record<string, number>;
  pity: PityState;
  packsOpened: number;
  /** Acuñación GLOBAL por carta (seriales con significado en toda la plataforma). */
  mintCounts: Record<string, number>;
}

/** Convierte una fila de `user_cards` a la forma de dominio `OwnedCard`. */
export function toOwnedCard(r: UserCardRow): OwnedCard {
  return {
    uid: r.uid,
    cardId: r.card_id,
    serial: r.serial ?? undefined,
    obtainedAt: new Date(r.obtained_at).getTime(),
    mintedVersion: r.minted_version ?? null,
  };
}

/**
 * Carga el estado de juego del usuario.
 *
 * La colección llega RESUMIDA por carta (`loadCollectionSummary`): completa para cualquier tamaño o error. Antes se
 * leía `user_cards` de una vez y PostgREST la cortaba en 1.000 filas sin avisar; además un error de lectura parecía
 * un inventario vacío. Ahora un fallo LANZA: ni la pantalla ni el motor de sobres trabajan con una colección parcial.
 */
export async function loadGameState(sb: SupabaseClient, userId: string): Promise<ServerGameState> {
  const [profileRes, summary, packsRes, gameRes, mintsRes] = await Promise.all([
    sb.from("profiles").select("credits, xp").eq("id", userId).maybeSingle(),
    loadCollectionSummary(sb, userId),
    sb.from("user_packs").select("pack_id, qty").eq("user_id", userId),
    sb.from("user_game").select("pity, packs_opened").eq("user_id", userId).maybeSingle(),
    /*
     * `card_mints` se lee PAGINADO (bloque 8.4.4). Es la tabla de la que sale el número de
     * serie: el acuñador toma `mintCounts[cardId]` y asigna el siguiente. Si PostgREST cortara
     * la lectura en su `max_rows`, las cartas que quedaran fuera parecerían tener 0 acuñadas y
     * volverían a emitir el #1 de una serie ya repartida — un daño silencioso y permanente.
     *
     * Hoy no puede pasar: hay una fila por carta y el catálogo tiene 773. Pero el catálogo es
     * administrable desde 8.4.2 y puede crecer; la lectura no debe depender de eso.
     */
    pageAll<{ card_id: string; minted: number }>((desde, hasta) => sb.from("card_mints")
      .select("card_id, minted").order("card_id").range(desde, hasta)),
  ]);

  if (profileRes.error) throw new IncompleteReadError("profiles", profileRes.error);
  if (packsRes.error) throw new IncompleteReadError("user_packs", packsRes.error);
  if (gameRes.error) throw new IncompleteReadError("user_game", gameRes.error);
  // Sin el contador de acuñación el motor asignaría el #1 de una serie ya repartida: se falla antes.
  if (mintsRes === null) throw new IncompleteReadError("card_mints");

  const { ownedCards, ownedCounts, origins, lockedUids, lockedCounts } = projectSummary(summary);

  const unopenedPacks: Record<string, number> = {};
  for (const p of (packsRes.data as { pack_id: string; qty: number }[]) ?? []) {
    if (p.qty > 0) unopenedPacks[p.pack_id] = p.qty;
  }

  const mintCounts: Record<string, number> = {};
  for (const m of mintsRes) {
    mintCounts[m.card_id] = m.minted;
  }

  const profile = profileRes.data as { credits: number; xp: number } | null;
  const game = gameRes.data as { pity: unknown; packs_opened: number } | null;

  return {
    credits: Number(profile?.credits ?? 0),
    xp: Number(profile?.xp ?? 0),
    ownedCards,
    ownedCounts,
    ownedTotal: summary.total,
    origins,
    lockedUids,
    lockedCounts,
    unopenedPacks,
    pity: migratePity(game?.pity),
    packsOpened: game?.packs_opened ?? 0,
    mintCounts,
  };
}

/** Proyecta el resumen por carta a las formas que consumen el dominio y el cliente. Puro. */
export function projectSummary(summary: Pick<CollectionSummary, "cards">): Pick<ServerGameState, "ownedCards" | "ownedCounts" | "origins" | "lockedUids" | "lockedCounts"> {
  const ownedCards: OwnedCard[] = [];
  const ownedCounts: Record<string, number> = {};
  const origins: Record<string, CardOrigin> = {};
  const lockedUids: string[] = [];
  const lockedCounts: Record<string, number> = {};
  for (const c of summary.cards) {
    ownedCards.push({ uid: c.rep.uid, cardId: c.cardId, serial: c.rep.serial ?? undefined, obtainedAt: c.rep.obtainedAt, mintedVersion: c.rep.mintedVersion });
    ownedCounts[c.cardId] = c.count;
    origins[c.rep.uid] = c.rep.origin as CardOrigin;
    if (c.rep.locked) lockedUids.push(c.rep.uid);
    if (c.locked > 0) lockedCounts[c.cardId] = c.locked;
  }
  return { ownedCards, ownedCounts, origins, lockedUids, lockedCounts };
}
