/**
 * DRL CREDITS — servicio de servidor (Fase 18).
 *
 * ────────────────────────── LA REGLA QUE ORDENA ESTE FICHERO ──────────────────────────
 *
 * **El cliente nombra un PRODUCTO; jamás una cantidad.** Cuántos DRL Credits concede cada
 * producto lo dice el catálogo del servidor (`@/domain/economy/drlCredits`). Si el cuerpo
 * de la petición trajera un `credits`, `amount` o `balance`, se ignora: aquí no se lee.
 *
 * Es la misma regla de la Fase 11 para el dinero real, aplicada al sandbox. Una tienda que
 * acepta «dame 5.000 créditos» del navegador es la definición del agujero.
 *
 * ────────────────────────── DÓNDE VIVE CADA GARANTÍA ──────────────────────────
 *
 *   · **Atomicidad y saldo nunca negativo** → `_ledger_apply`, con `for update` sobre la
 *     fila del perfil. No en Node: aquí no se suma ni se resta un solo crédito.
 *   · **Idempotencia** → `economy_ops.ref` (clave primaria) dentro de la propia RPC.
 *   · **Autorización** → la sesión. El `userId` sale SIEMPRE del token, nunca del cuerpo.
 *   · **Aislamiento entre usuarios** → la RPC filtra por `user_id`; devolver la compra de
 *     otro es imposible aunque se acierte con su referencia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  productById, activeProducts, isValidAmount, CATALOG_VERSION,
  type CreditProduct,
} from "@/domain/economy/drlCredits";

/**
 * FASE 41 · LA TIENDA DE PRUEBA ESTÁ CERRADA POR DEFECTO. `PAYMENTS_ENABLED=false` solo cambiaba textos: cualquier
 * sesión podía pedir 28.000 créditos por llamada con una clave nueva cada vez (fuente infinita, P0). Ahora conceder
 * exige un interruptor de SERVIDOR explícito (`NEXUS_SANDBOX_CREDITS=1`, solo entornos de prueba). La devolución sigue
 * abierta: solo resta.
 */
export function sandboxCreditsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // Fase 49.1 · y NUNCA en una build de producción (`next start`), aunque alguien deje la variable puesta: sin
  // pasarela (`PAYMENTS_ENABLED=false`) ningún botón de la tienda puede conceder créditos de verdad.
  return env.NEXUS_SANDBOX_CREDITS === "1" && env.NODE_ENV !== "production";
}

export const SANDBOX_CLOSED = "La tienda de créditos de prueba está cerrada en esta versión.";

export interface CreditsView {
  /** Fase 41 · ¿el servidor concede compras de prueba? (por defecto no). */
  purchasesOpen: boolean;
  balance: number;
  products: CreditProduct[];
  catalogVersion: number;
  /** Movimientos más recientes, ya listos para pintar. */
  history: LedgerEntry[];
  /** Nunca hay pagos reales en esta fase. Lo dice el servidor, no la interfaz. */
  sandbox: true;
}

export interface LedgerEntry {
  at: string;
  delta: number;
  kind: string;
  reason: string;
  balanceAfter: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): Result<never> => ({ ok: false, error, status });

/** Traduce el error de una RPC a algo que el jugador pueda leer, sin filtrar interioridades. */
function rpcError(message: string): Result<never> {
  if (message.includes("Saldo insuficiente")) return fail("No tienes DRL Credits suficientes", 409);
  if (message.includes("Compra original inexistente")) return fail("Esa compra no existe", 404);
  if (message.includes("ya fue devuelta")) return fail("Esa compra ya se devolvió", 409);
  if (message.includes("no está concedida")) return fail("Esa compra no se puede devolver", 409);
  if (message.includes("Cantidad inválida")) return fail("Cantidad inválida", 400);
  if (message.includes("Referencia obligatoria")) return fail("Referencia obligatoria", 400);
  return fail("No se pudo completar la operación", 500);
}

