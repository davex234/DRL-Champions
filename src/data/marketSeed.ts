import type { MarketListing, PriceRecord } from "@/domain/market/types";
import { emptyRecord, pushSale } from "@/domain/market/history";
import { marketValue, instanceValue } from "@/domain/economy/pricing";
import { getVariant } from "@/domain/cards/variants";
import { CARDS } from "@/data/catalog";

type Rng = () => number;

let idCounter = 0;
function makeId(prefix: string, rng: Rng): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.floor(rng() * 1e6).toString(36)}`;
}

/** Precio plausible para una carta con variación aleatoria. */
function jitterPrice(base: number, rng: Rng, spread = 0.22): number {
  const factor = 1 + (rng() * 2 - 1) * spread;
  return Math.max(25, Math.round((base * factor) / 25) * 25);
}

/** Serie aleatoria si la variante es serializada. */
function randomSerial(variantId: string, rng: Rng): number | undefined {
  const v = getVariant(variantId as never);
  if (!v.serialized || !v.serialLimit) return undefined;
  return 1 + Math.floor(rng() * v.serialLimit);
}

/** Genera el historial de precios inicial de todas las cartas. */
export function seedPriceHistory(now: number, rng: Rng = Math.random): Record<string, PriceRecord> {
  const out: Record<string, PriceRecord> = {};
  for (const card of CARDS) {
    const base = marketValue(card);
    let record = emptyRecord(base);
    // 6-10 ventas históricas con paseo aleatorio.
    const n = 6 + Math.floor(rng() * 5);
    let price = base;
    for (let i = n; i > 0; i--) {
      price = jitterPrice(price, rng, 0.14);
      record = pushSale(record, price, now - i * 3600_000 * (1 + rng() * 5));
    }
    out[card.id] = record;
  }
  return out;
}

/**
 * Genera listados de vendedores simulados (bots). Sesga hacia cartas comunes
 * para que las raras escaseen en el mercado.
 */
export function generateBotListings(count: number, now: number, rng: Rng = Math.random): MarketListing[] {
  const listings: MarketListing[] = [];
  for (let i = 0; i < count; i++) {
    // Selección sesgada: reintenta una vez si sale una carta muy rara.
    let card = CARDS[Math.floor(rng() * CARDS.length)];
    if (getVariant(card.variantId).rank >= 9 && rng() < 0.6) {
      card = CARDS[Math.floor(rng() * CARDS.length)];
    }
    const serial = randomSerial(card.variantId, rng);
    const base = instanceValue(card, serial);
    listings.push({
      id: makeId("bot", rng),
      cardId: card.id,
      serial,
      price: jitterPrice(base, rng, 0.25),
      seller: "bot",
      listedAt: now - Math.floor(rng() * 6 * 3600_000),
    });
  }
  return listings;
}

export { makeId as makeListingId };
