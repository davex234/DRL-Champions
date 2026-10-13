/**
 * TIENDA 4.0 — el modelo de producto (Fase 49).
 *
 * Cuatro clases de producto, y la diferencia entre ellas es de ARQUITECTURA, no de maquetación:
 *
 *   SOBRE (PACK)    una apertura aleatoria. El precio en créditos es el del sobre (`data/packs`), la
 *                   única autoridad que ya cobra el servidor (`app_buy_pack`). La oferta no lo repite.
 *   CAJA (BOX)      exactamente `BOX_PACK_COUNT` sobres de UN tipo, al inventario y SIN abrir.
 *   PACK (BUNDLE)   un conjunto comercial configurado a mano: sobres, cartas concretas y créditos.
 *   CARTA (CARD)    una carta concreta del catálogo, conocida antes de comprar. NO es el Marketplace:
 *                   la vende la casa (store-controlled offer).
 *
 * PRECIO ≠ MÉTODO DE PAGO. `purchaseMode` dice qué métodos ofrece el producto; los precios dicen
 * cuánto, y pueden faltar (pendientes de decidir). Un método sin precio, o sin forma de entregarse
 * todavía, se ENSEÑA como pendiente: nunca se finge.
 */
import type { Price } from "@/config/monetization";

export type PurchaseMode = "GAME_CURRENCY" | "REAL_MONEY" | "BOTH";
export type PaymentMethod = "GAME_CURRENCY" | "REAL_MONEY";
export type StoreProductKind = "PACK" | "BOX" | "CARD" | "BUNDLE";

/** Una caja son exactamente estos sobres, del tipo que diga la oferta. Regla de producto. */
export const BOX_PACK_COUNT = 10;

/** Insignias editoriales. «Destacado»/«Nuevo» son decisiones de la configuración; el estado lo deriva el resolvedor. */
export type OfferBadge = "FEATURED" | "NEW";

/** Lo común a toda oferta. Todo lo opcional falta a propósito hasta que alguien lo decida. */
export interface OfferBase {
  /** Único dentro de su clase. El id público es `<clase>:<id>` (`productId`). */
  id: string;
  enabled: boolean;
  sortOrder: number;
  purchaseMode: PurchaseMode;
  /** Precio en euros. `null` = pendiente de decidir: se enseña «por anunciar». */
  realMoneyPrice?: Price | null;
  /** Ventana ISO-8601 opcional. Fuera de ella la oferta no existe (ni se enseña ni se vende). */
  startAt?: string;
  endAt?: string;
  badge?: OfferBadge;
}

export interface PackOfferConfig extends OfferBase {
  /** El sobre. Su precio en créditos es el del catálogo de sobres, no se copia aquí. */
  packId: string;
}

export interface BoxOfferConfig extends OfferBase {
  name: string;
  /** Tipo de sobre de la caja. Una caja siempre es `BOX_PACK_COUNT` de este. */
  packId: string;
  /** Solo si algún día se decide venderla con créditos. Hoy no existe (`purchaseMode` REAL_MONEY). */
  gameCurrencyPrice?: number | null;
}

export interface CardOfferConfig extends OfferBase {
  cardId: string;
  featured: boolean;
  gameCurrencyPrice?: number | null;
}

export interface BundleContents {
  packs: { packId: string; count: number }[];
  /** Cartas concretas garantizadas. */
  cardIds: string[];
  /** DRL Credits (la única moneda del juego). */
  credits: number;
}

export interface BundleOfferConfig extends OfferBase {
  name: string;
  tagline: string;
  contents: BundleContents;
  gameCurrencyPrice?: number | null;
}

/** El gran destacado de arriba. Sin cuenta atrás: si tiene fecha de fin, se enseña la fecha. */
export interface FeaturedHeroConfig {
  id: string;
  enabled: boolean;
  sortOrder: number;
  startAt?: string;
  endAt?: string;
  /** Edición real del catálogo (una de las 7). */
  editionId: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
  /** Cartas REALES que protagonizan el banner (la primera, la más grande). */
  cardIds: string[];
  /** Sobre real que acompaña a las cartas y al que lleva la llamada a la acción. */
  packId: string;
  ctaLabel: string;
}

export interface StoreCatalogConfig {
  version: number;
  featuredHero: FeaturedHeroConfig[];
  packOffers: PackOfferConfig[];
  boxOffers: BoxOfferConfig[];
  cardOffers: CardOfferConfig[];
  bundleOffers: BundleOfferConfig[];
}

// ───────────────────────────── Resuelto (lo que ve la interfaz y comprueba el servidor) ─────────────────────────────

/**
 * Estado de UN método de pago de UN producto.
 *   AVAILABLE           se puede comprar ahora por este método (el servidor lo vuelve a comprobar).
 *   PRICE_PENDING       el método está previsto pero el precio no se ha decidido.
 *   CHECKOUT_PENDING    dinero real: no hay pasarela de pago todavía (`PAYMENTS_ENABLED`).
 *   FULFILMENT_PENDING  el servidor aún no sabe ENTREGAR este producto por este método.
 */
export type MethodStatus = "AVAILABLE" | "PRICE_PENDING" | "CHECKOUT_PENDING" | "FULFILMENT_PENDING";

export interface PurchaseOption {
  method: PaymentMethod;
  /** Créditos (GAME_CURRENCY) o céntimos EUR (REAL_MONEY). `null` = pendiente. */
  price: number | null;
  status: MethodStatus;
}

/** Estado visible del producto. «Agotado» no existe: no hay existencias limitadas en el juego. */
export type ProductStatus = "AVAILABLE" | "COMING_SOON" | "DISABLED";

export interface ResolvedProduct {
  /** `<clase>:<id>`, p. ej. `pack:premium`, `box:caja-masters`, `card:leaf__champions-s`. */
  productId: string;
  kind: StoreProductKind;
  name: string;
  sortOrder: number;
  badge: OfferBadge | null;
  status: ProductStatus;
  options: PurchaseOption[];
  /** Lo que se entrega. Para una caja, siempre `BOX_PACK_COUNT` sobres de un tipo. */
  grant: GrantPlan;
  /** Referencias al catálogo para pintar (sin precios). */
  packId?: string;
  cardId?: string;
  tagline?: string;
  endAt?: string;
  /** F60 · SÓLO vista previa del panel: el `PackDef` de un sobre en borrador (no está en el registro). Nunca en la tienda. */
  previewPack?: import("@/domain/packs/types").PackDef;
}

/** Lo que concede un producto una vez pagado. El servidor lo deriva del id; el cliente nunca lo envía. */
export interface GrantPlan {
  packs: { packId: string; count: number }[];
  cardIds: string[];
  credits: number;
}

export interface StoreCapabilities {
  /** Hay pasarela de pago real con confirmación por webhook. Hoy: `PAYMENTS_ENABLED` (false). */
  realMoneyCheckout: boolean;
  /** Qué clases sabe ENTREGAR el servidor a cambio de créditos, de forma atómica e idempotente. */
  creditFulfilment: Record<StoreProductKind, boolean>;
}
