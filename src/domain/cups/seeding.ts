/**
 * F86 · CABEZAS DE SERIE (puro). Política `RATING_SNAPSHOT`:
 *
 *   1. Rating ranked F84 (`duel_pvp_ratings.rating`) LEÍDO UNA VEZ al generar el cuadro y guardado como foto en
 *      `cup_registrations.seed_rating`. Cambiar de rating después no mueve el cuadro.
 *   2. Quien nunca jugó ranked entra con el rating inicial de F84 (1000): puede participar, sin colocación.
 *   3. Empates: `md5(cup_id || ':' || user_id)` ascendente — estable, no depende de la hora de inscripción y nadie
 *      puede elegirlo (el id de la copa no existe hasta que el admin la crea). Último desempate: el id.
 *
 * La función de hash se inyecta: el servidor y las pruebas usan md5 de Node, la SQL usa `md5()` de Postgres.
 */
import { CUP_UNRATED_SEED } from "./types";

export interface SeedEntry { userId: string; rating: number | null; gamesPlayed?: number | null }
export interface SeededEntry { userId: string; seed: number; seedRating: number; rated: boolean }

export const seedTieKey = (hash: (s: string) => string, cupId: string, userId: string): string => hash(`${cupId}:${userId}`);

export function seedEntries(cupId: string, entries: readonly SeedEntry[], hash: (s: string) => string): SeededEntry[] {
  const keyed = entries.map((e) => ({
    userId: e.userId,
    rating: typeof e.rating === "number" && Number.isFinite(e.rating) ? Math.trunc(e.rating) : CUP_UNRATED_SEED,
    rated: typeof e.rating === "number" && Number.isFinite(e.rating),
    tie: seedTieKey(hash, cupId, e.userId),
  }));
  keyed.sort((x, y) => (y.rating - x.rating) || (x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0) || (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
  return keyed.map((k, i) => ({ userId: k.userId, seed: i + 1, seedRating: k.rating, rated: k.rated }));
}
