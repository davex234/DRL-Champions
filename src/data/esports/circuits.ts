import type { Circuit } from "@/domain/esports/types";

/**
 * Circuitos base del ecosistema competitivo. Espejo TS del seed de
 * `0003_competitive.sql` (tabla `circuits`). Cubre los tiers solicitados:
 * VCT Internacional, Challengers, Game Changers y Ascension. Editable/ampliable.
 */
export const CIRCUITS: Circuit[] = [
  { id: "vct-emea", name: "VCT EMEA", tier: "vct-international", region: "EMEA", scope: "international" },
  { id: "vct-americas", name: "VCT Americas", tier: "vct-international", region: "Americas", scope: "international" },
  { id: "vct-pacific", name: "VCT Pacific", tier: "vct-international", region: "Pacific", scope: "international" },
  { id: "vct-china", name: "VCT China", tier: "vct-international", region: "China", scope: "international" },
  { id: "vct-masters", name: "VCT Masters", tier: "vct-international", scope: "international" },
  { id: "vct-champions", name: "Valorant Champions", tier: "vct-international", scope: "international" },
  { id: "ewc", name: "Esports World Cup", tier: "vct-international", scope: "international" },
  { id: "challengers-es", name: "Challengers España", tier: "challengers", region: "EMEA", scope: "national" },
  { id: "game-changers-emea", name: "Game Changers EMEA", tier: "game-changers", region: "EMEA", scope: "international" },
  { id: "ascension-emea", name: "Challengers Ascension EMEA", tier: "ascension", region: "EMEA", scope: "international" },
];

export const CIRCUITS_BY_ID: Record<string, Circuit> = Object.fromEntries(
  CIRCUITS.map((c) => [c.id, c]),
);

export function getCircuit(id: string): Circuit | undefined {
  return CIRCUITS_BY_ID[id];
}
