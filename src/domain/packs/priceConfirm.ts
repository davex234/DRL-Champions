/**
 * ICON (2026-10-09) · EL PRECIO QUE EL JUGADOR VIO.
 *
 * El servidor cobra SIEMPRE su precio (`pack.price`); el cliente nunca lo decide. Pero si el precio cambia (el ICON
 * Premium pasa de 60.000 a 80.000), una pestaña abierta antes del cambio enseña el precio viejo y «Comprar» cobraría el
 * nuevo sin que el jugador lo viera. Para evitarlo, el cliente manda `expectedPrice` (el precio que pintó) y el servidor
 * rechaza con 409, sin cobrar, si no coincide.
 *
 * `expectedPrice` es opcional para no romper clientes antiguos, SALVO en los sobres de `PRICE_CONFIRMATION_REQUIRED`:
 * ahí una petición sin precio (código de antes del cambio) se rechaza y la tienda pide recargar. Cuando ya no quede
 * ninguna pestaña antigua, el conjunto puede vaciarse.
 */
export const PRICE_CONFIRMATION_REQUIRED: ReadonlySet<string> = new Set(["icon"]);

export type PriceCheck = { ok: true } | { ok: false; status: 409; error: string; code: "PRICE_CHANGED" | "PRICE_CONFIRMATION_REQUIRED" };

/** ¿Se puede cobrar `price` a quien vio `expectedPrice`? */
export function checkExpectedPrice(pack: { id: string; price: number }, expectedPrice: number | undefined): PriceCheck {
  if (expectedPrice === undefined) {
    return PRICE_CONFIRMATION_REQUIRED.has(pack.id)
      ? { ok: false, status: 409, code: "PRICE_CONFIRMATION_REQUIRED", error: "El precio de este sobre ha cambiado. Recarga la tienda para ver el precio actual." }
      : { ok: true };
  }
  return expectedPrice === pack.price
    ? { ok: true }
    : { ok: false, status: 409, code: "PRICE_CHANGED", error: `El precio ha cambiado: ahora cuesta ${pack.price.toLocaleString("es-ES")} créditos. No se ha cobrado nada.` };
}

/** Validación de forma del campo en las rutas: entero ≥ 0 (o ausente). */
export const validExpectedPrice = (v: unknown): v is number | undefined =>
  v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000);
