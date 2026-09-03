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

/**
 * Alternativa sin dinero. Existe a propósito: quien juega mucho tiene que poder abrir el
 * mismo carril sin pagar. Debe coincidir con `CURRENT_SEASON.premiumCost`.
 */
export const PASS_TOKEN_COST = 1200;

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
 * Catálogo de paquetes de créditos.
 *
 * VACÍO A PROPÓSITO, y esto es una decisión, no una tarea pendiente: los créditos compran
 * sobres, los sobres dan cartas y las cartas deciden duelos. Vender créditos sería vender
 * ventaja competitiva, que es justo lo que prohíbe §29.
 *
 * La estructura se deja escrita porque el día que se venda algo que NO afecte al duelo
 * (una divisa puramente cosmética, por ejemplo) el catálogo será este y la pantalla de la
 * tienda ya sabe recorrerlo.
 */
export const CREDIT_PACKAGES: CreditPackage[] = [];

/** ¿Hay algo que vender ahora mismo? Lo usan las pantallas para no enseñar una sección vacía. */
export const hasStoreProducts = (): boolean => CREDIT_PACKAGES.length > 0;
