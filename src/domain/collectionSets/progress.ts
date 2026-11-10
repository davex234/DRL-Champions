/**
 * F82 · PROGRESO de un Collection Set contra lo que el usuario POSEE (puro).
 *
 * Recibe el conjunto de ids de carta DISTINTOS que posee el usuario (el servidor lo lee de `user_cards`): duplicados no
 * cuentan dos veces porque un requisito se satisface una vez, y cinco copias de la misma carta son un solo id.
 *
 * «Completado» (histórico, en `user_collection_completions`) y «lo tienes ahora» (este cálculo) son cosas distintas:
 * una vez reclamado, el set sigue completado aunque el usuario desguace, craftee o pierda cartas. Por eso la vista
 * los devuelve por separado.
 */
import type { CollectionSetDef, SetRequirement } from "./types";

export interface RequirementProgress {
  key: string;
  playerId: string;
  label: string;
  type: SetRequirement["type"];
  satisfied: boolean;
  /** Cartas del requisito que posee (variantes poseídas). Vacía si falta. */
  ownedCardIds: string[];
  /** Todas las cartas que lo satisfarían (para «qué me falta» y «dónde conseguirla»). */
  eligibleCardIds: string[];
}

export interface SetProgress {
  required: number;
  owned: number;
  missing: number;
  /** 0–100, entero hacia abajo: 4/5 = 80, nunca 100 sin estar completo. */
  pct: number;
  complete: boolean;
  requirements: RequirementProgress[];
}

export function progressOf(set: Pick<CollectionSetDef, "requirements">, owned: ReadonlySet<string>): SetProgress {
  const requirements = set.requirements.map((r): RequirementProgress => {
    const mine = r.cardIds.filter((id) => owned.has(id));
    return {
      key: r.key, playerId: r.playerId, label: r.label, type: r.type,
      satisfied: mine.length > 0, ownedCardIds: mine, eligibleCardIds: [...r.cardIds],
    };
  });
  const required = requirements.length;
  const have = requirements.filter((r) => r.satisfied).length;
  const complete = required > 0 && have === required;
  const pct = required === 0 ? 0 : complete ? 100 : Math.min(99, Math.floor((have / required) * 100));
  return { required, owned: have, missing: required - have, pct, complete, requirements };
}

export type SetState = "LOCKED" | "IN_PROGRESS" | "CLAIMABLE" | "COMPLETED";

/**
 * Estado de cara al jugador.
 *   COMPLETED    reclamado (permanente, mande lo que mande el inventario actual).
 *   CLAIMABLE    cumple todo ahora y no lo ha reclamado.
 *   IN_PROGRESS  tiene al menos un requisito.
 *   LOCKED       0 %: se enseña igualmente (descubrir objetivos), no se esconde.
 */
export function stateOf(p: SetProgress, claimed: boolean): SetState {
  if (claimed) return "COMPLETED";
  if (p.complete) return "CLAIMABLE";
  return p.owned > 0 ? "IN_PROGRESS" : "LOCKED";
}

/** Sets afectados por unas cartas (p. ej. las de un sobre recién abierto). */
export function setsTouchedBy<T extends Pick<CollectionSetDef, "id" | "requirements">>(sets: readonly T[], cardIds: readonly string[]): T[] {
  const ids = new Set(cardIds);
  return sets.filter((s) => s.requirements.some((r) => r.cardIds.some((c) => ids.has(c))));
}

/** Forma canónica (orden estable) de lo que se congela al publicar: base del checksum. */
export function canonicalPayload(set: Pick<CollectionSetDef, "id" | "family" | "version" | "kind" | "subjectId" | "requirements" | "reward">): string {
  const reqs = [...set.requirements]
    .map((r) => ({ key: r.key, type: r.type, playerId: r.playerId, label: r.label, cardIds: [...r.cardIds].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify({ id: set.id, family: set.family, version: set.version, kind: set.kind, subjectId: set.subjectId, requirements: reqs, reward: { badgeId: set.reward.badgeId } });
}
