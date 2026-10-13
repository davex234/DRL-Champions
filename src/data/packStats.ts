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
    packId: "estandar", price: 2500, cardCount: 5,
    drawn: { common: 0.9694, uncommon: 0.0208, rare: 0.0030, epic: 0.0059, legendary: 0.0009 },
    costPerRarity: { common: 516, uncommon: 24085, rare: 165563, epic: 84459, legendary: 574713 },
    meanValue: 1242, meanSalvage: 76,
    impossible: [],
  },
  "premium": {
    packId: "premium", price: 6000, cardCount: 6,
    drawn: { common: 0.8994, uncommon: 0.0729, rare: 0.0081, epic: 0.0171, legendary: 0.0025 },
    costPerRarity: { common: 1112, uncommon: 13724, rare: 123711, epic: 58337, legendary: 394737 },
    meanValue: 3341, meanSalvage: 201,
    impossible: [],
  },
  "oro": {
    packId: "oro", price: 12000, cardCount: 5,
    drawn: { common: 0.6034, uncommon: 0.2833, rare: 0.0299, epic: 0.0673, legendary: 0.0161 },
    costPerRarity: { common: 3977, uncommon: 8473, rare: 80321, epic: 35651, legendary: 149068 },
    meanValue: 8439, meanSalvage: 506,
    impossible: [],
  },
  "masters": {
    packId: "masters", price: 20000, cardCount: 5,
    drawn: { common: 0.2814, uncommon: 0.4766, rare: 0.0508, epic: 0.1606, legendary: 0.0306 },
    costPerRarity: { common: 14213, uncommon: 8392, rare: 78802, epic: 24907, legendary: 130847 },
    meanValue: 15785, meanSalvage: 949,
    impossible: [],
  },
  "champions": {
    packId: "champions", price: 35000, cardCount: 5,
    drawn: { common: 0.1605, uncommon: 0.2659, rare: 0.1386, epic: 0.3791, legendary: 0.0559 },
    costPerRarity: { common: 43606, uncommon: 26327, rare: 50494, epic: 18466, legendary: 125268 },
    meanValue: 28686, meanSalvage: 1724,
    impossible: [],
  },
  "ewc": {
    packId: "ewc", price: 8500, cardCount: 5,
    drawn: { common: 0.7686, uncommon: 0.0314, rare: 0.0000, epic: 0.1981, legendary: 0.0019 },
    costPerRarity: { common: 2212, uncommon: 54071, epic: 8582, legendary: 885417 },
    meanValue: 4549, meanSalvage: 275,
    impossible: [],
  },
  "emea": {
    packId: "emea", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "americas": {
    packId: "americas", price: 3500, cardCount: 5,
    drawn: { common: 0.9364, uncommon: 0.0560, rare: 0.0018, epic: 0.0053, legendary: 0.0006 },
    costPerRarity: { common: 748, uncommon: 12509, rare: 393258, epic: 130841, legendary: 1272727 },
    meanValue: 1567, meanSalvage: 93,
    impossible: [],
  },
  "pacific": {
    packId: "pacific", price: 3500, cardCount: 5,
    drawn: { common: 0.9264, uncommon: 0.0616, rare: 0.0030, epic: 0.0081, legendary: 0.0009 },
    costPerRarity: { common: 756, uncommon: 11371, rare: 231788, epic: 86313, legendary: 804598 },
    meanValue: 1595, meanSalvage: 98,
    impossible: [],
  },
  "china": {
    packId: "china", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-heretics": {
    packId: "team-heretics", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-fnatic": {
    packId: "team-fnatic", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-navi": {
    packId: "team-navi", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-g2": {
    packId: "team-g2", price: 3500, cardCount: 5,
    drawn: { common: 0.9364, uncommon: 0.0560, rare: 0.0018, epic: 0.0053, legendary: 0.0006 },
    costPerRarity: { common: 748, uncommon: 12509, rare: 393258, epic: 130841, legendary: 1272727 },
    meanValue: 1567, meanSalvage: 93,
    impossible: [],
  },
  "prime": {
    packId: "prime", price: 10000, cardCount: 4,
    drawn: { common: 0.0000, uncommon: 0.1886, rare: 0.2629, epic: 0.4125, legendary: 0.1359 },
    costPerRarity: { uncommon: 13254, rare: 9508, epic: 6060, legendary: 18391 },
    meanValue: 36712, meanSalvage: 2206,
    impossible: [],
  },
  "icon": {
    packId: "icon", price: 60000, cardCount: 3,
    drawn: { common: 0.0000, uncommon: 0.0000, rare: 0.6463, epic: 0.0000, legendary: 0.3537 },
    costPerRarity: { rare: 30945, legendary: 56548 },
    meanValue: 49691, meanSalvage: 2983,
    impossible: [],
  },
  "team-loud": {
    packId: "team-loud", price: 3500, cardCount: 5,
    drawn: { common: 0.9364, uncommon: 0.0560, rare: 0.0018, epic: 0.0053, legendary: 0.0006 },
    costPerRarity: { common: 748, uncommon: 12509, rare: 393258, epic: 130841, legendary: 1272727 },
    meanValue: 1567, meanSalvage: 93,
    impossible: [],
  },
  "team-blg": {
    packId: "team-blg", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-te": {
    packId: "team-te", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-jdg": {
    packId: "team-jdg", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-liquid": {
    packId: "team-liquid", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-tyl": {
    packId: "team-tyl", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-karmine": {
    packId: "team-karmine", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-m8": {
    packId: "team-m8", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-fut": {
    packId: "team-fut", price: 3500, cardCount: 5,
    drawn: { common: 0.9307, uncommon: 0.0595, rare: 0.0022, epic: 0.0071, legendary: 0.0006 },
    costPerRarity: { common: 752, uncommon: 11773, rare: 318182, epic: 99150, legendary: 1272727 },
    meanValue: 1533, meanSalvage: 93,
    impossible: [],
  },
  "team-100t": {
    packId: "team-100t", price: 3500, cardCount: 5,
    drawn: { common: 0.9364, uncommon: 0.0560, rare: 0.0018, epic: 0.0053, legendary: 0.0006 },
    costPerRarity: { common: 748, uncommon: 12509, rare: 393258, epic: 130841, legendary: 1272727 },
    meanValue: 1567, meanSalvage: 93,
    impossible: [],
  },
  "team-prx": {
    packId: "team-prx", price: 3500, cardCount: 5,
    drawn: { common: 0.9264, uncommon: 0.0616, rare: 0.0030, epic: 0.0081, legendary: 0.0009 },
    costPerRarity: { common: 756, uncommon: 11371, rare: 231788, epic: 86313, legendary: 804598 },
    meanValue: 1595, meanSalvage: 98,
    impossible: [],
  },
  "team-ns": {
    packId: "team-ns", price: 3500, cardCount: 5,
    drawn: { common: 0.9264, uncommon: 0.0616, rare: 0.0030, epic: 0.0081, legendary: 0.0009 },
    costPerRarity: { common: 756, uncommon: 11371, rare: 231788, epic: 86313, legendary: 804598 },
    meanValue: 1595, meanSalvage: 98,
    impossible: [],
  },
  "team-ge": {
    packId: "team-ge", price: 3500, cardCount: 5,
    drawn: { common: 0.9264, uncommon: 0.0616, rare: 0.0030, epic: 0.0081, legendary: 0.0009 },
    costPerRarity: { common: 756, uncommon: 11371, rare: 231788, epic: 86313, legendary: 804598 },
    meanValue: 1595, meanSalvage: 98,
    impossible: [],
  },
  "team-xlg": {
    packId: "team-xlg", price: 9500, cardCount: 5,
    drawn: { common: 0.0000, uncommon: 0.9880, rare: 0.0000, epic: 0.0120, legendary: 0.0000 },
    costPerRarity: { uncommon: 1923, epic: 158333 },
    meanValue: 4642, meanSalvage: 276,
    impossible: ["common", "rare"],
  },
  "team-lev": {
    packId: "team-lev", price: 3500, cardCount: 5,
    drawn: { common: 0.9364, uncommon: 0.0560, rare: 0.0018, epic: 0.0053, legendary: 0.0006 },
    costPerRarity: { common: 748, uncommon: 12509, rare: 393258, epic: 130841, legendary: 1272727 },
    meanValue: 1567, meanSalvage: 93,
    impossible: [],
  },
};

export const packStats = (packId: string): PackStatRow | null => PACK_STATS[packId] ?? null;
