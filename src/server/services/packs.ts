/**
 * SOBRES SERVER-AUTHORITATIVE (SOLO SERVIDOR) — bloque D.
 *
 * El SORTEO no se reimplementa aquí. Se ejecuta el MISMO motor que ya existía
 * (`PackEngine` → `openPack()` → `Minter`), ahora en Node, alimentado con el estado
 * REAL del servidor en vez de con `localStorage`. Este módulo solo orquesta:
 *
 *   leer estado → decidir con el motor → persistir atómicamente → devolver
 *
 * Dos propiedades que antes no se cumplían:
 *   · El precio del sobre lo pone el SERVIDOR (catálogo), nunca el cliente.
 *   · La semilla la genera el SERVIDOR con aleatoriedad criptográfica. Antes se
 *     derivaba del estado local (`packsOpened|ownedCards.length`), así que era
 *     predecible y se podía "re-tirar" editando localStorage.
 *
 * ────────────────────────── FASE 11 · IDEMPOTENCIA DE VERDAD ──────────────────────────
 *
 * La auditoría económica encontró que la idempotencia de esta ruta era **teórica**:
 * `app_buy_pack` aceptaba una clave opcional, la ruta la leía del cuerpo… y el cliente no
 * la enviaba nunca. Peor: `buy_and_open` reintentado saltaba la compra por su clave y
 * **volvía a abrir**, así que el jugador perdía un sobre del inventario a cambio de nada.
 *
 * Ahora:
 *   · La clave es OBLIGATORIA en la RPC de compra: sin ella no se cobra.
 *   · La apertura también tiene clave y guarda su RESULTADO. Un reintento devuelve LAS
 *     MISMAS CARTAS, no otras.
 *   · Las dos mitades de `buy_and_open` derivan de la MISMA clave de gesto, así que
 *     reintentar la operación entera es seguro de punta a punta.
 *   · Si el cliente no manda clave, la genera el servidor. Eso no protege de un
 *     reintento —cada intento sería una clave distinta— pero garantiza que la RPC nunca
 *     se llama sin ella y que la operación queda registrada en `economy_ops`.
 */
import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPack } from "@/data/packs";
import type { PackDef } from "@/domain/packs/types";
import { guardPurchase, guardPublicOpen } from "@/domain/packs/lifecycle";
import { economySellable } from "@/domain/packs/economyGate";
import { serverPackEngine } from "@/server/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { xpForCardRank } from "@/domain/progression/levels";
import { loadGameState } from "./inventory";
import { STARTER_POLICY, starterClaimGesture } from "@/domain/economy/starter";
import { readStarterStatus, assistForOpen } from "./starter";