/** Saldo + catálogo + historial. Solo lectura. */
export async function getCredits(
  sb: SupabaseClient, userId: string, limit = 50,
): Promise<Result<CreditsView>> {
  const { data: prof, error: e1 } = await sb
    .from("profiles").select("credits").eq("id", userId).maybeSingle();
  if (e1) return fail("No se pudo leer el saldo", 500);
  if (!prof) return fail("Perfil inexistente", 404);

  // El historial es del usuario de la SESIÓN. No hay parámetro para pedir el de otro.
  const { data: tx, error: e2 } = await sb
    .from("credit_transactions")
    .select("created_at, delta, kind, reason, balance_after")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (e2) return fail("No se pudo leer el historial", 500);

  return {
    ok: true,
    data: {
      balance: Number((prof as { credits: number }).credits),
      products: activeProducts(),
      catalogVersion: CATALOG_VERSION,
      sandbox: true,
      purchasesOpen: sandboxCreditsEnabled(),
      history: ((tx ?? []) as Record<string, unknown>[]).map((r) => ({
        at: String(r.created_at),
        delta: Number(r.delta),
        kind: String(r.kind ?? (Number(r.delta) >= 0 ? "credit" : "debit")),
        reason: String(r.reason ?? ""),
        balanceAfter: Number(r.balance_after),
      })),
    },
  };
}

export interface PurchaseResult {
  credits: number;
  granted: number;
  productId: string;
  sandbox: true;
}

/**
 * COMPRA SANDBOX. No cobra: concede.
 *
 * `ref` es la clave de idempotencia y la elige quien llama; repetirla devuelve el mismo
 * resultado y concede 0. Se prefija con el usuario para que la referencia de uno **no
 * pueda colisionar ni reutilizarse** con la de otro.
 */
export async function sandboxPurchase(
  sb: SupabaseClient, userId: string, productId: unknown, ref: unknown,
): Promise<Result<PurchaseResult>> {
  if (!sandboxCreditsEnabled()) return fail(SANDBOX_CLOSED, 403);
  if (typeof productId !== "string" || !productId) return fail("Producto inválido");
  if (typeof ref !== "string" || !ref.trim()) return fail("Referencia obligatoria");

  // El catálogo del SERVIDOR decide. Un id desconocido o inactivo se rechaza sin más.
  const product = productById(productId);
  if (!product) return fail("Producto inexistente", 404);
  // Cinturón y tirantes: el catálogo es nuestro, pero una cantidad inválida nunca pasa.
  if (!isValidAmount(product.credits)) return fail("Producto mal configurado", 500);

  const { data, error } = await sb.rpc("app_sandbox_purchase", {
    p_user: userId,
    p_product_id: product.productId,
    p_credits: product.credits,
    p_price_cents: product.referencePrice.cents,
    p_currency: product.referencePrice.currency,
    p_ref: scopedRef(userId, ref),
  });
  if (error) return rpcError(error.message);

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      credits: Number(r.credits ?? 0),
      granted: Number(r.granted ?? 0),
      productId: String(r.productId ?? product.productId),
      sandbox: true,
    },
  };
}

export interface RefundResult {
  credits: number;
  refunded: number;
  productId: string;
  sandbox: true;
}

/**
 * DEVOLUCIÓN SANDBOX. Exige la referencia de la compra original: no existe el reembolso
 * arbitrario. Si el jugador ya gastó los DRL Credits, la RPC corta por saldo insuficiente,
 * que es lo correcto — el saldo no puede quedar negativo ni devolviendo.
 */
export async function sandboxRefund(
  sb: SupabaseClient, userId: string, purchaseRef: unknown, ref: unknown,
): Promise<Result<RefundResult>> {
  if (typeof purchaseRef !== "string" || !purchaseRef.trim()) return fail("Compra original obligatoria");
  if (typeof ref !== "string" || !ref.trim()) return fail("Referencia obligatoria");

  const { data, error } = await sb.rpc("app_sandbox_refund", {
    p_user: userId,
    // Se reconstruye con el MISMO prefijo de usuario: nadie puede nombrar la compra de otro.
    p_purchase_ref: scopedRef(userId, purchaseRef),
    p_ref: scopedRef(userId, `refund:${ref}`),
  });
  if (error) return rpcError(error.message);

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      credits: Number(r.credits ?? 0),
      refunded: Number(r.refunded ?? 0),
      productId: String(r.productId ?? ""),
      sandbox: true,
    },
  };
}

/**
 * Referencia con ámbito de usuario.
 *
 * `economy_ops.ref` es única GLOBALMENTE, así que sin prefijo un jugador podría «gastar» la
 * referencia de otro —enviando la misma cadena— y bloquearle la operación, o recibir el
 * resultado cacheado de una operación ajena. Con el prefijo, el espacio de referencias de
 * cada usuario es suyo.
 */
const scopedRef = (userId: string, ref: string): string => `drlc:${userId}:${ref.slice(0, 96)}`;
