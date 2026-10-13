/**
 * MONETIZACIÓN — precios y paquetes (Fases 9E y 9F).
 *
 * Un único sitio donde vive TODO lo que cuesta dinero real o créditos. La Fase 9 pide
 * explícitamente que el precio del pase sea configurable y «nunca esté a fuego»: por eso
 * ningún componente escribe una cifra, todos leen de aquí.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN
 *
 *   1. **No hay pagos reales.** (§12) No existe infraestructura de pago segura en el
 *      proyecto, así que NO se integra ninguna pasarela. El precio se ANUNCIA y la
 *      compra queda deshabilitada con un motivo escrito, en vez de fingir una tienda que
 *      no puede cobrar. `PAYMENTS_ENABLED` es el único interruptor.
 *   2. **El dinero no compra ventaja competitiva.** (§29) Lo que se paga es cosmética y
 *      comodidad. Los créditos NO se venden: se ganan jugando. Por eso el catálogo de
 *      paquetes de abajo está vacío y documentado, no lleno de ofertas inventadas.
 *
 * Las cifras son las de la Fase 9 (4,99–5,99 €) y se guardan en CÉNTIMOS enteros: un
 * precio en coma flotante acaba, tarde o temprano, en un 5.989999999999999.
 */

/**
 * ¿Hay pasarela de pago conectada? Falso, y así seguirá hasta que exista una de verdad.
 * Cuando se conecte, este es el único valor que cambia; las pantallas ya están escritas
 * para los dos casos.
 */
export const PAYMENTS_ENABLED = false;

export interface Price {
  /** En céntimos de la divisa. Entero, siempre. */
  cents: number;
  currency: "EUR";
}

export const formatPrice = (p: Price): string =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: p.currency }).format(p.cents / 100);

// ───────────────────────────── Pase de temporada ─────────────────────────────

export interface PassProduct {
  id: string;
  label: string;
  /** Qué incluye, en palabras del jugador. */
  summary: string;
  price: Price;
}

/**
 * El pase premium. Un solo producto: un pase con dos precios distintos según lo que
 * incluye es la clase de tienda que nadie entiende a la primera.
 */
export const PASS_PRODUCT: PassProduct = {
  id: "pass-premium",
  label: "Pase premium",
  summary: "Desbloquea el carril de aspecto de la temporada: avatares, marcos, banderines y títulos.",
  price: { cents: 599, currency: "EUR" },
};

/*
 * Aquí vivía `PASS_TOKEN_COST = 1200`: el precio del carril premium en FICHAS DE EVENTO,
 * documentado como «la alternativa sin dinero».
 *
 * Se retira en la F18.2 junto con la segunda moneda. Y conviene dejar escrito que esa
 * alternativa nunca funcionó: el servidor cobraba llamando a `app_adjust_credits` con un
 * parámetro `p_tokens` que esa función no tiene, así que la compra devolvía siempre un
 * error. Ahora DRL Cards tiene UNA sola moneda, los DRL Credits, y el carril premium solo
 * se abrirá cuando exista una pasarela de pago de verdad.
 */

// ───────────────────────────── Paquetes de créditos ─────────────────────────────

export interface CreditPackage {
  id: string;
  credits: number;
  /** Créditos extra sobre la cantidad base, para el clásico «mejor valor». */
  bonus: number;
  price: Price;
  highlight?: boolean;
}

/**
 * Catálogo de paquetes de créditos — **SUSTITUIDO EN LA FASE 18**.
 *
 * ────────────────────────── QUÉ DECÍA ANTES, Y POR QUÉ CAMBIA ──────────────────────────
 *
 * Hasta la Fase 17 este array estaba vacío a propósito, con este motivo escrito:
 *
 *   «Los créditos compran sobres, los sobres dan cartas y las cartas deciden duelos.
 *    Vender créditos sería vender ventaja competitiva, que es justo lo que prohíbe §29.»
 *
 * **En la Fase 18 el responsable del producto revoca esa decisión de forma explícita:** los
 * créditos pasan a llamarse DRL Credits, se convierten en la moneda oficial de DRL Cards y
 * serán vendibles. Se deja constancia aquí —en vez de borrar el párrafo— para que el cambio
 * sea rastreable y no parezca un descuido de alguien que no leyó §29.
 *
 * ────────────────────────── DÓNDE VIVE AHORA EL CATÁLOGO ──────────────────────────
 *
 * En `@/domain/economy/drlCredits` (`CREDIT_PRODUCTS`), junto a las reglas de la moneda.
 * Este array se conserva vacío para no romper a quien todavía lo importe, y `PAYMENTS_ENABLED`
 * sigue en **falso**: las compras son de PRUEBA y no mueven un solo euro.
 *
 * @deprecated Usa `CREDIT_PRODUCTS` de `@/domain/economy/drlCredits`.
 */
export const CREDIT_PACKAGES: CreditPackage[] = [];

/**
 * ¿Hay algo que vender ahora mismo?
 *
 * Desde la Fase 18 el catálogo vive en `@/domain/economy/drlCredits`. Esta función se
 * mantiene para los llamadores existentes y responde por el catálogo nuevo.
 */
export const hasStoreProducts = (): boolean => CREDIT_PACKAGES.length > 0;
