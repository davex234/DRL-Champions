/**
 * SORTEO PONDERADO — la única línea de matemática nueva del bloque 8.3.
 *
 * ────────────────────────── QUÉ SUSTITUYE, Y POR QUÉ AQUÍ ──────────────────────────
 *
 * `openPack` elige la carta dentro de un bucket con `rng.pick(candidates)`, que es
 * UNIFORME. Ese es el único punto de todo el motor donde puede vivir la probabilidad por
 * carta: es literalmente la línea que decide cuál de las candidatas sale.
 *
 * Todo lo demás del motor —pesos por bucket, garantías, `guaranteedMin`, pity,
 * anti-duplicados, orden del pool, consumo del RNG— queda intacto.
 *
 * ────────────────────────── LA DEMOSTRACIÓN ──────────────────────────
 *
 * Esta función tiene que cumplir DOS cosas o la migración no puede ser segura:
 *
 * **1. Consume exactamente UNA llamada a `rng.next()`**, igual que `rng.pick`. Si
 *    consumiera dos, el flujo del generador se desplazaría y TODAS las cartas siguientes
 *    del sobre —y de la siguiente apertura con la misma semilla— cambiarían.
 *
 * **2. Con todos los pesos iguales a 1 devuelve EXACTAMENTE lo mismo que `rng.pick`.**
 *    No «casi»: el mismo índice, por la misma aritmética.
 *
 *        rng.pick(arr)  =  arr[ floor( next() · n ) ]
 *
 *        pickWeighted, con wᵢ = 1 para todo i:
 *          total = Σ wᵢ = n
 *          roll  = next() · n
 *          se devuelve el primer i tal que roll < Σ_{k≤i} wₖ = i+1
 *          ⟺ next()·n < i+1
 *          ⟺ i = floor( next()·n )                                        ∎
 *
 *    Y no es solo igualdad matemática: con w=1 las operaciones en coma flotante son
 *    literalmente las mismas (`next()*n` frente a `next()*n`, comparado contra enteros
 *    pequeños exactos), así que no hay margen de error de redondeo. Con pesos uniformes
 *    distintos de 1 la igualdad sigue siendo matemática pero pasa por más operaciones; por
 *    eso la migración usa **peso 1**, que es el caso exacto.
 *
 * `content-pools:verify` comprueba las dos propiedades contra el motor real, no aquí.
 */
import type { Rng } from "@/sim/rng";

/** El peso de una carta que nadie ha configurado. Es el que reproduce el sorteo actual. */
export const DEFAULT_WEIGHT = 1;

/**
 * Elige un elemento con probabilidad proporcional a su peso, consumiendo UNA sola tirada.
 *
 * `weightOf` debe devolver un número finito y positivo. Un peso no válido —0, negativo,
 * `NaN`, `Infinity`— se trata como `DEFAULT_WEIGHT` en vez de propagarse: un dato corrupto
 * no puede convertir el sorteo en un `undefined` en manos de un jugador. La base de datos
 * ya lo impide con un `CHECK` (`weight > 0 and weight <= 1000000`); esto es la segunda
 * puerta, para el caso de que la configuración llegue de otro sitio.
 */
export function pickWeighted<T>(arr: readonly T[], weightOf: (item: T) => number, rng: Rng): T {
  const n = arr.length;
  if (n === 0) throw new Error("pickWeighted: lista vacía");
  if (n === 1) {
    // Una sola candidata: el resultado no depende del azar, pero la tirada SE CONSUME
    // igualmente. `rng.pick` la consume, y no hacerlo desplazaría el flujo del generador —
    // que es precisamente el fallo que este módulo existe para no cometer.
    rng.next();
    return arr[0];
  }

  let total = 0;
  for (let i = 0; i < n; i++) total += safeWeight(weightOf(arr[i]));

  const roll = rng.next() * total;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += safeWeight(weightOf(arr[i]));
    if (roll < acc) return arr[i];
  }
  // Solo alcanzable por redondeo en el último tramo. Devolver la última es lo correcto:
  // es el elemento cuyo intervalo termina en `total`.
  return arr[n - 1];
}

/** ¿Todos los pesos son el valor por defecto? Entonces el sorteo es el de siempre. */
export function isUniform<T>(arr: readonly T[], weightOf: (item: T) => number): boolean {
  for (let i = 0; i < arr.length; i++) if (safeWeight(weightOf(arr[i])) !== DEFAULT_WEIGHT) return false;
  return true;
}

/**
 * Probabilidad efectiva de cada elemento, para explicar la distribución sin sortearla.
 * Es lo que consume la comprobación matemática de la Fase 16 y lo que podrá enseñar el
 * panel de 8.4 — calculado en el servidor, nunca en la interfaz.
 */
export function effectiveProbabilities<T>(
  arr: readonly T[], weightOf: (item: T) => number,
): { item: T; weight: number; p: number }[] {
  let total = 0;
  const ws = arr.map((it) => { const w = safeWeight(weightOf(it)); total += w; return w; });
  return arr.map((item, i) => ({ item, weight: ws[i], p: total > 0 ? ws[i] / total : 0 }));
}

function safeWeight(w: number): number {
  return Number.isFinite(w) && w > 0 ? w : DEFAULT_WEIGHT;
}
