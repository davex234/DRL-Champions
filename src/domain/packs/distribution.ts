/**
 * DISTRIBUCIÓN — la configuración de pool vista desde el dominio (Bloque 8.3).
 *
 * El motor de sobres no sabe que existe una base de datos, y no va a empezar a saberlo. Lo
 * que recibe es esta forma: para un sobre concreto, **qué cartas pertenecen a su pool** y
 * **cuánto pesa cada una**. De dónde salga eso —`content_pools` en producción, un objeto
 * literal en un test— es problema de quien la construye.
 *
 * ────────────────────────── LA REGLA DE COMPATIBILIDAD ──────────────────────────
 *
 * `null` significa «este sobre no tiene pool configurado», y entonces **todo se comporta
 * exactamente como antes de 8.3**: elegibilidad por las restricciones del `PackDef` y
 * sorteo uniforme. No es un caso degradado, es el caso por defecto: hoy los 12 sobres
 * funcionan así y tienen que seguir funcionando así hasta que alguien configure un pool
 * a propósito.
 *
 * ────────────────────────── NARROW, NO WIDEN ──────────────────────────
 *
 * Un pool INTERSECA con las restricciones del `PackDef`; no las sustituye. Un sobre de EMEA
 * con un pool no puede empezar a repartir cartas de Pacific.
 *
 * Es deliberado y tiene un porqué: mientras `PackDef` siga viviendo en código (§0 de la
 * migración 0039), sus restricciones son la única barrera que impide que una configuración
 * administrativa contradiga lo que el sobre dice ser. Poder ESTRECHAR y REPONDERAR cubre
 * todo lo que 8.3 necesita; poder ENSANCHAR exige que el sobre entero sea administrable, y
 * eso es 8.4. Queda declarado como deuda, no como olvido.
 */
import type { CardDef } from "../cards/types";
import { DEFAULT_WEIGHT } from "./weighted";

/** Una entrada de pool tal y como la ve el dominio. */
export interface PoolEntry {
  cardId: string;
  weight: number;
  mode: "INCLUDE" | "EXCLUDE";
}

/** Reglas de elegibilidad de un pool. Mismo vocabulario que `PackDef` — no uno nuevo. */
export interface PoolRules {
  groups?: string[];
  region?: string;
  variants?: string[];
  excludeVariants?: string[];
  series?: string[];
  serializedOnly?: boolean;
}

export interface PoolDef {
  id: string;
  mode: "RULE" | "EXPLICIT" | "MIXED";
  rules: PoolRules;
  entries: PoolEntry[];
  availableFrom?: number | null;
  availableTo?: number | null;
}

/**
 * La configuración resuelta para UN sobre: la única forma que el motor consume.
 *
 * `members` es `null` cuando la pertenencia no la decide el pool (modo `RULE` puro sin
 * lista explícita): en ese caso la elegibilidad la siguen decidiendo las reglas y el
 * `PackDef`, y el pool solo aporta pesos.
 */
export interface PackDistribution {
  /** Identificador estable de esta configuración. Entra en la clave de la caché del pool. */
  key: string;
  /** `null` = la pertenencia no la restringe una lista explícita. */
  members: Set<string> | null;
  /** Cartas expulsadas del pool aunque las reglas las incluyeran. */
  excluded: Set<string>;
  /** Peso de una carta. `DEFAULT_WEIGHT` si nadie lo ha configurado. */
  weightOf(cardId: string): number;
  /** ¿Todos los pesos son el de por defecto? Si sí, el sorteo es idéntico al anterior. */
  uniform: boolean;
}

