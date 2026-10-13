/**
 * LAS CARTAS DE UN JUGADOR, SIN LÍMITE (SOLO SERVIDOR).
 *
 * Único punto por el que el servidor lee `user_cards` de una cuenta. Tres lecturas, según lo que haga falta:
 *
 *   · `readUserCards`         TODAS las filas, por cursor, completas o error. Para decidir sobre ejemplares concretos
 *                             (desguace, crafteo, forja). Nunca devuelve una colección parcial.
 *   · `loadCollectionSummary` un resumen POR CARTA (cuántas copias, cuántas en venta, el mejor ejemplar, cuándo llegó
 *                             la primera). Su tamaño lo acota el catálogo, no la colección: 50.000 copias de 331
 *                             cartas son 331 líneas. Es lo que necesitan el motor de sobres (qué cartas se tienen),
 *                             las misiones, los logros, el álbum y el constructor de equipos.
 *   · `readUserCardsByUid`    ejemplares concretos por `uid`, troceados. Para resolver un equipo o una vitrina.
 *
 * El resumen se calcula en la base (`app_collection_summary`, migración 0074) en una sola consulta. Si la función
 * todavía no existe (código desplegado antes que la migración) se calcula aquí recorriendo la colección por cursor:
 * mismo resultado, más consultas. El orden de despliegue no puede romper el juego.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunked, IncompleteReadError, keysetAll, keysetEach } from "@/server/db/keyset";

/** Un ejemplar, con todo lo que guarda `user_cards`. */
export interface OwnedInstance {
  uid: string;
  cardId: string;
  serial: number | null;
  mintedVersion: number | null;
  /** ms desde época. */
  obtainedAt: number;
  origin: string;
  locked: boolean;
}

/** Lo que el jugador tiene de UNA carta. */
export interface CardHolding {
  cardId: string;
  /** Copias que posee. */
  count: number;
  /** De ellas, cuántas están bloqueadas (en venta). */
  locked: number;
  /** De ellas, cuántas llevan número de serie. */
  numbered: number;
  /** Cuándo obtuvo la primera copia (ms) o `null` si ninguna tiene fecha. */
  firstObtainedAt: number | null;
  /** El mejor ejemplar: número de serie más bajo; sin serie, `uid` más bajo. El mismo orden que `sortInstances`. */
  rep: OwnedInstance;
}

export interface CollectionSummary {
  /** Copias totales. */
  total: number;
  /** Cartas distintas. */
  distinct: number;
  /** Una línea por carta poseída, ordenadas por `cardId`. */
  cards: CardHolding[];
  /** De dónde salió: la función de la base o el recorrido por cursor. Solo informativo (métricas). */
  via: "rpc" | "scan";
}

const FULL = "uid, card_id, serial, origin, locked, obtained_at, minted_version";
interface FullRow { uid: string; card_id: string; serial: number | null; origin: string; locked: boolean; obtained_at: string | null; minted_version?: number | null }

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function toInstance(r: FullRow): OwnedInstance {
  return { uid: r.uid, cardId: r.card_id, serial: r.serial ?? null, mintedVersion: r.minted_version ?? null, obtainedAt: ms(r.obtained_at) ?? 0, origin: r.origin, locked: !!r.locked };
}

/** ¿`a` es mejor ejemplar que `b`? Serie ascendente (sin serie al final) y después `uid`. */
export function betterInstance(a: { uid: string; serial: number | null }, b: { uid: string; serial: number | null }): boolean {
  const sa = a.serial ?? Infinity, sb = b.serial ?? Infinity;
  return sa !== sb ? sa < sb : a.uid < b.uid;
}

/**
 * TODAS las filas de `user_cards` del jugador con las columnas pedidas. `columns` debe incluir `uid` (es el cursor).
 * Lanza `IncompleteReadError` si alguna página falla.
 */
export async function readUserCards<T extends { uid: string }>(
  sb: SupabaseClient, userId: string, columns: string, opts: { cardIds?: readonly string[] } = {},
): Promise<T[]> {
  if (!/(^|,)\s*uid\s*(,|$)/.test(columns)) throw new Error("readUserCards: las columnas deben incluir uid");
  if (opts.cardIds && opts.cardIds.length === 0) return [];
  const lists = opts.cardIds ? chunked(opts.cardIds, 100) : [null];
  const out: T[] = [];
  for (const ids of lists) {
    const rows = await keysetAll<T>({
      what: "user_cards",
      key: (r) => r.uid,
      page: (after, limit, withCount) => {
        let q = sb.from("user_cards").select(columns, withCount ? { count: "exact" } : undefined).eq("user_id", userId);
        if (ids) q = q.in("card_id", ids as string[]);
        if (after !== null) q = q.gt("uid", after);
        return q.order("uid", { ascending: true }).limit(limit) as unknown as PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null; count?: number | null }>;
      },
    });
    for (const r of rows) out.push(r);
  }
  return out;
}

/**
 * TODOS los ejemplares de UNA carta, de todas las cuentas (administración: «¿a cuánta gente afecta esta edición?»).
 * Por cursor, completo o error. `columns` debe incluir `uid`.
 */
