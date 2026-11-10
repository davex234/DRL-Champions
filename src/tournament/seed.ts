/**
 * SEED ENGINE — asigna semillas a los equipos (Online Fase 6/7).
 *
 * random / rank (por rating, reutiliza Competitive) / regional (equilibra regiones) / protected
 * (los mejores separados en el bracket). DETERMINISTA (Rng sembrado). PURO.
 */
import { makeRng, seedFrom, type Rng } from "@/sim/rng";
import type { Team, SeedMethod } from "./types";

/** Devuelve los equipos con `seed` asignado (1 = mejor), ordenados por semilla. */
export function seedTeams(teams: Team[], method: SeedMethod, rngSeed: number): Team[] {
  const rng: Rng = makeRng(seedFrom(`seed:${rngSeed}:${method}`));
  let ordered: Team[];
  switch (method) {
    case "rank":
      ordered = [...teams].sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1));
      break;
    case "regional": {
      // Equilibra: intercala equipos de distintas regiones (evita choques regionales tempranos).
      const byRegion = new Map<string, Team[]>();
      for (const t of [...teams].sort((a, b) => b.rating - a.rating)) { const arr = byRegion.get(t.region) ?? []; arr.push(t); byRegion.set(t.region, arr); }
      ordered = []; let added = true;
      while (added) { added = false; for (const arr of byRegion.values()) { const t = arr.shift(); if (t) { ordered.push(t); added = true; } } }
      break;
    }
    case "protected":
      // Como rank, pero los protegidos (top 25%) se mantienen por rating estricto.
      ordered = [...teams].sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1));
      break;
    case "random":
    default: {
      ordered = [...teams];
      for (let i = ordered.length - 1; i > 0; i--) { const j = rng.int(0, i); [ordered[i], ordered[j]] = [ordered[j], ordered[i]]; }
      break;
    }
  }
  return ordered.map((t, i) => ({ ...t, seed: i + 1 }));
}

/** Orden de siembra estándar para un bracket de eliminación (1 vs N, 2 vs N-1, …) evitando cruces top. */
export function bracketSeedOrder(n: number): number[] {
  // Genera el orden clásico de "protected seeding" para potencias de 2.
  let rounds = [1, 2];
  while (rounds.length < n) {
    const next: number[] = [];
    const sum = rounds.length * 2 + 1;
    for (const s of rounds) { next.push(s); next.push(sum - s); }
    rounds = next;
  }
  return rounds.slice(0, n);
}