/** Carta revelada que se devuelve al cliente para la animación. */
export interface OpenedCardDTO {
  uid: string;
  cardId: string;
  serial: number | null;
  /** Fase 38 · versión acuñada tal como quedó en `user_cards` (la lee el servidor, no se supone). */
  mintedVersion: number | null;
  isNew: boolean;
  value: number;
  bucket: string;
  byPity: boolean;
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/**
 * Resolutor de sobre por id. Por defecto el catálogo real (`getPack`). Es un punto de inyección
 * para pruebas de servidor: permite ejercer un sobre DRAFT sin añadirlo a `PACKS`. En producción
 * la ruta pública nunca lo pasa, así que el comportamiento no cambia.
 */
export type PackResolver = (id: string) => PackDef | undefined;

const fail = (error: string, status = 400): { ok: false; error: string; status: number } =>
  ({ ok: false, error, status });

/**
 * Clave de idempotencia de una operación de sobres.
 *
 * Se compone en el SERVIDOR a partir del usuario, la acción y el gesto del cliente. Que
 * lleve el `userId` no es decorativo: impide que el gesto de una persona colisione con el
 * de otra en `economy_ops`, cuya clave primaria es global.
 */
export function packOpRef(userId: string, action: string, gesture: string): string {
  return `pack:${action}:${userId}:${gesture}`;
}

/** Un gesto sin identificar por el cliente. No protege de reintentos, pero sí cierra el contrato. */
const anonymousGesture = () => randomUUID();

/**
 * Compra un sobre. El precio se toma del catálogo del servidor.
 * `gesture` hace la operación idempotente: reintentar el mismo gesto no cobra dos veces.
 */
export async function buyPack(
  sb: SupabaseClient, userId: string, packId: string, gesture?: string,
  resolve: PackResolver = getPack,
): Promise<ServiceResult<{ credits: number; packId: string; qty: number }>> {
  const pack = resolve(packId);
  // Fase 20.4 — AUTORIDAD DE ESTADO EN SERVIDOR, antes de tocar la economía: solo un sobre
  // ACTIVE se compra. DRAFT no existe de cara al público (404); RETIRED existe pero ya no se
  // vende (409). No se confía en el filtro de la tienda ni en la forma del cuerpo.
  const purchase = guardPurchase(pack);
  if (!purchase.ok) return fail(purchase.reason, purchase.status);
  if (!pack) return fail("Sobre no encontrado", 404); // inalcanzable tras la guarda; estrecha el tipo.
  // Pack Opening 3.1 · COMPUERTA ECONÓMICA (fallo cerrado), antes de tocar la economía: un sobre especial fuera de los
  // límites derivados de la línea principal no se vende, diga lo que diga la tienda o el cuerpo de la petición.
  const econ = economySellable(pack);
  if (!econ.ok) return fail(econ.reason, 409);

  /*
   * FASE 41 · UN SOBRE GRATIS NO ES UN GRIFO. Precio 0 solo existe para la asistencia de primer equipo: el servidor
   * comprueba que la cuenta aún NO puede formar plantilla, que no tiene ya uno sin abrir y que no ha agotado el tope.
   * La clave de idempotencia es la N-ésima concesión (no el gesto del cliente): dos peticiones simultáneas calculan la
   * misma clave y el libro mayor solo deja pasar una.
   */
  let ref = packOpRef(userId, "buy", gesture ?? anonymousGesture());
  if (pack.price <= 0) {
    if (pack.id !== STARTER_POLICY.packId) return fail("Este sobre no se puede conseguir gratis", 409);
    const st = await readStarterStatus(sb, userId);
    if (!st.eligible) {
      const why = st.reason === "DECK_READY" ? "Ya puedes formar tu plantilla: el Sobre Inicial gratis ya no está disponible"
        : st.reason === "HAS_UNOPENED_STARTER" ? "Ya tienes un Sobre Inicial por abrir"
        : "Ya has recibido todos los Sobres Iniciales gratis";
      return fail(why, 409);
    }
    ref = packOpRef(userId, "buy", starterClaimGesture(st.freeClaims));
  }

  const { data, error } = await sb.rpc("app_buy_pack", {
    p_user: userId,
    p_pack_id: packId,
    p_price: pack.price,
    p_ref: ref,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("Saldo insuficiente")) return fail("Créditos insuficientes", 409);
    return fail(msg || "No se pudo comprar el sobre", 500);
  }
  return { ok: true, data: data as { credits: number; packId: string; qty: number } };
}

/**
 * Abre un sobre del inventario del usuario.
 *
 * La validación real de "¿tiene el sobre?" la hace la RPC dentro de la misma
 * transacción que lo consume: entre leer el estado y persistir no puede colarse
 * una segunda apertura del mismo sobre.
 */
export type OpenPackData = { opened: OpenedCardDTO[]; credits: number; xpGained: number; repeated: boolean };

interface CardRow { uid: string; card_id: string; serial: number | null; minted_version: number | null }

const variantIdOf = (cardId: string): string => cardId.split("__")[1] ?? "";
const bucketOf = (cardId: string): string => {
  try { return bucketForRank(getVariant(variantIdOf(cardId) as Parameters<typeof getVariant>[0]).rank); } catch { return "common"; }
};

/** Filas de `user_cards` de ESTE usuario para esos uids, en el orden de los uids. */
async function readCardsByUids(sb: SupabaseClient, userId: string, uids: string[]): Promise<CardRow[]> {
  if (uids.length === 0) return [];
  const { data, error } = await sb.from("user_cards").select("uid, card_id, serial, minted_version").eq("user_id", userId).in("uid", uids);
  if (error) throw new Error(error.message);
  const byUid = new Map(((data ?? []) as CardRow[]).map((r) => [r.uid, r]));
  return uids.map((u) => byUid.get(u)).filter((r): r is CardRow => !!r);
}

/**
 * FASE 38 · UNA APERTURA YA HECHA SE DEVUELVE LEYENDO LO GUARDADO.
 *
 * Antes, un reintento con la misma clave volvía a SORTEAR (semilla nueva) y emparejaba los `uids` guardados con las
 * cartas del sorteo nuevo: la pantalla podía enseñar la carta A con el uid y el serial de la B. Y si ese era el último
 * sobre, la comprobación de inventario respondía 409 antes de llegar a la RPC. Ahora, con clave de gesto, lo primero es
 * mirar `economy_ops` (del propio usuario): si la operación existe, las cartas salen de `user_cards` por uid —las
 * persistidas— sin tocar economía. «Nueva» se deriva de las demás copias del usuario.
 */
async function storedOpen(sb: SupabaseClient, userId: string, ref: string, packId: string): Promise<ServiceResult<OpenPackData> | null> {
  const { data, error } = await sb.from("economy_ops").select("kind, result").eq("ref", ref).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  const op = data as { kind: string; result: { uids?: unknown; packId?: unknown } | null };
  if (op.kind !== "open_pack") return fail("Esa operación no es una apertura", 409);
  if (op.result?.packId !== packId) return fail("Esa operación pertenece a otro sobre", 409);
  const uids = Array.isArray(op.result?.uids) ? (op.result!.uids as unknown[]).filter((u): u is string => typeof u === "string") : [];
  return { ok: true, data: await dtoFromRows(sb, userId, await readCardsByUids(sb, userId, uids), true) };
}

async function dtoFromRows(sb: SupabaseClient, userId: string, rows: CardRow[], repeated: boolean, fresh?: { isNew: boolean[]; value: number[]; byPity: boolean[] }): Promise<OpenPackData> {
  let isNew: boolean[];
  if (fresh) {
    isNew = fresh.isNew;
  } else {
    const ids = [...new Set(rows.map((r) => r.card_id))];
    const { data } = ids.length ? await sb.from("user_cards").select("uid, card_id").eq("user_id", userId).in("card_id", ids) : { data: [] };
    const mine = new Set(rows.map((r) => r.uid));
    const others = new Map<string, number>();
    for (const r of (data ?? []) as { uid: string; card_id: string }[]) if (!mine.has(r.uid)) others.set(r.card_id, (others.get(r.card_id) ?? 0) + 1);
    const seen = new Set<string>();
    isNew = rows.map((r) => { const n = (others.get(r.card_id) ?? 0) === 0 && !seen.has(r.card_id); seen.add(r.card_id); return n; });
  }
  const opened: OpenedCardDTO[] = rows.map((r, i) => ({
    uid: r.uid,
    cardId: r.card_id,
    serial: r.serial ?? null,
    mintedVersion: r.minted_version ?? null,
    isNew: isNew[i] ?? false,
    value: fresh?.value[i] ?? 0,
    bucket: bucketOf(r.card_id),
    byPity: fresh?.byPity[i] ?? false,
  }));
  const { data: prof } = await sb.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return { opened, credits: Number((prof as { credits: number } | null)?.credits ?? 0), xpGained: 0, repeated };
}

export async function openPackForUser(
  sb: SupabaseClient, userId: string, packId: string, gesture?: string,
  resolve: PackResolver = getPack,
): Promise<ServiceResult<OpenPackData>> {
  const pack = resolve(packId);
  // Fase 20.4 — AUTORIDAD DE ESTADO EN SERVIDOR: un DRAFT no se abre por la ruta pública (404),
  // ni siquiera si el cliente afirma poseerlo. ACTIVE y RETIRED sí (RETIRED es histórico: si se
  // posee, se abre). La POSESIÓN la sigue comprobando la RPC dentro de la transacción.
  const open = guardPublicOpen(pack);
  if (!open.ok) return fail(open.reason, open.status);
  if (!pack) return fail("Sobre no encontrado", 404); // inalcanzable tras la guarda; estrecha el tipo.

  // Fase 38 · reintento de un gesto ya aplicado: el resultado guardado, sin sortear ni exigir inventario.
  if (gesture) {
    const prior = await storedOpen(sb, userId, packOpRef(userId, "open", gesture), packId);
    if (prior) return prior;
  }

  const state = await loadGameState(sb, userId);
  if ((state.unopenedPacks[packId] ?? 0) <= 0) {
    return fail("No tienes ese sobre", 409);
  }

  // Semilla imprevisible para el cliente (32 bits). El motor sigue siendo
  // determinista: misma semilla ⇒ mismo resultado, verificable en pruebas.
  const seed = randomInt(0, 2 ** 31 - 1);
  const now = Date.now();

  /*
   * BLOQUE 8.1 — el motor es EL MISMO; lo que cambia es de dónde salen las cartas.
   *
   * `serverPackEngine()` devuelve un `PackEngine` construido sobre el catálogo PERSISTIDO
   * (`content_cards`), no sobre el `CARDS` derivado del código. Ni el pity, ni las
   * garantías, ni el anti-duplicado, ni el sorteo, ni la caché del pool cambian una línea:
   * la única diferencia es el conjunto elegible, y `content-catalog:verify` demuestra que
   * con la misma semilla y el mismo estado los dos motores devuelven exactamente lo mismo.
   */
  const result = (await serverPackEngine(sb)).open(pack, {
    seed,
    owned: state.ownedCards,
    mintCounts: state.mintCounts,
    pity: state.pity,
    now,
    // Fase 41 · solo Sobre Inicial y solo si con estas cartas aún no hay plantilla posible; si no, `null` (sobre normal).
    assist: await assistForOpen(sb, pack.id, state.ownedCards.map((c) => c.cardId)),
  });

  const xpGained = result.instances.reduce(
    (sum, ins) => sum + xpForCardRank(getVariant(ins.variantId).rank), 0,
  );

  const instances = result.instances.map((ins) => ({
    cardId: ins.cardId,
    serial: ins.serial,
    origin: ins.origin,
  }));

  const { data, error } = await sb.rpc("app_apply_pack_open", {
    p_user: userId,
    p_pack_id: packId,
    p_instances: instances,
    p_pity: result.pityAfter,
    p_mint_delta: result.mintDelta,
    p_xp: xpGained,
    p_ref: packOpRef(userId, "open", gesture ?? anonymousGesture()),
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("No tienes ese sobre")) return fail("No tienes ese sobre", 409);
    return fail(msg || "No se pudo abrir el sobre", 500);
  }

  const applied = (data ?? {}) as { uids?: string[]; repeated?: boolean };
  const uids = (applied.uids ?? []) as string[];

  // Fase 38 · carrera con la MISMA clave (dos peticiones del mismo gesto): la RPC devolvió lo guardado por la otra.
  // Nunca se empareja con este sorteo, que no se persistió: se lee lo persistido.
  if (applied.repeated) {
    return { ok: true, data: await dtoFromRows(sb, userId, await readCardsByUids(sb, userId, uids), true) };
  }

  /*
   * Fase 38 · LO QUE SE ENSEÑA ES LO QUE SE GUARDÓ. Se relee `user_cards` por uid: carta, serial y versión acuñada
   * salen de la fila persistida, no del objeto del sorteo. Si alguna vez no coincidieran, manda la base de datos.
   */
  const rows = await readCardsByUids(sb, userId, uids);
  // Los metadatos del sorteo (nueva, valor, pity) solo se adjuntan si la fila persistida es la misma carta.
  const sameCard = (i: number) => result.instances[i]?.cardId === rows[i]?.card_id;
  const fresh = {
    isNew: rows.map((_, i) => (sameCard(i) ? result.instances[i].isNew : false)),
    value: rows.map((_, i) => (sameCard(i) ? result.instances[i].value : 0)),
    byPity: rows.map((_, i) => (sameCard(i) ? result.instances[i].byPity : false)),
  };
  const out = await dtoFromRows(sb, userId, rows, false, fresh);
  return { ok: true, data: { ...out, credits: out.credits || state.credits, xpGained } };
}

/**
 * Comprar y abrir en una sola operación (la tienda lo ofrece como un solo gesto).
 *
 * Las dos mitades comparten el MISMO gesto, y de ahí salen dos claves distintas
 * (`pack:buy:…` y `pack:open:…`). Es lo que hace que reintentar la operación entera sea
 * seguro: la compra se reconoce como repetida y **la apertura también**, devolviendo las
 * mismas cartas en vez de consumir un segundo sobre.
 *
 * Antes de la Fase 11 solo la compra tenía clave, así que un reintento cobraba una vez y
 * abría dos: el jugador pagaba un sobre y perdía dos.
 */
export async function buyAndOpen(
  sb: SupabaseClient, userId: string, packId: string, gesture?: string,
  resolve: PackResolver = getPack,
): Promise<ServiceResult<OpenPackData>> {
  const g = gesture ?? anonymousGesture();
  // Fase 41 · reintento de un gesto ya ABIERTO: se devuelve lo guardado sin volver a comprar (con el Sobre Inicial
  // gratis la clave de compra es la N-ésima concesión, así que sin esto un reintento pediría la siguiente).
  if (gesture) {
    const prior = await storedOpen(sb, userId, packOpRef(userId, "open", gesture), packId);
    if (prior) return prior;
  }
  const bought = await buyPack(sb, userId, packId, g, resolve);
  if (!bought.ok) return bought;
  return openPackForUser(sb, userId, packId, g, resolve);
}
