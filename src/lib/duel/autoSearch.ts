/**
 * F66 · ¿Qué hacer al entrar en `/duelos/pvp?buscar=<equipo>`? Decisión PURA (la página solo la ejecuta).
 *
 * El fallo que corrige (encontrado por el E2E de dos clientes): la URL conserva `?buscar=` y, si el jugador recarga
 * justo cuando le emparejan (F5 en «Rival encontrado»), la cola ya dice MATCHED con su partida VIVA. La página daba
 * cualquier MATCHED por «partida anterior», la marcaba como vista y volvía a encolar: el servidor respondía
 * ACTIVE_MATCH (bien) y el jugador se quedaba fuera de su propia partida hasta perderla por tiempo.
 *
 *   · buscando / cargando / error     → nada (ya busca, o hay que dejar ver el error)
 *   · emparejado y la partida SIGUE   → retomar (no se encola, no se marca como vista)
 *   · emparejado y la partida TERMINÓ → marcarla vista y encolar de nuevo (el «Buscar» de /competitivo)
 *   · sin entrada                     → encolar si el equipo pedido es legal
 */
import { isTerminal } from "@/domain/cardgame/pvp/lifecycle";
import type { PvpLifecycle } from "@/domain/cardgame/pvp/types";

export type AutoSearchAction = "none" | "resume" | "requeue" | "enqueue";

const LIFECYCLES: readonly string[] = ["CREATED", "IN_TURN", "FINISHED", "ABANDONED", "EXPIRED"] satisfies readonly PvpLifecycle[];

export function autoSearchDecision(input: {
  phase: "idle" | "loading" | "queued" | "matched" | "closed" | "error";
  deckValid: boolean;
  /** Ciclo de vida de la partida a la que apunta la entrada MATCHED (`null` = no se pudo leer / no existe). */
  matchedLifecycle: string | null;
}): AutoSearchAction {
  if (input.phase === "matched") {
    // F76 · «sigue» = NO terminal según la definición canónica (la misma que usa el servidor), no una lista local.
    const l = input.matchedLifecycle;
    if (l !== null && LIFECYCLES.includes(l) && !isTerminal(l as PvpLifecycle)) return "resume";
    return input.deckValid ? "requeue" : "none";
  }
  if (input.phase === "idle" && input.deckValid) return "enqueue";
  return "none";
}
