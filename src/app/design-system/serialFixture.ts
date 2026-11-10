/**
 * CARTA SERIALIZADA DE QA — sólo arneses `/design-system/*` y pruebas. NUNCA una pantalla de juego.
 *
 * El catálogo diseñado (`Cartas\`, 2026-09-21) no tiene ediciones con tirada limitada: no se decidió
 * ninguna. La lógica de seriales (serial #1, el más bajo, prestigio) sigue existiendo y hay que poder
 * probarla, así que aquí se fabrica UNA definición local: un jugador REAL del catálogo en la variante
 * serializada `prime` (del modelo anterior, que sigue en `VARIANTS`). Se da de alta sólo en el catálogo
 * del proceso en curso con `registerServerCards` —la puerta que ya existe para cartas que no están en el
 * catálogo compilado—; no se persiste ni se sirve.
 */
import { CARDS, getCard, registerServerCards } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";

export function qaSerializedCard(): CardDef {
  const base = CARDS.find((c) => c.variantId === "base" && !!c.combat) ?? CARDS[0];
  const id = `${base.playerId}__prime`;
  const existing = getCard(id);
  if (existing) return existing;
  const def: CardDef = { ...base, id, variantId: "prime", image: undefined, printed: undefined };
  registerServerCards([def]);
  return getCard(id)!;
}
