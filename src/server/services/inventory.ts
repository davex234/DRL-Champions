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
  ownedCards: OwnedCard[];
  origins: Record<string, CardOrigin>;
  lockedUids: string[];
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

/** Carga TODO el estado de juego del usuario en una sola pasada. */
export async function loadGameState(sb: SupabaseClient, userId: string): Promise<ServerGameState> {
  const [profileRes, cardsRes, packsRes, gameRes, mintsRes] = await Promise.all([
    sb.from("profiles").select("credits, xp").eq("id", userId).maybeSingle(),
    sb.from("user_cards").select("uid, card_id, serial, origin, locked, obtained_at, minted_version").eq("user_id", userId),
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

  const rows = (cardsRes.data as UserCardRow[]) ?? [];
  const origins: Record<string, CardOrigin> = {};
  const lockedUids: string[] = [];
  for (const r of rows) {
    origins[r.uid] = r.origin as CardOrigin;
    if (r.locked) lockedUids.push(r.uid);
  }

  const unopenedPacks: Record<string, number> = {};
  for (const p of (packsRes.data as { pack_id: string; qty: number }[]) ?? []) {
    if (p.qty > 0) unopenedPacks[p.pack_id] = p.qty;
  }

  const mintCounts: Record<string, number> = {};
  for (const m of mintsRes ?? []) {
    mintCounts[m.card_id] = m.minted;
  }

  const profile = profileRes.data as { credits: number; xp: number } | null;
  const game = gameRes.data as { pity: unknown; packs_opened: number } | null;

  return {
    credits: Number(profile?.credits ?? 0),
    xp: Number(profile?.xp ?? 0),
    ownedCards: rows.map(toOwnedCard),
    origins,
    lockedUids,
    unopenedPacks,
    pity: migratePity(game?.pity),
    packsOpened: game?.packs_opened ?? 0,
    mintCounts,
  };
}
