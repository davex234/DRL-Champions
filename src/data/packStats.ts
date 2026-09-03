/**
 * ESTADÍSTICA DE SOBRES — GENERADO, NO ESCRITO A MANO.
 *
 *   npm run economy:model -- --emit
 *
 * Medido con el motor de sorteo REAL sobre 20.000 aperturas por sobre,
 * semilla 90210, colección vacía en cada apertura.
 *
 * Existe para que la tienda pueda enseñar el reparto de rareza que un sobre entrega DE
 * VERDAD, en vez de los pesos declarados en `data/packs`, que no coinciden: una garantía
 * de «rara o mejor» ocupa una casilla y desplaza el reparto entero.
 *
 * `src/data/packStats.test.ts` vuelve a medir con una muestra pequeña y compara. Si se
 * tocan los pesos, los precios o el catálogo, ese test cae y este fichero hay que
 * regenerarlo. Es la red que impide que la tienda mienta sin que nadie se entere.
 */
import type { RarityBucket } from "@/domain/packs/types";

export interface PackStatRow {
  packId: string;
  price: number;
  cardCount: number;
  /** Reparto de rareza REAL, en tanto por uno. Suma 1. */
  drawn: Record<RarityBucket, number>;
  /** Lo que cuesta, de media, UNA carta de cada rareza comprando este sobre. */
  costPerRarity: Partial<Record<RarityBucket, number>>;
  /** Valor de mercado medio del contenido del sobre. */
  meanValue: number;
  /** Lo que devolvería desguazar el sobre entero. */
  meanSalvage: number;
  /** Rarezas con peso declarado que este sobre NO PUEDE entregar: no hay cartas. */
  impossible: RarityBucket[];
}

export const PACK_STATS_SAMPLE = 20000;
export const PACK_STATS_SEED = 90210;

export const PACK_STATS: Record<string, PackStatRow> = {
  "estandar": {
    packId: "estandar", price: 750, cardCount: 5,
    drawn: { common: 0.5526, uncommon: 0.3481, rare: 0.0797, epic: 0.0176, legendary: 0.0020 },
    costPerRarity: { common: 271, uncommon: 431, rare: 1882, epic: 8532, legendary: 74257 },
    meanValue: 2568, meanSalvage: 353,
    impossible: [],
  },
  "premium": {
    packId: "premium", price: 2500, cardCount: 6,
    drawn: { common: 0.2522, uncommon: 0.3744, rare: 0.2684, epic: 0.0900, legendary: 0.0150 },
    costPerRarity: { common: 1652, uncommon: 1113, rare: 1552, epic: 4630, legendary: 27840 },
    meanValue: 8621, meanSalvage: 992,
    impossible: [],
  },
  "masters": {
    packId: "masters", price: 5000, cardCount: 5,
    drawn: { common: 0.0809, uncommon: 0.3217, rare: 0.2393, epic: 0.3039, legendary: 0.0542 },
    costPerRarity: { common: 12364, uncommon: 3108, rare: 4179, epic: 3290, legendary: 18460 },
    meanValue: 14476, meanSalvage: 1709,
    impossible: [],
  },
  "champions": {
    packId: "champions", price: 8000, cardCount: 5,
    drawn: { common: 0.0405, uncommon: 0.2410, rare: 0.2806, epic: 0.3209, legendary: 0.1170 },
    costPerRarity: { common: 39545, uncommon: 6640, rare: 5702, epic: 4986, legendary: 13672 },
    meanValue: 20551, meanSalvage: 2270,
    impossible: [],
  },
  "ewc": {
    packId: "ewc", price: 6000, cardCount: 5,
    drawn: { common: 0.0653, uncommon: 0.3044, rare: 0.2560, epic: 0.3230, legendary: 0.0513 },
    costPerRarity: { common: 18371, uncommon: 3942, rare: 4688, epic: 3715, legendary: 23401 },
    meanValue: 14754, meanSalvage: 1752,
    impossible: [],
  },
  "emea": {
    packId: "emea", price: 3000, cardCount: 5,
    drawn: { common: 0.3521, uncommon: 0.3999, rare: 0.1782, epic: 0.0597, legendary: 0.0101 },
    costPerRarity: { common: 1704, uncommon: 1500, rare: 3367, epic: 10045, legendary: 59524 },
    meanValue: 5527, meanSalvage: 631,
    impossible: [],
  },
  "americas": {
    packId: "americas", price: 3000, cardCount: 5,
    drawn: { common: 0.3521, uncommon: 0.3999, rare: 0.1782, epic: 0.0597, legendary: 0.0101 },
    costPerRarity: { common: 1704, uncommon: 1500, rare: 3367, epic: 10045, legendary: 59524 },
    meanValue: 5259, meanSalvage: 631,
    impossible: [],
  },
  "pacific": {
    packId: "pacific", price: 3000, cardCount: 5,
    drawn: { common: 0.3521, uncommon: 0.3999, rare: 0.1782, epic: 0.0597, legendary: 0.0101 },
    costPerRarity: { common: 1704, uncommon: 1500, rare: 3367, epic: 10045, legendary: 59524 },
    meanValue: 4968, meanSalvage: 631,
    impossible: [],
  },
  "china": {
    packId: "china", price: 3000, cardCount: 5,
    drawn: { common: 0.3791, uncommon: 0.4288, rare: 0.1921, epic: 0.0000, legendary: 0.0000 },
    costPerRarity: { common: 1583, uncommon: 1399, rare: 3123 },
    meanValue: 2804, meanSalvage: 399,
    impossible: [],
  },
  "prime": {
    packId: "prime", price: 10000, cardCount: 4,
    drawn: { common: 0.0000, uncommon: 0.1886, rare: 0.2629, epic: 0.4125, legendary: 0.1359 },
    costPerRarity: { uncommon: 13254, rare: 9508, epic: 6060, legendary: 18391 },
    meanValue: 21884, meanSalvage: 2123,
    impossible: [],
  },
  "icon": {
    packId: "icon", price: 20000, cardCount: 3,
    drawn: { common: 0.0000, uncommon: 0.0000, rare: 0.2010, epic: 0.2994, legendary: 0.4996 },
    costPerRarity: { rare: 33165, epic: 22270, legendary: 13343 },
    meanValue: 36726, meanSalvage: 3058,
    impossible: [],
  },
};

export const packStats = (packId: string): PackStatRow | null => PACK_STATS[packId] ?? null;
