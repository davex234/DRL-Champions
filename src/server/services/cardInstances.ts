/**
 * EJEMPLARES DE LA COLECCIÓN, PAGINADOS POR CURSOR (COLECCIONES ILIMITADAS · SOLO SERVIDOR).
 *
 * El estado de juego ya no lleva la colección entera: lleva un ejemplar por carta y los recuentos. Quien necesita
 * ver COPIAS concretas (la ficha de una carta, la vitrina, vender una repetida) las pide aquí, por páginas.
 *
 * GARANTÍAS
 *   · El usuario sale del token (lo pasa la ruta). Toda consulta filtra `user_id` en la base: ni un filtro ni un
 *     cursor manipulado pueden alcanzar cartas de otra cuenta.
 *   · Paginación por CLAVE, no por desplazamiento: insertar o borrar cartas entre dos páginas no repite ni salta
 *     ninguna de las que ya estaban. Orden total y determinista (`uid`, o serie y después `uid`).
 *   · El cursor es opaco para el cliente, pero NO es un secreto ni una credencial: se valida su forma, su versión y
 *     que corresponde a los mismos filtros con los que se emitió. Un cursor ajeno a la consulta se rechaza (400).
 *   · Tamaño de página acotado (`CARDS_PAGE_MAX`). No hay tope de páginas: se puede recorrer cualquier colección.
 *   · Solo lectura: no escribe nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { isValidCardId } from "@/domain/collection/room";
import { readUserCardsByUid, toInstance, type OwnedInstance } from "./userCards";

export const CARDS_PAGE_DEFAULT = 48;
export const CARDS_PAGE_MAX = 100;
/** Ejemplares que se pueden pedir por `uid` en una llamada. */
export const CARDS_LOOKUP_MAX = 60;

export type CardsSort = "uid" | "serial";

export interface CardsQuery {
  /** Solo copias de esta carta. Obligatoria para `sort: "serial"`. */
  cardId: string | null;
  sort: CardsSort;
  /** `true` solo en venta, `false` solo libres, `null` todas. */
  locked: boolean | null;
  /** Solo copias con número de serie. */
  numbered: boolean;
  limit: number;
  cursor: string | null;
}

export interface CardsPage {
  items: OwnedInstance[];
  /** Cursor de la página siguiente, o `null` si no hay más. */
  nextCursor: string | null;
  hasMore: boolean;
  /** Total de ejemplares que cumplen los filtros. Solo en la primera página (sin cursor); después `null`. */
  total: number | null;
}

export type CardsResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code: string };
const fail = (status: number, error: string, code: string): CardsResult<never> => ({ ok: false, status, error, code });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const COLS = "uid, card_id, serial, origin, locked, obtained_at, minted_version";
type Row = Parameters<typeof toInstance>[0];

/* ───────────────────────────── cursor ───────────────────────────── */

/** Posición dentro del orden: fase numerada (por serie) o fase sin serie / orden por `uid`. */
type Position = { p: "s"; s: number } | { p: "u"; u: string };
interface CursorBody { v: 1; f: string; at: Position }

/** Huella de los filtros: un cursor solo vale para la consulta que lo emitió. */
function filterKey(q: Pick<CardsQuery, "cardId" | "sort" | "locked" | "numbered">): string {
  return createHash("sha256").update(JSON.stringify([q.cardId, q.sort, q.locked, q.numbered])).digest("base64url").slice(0, 16);
}

export function encodeCursor(q: Pick<CardsQuery, "cardId" | "sort" | "locked" | "numbered">, at: Position): string {
  const body: CursorBody = { v: 1, f: filterKey(q), at };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** `null` = cursor no válido para esta consulta. Nunca lanza. */
export function decodeCursor(raw: string, q: Pick<CardsQuery, "cardId" | "sort" | "locked" | "numbered">): Position | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 400 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let body: unknown;
  try { body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.v !== 1 || b.f !== filterKey(q)) return null;
  const at = b.at as Record<string, unknown> | null;
  if (!at || typeof at !== "object") return null;
  if (at.p === "u" && isUuid(at.u) && Object.keys(at).length === 2) return { p: "u", u: (at.u as string).toLowerCase() };
  if (at.p === "s" && q.sort === "serial" && typeof at.s === "number" && Number.isInteger(at.s) && at.s >= 0 && at.s <= 2_147_483_647 && Object.keys(at).length === 2) return { p: "s", s: at.s };
  return null;
}

/* ───────────────────────────── parámetros ───────────────────────────── */

const ALLOWED = new Set(["card", "sort", "locked", "numbered", "limit", "cursor", "uids"]);

