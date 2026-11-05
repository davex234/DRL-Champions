/**
 * MARKETPLACE PATCH (Fase 5) — proyecta la política de mercado YA decidida por F4
 * (`decideMarket` reutilizado allí, sin recomputar aquí) a entradas de mercado: tradable /
 * valor inicial (== instanceValue, verificado en F4) / restricciones / visibilidad.
 * Nunca abre listados; nunca toca el MarketEngine. Determinista.
 */
import type { CardSpec } from "@/card-generator";
import type { MarketplacePatch, MarketEntry } from "./types";

export function buildMarketPatch(specs: CardSpec[], changedIds: Set<string>): MarketplacePatch {
  const entries: MarketEntry[] = specs
    .filter((s) => changedIds.has(s.cardId))
    .map((s) => {
      const m = s.eligibility.market;
      return {
        cardId: s.cardId,
        tradable: m.toMarket && !m.impossible,
        initialValue: s.estimatedValue,
        restrictions: { limited: m.limited, exclusive: m.exclusive, impossible: m.impossible },
        visibility: m.toMarket ? "public" as const : "unlisted" as const,
      };
    })
    .sort((a, b) => a.cardId.localeCompare(b.cardId));
  return { entries };
}
