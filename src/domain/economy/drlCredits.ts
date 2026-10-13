/**
 * DRL CREDITS — la moneda oficial de DRL Cards (Fase 18).
 *
 * ────────────────────────── UNA SOLA MONEDA ──────────────────────────
 *
 * Los créditos que ya existían NO se sustituyen ni se convierten: **son** los DRL Credits.
 * La fuente de verdad sigue siendo `profiles.credits`, el libro sigue siendo
 * `credit_transactions` y la única puerta que mueve saldo sigue siendo `_ledger_apply`.
 * Aquí no hay saldos, ni aritmética de saldo, ni una segunda contabilidad: solo el
 * catálogo de productos y las reglas de la moneda.
 *
 * ────────────────────────── LAS REGLAS DE LA MONEDA ──────────────────────────
 *
 *   · **Entera.** Nunca 100,50 DRL Credits. `bigint` en la base, enteros aquí.
 *   · **Nunca negativa.** Lo garantiza `_ledger_apply` con su comprobación, no la interfaz.
 *   · **Sin coma flotante.** Ni un `number` con decimales toca un importe.
 *   · **No es dinero.** No se retira, no se transfiere entre jugadores y no se convierte a
 *     euros. Comprarlos es una vía de entrada; salir no existe.
 *
 * ────────────────────────── NOMBRE ──────────────────────────
 *
 * La marca es **DRL Credits**, en inglés y sin traducir, igual que uno no traduce el
 * nombre de una divisa. En español se escribe «1.000 DRL Credits», no «1.000 créditos DRL».
 * Abreviatura interna: DRLC.
 */

/** Abreviatura interna. No se muestra al jugador: la marca es «DRL Credits». */
export const DRLC = "DRLC" as const;

/** Nombre visible. Un único sitio, para que nadie vuelva a escribirlo a mano. */
export const CURRENCY_NAME = "DRL Credits" as const;

/** Símbolo de la moneda en la interfaz. */
export const CURRENCY_ICON = "🪙" as const;

/**
 * Precio de referencia de un producto. **No activa ningún cobro**: es lo que costaría el
 * día que exista una pasarela, guardado en céntimos enteros porque un importe en coma
 * flotante acaba siempre en un 4,989999999999999.
 */
export interface ReferencePrice {
  cents: number;
  currency: "EUR";
}

export interface CreditProduct {
  /** Identificador estable. Es lo ÚNICO que el cliente puede nombrar. */
  productId: string;
  name: string;
  /** DRL Credits que concede. Entero y positivo. Lo decide el servidor, nunca el cliente. */
  credits: number;
  /** Orden de presentación en la tienda. */
  order: number;
  /** Un producto inactivo no se vende ni aparece, pero su historial se conserva. */
  active: boolean;
  /**
   * Precio de referencia para una monetización futura. **Separado del saldo a propósito**:
   * no participa en ningún cálculo de DRL Credits y no dispara ningún pago.
   */
  referencePrice: ReferencePrice;
  /** Anotaciones libres (destacado, etiqueta comercial…). No afecta a la economía. */
  metadata?: Record<string, string>;
}

/** Versión del catálogo. Cambia cuando cambian productos o cantidades; queda en el ledger. */
export const CATALOG_VERSION = 1 as const;

/**
 * Catálogo de productos de DRL Credits.
 *
 * ────────────────────────── DECISIÓN DE PRODUCTO (Fase 18) ──────────────────────────
 *
 * Hasta la Fase 17 este catálogo estaba VACÍO a propósito, y el motivo estaba escrito: los
 * DRL Credits compran sobres, los sobres dan cartas y las cartas deciden duelos, así que
 * venderlos era vender ventaja competitiva.
 *
 * **En la Fase 18 esa decisión se revoca de forma explícita**, por decisión del responsable
 * del producto: los DRL Credits pasan a ser la moneda oficial y serán vendibles. Queda
 * escrito aquí para que el cambio sea rastreable y no parezca un descuido.
 *
 * Lo que NO cambia con esta decisión: los precios de los sobres, las probabilidades, las
 * recompensas, el salvamento y el equilibrio económico siguen exactamente como estaban.
 */
export const CREDIT_PRODUCTS: CreditProduct[] = [
  { productId: "drlc-starter",  name: "Starter",  credits: 1_000,  order: 1, active: true, referencePrice: { cents: 199,  currency: "EUR" } },
  { productId: "drlc-basic",    name: "Basic",    credits: 2_800,  order: 2, active: true, referencePrice: { cents: 499,  currency: "EUR" } },
  { productId: "drlc-popular",  name: "Popular",  credits: 5_000,  order: 3, active: true, referencePrice: { cents: 899,  currency: "EUR" }, metadata: { badge: "El más elegido" } },
  { productId: "drlc-large",    name: "Large",    credits: 13_500, order: 4, active: true, referencePrice: { cents: 1999, currency: "EUR" } },
  { productId: "drlc-ultimate", name: "Ultimate", credits: 28_000, order: 5, active: true, referencePrice: { cents: 3999, currency: "EUR" } },
];

/** Productos vendibles, en orden. Es lo que ve la tienda. */
export const activeProducts = (): CreditProduct[] =>
  CREDIT_PRODUCTS.filter((p) => p.active).sort((a, b) => a.order - b.order);

/**
 * Producto por id. Devuelve `undefined` si no existe o está inactivo — **nunca** un
 * producto por defecto: un id desconocido es un intento de manipulación, no un despiste.
 */
export const productById = (id: string): CreditProduct | undefined =>
  CREDIT_PRODUCTS.find((p) => p.productId === id && p.active);

/**
 * ¿Es una cantidad de DRL Credits válida? Entera, finita, positiva y por debajo del techo
 * de seguridad. Se aplica a TODO lo que venga de fuera antes de tocar el libro mayor.
 */
export const MAX_TRANSACTION = 10_000_000;

export function isValidAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_TRANSACTION;
}

/** Formato español: «1.000 DRL Credits». Sin decimales, porque la moneda no los tiene. */
export const formatDRLC = (n: number): string =>
  `${new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Math.trunc(n))} ${CURRENCY_NAME}`;

/** Formato con signo, para el historial: «+5.000 DRL Credits», «−750 DRL Credits». */
export const formatDelta = (n: number): string =>
  `${n >= 0 ? "+" : "−"}${formatDRLC(Math.abs(n))}`;

/**
 * Etiqueta en español de cada tipo de movimiento del libro mayor. El `kind` de la base es
 * inglés y estable; lo que lee el jugador, no.
 */
export const KIND_LABEL: Record<string, string> = {
  credit: "Ingreso",
  debit: "Gasto",
  purchase: "Compra de prueba",
  refund: "Devolución",
  adjustment: "Ajuste",
  transfer_in: "Venta en el mercado",
  transfer_out: "Compra en el mercado",
  reversal: "Reversión",
};
