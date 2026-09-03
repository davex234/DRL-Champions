/**
 * PARA QUÉ SIRVE CADA SOBRE (Fase 12) — dominio PURO, derivado de lo MEDIDO.
 *
 * ────────────────────────── EL PROBLEMA ──────────────────────────
 *
 * La simulación de la Fase 11 encontró algo que la tienda no dice: **el sobre caro NO
 * completa la colección más rápido**. Un perfil Activo gasta 3,3 veces más que un Casual y
 * acaba con MENOS cartas distintas (418 frente a 453), porque los sobres caros empujan
 * hacia rarezas con muy pocas cartas —34 raras, 9 épicas, 7 legendarias en un catálogo de
 * 772— y por eso repiten muchísimo más.
 *
 * Mientras tanto la tienda enseña una barra de colores y un precio. Un jugador que quiere
 * completar colección y compra Champions porque «es mejor» está tomando la peor decisión
 * posible con la información que le hemos dado. Eso es una promesa falsa por omisión.
 *
 * ────────────────────────── LA RESPUESTA ──────────────────────────
 *
 * No es un texto de marketing escrito a mano: es una conclusión **calculada** a partir de
 * `data/packStats`, que a su vez está medido con el motor real. Para cada sobre:
 *
 *   · ¿Para qué rareza es la vía MÁS BARATA de todo el catálogo?
 *   · ¿Cuánto cuesta, en créditos, una carta de esa rareza comprando este sobre?
 *   · ¿Promete alguna rareza que NO puede entregar?
 *
 * Si el catálogo cambia, la frase cambia sola. No hay ninguna afirmación que un cambio de
 * datos pueda dejar mintiendo, que es la única forma de que una tienda no mienta.
 */
import { PACK_STATS, packStats, type PackStatRow } from "@/data/packStats";
import { PACKS } from "@/data/packs";
import { BUCKET_LABEL, type RarityBucket } from "./types";

const BUCKETS: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Las rarezas «de colección»: son el 93,5 % del catálogo (299 + 423 de 772 cartas). */
const BREADTH: RarityBucket[] = ["common", "uncommon"];

export interface PackGuidance {
  /** Rareza para la que este sobre es la vía más barata del catálogo, si lo es de alguna. */
  bestFor: RarityBucket | null;
  /** Lo que cuesta una carta de esa rareza comprando este sobre. */
  bestCost: number | null;
  /** Una frase. Lo que este sobre hace mejor que los demás, o que no destaca en nada. */
  headline: string;
  /** Lo que el jugador debería saber antes de pagar, y que hoy no se le dice. */
  warnings: string[];
  /** Coste por carta de cada rareza, para enseñarlo al lado del reparto. */
  costPerRarity: Partial<Record<RarityBucket, number>>;
}

/** Para cada rareza, qué sobre la consigue más barata. Se calcula una vez. */
function cheapestByBucket(): Partial<Record<RarityBucket, { packId: string; cost: number }>> {
  const out: Partial<Record<RarityBucket, { packId: string; cost: number }>> = {};
  for (const row of Object.values(PACK_STATS) as PackStatRow[]) {
    for (const b of BUCKETS) {
      const cost = row.costPerRarity[b];
      if (cost === undefined) continue;
      const cur = out[b];
      if (!cur || cost < cur.cost) out[b] = { packId: row.packId, cost };
    }
  }
  return out;
}

const CHEAPEST = cheapestByBucket();

/** Exportado para las pruebas y para el informe: la vía barata de cada rareza. */
export const cheapestPackFor = (b: RarityBucket): { packId: string; cost: number } | null =>
  CHEAPEST[b] ?? null;

export function guidanceFor(packId: string): PackGuidance | null {
  const row = packStats(packId);
  if (!row) return null;

  // Gana la rareza MÁS ALTA para la que este sobre es la vía barata: es la que lo define.
  let bestFor: RarityBucket | null = null;
  for (const b of BUCKETS) if (CHEAPEST[b]?.packId === packId) bestFor = b;
  const bestCost = bestFor ? (CHEAPEST[bestFor]?.cost ?? null) : null;

  const warnings: string[] = [];

  /*
   * Advertencia 1 — lo imposible. Un sobre que declara un 6 % de épicas sin una sola carta
   * épica elegible está cobrando por algo que no puede dar. Le pasa hoy al sobre China.
   */
  if (row.impossible.length > 0) {
    const names = row.impossible.map((b) => BUCKET_LABEL[b].toLowerCase()).join(" ni ");
    warnings.push(`No contiene ninguna carta ${names}: no hay jugadores de esta selección con esa rareza.`);
  }

  /*
   * Advertencia 2 — la de la Fase 11. Un sobre que no es la vía barata de ninguna rareza de
   * colección concentra el sorteo en un puñado de cartas, y eso significa repetir. Decirlo
   * es la diferencia entre vender rareza y prometer colección.
   */
  const isBreadth = bestFor !== null && BREADTH.includes(bestFor);
  if (!isBreadth && row.price > 0) {
    const cheap = CHEAPEST.common;
    const factor = cheap && row.costPerRarity.common
      ? Math.round(row.costPerRarity.common / cheap.cost)
      : null;
    warnings.push(
      factor && factor > 1
        ? `Para AMPLIAR colección sale caro: cada carta común cuesta unas ${factor} veces más que en el sobre barato.`
        : "Está pensado para perseguir rareza, no para ampliar colección.",
    );
  }

  /*
   * Un sobre que no gana en ninguna rareza no es necesariamente malo: puede estar DIRIGIDO.
   * Los cuatro regionales sortean solo entre jugadores de una selección, y los de torneo
   * solo entre sus grupos. Eso se paga en eficiencia y se compra en puntería, y decirlo así
   * es más honesto que un «no es la vía más barata» a secas, que suena a defecto cuando es
   * una decisión de diseño.
   */
  const def = PACKS.find((p) => p.id === packId);
  const targeted = def?.restrictRegion
    ? `jugadores de ${def.restrictRegion}`
    : def?.restrictGroups?.length
      ? "cartas de torneo"
      : null;

  const headline = bestFor !== null
    ? isBreadth
      ? `La vía más barata para AMPLIAR colección: ${BUCKET_LABEL[bestFor].toLowerCase()} desde ${Math.round(bestCost!)} créditos por carta.`
      : `La vía más barata para conseguir una ${BUCKET_LABEL[bestFor].toLowerCase()}: unos ${Math.round(bestCost!)} créditos por carta.`
    : targeted
      ? `Sortea solo entre ${targeted}. No es el más barato: es el más dirigido.`
      : "Ningún otro sobre lo supera en nada: hay opciones más baratas para cualquier rareza.";

  return { bestFor, bestCost, headline, warnings, costPerRarity: row.costPerRarity };
}
