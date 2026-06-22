import type { CardDef } from "../cards/types";
import { getVariant } from "../cards/variants";
import { CARDS, getPlayer } from "@/data/catalog";
import type { PackDef, RarityBucket } from "./types";
import { bucketForRank } from "./types";

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];
const BUCKET_INDEX: Record<RarityBucket, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

type Rng = () => number;

/** Devuelve el pool de cartas elegibles para un sobre, agrupado por bucket. */
function eligiblePool(pack: PackDef): Record<RarityBucket, CardDef[]> {
  const pool: Record<RarityBucket, CardDef[]> = {
    common: [],
    uncommon: [],
    rare: [],
    epic: [],
    legendary: [],
  };

  for (const card of CARDS) {
    const variant = getVariant(card.variantId);
    if (pack.restrictGroups && !pack.restrictGroups.includes(variant.group)) continue;
    if (pack.restrictRegion) {
      const player = getPlayer(card.playerId);
      if (!player || player.region !== pack.restrictRegion) continue;
    }
    pool[bucketForRank(variant.rank)].push(card);
  }

  return pool;
}

/** Elige un bucket con probabilidad ponderada, ignorando buckets vacíos. */
function rollBucket(
  weights: Record<RarityBucket, number>,
  pool: Record<RarityBucket, CardDef[]>,
  minBucket: RarityBucket | undefined,
  rng: Rng,
): RarityBucket | null {
  const minIdx = minBucket ? BUCKET_INDEX[minBucket] : 0;
  const candidates = BUCKETS.filter(
    (b) => BUCKET_INDEX[b] >= minIdx && weights[b] > 0 && pool[b].length > 0,
  );

  // Fallback: si el mínimo garantizado no tiene stock, usa el bucket más alto disponible.
  const usable = candidates.length
    ? candidates
    : BUCKETS.filter((b) => pool[b].length > 0);
  if (!usable.length) return null;
  if (candidates.length === 0) {
    return usable[usable.length - 1];
  }

  const total = usable.reduce((s, b) => s + weights[b], 0);
  let roll = rng() * total;
  for (const b of usable) {
    roll -= weights[b];
    if (roll <= 0) return b;
  }
  return usable[usable.length - 1];
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Abre un sobre y devuelve las cartas obtenidas (definiciones).
 * La asignación de número de serie la hace el store (necesita el contador
 * global de acuñación). Función pura: acepta un RNG inyectable para tests.
 */
export function openPack(pack: PackDef, rng: Rng = Math.random): CardDef[] {
  const pool = eligiblePool(pack);
  const results: CardDef[] = [];

  for (let i = 0; i < pack.cardCount; i++) {
    const isLast = i === pack.cardCount - 1;
    const minBucket = isLast ? pack.guaranteedMin : undefined;
    const bucket = rollBucket(pack.weights, pool, minBucket, rng);
    if (!bucket) continue;
    results.push(pick(pool[bucket], rng));
  }

  // Ordena de menor a mayor rareza para que el reveal sea de menos a más épico.
  results.sort((a, b) => getVariant(a.variantId).rank - getVariant(b.variantId).rank);
  return results;
}
