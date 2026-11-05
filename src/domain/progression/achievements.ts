import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
import { canonicalCardTeam } from "@/data/teamIdentities";

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

/** Cartas de un equipo CANÓNICO (el equipo de la carta: el impreso en el catálogo diseñado). */
const cardIdsForTeam = (canonicalId: string) =>
  CARDS.filter((c) => canonicalCardTeam(c, getPlayer(c.playerId)).key === canonicalId).map((c) => c.id);

const cardIdsForRegion = (region: string) =>
  CARDS.filter((c) => getPlayer(c.playerId)?.region === region).map((c) => c.id);

// Los ids se resuelven PEREZOSAMENTE (nunca a import-time): el catálogo vivo cambia con cada
// publish/import (rebuildCatalog) y estos logros deben ver siempre el catálogo vigente.
const heretics = () => cardIdsForTeam("team-heretics"); // TH impreso: la plantilla entera, no un alias
const emea = () => cardIdsForRegion("EMEA");

/** ¿Posee alguna carta que cumpla `f`? Sobre el catálogo vivo (una carta que ya no existe no cuenta). */
function ownsAny(owned: Set<string>, f: (variantId: string) => boolean): boolean {
  for (const id of owned) {
    const card = CARDS.find((c) => c.id === id);
    if (card && f(card.variantId)) return true;
  }
  return false;
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
    // Catálogo diseñado (2026-09-21): las cartas MVP ya no existen. Mismo escalón —la primera carta de
    // torneo de rareza alta— con la edición que lo es ahora: Champions S (épica, 20 cartas). Id estable.
    id: "primer-mvp",
    name: "Consigue una Champions S",
    description: "Obtén tu primera carta Champions S.",
    icon: "⭐",
    reward: 3000,
    goal: 1,
    progress: (c) => (ownsAny(c.ownedCardIds, (v) => v === "champions-s") ? 1 : 0),
  },
  {
    // Las Icon Series ya no existen. Equivalente: la cima de la rareza del catálogo diseñado, una
    // legendaria (Record Breaker o Moments; el Sobre Icon la garantiza). Id estable.
    id: "primer-icon",
    name: "Consigue una leyenda",
    description: "Obtén tu primera carta legendaria (Record Breaker o Moments).",
    icon: "👑",
    reward: 10000,
    goal: 1,
    progress: (c) => (ownsAny(c.ownedCardIds, (v) => bucketForRank(getVariant(v as never).rank) === "legendary") ? 1 : 0),
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
    get goal() { return heretics().length; },
    progress: (c) => ownedInSet(heretics(), c.ownedCardIds),
  },
  {
    id: "completa-emea",
    name: "Completar EMEA",
    description: "Consigue todas las cartas de la región EMEA.",
    icon: "🌍",
    reward: 15000,
    get goal() { return emea().length; },
    progress: (c) => ownedInSet(emea(), c.ownedCardIds),
  },
];