/**
 * HUELLA DE UN POOL — lo que hace que su clave de caché signifique algo.
 *
 * ────────────────────────── EL FALLO QUE ESTO CIERRA ──────────────────────────
 *
 * Hasta 8.4.3 la clave era `${pool.id}#${pool.entries.length}`: el identificador del pool y
 * **cuántas** entradas tenía. Dos configuraciones distintas con el mismo número de entradas
 * producían la misma clave, y `buildPool` cachea la PERTENENCIA por esa clave. Medido:
 *
 *     pool A = [derke__prime, benjy__silver, aaaay__silver]   → clave `sonda#3`
 *     pool B = [derke__prime, benjy__silver, vora__silver]    → clave `sonda#3`
 *     buildPool(registro, sobre, B)  devuelve el pool de A.
 *
 * Es decir: un administrador que sustituyera una carta por otra —o que cambiara una entrada
 * de INCLUDE a EXCLUDE— dejaba la base de datos correcta y el proceso servidor repartiendo la
 * configuración ANTERIOR indefinidamente, hasta que cambiara el catálogo o alguien reiniciara.
 * Exactamente el escenario que la Fase 12 de 8.3 declaraba cerrado.
 *
 * No se vio en 8.3 porque sus pruebas cambiaban de pool desvinculando uno y vinculando otro
 * con distinto id: la clave cambiaba por el id, no por el contenido. Un cambio DENTRO del
 * mismo pool nunca se ejercitó.
 *
 * ────────────────────────── POR QUÉ ASÍ ──────────────────────────
 *
 * La huella cubre `cardId`, `mode` y `weight` de cada entrada, ordenados: es la identidad de
 * la configuración, no del trozo que hoy se cachea. Un peso no afecta a lo que `buildPool`
 * guarda —los pesos los aplica `weightOf` en el momento de elegir— pero incluirlo cuesta nada
 * y evita tener que razonar sobre qué parte de la configuración entra en la clave y cuál no.
 *
 * `revision` de la base de datos habría servido igual, pero solo para los pools que vienen de
 * la base: un `PoolDef` construido a mano en una prueba no la tiene. Del contenido siempre se
 * puede derivar.
 *
 * FNV-1a de 32 bits: barato, sin dependencias y suficiente para distinguir configuraciones.
 * No es criptográfico y no pretende serlo — la huella auditable del pool vive en SQL
 * (`_pool_checksum`, sha256) y esta solo tiene que separar claves de caché.
 */
function poolFingerprint(pool: PoolDef): string {
  let h = 0x811c9dc5;
  const mezcla = (txt: string): void => {
    for (let i = 0; i < txt.length; i++) {
      h ^= txt.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  mezcla(pool.mode);
  mezcla(JSON.stringify(pool.rules ?? {}));
  // Ordenado: dos listas con las mismas entradas en otro orden son la MISMA configuración.
  for (const e of [...pool.entries].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0))) {
    mezcla(`|${e.cardId}:${e.mode}:${e.weight}`);
  }
  return `${pool.entries.length}.${h.toString(36)}`;
}

/**
 * ¿Es esta carta elegible según el pool? Se llama DESPUÉS de `isEligible` del `PackDef`,
 * nunca en su lugar (ver «narrow, no widen»).
 */
export function poolAllows(dist: PackDistribution | null, card: CardDef): boolean {
  if (!dist) return true;
  if (dist.excluded.has(card.id)) return false;
  if (dist.members && !dist.members.has(card.id)) return false;
  return true;
}

/**
 * Compone la configuración de un sobre a partir de sus pools ACTIVOS.
 *
 * Cuando una carta está en varios pools del mismo sobre, manda el de MENOR `priority`. Sin
 * una regla de desempate declarada, «¿cuánto pesa esta carta en este sobre?» tendría dos
 * respuestas — y una distribución con dos respuestas no es una distribución.
 *
 * `now` se inyecta; el dominio no lee el reloj. Un pool fuera de su ventana de
 * disponibilidad sencillamente no participa.
 */
export function composeDistribution(
  pools: { pool: PoolDef; priority: number }[],
  now: number,
): PackDistribution | null {
  const activos = pools
    .filter(({ pool }) =>
      (pool.availableFrom == null || now >= pool.availableFrom)
      && (pool.availableTo == null || now < pool.availableTo))
    .sort((a, b) => a.priority - b.priority || (a.pool.id < b.pool.id ? -1 : 1));

  if (activos.length === 0) return null;

  const weights = new Map<string, number>();
  const excluded = new Set<string>();
  let members: Set<string> | null = null;
  let restringe = false;

  for (const { pool } of activos) {
    if (pool.mode === "EXPLICIT" || pool.mode === "MIXED") restringe = true;
    for (const e of pool.entries) {
      if (e.mode === "EXCLUDE") { excluded.add(e.cardId); continue; }
      // El primero en llegar gana: los pools vienen ordenados por prioridad.
      if (!weights.has(e.cardId)) weights.set(e.cardId, e.weight);
      if (pool.mode === "EXPLICIT") {
        members ??= new Set<string>();
        members.add(e.cardId);
      }
    }
  }
  // Una carta excluida no puede estar además incluida: EXCLUDE gana siempre, porque es la
  // única forma de que «todo esto menos aquello» signifique lo que parece.
  for (const id of excluded) { weights.delete(id); members?.delete(id); }

  const uniform = [...weights.values()].every((w) => w === DEFAULT_WEIGHT);

  return {
    key: activos.map(({ pool }) => `${pool.id}#${poolFingerprint(pool)}`).join("|"),
    members: restringe ? members : null,
    excluded,
    weightOf: (cardId) => weights.get(cardId) ?? DEFAULT_WEIGHT,
    uniform,
  };
}
