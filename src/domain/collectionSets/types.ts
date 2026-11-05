/**
 * F82 · COLLECTION SETS — tipos del dominio (puro).
 *
 * Un Collection Set es un objetivo coleccionable con REQUISITOS CONGELADOS. La diferencia con la maestría (F13) y con
 * los logros «completa-*» es exactamente esa: aquellos se recalculan contra el catálogo vivo (una carta nueva mueve la
 * meta); un set publicado guarda su lista de cartas elegibles y no cambia nunca. Un cambio de plantilla o de catálogo
 * se publica como OTRA versión (`family` igual, `version` + 1), y lo completado sigue completado.
 */

export type SetKind = "TEAM" | "EDITION";
export type SetStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export const SET_KINDS: readonly SetKind[] = ["TEAM", "EDITION"];
export const SET_STATUSES: readonly SetStatus[] = ["DRAFT", "PUBLISHED", "RETIRED"];

/**
 * Un requisito. Se satisface UNA vez, con poseer CUALQUIERA de `cardIds` (cinco copias de la misma carta = un requisito).
 *
 *   PLAYER_ANY_CARD  cualquier carta elegible de ese jugador (equipo: las impresas con ESE equipo, no las de otro).
 *   SPECIFIC_CARD    exactamente esa carta (`cardIds` de longitud 1). Lo usan los sets de edición.
 */
export type RequirementType = "PLAYER_ANY_CARD" | "SPECIFIC_CARD";

export interface SetRequirement {
  /** Clave estable dentro del set: `player:<playerId>` o `card:<cardId>`. */
  key: string;
  type: RequirementType;
  playerId: string;
  /** Nombre para mostrar en el momento de publicar (se congela con el resto). */
  label: string;
  /** Cartas que lo satisfacen, congeladas. Nunca vacía en un set publicado. */
  cardIds: string[];
}

/** Recompensa. F82 solo concede INSIGNIAS (cosmético permanente); la forma deja sitio a otras, pero hoy no existen. */
export interface SetReward {
  badgeId: string;
}

export interface CollectionSetDef {
  /** Id estable de ESTA versión: `team-g2-v1`. */
  id: string;
  /** Familia: lo que comparten las versiones (`team:g2`). Una sola PUBLISHED por familia. */
  family: string;
  version: number;
  kind: SetKind;
  /** Equipo canónico (TEAM) o variantId (EDITION). */
  subjectId: string;
  title: string;
  status: SetStatus;
  requirements: SetRequirement[];
  reward: SetReward;
  /** Ruta del logo real (TEAM). `null` en ediciones: se pinta con el lenguaje visual propio. */
  logo: string | null;
  /** sha256 de requisitos + recompensa en forma canónica, fijado al publicar. */
  checksum: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  /** Versión de fila (concurrencia optimista del admin). */
  rowVersion: number;
}

/** Prefijo de las insignias de colección. Cabe en la familia `insignia` del catálogo de cosméticos existente. */
export const BADGE_PREFIX = "insignia:coleccion:";
export const BADGE_ID_PATTERN = /^insignia:coleccion:[a-z0-9-]{1,48}$/;
export const SET_ID_PATTERN = /^[a-z0-9-]{3,64}$/;
/** Cualquier insignia que el usuario puede destacar en su perfil (las de colección y las de maestría heredadas). */
export const ANY_BADGE_PATTERN = /^insignia:[a-z0-9:-]{1,80}$/;

export const badgeIdFor = (familySlug: string): string => `${BADGE_PREFIX}${familySlug}`;
export const isCollectionBadge = (id: string): boolean => BADGE_ID_PATTERN.test(id);
