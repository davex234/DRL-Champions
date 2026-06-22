import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";

/** Contexto que el store calcula para evaluar el progreso de logros. */
export interface AchievementContext {
  packsOpened: number;
  /** Ids (CardDef.id) distintos que posee el usuario. */
  ownedCardIds: Set<string>;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward: number; // DRL Credits
  goal: number;
  progress: (ctx: AchievementContext) => number;
}

// --- Helpers de catálogo para logros de colección ---
function ownedInSet(ids: string[], owned: Set<string>): number {
  return ids.reduce((n, id) => n + (owned.has(id) ? 1 : 0), 0);
}

const cardIdsForTeam = (team: string) =>
  CARDS.filter((c) => getPlayer(c.playerId)?.team === team).map((c) => c.id);

const cardIdsForRegion = (region: string) =>
  CARDS.filter((c) => getPlayer(c.playerId)?.region === region).map((c) => c.id);

const HERETICS_IDS = cardIdsForTeam("Team Heretics");
const EMEA_IDS = cardIdsForRegion("EMEA");

function countOwnedByGroup(owned: Set<string>, group: string): number {
  let n = 0;
  for (const id of owned) {
    const card = CARDS.find((c) => c.id === id);
    if (card && getVariant(card.variantId).group === group) n++;
  }
  return n;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "sobres-100",
    name: "Abridor en serie",
    description: "Abre 100 sobres.",
    icon: "📦",
    reward: 2500,
    goal: 100,
    progress: (c) => c.packsOpened,
  },
  {
    id: "sobres-1000",
    name: "Maestro de sobres",
    description: "Abre 1000 sobres.",
    icon: "🏭",
    reward: 25000,
    goal: 1000,
    progress: (c) => c.packsOpened,
  },
  {
    id: "primer-mvp",
    name: "Consigue un MVP",
    description: "Obtén tu primera carta MVP.",
    icon: "⭐",
    reward: 3000,
    goal: 1,
    progress: (c) => Math.min(1, countOwnedByGroup(c.ownedCardIds, "mvp")),
  },
  {
    id: "primer-icon",
    name: "Consigue un Icon",
    description: "Obtén tu primera carta Icon Series.",
    icon: "👑",
    reward: 10000,
    goal: 1,
    progress: (c) => (c.ownedCardIds.has("scream__icon-series") || c.ownedCardIds.has("aspas__icon-series") || c.ownedCardIds.has("tenz__icon-series") ? 1 : 0),
  },
  {
    id: "coleccionista",
    name: "Coleccionista",
    description: "Consigue 40 cartas distintas.",
    icon: "🗂️",
    reward: 4000,
    goal: 40,
    progress: (c) => c.ownedCardIds.size,
  },
  {
    id: "completa-heretics",
    name: "Completar Team Heretics",
    description: "Consigue todas las cartas de Team Heretics.",
    icon: "🐉",
    reward: 8000,
    goal: HERETICS_IDS.length,
    progress: (c) => ownedInSet(HERETICS_IDS, c.ownedCardIds),
  },
  {
    id: "completa-emea",
    name: "Completar EMEA",
    description: "Consigue todas las cartas de la región EMEA.",
    icon: "🌍",
    reward: 15000,
    goal: EMEA_IDS.length,
    progress: (c) => ownedInSet(EMEA_IDS, c.ownedCardIds),
  },
];
