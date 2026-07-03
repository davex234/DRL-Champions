/**
 * MARKETPLACE & PLAYER TRADING ENGINE — vocabulario compartido (Collection Fase 5/7).
 *
 * El Marketplace NUNCA es dueño de cartas: la carta SIEMPRE pertenece a Collection. El motor solo
 * ADMINISTRA operaciones (listados/ofertas/transacciones) sobre un libro con índices O(1). Reutiliza
 * `@/domain/market` (tipos/fees/history), `@/domain/economy/pricing` (valor), `@/collection`
 * (propiedad) y el RNG del proyecto. Determinista (semilla + reloj lógico inyectados). Devuelve un
 * PLAN de EFECTOS que el store aplica a la colección/moneda.
 *
 *   Collection → Marketplace → Collection → Deck → Gameplay → Career
 */
import type {
  MarketListing, MarketOffer, MarketEvent, MarketEventType, PriceRecord, TxRecord, ListingStatus, Visibility, OfferStatus,
} from "@/domain/market/types";
import type { CardDef, OwnedCard } from "@/domain/cards/types";

export type {
  MarketListing, MarketOffer, MarketEvent, MarketEventType, PriceRecord, TxRecord, ListingStatus, Visibility, OfferStatus, CardDef, OwnedCard,
};

/** Versión del estado persistible del mercado (migraciones/compat futura). */
export const MARKET_SCHEMA_VERSION = 1;

export const USER = "user";

/** Estado persistible del mercado (fuente de verdad de listados/ofertas/historial). */
export interface MarketState {
  version: number;
  listings: MarketListing[];
  offers: MarketOffer[];
  priceHistory: Record<string, PriceRecord>;
  transactions: TxRecord[];
}

export const freshMarketState = (): MarketState => ({ version: MARKET_SCHEMA_VERSION, listings: [], offers: [], priceHistory: {}, transactions: [] });

// ───────────────────────────── Valor dinámico (Fase 5 · VALOR) ─────────────────────────────

/** Modificadores externos del valor (temporada/evento/popularidad/demanda). Multiplicadores, 1 = neutro. */
export interface ValueModifiers {
  season?: number;
  event?: number;
  popularity?: number;   // Living World / Career (fama del jugador/palmarés más allá del OVR)
  demand?: number;
}

export interface ValueContext {
  history?: PriceRecord;
  /** Nº de listados activos de la MISMA carta (oferta ⇒ presiona el precio a la baja). */
  activeListings?: number;
  modifiers?: ValueModifiers;
}

// ───────────────────────────── Operaciones (plan de efectos) ─────────────────────────────

/** Efectos que el store aplica a Collection/moneda (el motor no toca el store). */
export interface Effect {
  creditsDelta: number;
  /** Instancias a DEVOLVER a la colección (uid preservado): cancelar/expirar. */
  restore: OwnedCard[];
  /** Nuevas instancias a adquirir (compra): cardId + serie. */
  acquire: { cardId: string; serial?: number }[];
  /** uids a RETIRAR de la colección (escrow al listar). */
  removeUids: string[];
}

export const freshEffect = (): Effect => ({ creditsDelta: 0, restore: [], acquire: [], removeUids: [] });

/** Resultado de una operación: éxito + eventos + efectos. */
export interface OpResult {
  ok: boolean;
  error?: string;
  events: MarketEvent[];
  effect: Effect;
}

// ───────────────────────────── Entradas de operación ─────────────────────────────

export interface ListingInput {
  /** Instancia REAL a listar (ya validada como poseída y no bloqueada por el store). */
  owned: OwnedCard;
  price: number;
  visibility?: Visibility;
  reservedFor?: string;
  lotId?: string;
  expiresAt?: number;
  sellerId?: string;   // por defecto "user"
}

export interface OfferInput {
  listingId?: string;
  cardId: string;
  serial?: number;
  amount: number;
  from: string;
  expiresAt?: number;
}

// ───────────────────────────── Analytics ─────────────────────────────

export interface MarketAnalytics {
  totalListings: number;
  activeListings: number;
  openOffers: number;
  transactions: number;
  volumeCredits: number;
  avgListingPrice: number;
  /** Cartas con más ventas recientes. */
  hotCards: { cardId: string; sales: number; avg: number }[];
  trend: { up: number; down: number; stable: number };
}

/** Resultado de validar el estado del mercado (SEGURIDAD, sin estados imposibles). */
export interface MarketIssue { code: string; message: string; listingId?: string }
export interface MarketValidation { ok: boolean; issues: MarketIssue[] }