export async function readCardInstances<T extends { uid: string }>(sb: SupabaseClient, cardId: string, columns: string): Promise<T[]> {
  if (!/(^|,)\s*uid\s*(,|$)/.test(columns)) throw new Error("readCardInstances: las columnas deben incluir uid");
  return keysetAll<T>({
    what: "user_cards (por carta)",
    key: (r) => r.uid,
    page: (after, limit, withCount) => {
      let q = sb.from("user_cards").select(columns, withCount ? { count: "exact" } : undefined).eq("card_id", cardId);
      if (after !== null) q = q.gt("uid", after);
      return q.order("uid", { ascending: true }).limit(limit) as unknown as PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null; count?: number | null }>;
    },
  });
}

/** Ejemplares concretos del jugador por `uid`. Los que no son suyos (o no existen) simplemente no vuelven. */
export async function readUserCardsByUid(sb: SupabaseClient, userId: string, uids: readonly string[]): Promise<OwnedInstance[]> {
  const unique = [...new Set(uids)];
  const out: OwnedInstance[] = [];
  for (const part of chunked(unique, 100)) {
    const { data, error } = await sb.from("user_cards").select(FULL).eq("user_id", userId).in("uid", part);
    if (error) throw new IncompleteReadError("user_cards (por uid)", error);
    for (const r of (data ?? []) as FullRow[]) out.push(toInstance(r));
  }
  return out;
}

/** Agrega ejemplares a un resumen. Puro: es el mismo cálculo que hace la función de la base. */
export function summarize(rows: Iterable<OwnedInstance>): Omit<CollectionSummary, "via"> {
  const by = new Map<string, CardHolding>();
  let total = 0;
  for (const r of rows) {
    total++;
    const h = by.get(r.cardId);
    const at = r.obtainedAt > 0 ? r.obtainedAt : null;
    if (!h) { by.set(r.cardId, { cardId: r.cardId, count: 1, locked: r.locked ? 1 : 0, numbered: r.serial !== null ? 1 : 0, firstObtainedAt: at, rep: r }); continue; }
    h.count++;
    if (r.locked) h.locked++;
    if (r.serial !== null) h.numbered++;
    if (at !== null && (h.firstObtainedAt === null || at < h.firstObtainedAt)) h.firstObtainedAt = at;
    if (betterInstance(r, h.rep)) h.rep = r;
  }
  const cards = [...by.values()].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
  return { total, distinct: cards.length, cards };
}

interface RpcSummary {
  total: number; distinct: number;
  cards: { card_id: string; n: number; locked: number; numbered: number; first_at: string | null; rep: { uid: string; serial: number | null; minted_version: number | null; obtained_at: string | null; origin: string; locked: boolean } }[];
}

const rpcMissing = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? ""));

/** Si la función no existe se recuerda un rato: no se paga una llamada fallida en cada petición. */
let rpcMissingUntil = 0;
const RPC_RETRY_MS = 60_000;
/** Solo para tests. */
export function __resetSummaryRpcProbe(): void { rpcMissingUntil = 0; }

async function summaryByScan(sb: SupabaseClient, userId: string): Promise<CollectionSummary> {
  const all: OwnedInstance[] = [];
  await keysetEach<FullRow>({
    what: "user_cards",
    key: (r) => r.uid,
    page: (after, limit, withCount) => {
      let q = sb.from("user_cards").select(FULL, withCount ? { count: "exact" } : undefined).eq("user_id", userId);
      if (after !== null) q = q.gt("uid", after);
      return q.order("uid", { ascending: true }).limit(limit) as unknown as PromiseLike<{ data: FullRow[] | null; error: { message?: string; code?: string } | null; count?: number | null }>;
    },
    onPage: (rows) => { for (const r of rows) all.push(toInstance(r)); },
  });
  return { ...summarize(all), via: "scan" };
}

/** Resumen por carta de la colección del jugador. Completo o error; nunca parcial. */
export async function loadCollectionSummary(sb: SupabaseClient, userId: string, opts: { now?: number } = {}): Promise<CollectionSummary> {
  const now = opts.now ?? Date.now();
  if (now >= rpcMissingUntil) {
    const { data, error } = await sb.rpc("app_collection_summary", { p_user: userId });
    if (!error && data && typeof data === "object") {
      const d = data as RpcSummary;
      const cards: CardHolding[] = (d.cards ?? []).map((c) => ({
        cardId: c.card_id,
        count: Number(c.n),
        locked: Number(c.locked),
        numbered: Number(c.numbered ?? 0),
        firstObtainedAt: ms(c.first_at),
        rep: { uid: c.rep.uid, cardId: c.card_id, serial: c.rep.serial ?? null, mintedVersion: c.rep.minted_version ?? null, obtainedAt: ms(c.rep.obtained_at) ?? 0, origin: c.rep.origin, locked: !!c.rep.locked },
      }));
      return { total: Number(d.total), distinct: Number(d.distinct), cards, via: "rpc" };
    }
    if (error && !rpcMissing(error)) throw new IncompleteReadError("resumen de colección", error);
    rpcMissingUntil = now + RPC_RETRY_MS;
  }
  return summaryByScan(sb, userId);
}

/** Conjunto de cartas distintas que posee el jugador. */
export function ownedCardIdsOf(summary: Pick<CollectionSummary, "cards">): Set<string> {
  return new Set(summary.cards.map((c) => c.cardId));
}

/** Copias por carta. */
export function countsOf(summary: Pick<CollectionSummary, "cards">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of summary.cards) out[c.cardId] = c.count;
  return out;
}
