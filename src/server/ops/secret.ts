/**
 * F67 · comparación de secretos en TIEMPO CONSTANTE. `a !== b` corta en el primer carácter distinto y filtra, midiendo
 * tiempos, cuántos caracteres del secreto se han acertado. Falla cerrado si falta cualquiera de los dos.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  // Se comparan HASHES de longitud fija: ni siquiera la longitud del secreto se filtra.
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
