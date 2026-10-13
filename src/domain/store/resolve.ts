/**
 * TIENDA 4.0 — el resolvedor (Fase 49). PURO: configuración + catálogo + reloj → productos.
 *
 * Lo usan la interfaz (para pintar) y el servidor (para decidir). La interfaz nunca decide que una
 * compra es válida: el servidor vuelve a llamar a `findStoreProduct` con el `productId` y su reloj.
 */
import { PAYMENTS_ENABLED } from "@/config/monetization";
import { STORE_CATALOG } from "@/data/storeCatalog";
import { getPack, PACKS } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { DESIGNED_EDITIONS } from "@/domain/cards/variants";
import { isPurchasable, isStoreVisible } from "@/domain/packs/lifecycle";
import { economySellable } from "@/domain/packs/economyGate";
import type { VariantId } from "@/domain/cards/types";
import {
  BOX_PACK_COUNT,
  type FeaturedHeroConfig, type GrantPlan, type MethodStatus, type OfferBase, type PackOfferConfig, type PaymentMethod, type ProductStatus,
  type PurchaseMode, type PurchaseOption, type ResolvedProduct, type StoreCapabilities, type StoreCatalogConfig, type StoreProductKind,
} from "./types";

/** Lo que el sistema sabe hacer HOY. Cambia cuando exista la pasarela o una RPC de entrega nueva. */
export const STORE_CAPABILITIES: StoreCapabilities = Object.freeze({
  realMoneyCheckout: PAYMENTS_ENABLED,
  // Solo el sobre tiene una compra con créditos atómica e idempotente (`app_buy_pack`).
  creditFulfilment: Object.freeze({ PACK: true, BOX: false, CARD: false, BUNDLE: false }),
});

export const PRODUCT_ID = /^(pack|box|card|bundle):[a-z0-9_-]{1,64}$/;
const KIND_PREFIX: Record<StoreProductKind, string> = { PACK: "pack", BOX: "box", CARD: "card", BUNDLE: "bundle" };

export const methodsOf = (mode: PurchaseMode): PaymentMethod[] =>
  mode === "BOTH" ? ["GAME_CURRENCY", "REAL_MONEY"] : [mode];

/** ¿La oferta existe en este instante? Sin ventana, siempre; con fechas mal escritas, nunca. */
export function inWindow(o: { startAt?: string; endAt?: string }, now: number): boolean {
  const start = o.startAt ? Date.parse(o.startAt) : -Infinity;
  const end = o.endAt ? Date.parse(o.endAt) : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start && now < end;
}

function option(kind: StoreProductKind, method: PaymentMethod, price: number | null | undefined, caps: StoreCapabilities): PurchaseOption {
  const p = price ?? null;
  let status: MethodStatus;
  if (method === "REAL_MONEY") status = !caps.realMoneyCheckout ? "CHECKOUT_PENDING" : p === null ? "PRICE_PENDING" : "AVAILABLE";
  else status = p === null ? "PRICE_PENDING" : !caps.creditFulfilment[kind] ? "FULFILMENT_PENDING" : "AVAILABLE";
  return { method, price: p, status };
}

const statusOf = (options: PurchaseOption[]): ProductStatus =>
  options.some((o) => o.status === "AVAILABLE") ? "AVAILABLE" : "COMING_SOON";

function base(o: OfferBase, kind: StoreProductKind, name: string, options: PurchaseOption[], grant: GrantPlan): ResolvedProduct {
  return {
    productId: `${KIND_PREFIX[kind]}:${o.id}`, kind, name, sortOrder: o.sortOrder, badge: o.badge ?? null,
    status: statusOf(options), options, grant, ...(o.endAt ? { endAt: o.endAt } : {}),
  };
}

