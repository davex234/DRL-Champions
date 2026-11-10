/**
 * QUÉ CARTAS SALEN EN EL VESTÍBULO — reglas puras, deterministas y sobre datos REALES.
 *
 * ────────────────────────── POR QUÉ ESTO ES UN FICHERO APARTE ──────────────────────────
 *
 * La referencia de la Home enseña una carta legendaria enorme y varias flotando. La tentación es
 * inventar un sistema —«héroe del día», rotación diaria, recompensa— y la respuesta es NO: ese
 * sistema no existe en el producto, y fabricar una rotación falsa es prometer algo que nadie
 * cumple. Lo que sí se puede hacer sin inventar nada es ELEGIR bien entre lo que ya hay.
 *
 * La regla: la mejor carta que el jugador POSEE (primero rareza, y a igualdad, media). Si todavía
 * no tiene ninguna —cuenta recién creada, o sesión sin iniciar—, la mejor del catálogo, para que
 * la escena nunca esté vacía. Es determinista: la misma colección enseña siempre la misma carta.
 *
 * Puro: sin React, sin red, sin azar y sin reloj. Por eso se puede probar sin montar nada.
 */
import type { CardDef } from "@/domain/cards/types";

/** Lo mínimo que hace falta saber de una carta poseída. Coincide con el store. */
export interface OwnedLike { cardId: string; uid?: string }

type GetCard = (id: string) => CardDef | undefined;
/* El identificador de variante lo define la propia carta: nada de `string` suelto. */
type GetVariant = (variantId: CardDef["variantId"]) => { rank: number };

/** Orden canónico: rareza primero, media después. El mismo criterio que la vitrina de Fase 36. */
function mejorPrimero(getVariant: GetVariant) {
  return (a: CardDef, b: CardDef) => getVariant(b.variantId).rank - getVariant(a.variantId).rank || b.ovr - a.ovr;
}

/** Las cartas del jugador, sin duplicar por definición de carta, ya ordenadas de mejor a peor. */
function coleccionOrdenada(owned: OwnedLike[], getCard: GetCard, getVariant: GetVariant): CardDef[] {
  const vistas = new Set<string>();
  const defs: CardDef[] = [];
  for (const o of owned) {
    const def = getCard(o.cardId);
    if (!def || vistas.has(def.id)) continue;
    vistas.add(def.id);
    defs.push(def);
  }
  return defs.sort(mejorPrimero(getVariant));
}

/**
 * LA CARTA PROTAGONISTA. La mejor que se posee; si no se posee ninguna, la mejor del catálogo.
 * Nunca `null` mientras el catálogo tenga algo: la escena no puede quedarse sin protagonista.
 */
export function pickHeroCard(
  owned: OwnedLike[], getCard: GetCard, getVariant: GetVariant, catalogo: readonly CardDef[],
): CardDef | null {
  const mias = coleccionOrdenada(owned, getCard, getVariant);
  if (mias.length > 0) return mias[0];
  const todas = [...catalogo].sort(mejorPrimero(getVariant));
  return todas[0] ?? null;
}

/**
 * LAS CARTAS QUE VUELAN. Las siguientes mejores del jugador; se completa con catálogo cuando no
 * llegan, y NUNCA se repite la protagonista (ver la misma carta dos veces rompe la ilusión).
 */
export function pickHallCards(
  owned: OwnedLike[], getCard: GetCard, getVariant: GetVariant, catalogo: readonly CardDef[],
  hero: CardDef | null, cuantas = 5,
): CardDef[] {
  const fuera = new Set<string>(hero ? [hero.id] : []);
  const salida: CardDef[] = [];

  const empujar = (def: CardDef) => {
    if (fuera.has(def.id) || salida.length >= cuantas) return;
    fuera.add(def.id);
    salida.push(def);
  };

  for (const def of coleccionOrdenada(owned, getCard, getVariant)) empujar(def);
  /*
   * Relleno del catálogo REPARTIDO, no las cinco mejores seguidas: tomando las primeras salían
   * cinco cartas casi idénticas (misma rareza, misma paleta) y la escena parecía un catálogo
   * ordenado en vez de un puñado de cartas volando. El salto fijo da variedad sin usar azar, así
   * que la escena sigue siendo la misma en cada carga.
   */
  if (salida.length < cuantas) {
    const todas = [...catalogo].sort(mejorPrimero(getVariant));
    const salto = Math.max(1, Math.floor(todas.length / (cuantas * 4)));
    for (let i = 0; i < todas.length && salida.length < cuantas; i += salto) empujar(todas[i]);
  }
  return salida;
}
