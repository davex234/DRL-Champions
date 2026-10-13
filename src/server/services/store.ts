/**
 * TIENDA 4.0 · CHECKOUT EN SERVIDOR (Fase 49).
 *
 * El cliente nombra un PRODUCTO (`productId`) y un MÉTODO. Todo lo demás —qué es, si existe hoy, si se
 * vende por ese método, cuánto cuesta y qué entrega— lo resuelve aquí `findStoreProduct` con el reloj del
 * servidor. Ni precio, ni cantidad, ni cartas, ni contenido de caja viajan desde el navegador (la ruta
 * los rechaza por su nombre).
 *
 *   GAME_CURRENCY · sobre   → `buyPack` (el mismo servicio y la misma RPC `app_buy_pack` de siempre:
 *                             precio del catálogo, guarda de ciclo de vida, idempotencia por `ref`).
 *   GAME_CURRENCY · resto   → 409: el servidor aún no sabe entregarlo de forma atómica (no se finge).
 *   REAL_MONEY              → 503 mientras no haya pasarela (`PAYMENTS_ENABLED`). NUNCA concede nada.
 *
 * ────────────────────────── EL DÍA QUE HAYA PASARELA ──────────────────────────
 *
 *   1. `REAL_MONEY` crea aquí la sesión de pago del proveedor con el precio de ESTE resolvedor y guarda una
 *      fila `payments` (0021) en `created`, con `productId` y el `grant` resuelto.
 *   2. El webhook del proveedor (firma verificada) marca `paid` y concede `grant` con `app_grant_reward`
 *      y `ref = payment:<id>`: idempotente, así que un webhook repetido no concede dos veces.
 *   3. Nada se concede antes del pago confirmado. Una caja concede `BOX_PACK_COUNT` sobres al inventario.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { findStoreProduct, optionFor } from "@/domain/store/resolve";
import type { PaymentMethod, StoreCatalogConfig } from "@/domain/store/types";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { buyPack as realBuyPack, type ServiceResult } from "./packs";

export interface StoreCheckoutInput {
  productId: string;
  method: PaymentMethod;
  ref?: string;
}

export type StoreCheckoutData =
  | { kind: "PACK_PURCHASED"; productId: string; credits: number; packId: string; qty: number };

export interface StoreDeps {
  buyPack: typeof realBuyPack;
  now: () => number;
  catalog: StoreCatalogConfig;
}

const DEFAULT_DEPS: StoreDeps = { buyPack: realBuyPack, now: () => Date.now(), catalog: STORE_CATALOG };

const fail = <T>(error: string, status: number): ServiceResult<T> => ({ ok: false, error, status });

export async function storeCheckout(
  sb: SupabaseClient, userId: string, input: StoreCheckoutInput, deps: StoreDeps = DEFAULT_DEPS,
): Promise<ServiceResult<StoreCheckoutData>> {
  const product = findStoreProduct(input.productId, deps.now(), deps.catalog);
  if (!product) return fail("Producto no encontrado", 404);
  if (product.status === "DISABLED") return fail("Este producto no está a la venta", 410);

  const option = optionFor(product, input.method);
  if (!option) return fail("Este producto no se vende por ese método", 400);

  if (input.method === "REAL_MONEY") {
    // Sin pasarela no hay cobro, ni fila de pago, ni concesión. El precio (si lo hay) es solo informativo.
    return fail(option.status === "CHECKOUT_PENDING" ? "El pago con dinero real llegará pronto" : "Pago no disponible", 503);
  }

  if (option.status === "PRICE_PENDING") return fail("Este producto todavía no tiene precio", 409);
  if (option.status === "FULFILMENT_PENDING" || product.kind !== "PACK" || !product.packId) {
    return fail("Este producto todavía no se puede comprar con créditos", 409);
  }

  // El precio y la guarda de ciclo de vida los vuelve a aplicar `buyPack` con el catálogo del servidor.
  const res = await deps.buyPack(sb, userId, product.packId, input.ref);
  if (!res.ok) return res;
  return { ok: true, data: { kind: "PACK_PURCHASED", productId: product.productId, ...res.data } };
}