/** Todos los productos de la configuración, resueltos (incluidos los que no se enseñan: `DISABLED`). */
export function resolveAll(now: number, cfg: StoreCatalogConfig = STORE_CATALOG, caps: StoreCapabilities = STORE_CAPABILITIES): ResolvedProduct[] {
  const out: ResolvedProduct[] = [];
  const shown = (o: OfferBase) => o.enabled && inWindow(o, now);

  // F60 · los sobres del panel (`cms-…`, ya ACTIVE/RETIRED en el registro vivo) se venden SÓLO con créditos, al precio
  // de su plantilla, dentro de su ventana. Nunca con dinero real (PAYMENTS sigue OFF; y no hay precio decidido).
  const runtimeOffers: PackOfferConfig[] = cfg === STORE_CATALOG
    ? PACKS.filter((p) => p.cms).map((p, i) => ({
      id: p.id, packId: p.id, enabled: true, sortOrder: 200 + i, purchaseMode: "GAME_CURRENCY" as const, badge: "NEW" as const,
      ...(p.cms?.availableFrom ? { startAt: p.cms.availableFrom } : {}), ...(p.cms?.availableTo ? { endAt: p.cms.availableTo } : {}),
    }))
    : [];
  for (const o of [...cfg.packOffers, ...runtimeOffers]) {
    const pack = getPack(o.packId);
    if (!pack) continue;
    const options = methodsOf(o.purchaseMode).map((m) =>
      option("PACK", m, m === "GAME_CURRENCY" ? pack.price : o.realMoneyPrice?.cents, caps));
    const p = base(o, "PACK", pack.name, options, { packs: [{ packId: pack.id, count: 1 }], cardIds: [], credits: 0 });
    // El ciclo de vida del sobre manda: DRAFT o RETIRED nunca se venden aquí. Pack Opening 3.1 · y la compuerta económica
    // de los especiales (fallo cerrado): un sobre fuera de límites no se ofrece.
    const sellable = shown(o) && isStoreVisible(pack) && isPurchasable(pack) && economySellable(pack).ok;
    out.push({ ...p, packId: pack.id, status: sellable ? p.status : "DISABLED" });
  }
  for (const o of cfg.boxOffers) {
    const pack = getPack(o.packId);
    if (!pack) continue;
    const options = methodsOf(o.purchaseMode).map((m) =>
      option("BOX", m, m === "GAME_CURRENCY" ? o.gameCurrencyPrice : o.realMoneyPrice?.cents, caps));
    const p = base(o, "BOX", o.name, options, { packs: [{ packId: pack.id, count: BOX_PACK_COUNT }], cardIds: [], credits: 0 });
    const sellable = shown(o) && isStoreVisible(pack) && isPurchasable(pack);
    out.push({ ...p, packId: pack.id, status: sellable ? p.status : "DISABLED" });
  }
  for (const o of cfg.cardOffers) {
    const card = getCard(o.cardId);
    if (!card) continue;
    const options = methodsOf(o.purchaseMode).map((m) =>
      option("CARD", m, m === "GAME_CURRENCY" ? o.gameCurrencyPrice : o.realMoneyPrice?.cents, caps));
    const p = base({ ...o, badge: o.badge ?? (o.featured ? "FEATURED" : undefined) }, "CARD", card.id, options, { packs: [], cardIds: [card.id], credits: 0 });
    out.push({ ...p, cardId: card.id, status: shown(o) ? p.status : "DISABLED" });
  }
  for (const o of cfg.bundleOffers) {
    const packsOk = o.contents.packs.every((x) => { const pk = getPack(x.packId); return !!pk && isPurchasable(pk); });
    const cardsOk = o.contents.cardIds.every((id) => !!getCard(id));
    const options = methodsOf(o.purchaseMode).map((m) =>
      option("BUNDLE", m, m === "GAME_CURRENCY" ? o.gameCurrencyPrice : o.realMoneyPrice?.cents, caps));
    const p = base(o, "BUNDLE", o.name, options, { packs: o.contents.packs.map((x) => ({ ...x })), cardIds: [...o.contents.cardIds], credits: o.contents.credits });
    out.push({ ...p, tagline: o.tagline, status: shown(o) && packsOk && cardsOk ? p.status : "DISABLED" });
  }
  return out;
}

export interface StoreView {
  hero: FeaturedHeroConfig | null;
  packs: ResolvedProduct[];
  boxes: ResolvedProduct[];
  cards: ResolvedProduct[];
  bundles: ResolvedProduct[];
}

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

/** Lo que se ENSEÑA en /tienda: sin DISABLED, ordenado. */
export function resolveStore(now: number, cfg: StoreCatalogConfig = STORE_CATALOG, caps: StoreCapabilities = STORE_CAPABILITIES): StoreView {
  const all = resolveAll(now, cfg, caps).filter((p) => p.status !== "DISABLED").sort(bySort);
  const hero = cfg.featuredHero.filter((h) => h.enabled && inWindow(h, now) && h.cardIds.every((id) => !!getCard(id))).sort(bySort)[0] ?? null;
  return {
    hero,
    packs: all.filter((p) => p.kind === "PACK"),
    boxes: all.filter((p) => p.kind === "BOX"),
    cards: all.filter((p) => p.kind === "CARD"),
    bundles: all.filter((p) => p.kind === "BUNDLE"),
  };
}

/** El producto que nombra un id, tal y como está AHORA. `null` si no existe. Lo usa el servidor. */
export function findStoreProduct(productId: string, now: number, cfg: StoreCatalogConfig = STORE_CATALOG, caps: StoreCapabilities = STORE_CAPABILITIES): ResolvedProduct | null {
  if (!PRODUCT_ID.test(productId)) return null;
  return resolveAll(now, cfg, caps).find((p) => p.productId === productId) ?? null;
}

