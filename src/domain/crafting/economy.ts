/**
 * F73 · ECONOMÍA DEL CRAFTEO — la regla que decide cuántas unidades cuesta subir de categoría. PURA.
 *
 * El crafteo no puede crear valor: solo CONVIERTE lo que ya tienes (duplicados, sobres ganados) en algo de categoría
 * superior, y siempre con pérdida. Para cada receta se exige, a la vez, que la ruta de crafteo sea al menos un
 * `CRAFT_PREMIUM` (25 %) PEOR que la ruta directa en TODAS las medidas que la economía congelada conoce:
 *
 *   precio      X · precio(entrada)          ≥ 1,25 · precio(salida)          (nunca es más barato craftear que comprar)
 *   valor       X · valor(entrada, peor caso) ≥ 1,25 · valor(salida, media)    (no se fabrica valor de colección)
 *   desguace    X · desguace(entrada)         ≥ 1,25 · desguace(salida)        (no hay bucle crafteo → desguace → créditos)
 *
 * «peor caso» = lo que más le conviene a quien intenta explotarlo: en cartas, las entradas MÁS BARATAS de su clase y la
 * salida MEDIA de la clase superior (la salida es aleatoria). En sobres, medias de 20.000 aperturas del motor real.
 * X nunca baja de 2 (un 1→1 sería un cambio de categoría gratis). Si X sale por encima de `CRAFT_MAX_INPUT`, la receta
 * no es jugable con un coste seguro: se propone DESACTIVADA.
 *
 * Nada de aquí cambia precios, probabilidades, valores ni desguace: los LEE.
 */

export const CRAFT_PREMIUM = 1.25;
export const CRAFT_MIN_INPUT = 2;
/** Por encima de esto la receta no es razonable para un jugador: se deja desactivada (propuesta). */
export const CRAFT_MAX_INPUT = 40;

export interface ValueSide {
  /** Coste en créditos por unidad (precio del sobre, o coste medio de conseguir UNA carta de la clase comprando). */
  cost: number;
  /** Valor de mercado por unidad (media de la salida; mínimo de la entrada). */
  value: number;
  /** Desguace por unidad (ídem). */
  salvage: number;
}

export interface RatioAnalysis {
  input: ValueSide;
  output: ValueSide;
  /** Unidades mínimas que satisfacen CADA medida por separado. */
  byCost: number;
  byValue: number;
  bySalvage: number;
  /** El ratio propuesto: el máximo de las tres y del mínimo absoluto. */
  ratio: number;
  /** Pérdida efectiva de la ruta de crafteo frente a la directa, en cada medida (1 − salida/entrada·X). */
  lossCost: number;
  lossValue: number;
  lossSalvage: number;
  /** ¿Es jugable (X ≤ CRAFT_MAX_INPUT)? Si no, se propone desactivada. */
  viable: boolean;
}

const need = (outV: number, inV: number) => (inV > 0 ? Math.ceil((CRAFT_PREMIUM * outV) / inV - 1e-9) : Number.POSITIVE_INFINITY);
const loss = (outV: number, inV: number, x: number) => (inV > 0 ? +(1 - outV / (inV * x)).toFixed(4) : 1);

export function analyzeRatio(input: ValueSide, output: ValueSide): RatioAnalysis {
  const byCost = need(output.cost, input.cost);
  const byValue = need(output.value, input.value);
  const bySalvage = need(output.salvage, input.salvage);
  const ratio = Math.max(CRAFT_MIN_INPUT, byCost, byValue, bySalvage);
  return {
    input, output, byCost, byValue, bySalvage, ratio,
    lossCost: loss(output.cost, input.cost, ratio),
    lossValue: loss(output.value, input.value, ratio),
    lossSalvage: loss(output.salvage, input.salvage, ratio),
    viable: Number.isFinite(ratio) && ratio <= CRAFT_MAX_INPUT,
  };
}

/** ¿Es segura una receta con `qty` entradas? (lo que valida el admin antes de ACTIVAR). */
export function ratioIsSafe(qty: number, a: Pick<RatioAnalysis, "ratio" | "viable">): boolean {
  return a.viable && Number.isInteger(qty) && qty >= a.ratio && qty <= 100;
}