/** Valida los parámetros de la URL. Cualquier clave desconocida o valor mal formado → 400 (nunca se ignora en silencio). */
export function parseCardsQuery(params: URLSearchParams): CardsResult<{ kind: "page"; query: CardsQuery } | { kind: "lookup"; uids: string[] }> {
  const keys = [...params.keys()];
  if (keys.some((k) => !ALLOWED.has(k)) || new Set(keys).size !== keys.length) return fail(400, "Parámetro no válido", "BAD_PARAM");

  if (params.has("uids")) {
    if (keys.length !== 1) return fail(400, "Parámetro no válido", "BAD_PARAM");
    const uids = (params.get("uids") ?? "").split(",").filter(Boolean);
    if (uids.length === 0 || uids.length > CARDS_LOOKUP_MAX || !uids.every(isUuid)) return fail(400, "Lista de cartas no válida", "BAD_UIDS");
    return { ok: true, data: { kind: "lookup", uids: [...new Set(uids.map((u) => u.toLowerCase()))] } };
  }

  const card = params.get("card");
  if (card !== null && !isValidCardId(card)) return fail(400, "Carta no válida", "BAD_CARD");
  const sortRaw = params.get("sort") ?? (card ? "serial" : "uid");
  if (sortRaw !== "uid" && sortRaw !== "serial") return fail(400, "Orden no válido", "BAD_SORT");
  if (sortRaw === "serial" && !card) return fail(400, "Ordenar por serie exige una carta", "BAD_SORT");
  const lockedRaw = params.get("locked");
  if (lockedRaw !== null && lockedRaw !== "0" && lockedRaw !== "1") return fail(400, "Filtro no válido", "BAD_FILTER");
  const numberedRaw = params.get("numbered");
  if (numberedRaw !== null && numberedRaw !== "1") return fail(400, "Filtro no válido", "BAD_FILTER");
  const limitRaw = params.get("limit");
  let limit = CARDS_PAGE_DEFAULT;
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) return fail(400, "Tamaño de página no válido", "BAD_LIMIT");
    limit = Number(limitRaw);
    if (limit < 1 || limit > CARDS_PAGE_MAX) return fail(400, "Tamaño de página no válido", "BAD_LIMIT");
  }
  return { ok: true, data: { kind: "page", query: { cardId: card, sort: sortRaw, locked: lockedRaw === null ? null : lockedRaw === "1", numbered: numberedRaw === "1", limit, cursor: params.get("cursor") } } };
}

/* ───────────────────────────── lectura ───────────────────────────── */

/** La consulta base: SIEMPRE acotada al usuario. Los filtros solo restringen dentro de sus cartas. */
function base(sb: SupabaseClient, userId: string, q: CardsQuery, count: boolean) {
  let b = sb.from("user_cards").select(COLS, count ? { count: "exact" } : undefined).eq("user_id", userId);
  if (q.cardId) b = b.eq("card_id", q.cardId);
  if (q.locked !== null) b = b.eq("locked", q.locked);
  return b;
}

/** Una página de ejemplares del usuario. */
export async function listCardInstances(sb: SupabaseClient, userId: string, q: CardsQuery): Promise<CardsResult<CardsPage>> {
  let at: Position | null = null;
  if (q.cursor !== null) {
    at = decodeCursor(q.cursor, q);
    if (!at) return fail(400, "Cursor no válido", "BAD_CURSOR");
  }
  const first = at === null;
  const want = q.limit + 1; // una de más para saber si quedan
  const rows: Row[] = [];
  let total: number | null = null;

  if (q.sort === "uid") {
    let b = base(sb, userId, q, first);
    if (q.numbered) b = b.not("serial", "is", null);
    if (at && at.p === "u") b = b.gt("uid", at.u);
    const { data, error, count } = await b.order("uid", { ascending: true }).limit(want);
    if (error) return fail(500, "No se pudieron leer tus cartas", "UNAVAILABLE");
    rows.push(...((data ?? []) as Row[]));
    if (first) total = count ?? null;
  } else {
    // Orden canónico de las copias de UNA carta: numeradas por serie ascendente; después, sin serie, por `uid`.
    // La serie es única por carta (`user_cards_serial_uniq`), así que basta como clave en la primera fase.
    let numbered = 0, plain = 0;
    if (!at || at.p === "s") {
      let b = base(sb, userId, q, first).not("serial", "is", null);
      if (at && at.p === "s") b = b.gt("serial", at.s);
      const { data, error, count } = await b.order("serial", { ascending: true }).limit(want);
      if (error) return fail(500, "No se pudieron leer tus cartas", "UNAVAILABLE");
      rows.push(...((data ?? []) as Row[]));
      numbered = count ?? 0;
    }
    if (!q.numbered && rows.length < want) {
      let b = base(sb, userId, q, first).is("serial", null);
      if (at && at.p === "u") b = b.gt("uid", at.u);
      const { data, error, count } = await b.order("uid", { ascending: true }).limit(want - rows.length);
      if (error) return fail(500, "No se pudieron leer tus cartas", "UNAVAILABLE");
      rows.push(...((data ?? []) as Row[]));
      plain = count ?? 0;
    } else if (first && !q.numbered) {
      // La primera fase llenó la página: el total necesita igualmente cuántas copias hay sin serie.
      const { count, error } = await base(sb, userId, q, true).is("serial", null).limit(1);
      if (error) return fail(500, "No se pudieron leer tus cartas", "UNAVAILABLE");
      plain = count ?? 0;
    }
    if (first) total = numbered + plain;
  }

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor(q, q.sort === "serial" && last.serial !== null ? { p: "s", s: last.serial } : { p: "u", u: last.uid })
    : null;
  return { ok: true, data: { items: page.map(toInstance), nextCursor, hasMore, total } };
}

/** Ejemplares concretos por `uid`. Los que no son del usuario (o no existen) no vuelven: no se distingue un caso del otro. */
export async function lookupCardInstances(sb: SupabaseClient, userId: string, uids: readonly string[]): Promise<CardsResult<{ items: OwnedInstance[] }>> {
  try {
    const items = await readUserCardsByUid(sb, userId, uids);
    return { ok: true, data: { items: items.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)) } };
  } catch {
    return fail(500, "No se pudieron leer tus cartas", "UNAVAILABLE");
  }
}
