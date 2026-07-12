/**
 * MATERIALES (Collection Fase 4/7) — el ÚNICO recurso nuevo, como EXTENSIÓN (no otra economía).
 *
 * Polvo por bucket de rareza (reutiliza `RarityBucket`). Operaciones inmutables + valoración de salvage
 * reutilizando el pricing existente (`quickSellValue`) y `bucketForRank`. Sin `Math.random`/`Date.now`.
 */
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { quickSellValue } from "@/domain/economy/pricing";
import type { CardDef, VariantDef } from "@/domain/cards/types";
import type { Materials } from "./types";
import { CRAFT_SCHEMA_VERSION } from "./types";

export const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

export const freshMaterials = (): Materials => ({ common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 });

/** Polvo que produce salvar una carta de un rango (determinista, escala con la rareza). */
export function dustForRank(rank: number): number {
  return 1 + Math.floor(rank / 3); // bronce ~1, épicas/legendarias ~4-6
}

export const addMaterials = (a: Materials, b: Partial<Materials>): Materials => {
  const out = { ...a };
  for (const k of BUCKETS) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
};

export const subMaterials = (a: Materials, b: Partial<Materials>): Materials => {
  const out = { ...a };
  for (const k of BUCKETS) out[k] = (out[k] ?? 0) - (b[k] ?? 0);
  return out;
};

/** ¿Alcanza `bag` para pagar `cost`? */
export const hasMaterials = (bag: Materials, cost: Partial<Materials> = {}): boolean =>
  BUCKETS.every((k) => (bag[k] ?? 0) >= (cost[k] ?? 0));

export const totalMaterials = (m: Materials): number => BUCKETS.reduce((s, k) => s + (m[k] ?? 0), 0);

/**
 * Rendimiento de salvar una carta (polvo + créditos). El polvo va al bucket de la carta; los créditos
 * reutilizan `quickSellValue`. Determinista.
 */
export function salvageYield(card: CardDef, variant: VariantDef, serial: number | undefined, opts: { dustByBucket?: boolean; fixed?: Partial<Materials>; credits?: number; valueFromCard?: boolean }): { materials: Materials; credits: number } {
  // Acumulación in-place sobre un objeto RECIÉN creado (mismo resultado que encadenar
  // addMaterials, sin alocar un objeto intermedio por paso: esto corre millones de veces).
  const materials = freshMaterials();
  if (opts.dustByBucket) materials[bucketForRank(variant.rank)] += dustForRank(variant.rank);
  if (opts.fixed) for (const k of BUCKETS) materials[k] += opts.fixed[k] ?? 0;
  const credits = (opts.credits ?? 0) + (opts.valueFromCard ? quickSellValue(card, serial) : 0);
  return { materials, credits };
}

/** MIGRA materiales antiguos/corruptos al esquema actual (nunca rompe). Determinista. */
export function migrateMaterials(raw: unknown): Materials {
  const base = freshMaterials();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Record<string, unknown>>;
  for (const k of BUCKETS) { const v = r[k]; if (typeof v === "number" && Number.isFinite(v) && v >= 0) base[k] = Math.floor(v); }
  return base;
}

export { CRAFT_SCHEMA_VERSION };
