/**
 * ANTI-DUPLICADOS (Collection Fase 2/7) — parte interna del decisor `openPack`.
 *
 * NO elimina duplicados: el decisor DECIDE qué hacer según la política del sobre. Determinista (RNG del
 * proyecto) y de SOLO LECTURA sobre la propiedad (`owned`, cardIds) — nunca muta el inventario.
 * Reutiliza el `CardRegistry` (solo el tipo) para conocer variantes/jugadores.
 */
import type { CardRegistry } from "@/collection";
import type { Rng } from "@/sim/rng";
import type { AntiDupPolicy } from "./types";
import type { CardDef } from "../cards/types";

export interface AntiDupOutcome { card: CardDef; compensated: boolean }

/**
 * Resuelve una carta recién elegida frente a la política anti-dup.
 * @param candidates cartas elegibles para este hueco (mismo requisito) — para "avoid"/"replace".
 * @param flatPool   pool completo del sobre (todas las rarezas) — para "upgrade".
 * @param owned      cardIds ya poseídos (SOLO LECTURA).
 */
export function resolveAntiDup(
  policy: AntiDupPolicy,
  picked: CardDef,
  candidates: CardDef[],
  flatPool: CardDef[],
  owned: Set<string>,
  registry: CardRegistry,
  rng: Rng,
): AntiDupOutcome {
  const isDup = owned.has(picked.id);
  if (!isDup || policy === "allow") return { card: picked, compensated: false };

  switch (policy) {
    case "compensate":
      return { card: picked, compensated: true };

    case "avoid":
    case "replace": {
      const fresh = candidates.filter((c) => !owned.has(c.id));
      if (fresh.length) return { card: rng.pick(fresh), compensated: false };
      return { card: picked, compensated: false }; // sin stock nuevo: se acepta el duplicado
    }

    case "upgrade": {
      const rank = registry.variant(picked.variantId).rank;
      const upgrades = flatPool
        .filter((c) => c.playerId === picked.playerId && !owned.has(c.id) && registry.variant(c.variantId).rank > rank)
        .sort((a, b) => registry.variant(a.variantId).rank - registry.variant(b.variantId).rank);
      if (upgrades.length) return { card: upgrades[0], compensated: false }; // la mejora más cercana
      const fresh = candidates.filter((c) => !owned.has(c.id));
      return fresh.length ? { card: rng.pick(fresh), compensated: false } : { card: picked, compensated: false };
    }
  }
}
