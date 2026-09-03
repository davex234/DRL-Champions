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
import { runtimePackEngine } from "@/publisher/runtime";
import { getVariant } from "@/domain/cards/variants";
import { xpForCardRank } from "@/domain/progression/levels";
import { loadGameState } from "./inventory";

/** Carta revelada que se devuelve al cliente para la animación. */
export interface OpenedCardDTO {
  uid: string;
  cardId: string;
  serial: number | null;
  isNew: boolean;
  value: number;
  bucket: string;
  byPity: boolean;
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

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
): Promise<ServiceResult<{ credits: number; packId: string; qty: number }>> {
  const pack = getPack(packId);
  if (!pack) return fail("Sobre no encontrado", 404);

  const { data, error } = await sb.rpc("app_buy_pack", {
    p_user: userId,
    p_pack_id: packId,
    p_price: pack.price,
    p_ref: packOpRef(userId, "buy", gesture ?? anonymousGesture()),
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
export async function openPackForUser(
  sb: SupabaseClient, userId: string, packId: string, gesture?: string,
): Promise<ServiceResult<{ opened: OpenedCardDTO[]; credits: number; xpGained: number }>> {
  const pack = getPack(packId);
  if (!pack) return fail("Sobre no encontrado", 404);

  const state = await loadGameState(sb, userId);
  if ((state.unopenedPacks[packId] ?? 0) <= 0) {
    return fail("No tienes ese sobre", 409);
  }

  // Semilla imprevisible para el cliente (32 bits). El motor sigue siendo
  // determinista: misma semilla ⇒ mismo resultado, verificable en pruebas.
  const seed = randomInt(0, 2 ** 31 - 1);
  const now = Date.now();

  const result = runtimePackEngine().open(pack, {
    seed,
    owned: state.ownedCards,
    mintCounts: state.mintCounts,
    pity: state.pity,
    now,
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

  const uids = ((data as { uids: string[] })?.uids ?? []) as string[];
  const opened: OpenedCardDTO[] = result.instances.map((ins, i) => ({
    uid: uids[i] ?? `${packId}:${i}`,
    cardId: ins.cardId,
    serial: ins.serial,
    isNew: ins.isNew,
    value: ins.value,
    bucket: ins.bucket,
    byPity: ins.byPity,
  }));

  // Saldo actualizado (la apertura no cuesta créditos, pero el cliente refresca aquí).
  const { data: prof } = await sb.from("profiles").select("credits").eq("id", userId).maybeSingle();

  return {
    ok: true,
    data: { opened, credits: Number((prof as { credits: number } | null)?.credits ?? state.credits), xpGained },
  };
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
): Promise<ServiceResult<{ opened: OpenedCardDTO[]; credits: number; xpGained: number }>> {
  const g = gesture ?? anonymousGesture();
  const bought = await buyPack(sb, userId, packId, g);
  if (!bought.ok) return bought;
  return openPackForUser(sb, userId, packId, g);
}
