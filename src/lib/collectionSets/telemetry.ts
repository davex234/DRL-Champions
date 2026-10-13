/**
 * F82 · TELEMETRÍA DE LA SALA DE TROFEOS — contextos de `flow_started` con el mismo patrón que perfil/meta/temporada.
 *
 * El contrato de flujos sigue CERRADO a propósito (4 flujos, fijado en los tests de contrato): hasta que `collections`
 * exista en la base de datos Y en `FLOWS`, este módulo es un no-op honesto. Lo que sí queda medido, con fecha y sin PII,
 * es la verdad del servidor: `user_collection_completions.completed_at`, `user_cosmetics.granted_at` (source
 * `collection:<set>`) y `player_profile_customization.updated_at` al destacar.
 */
import { trackFlow } from "@/lib/telemetry/client";
import { isFlow, type Flow } from "@/lib/telemetry/contract";

export const COLLECTION_CONTEXTS = ["collection_viewed", "collection_set_viewed", "collection_completed", "badge_unlocked", "badge_equipped"] as const;
export type CollectionContext = (typeof COLLECTION_CONTEXTS)[number];
export const COLLECTIONS_FLOW = "collections";

export function trackCollections(context: CollectionContext): void {
  try {
    const flow: unknown = COLLECTIONS_FLOW;
    if (!isFlow(flow)) return;
    trackFlow(flow as Flow, context);
  } catch { /* nunca tumba la pantalla */ }
}
