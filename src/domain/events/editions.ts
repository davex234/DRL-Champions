/**
 * EVENTOS ↔ EDICIONES DEL CATÁLOGO DISEÑADO (2026-09-21).
 *
 * Las misiones de evento medían variantes que ya no existen (`*-mvp`, `*-winner`, «carta EWC»). Aquí se
 * fija, UNA vez, qué cuenta ahora con las 7 ediciones reales:
 *   · «carta del evento»: las ediciones con el nombre del torneo — Masters → Masters L y Masters SDC;
 *     Champions → Champions S. EWC no tiene edición: esa misión no se ofrece (no se deja imposible).
 *   · las antiguas «MVP» y «Winner» pasan a la rareza que ocupaban: legendaria (Record Breaker, Moments)
 *     y épica o superior (Champions S y las legendarias).
 */
import type { VariantId } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import type { EventType } from "./types";

export const EVENT_EDITIONS: Readonly<Record<EventType, readonly VariantId[]>> = {
  masters: ["masters-l", "masters-sdc"],
  champions: ["champions-s"],
  ewc: [],
};

/** ¿Es esta carta una «carta del evento» de ese tipo? */
export const isEventEdition = (type: EventType, variantId: string): boolean =>
  EVENT_EDITIONS[type].includes(variantId as VariantId);

/** Legendaria (Record Breaker, Moments). */
export const isLegendaryCard = (variantId: string): boolean =>
  bucketForRank(getVariant(variantId as VariantId).rank) === "legendary";

/** Épica o superior (Champions S y las legendarias). */
export const isEpicOrBetterCard = (variantId: string): boolean => {
  const b = bucketForRank(getVariant(variantId as VariantId).rank);
  return b === "epic" || b === "legendary";
};
