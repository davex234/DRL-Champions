/**
 * TAG PÚBLICO DE CUENTA — identificador PÚBLICO, único y PERMANENTE de una cuenta de Valorosters (puro, sin red).
 *
 * Tres identidades, cada una con su papel:
 *   · id interno (`auth.users.id` = `profiles.id`, UUID): PRIVADO, clave técnica de TODAS las relaciones. No cambia.
 *   · nombre (`profiles.username`): visible, puede cambiar.
 *   · TAG (`profiles.public_tag`): visible, NO cambia nunca y NUNCA se reutiliza (registro `account_tag_registry`, 0068).
 *
 * Formato: 7 símbolos de un alfabeto de 31 sin ambiguos (sin 0/O, 1/I/L). La BD guarda el valor CANÓNICO en mayúsculas
 * y SIN «#»; la interfaz lo presenta como «#7K4M92X». Lo genera SOLO la BD (pgcrypto, muestreo por rechazo: sin sesgo de
 * módulo); el cliente nunca lo propone ni lo cambia.
 *
 * ¿Por qué 7 y no 6? Las colisiones las resuelve el registro (clave única + reintento), así que la longitud la decide la
 * ADIVINABILIDAD: con 6 símbolos (31^6 ≈ 8,9·10^8) y 10 M de cuentas, 1 de cada 89 tags al azar sería real; con 7
 * (31^7 ≈ 2,75·10^10), 1 de cada 2.751, y el alta reintenta con probabilidad ≈ 0,04 %. 8 símbolos no aporta nada que haga falta.
 */

/** Alfabeto: 2–9 y A–Z sin I, L ni O (31 símbolos). El orden es el de la generación en SQL (0068): no cambiarlo. */
export const TAG_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const TAG_LENGTH = 7;
/** Patrón canónico (el mismo CHECK de la BD). */
export const TAG_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/;

/**
 * Normaliza lo que escribe una persona: recorta, quita UN «#» inicial y pasa a mayúsculas. Devuelve el valor CANÓNICO
 * (sin «#») o `null` si no es un tag válido (longitud, símbolos ambiguos u otros caracteres). No «corrige» 0→O ni 1→I:
 * esos símbolos no existen en el alfabeto, así que un tag con ellos sencillamente no es un tag.
 */
export function normalizeTag(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/^#/, "").toUpperCase();
  return TAG_PATTERN.test(t) ? t : null;
}

/** ¿Lo escrito PRETENDE ser un tag? (empieza por «#»): la búsqueda lo trata como tag EXACTO, nunca como nombre. */
export const looksLikeTagQuery = (q: unknown): boolean => typeof q === "string" && q.trim().startsWith("#");

/** Presentación: «#7K4M92X». */
export const formatTag = (tag: string): string => `#${tag}`;

/** Texto accesible del tag. */
export const tagAriaLabel = (tag: string): string => `Identificador de cuenta ${formatTag(tag)}`;

/** Capacidad del espacio y riesgo a una población dada (para el informe y los tests). */
export function tagSpace(population: number, length = TAG_LENGTH, alphabet = TAG_ALPHABET.length) {
  const size = alphabet ** length;
  const occupancy = population / size;
  return {
    size,
    bits: Math.log2(size),
    /** Probabilidad de que ALGUNA pareja coincida si NO hubiera reintento (cumpleaños). */
    birthdayNoRetry: 1 - Math.exp(-(population * (population - 1)) / (2 * size)),
    /** Probabilidad de que un alta nueva choque y tenga que reintentar = de acertar un tag real al azar. */
    occupancy,
    /** Un tag al azar de cada `oneIn` es real. */
    oneIn: 1 / occupancy,
    /** Probabilidad de agotar 10 intentos seguidos (el tope de la BD). */
    failWith10: occupancy ** 10,
  };
}
