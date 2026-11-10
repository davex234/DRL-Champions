/**
 * RNG DETERMINISTA Y SERIALIZABLE (Fase 6).
 *
 * REUTILIZA el algoritmo estándar del proyecto —mulberry32, el mismo de `@/sim/rng`, que ya usan
 * los sobres, el battle pass y el modo carrera— pero en forma de VALOR y no de cierre.
 *
 * `makeRng` guarda su estado en una variable capturada, así que no se puede serializar: una partida
 * pausada perdería la posición del generador y las decisiones futuras del bot cambiarían. Aquí el
 * estado es un objeto plano, así que una partida se guarda, se carga y continúa exactamente igual.
 *
 * Cada operación es PURA: recibe un estado y devuelve el valor MÁS el estado siguiente. No hay
 * mutación, no hay estado global y no existe `Math.random`.
 *
 * La secuencia numérica es idéntica a la de `makeRng(seed)`, y hay un test que lo verifica.
 */

/** Estado del generador. Plano y serializable a JSON. */
export interface RngState {
  algorithm: "mulberry32";
  /** Semilla original. Se conserva para poder reiniciar y para trazabilidad. */
  seed: number;
  /** Estado interno actual (entero de 32 bits sin signo). */
  state: number;
  /** Cuántos valores se han extraído. Solo informativo. */
  draws: number;
}

/** Crea un generador a partir de una semilla. La semilla entra SIEMPRE desde fuera. */
export function createRng(seed: number): RngState {
  const s = normalizeSeed(seed);
  return { algorithm: "mulberry32", seed: s, state: s, draws: 0 };
}

/**
 * Normaliza cualquier número a un entero de 32 bits sin signo.
 * Acepta negativos, decimales, enormes, `NaN` e infinitos sin romperse: es la frontera que evita
 * que una semilla extraña produzca un generador inválido.
 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

/** ¿Es un estado de generador válido? Frontera de entrada para estados que vienen de fuera. */
export function isRngState(v: unknown): v is RngState {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<RngState>;
  return (
    s.algorithm === "mulberry32" &&
    typeof s.seed === "number" && Number.isFinite(s.seed) &&
    typeof s.state === "number" && Number.isFinite(s.state) &&
    typeof s.draws === "number" && Number.isFinite(s.draws) && s.draws >= 0
  );
}

/** Siguiente flotante en [0,1). Devuelve el valor y el estado siguiente. */
export function nextFloat(rng: RngState): { value: number; rng: RngState } {
  let a = (rng.state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { ...rng, state: a >>> 0, draws: rng.draws + 1 } };
}

/** Entero en [min, max], ambos inclusive. */
export function nextInt(rng: RngState, min: number, max: number): { value: number; rng: RngState } {
  if (max <= min) return { value: min, rng };
  const r = nextFloat(rng);
  return { value: min + Math.floor(r.value * (max - min + 1)), rng: r.rng };
}

/**
 * Elige un elemento de una lista NO vacía.
 * Con lista vacía devuelve `undefined` y NO consume el generador: así una situación imposible no
 * desplaza la secuencia y arruina la reproducibilidad.
 */
export function pick<T>(rng: RngState, arr: readonly T[]): { value: T | undefined; rng: RngState } {
  if (arr.length === 0) return { value: undefined, rng };
  const r = nextInt(rng, 0, arr.length - 1);
  return { value: arr[r.value], rng: r.rng };
}