/** La opción de pago de un producto para un método, o `null` si el producto no la ofrece. */
export const optionFor = (p: ResolvedProduct, method: PaymentMethod): PurchaseOption | null =>
  p.options.find((o) => o.method === method) ?? null;

// ───────────────────────────── Validación de la configuración (test) ─────────────────────────────

export function validateStoreCatalog(cfg: StoreCatalogConfig = STORE_CATALOG): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const unique = (k: string, id: string) => { const key = `${k}:${id}`; if (ids.has(key)) issues.push(`id repetido ${key}`); ids.add(key); };
  const price = (label: string, o: { realMoneyPrice?: { cents: number } | null; gameCurrencyPrice?: number | null }) => {
    if (o.realMoneyPrice && (!Number.isInteger(o.realMoneyPrice.cents) || o.realMoneyPrice.cents <= 0)) issues.push(`${label}: precio en euros no válido`);
    if (o.gameCurrencyPrice != null && (!Number.isInteger(o.gameCurrencyPrice) || o.gameCurrencyPrice <= 0)) issues.push(`${label}: precio en créditos no válido`);
  };
  const dates = (label: string, o: { startAt?: string; endAt?: string }) => {
    for (const d of [o.startAt, o.endAt]) if (d !== undefined && Number.isNaN(Date.parse(d))) issues.push(`${label}: fecha no válida ${d}`);
    if (o.startAt && o.endAt && Date.parse(o.startAt) >= Date.parse(o.endAt)) issues.push(`${label}: ventana vacía`);
  };
  const sellablePack = (label: string, packId: string) => {
    const p = getPack(packId);
    if (!p) issues.push(`${label}: sobre inexistente ${packId}`);
    else if (!isPurchasable(p) || !isStoreVisible(p)) issues.push(`${label}: sobre no vendible (${p.lifecycle ?? (p.retired ? "RETIRED" : "?")}) ${packId}`);
    else { const e = economySellable(p); if (!e.ok) issues.push(`${label}: compuerta económica ${packId}: ${e.issues.map((i) => i.code).join(", ")}`); }
  };

  for (const h of cfg.featuredHero) {
    unique("hero", h.id); dates(`hero ${h.id}`, h);
    if (!DESIGNED_EDITIONS.has(h.editionId as VariantId)) issues.push(`hero ${h.id}: edición inexistente ${h.editionId}`);
    if (h.cardIds.length === 0) issues.push(`hero ${h.id}: sin cartas`);
    for (const id of h.cardIds) if (!getCard(id)) issues.push(`hero ${h.id}: carta inexistente ${id}`);
    sellablePack(`hero ${h.id}`, h.packId);
  }
  for (const o of cfg.packOffers) {
    unique("pack", o.id); dates(`pack ${o.id}`, o); price(`pack ${o.id}`, o);
    if (o.enabled) sellablePack(`pack ${o.id}`, o.packId);
  }
  for (const o of cfg.boxOffers) {
    unique("box", o.id); dates(`box ${o.id}`, o); price(`box ${o.id}`, o);
    if (o.enabled) sellablePack(`box ${o.id}`, o.packId);
  }
  for (const o of cfg.cardOffers) {
    unique("card", o.id); dates(`card ${o.id}`, o); price(`card ${o.id}`, o);
    if (!getCard(o.cardId)) issues.push(`card ${o.id}: carta inexistente ${o.cardId}`);
  }
  for (const o of cfg.bundleOffers) {
    unique("bundle", o.id); dates(`bundle ${o.id}`, o); price(`bundle ${o.id}`, o);
    const c = o.contents;
    if (c.packs.length + c.cardIds.length === 0 && c.credits <= 0) issues.push(`bundle ${o.id}: vacío`);
    if (!Number.isInteger(c.credits) || c.credits < 0) issues.push(`bundle ${o.id}: créditos no válidos`);
    for (const x of c.packs) {
      if (!Number.isInteger(x.count) || x.count <= 0) issues.push(`bundle ${o.id}: cantidad no válida de ${x.packId}`);
      if (o.enabled) sellablePack(`bundle ${o.id}`, x.packId);
    }
    for (const id of c.cardIds) if (!getCard(id)) issues.push(`bundle ${o.id}: carta inexistente ${id}`);
  }
  for (const o of [...cfg.packOffers, ...cfg.boxOffers, ...cfg.cardOffers, ...cfg.bundleOffers]) {
    if (!Number.isFinite(o.sortOrder)) issues.push(`${o.id}: sortOrder no válido`);
    if (!/^[a-z0-9_-]{1,64}$/.test(o.id)) issues.push(`${o.id}: id no válido`);
  }
  return issues;
}
