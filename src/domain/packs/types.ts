import type { VariantGroup } from "../cards/types";

/** Buckets de rareza para las probabilidades de los sobres. */
export type RarityBucket = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const BUCKET_LABEL: Record<RarityBucket, string> = {
  common: "Común",
  uncommon: "Poco común",
  rare: "Rara",
  epic: "Épica",
  legendary: "Legendaria",
};

/** Clasifica una variante (por su rank) en un bucket de rareza. */
export function bucketForRank(rank: number): RarityBucket {
  if (rank <= 2) return "common";
  if (rank <= 5) return "uncommon";
  if (rank <= 8) return "rare";
  if (rank <= 11) return "epic";
  return "legendary";
}

export interface PackDef {
  id: string;
  name: string;
  description: string;
  /** Precio en DRL Credits. */
  price: number;
  /** Número de cartas que entrega. */
  cardCount: number;
  /** Pesos relativos por bucket para cada carta normal. */
  weights: Record<RarityBucket, number>;
  /**
   * Bucket mínimo garantizado en la última carta (el "tirón"): la última
   * carta se sortea solo entre buckets >= este. Opcional.
   */
  guaranteedMin?: RarityBucket;
  /**
   * Restringe el pool de variantes a estos grupos (p. ej. solo regionales
   * de EMEA). Si se omite, cualquier variante es elegible.
   */
  restrictGroups?: VariantGroup[];
  /** Restringe el pool a una región concreta (sobres regionales). */
  restrictRegion?: "EMEA" | "Americas" | "Pacific" | "China";
  /** Color de acento del sobre (para el arte). */
  accent: string;
  /** Etiqueta corta de categoría (Evento, Premium...). */
  tag?: string;
  /** Si pertenece a un evento: solo disponible mientras el evento esté activo. */
  eventId?: string;
}
