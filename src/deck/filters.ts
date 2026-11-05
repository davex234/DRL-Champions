/**
 * FILTROS DEL DECK BUILDER (Collection Fase 3/7).
 *
 * REUTILIZA el motor de filtros del Collection Engine (`FilterSpec`/`applyFilter`) — no reimplementa
 * filtrado. Solo añade lo específico del builder: excluir cartas ya seleccionadas, y filtros de
 * instancia (bloqueadas/duplicadas) sobre uids. Puro, O(n), sin estado.
 */
import type { CollectionEngine, CardView, FilterSpec, OwnedCard } from "@/collection";

/** Opciones específicas del builder (además de todo lo que ya ofrece FilterSpec). */
export interface DeckFilterOpts {
  /** Excluir estas cartas (p. ej. las ya alineadas en el deck). */
  excludeCardIds?: Set<string>;
  /** Excluir los jugadores ya presentes (no dos cartas del mismo jugador). */
  excludePlayerIds?: Set<string>;
}

/**
 * Candidatos de carta para el builder: parte del filtro de Collection y aplica las exclusiones del
 * deck. `spec` cubre rol/ovr/rareza/serie(via variants)/región/poseídas/favoritas/serializadas/tags/texto.
 */
export function deckCandidates(engine: CollectionEngine, spec: FilterSpec, opts: DeckFilterOpts = {}): CardView[] {
  let views = engine.filter(spec);
  if (opts.excludeCardIds) views = views.filter((v) => !opts.excludeCardIds!.has(v.cardId));
  if (opts.excludePlayerIds) views = views.filter((v) => !opts.excludePlayerIds!.has(v.playerId));
  return views;
}

/** Instancia poseída pickable (uid) enriquecida para filtros de instancia. */
export interface OwnedInstanceFilter {
  /** Solo instancias bloqueadas / no bloqueadas (locks por uid; se inyectan, no se inventan). */
  locked?: boolean;
  lockedUids?: Set<string>;
  /** Solo duplicados (cartas con >1 copia poseída). */
  duplicatesOnly?: boolean;
}

/**
 * Filtra INSTANCIAS poseídas (por uid) para los filtros "bloqueadas"/"duplicados". Reutiliza el índice
 * de propiedad del Collection Engine (countOf) — no cuenta a mano.
 */
export function filterOwnedInstances(engine: CollectionEngine, owned: OwnedCard[], f: OwnedInstanceFilter): OwnedCard[] {
  const locks = f.lockedUids;
  const own = engine.ownership();
  return owned.filter((o) => {
    if (f.locked != null && locks && locks.has(o.uid) !== f.locked) return false;
    if (f.duplicatesOnly && own.countOf(o.cardId) <= 1) return false;
    return true;
  });
}
