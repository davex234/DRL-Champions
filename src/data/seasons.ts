/**
 * Catálogo de TEMPORADAS del Battle Pass (DRL Champions, Collection Fase 6/7).
 *
 * Todo por DATOS: una temporada = tracks (libre/premium) por nivel + piscina de misiones. Las misiones
 * miden MÉTRICAS reales del ecosistema (no duplican estadísticas). Añadir una temporada = añadir una
 * entrada aquí, sin tocar el motor.
 */
import type { SeasonDef, MissionDef } from "@/battlepass/types";

/** Genera un track lineal: recompensa base cada nivel + hitos (sobres/cartas/cosméticos). */
function buildTrack(kind: "free" | "premium"): SeasonDef["free"] {
  const track: SeasonDef["free"] = {};
  for (let lvl = 1; lvl <= 50; lvl++) {
    if (kind === "free") {
      if (lvl % 10 === 0) track[lvl] = { packId: "estandar", packCount: 1, credits: 500 };
      else if (lvl % 5 === 0) track[lvl] = { materials: { rare: 2 } };
      else track[lvl] = { credits: 300 + lvl * 20 };
    } else {
      if (lvl === 50) track[lvl] = { packId: "champions", packCount: 1, cosmetics: ["border:s1-champion"] };
      else if (lvl % 10 === 0) track[lvl] = { packId: "premium", packCount: 1};
      else if (lvl % 5 === 0) track[lvl] = { materials: { epic: 2 }, cosmetics: [`icon:s1-lvl${lvl}`] };
      else track[lvl] = { credits: 600 + lvl * 30};
    }
  }
  return track;
}

const MISSIONS: MissionDef[] = [
  // Daily (por datos: métricas reales del juego).
  { id: "d-open", label: "Abre 3 sobres", kind: "daily", metric: "packs_opened", goal: 3, xp: 200, reward: { credits: 500 }, repeatable: true, weight: 3 },
  { id: "d-play", label: "Juega 2 partidos", kind: "daily", metric: "matches_played", goal: 2, xp: 200, reward: { credits: 400}, repeatable: true, weight: 3 },
  { id: "d-win", label: "Gana 1 partido", kind: "daily", metric: "matches_won", goal: 1, xp: 250, reward: {}, repeatable: true, weight: 2 },
  { id: "d-buy", label: "Compra 1 carta", kind: "daily", metric: "market_buy", goal: 1, xp: 150, reward: { credits: 300 }, repeatable: true, weight: 1 },
  { id: "d-craft", label: "Fabrica/mejora 1 carta", kind: "daily", metric: "cards_crafted", goal: 1, xp: 200, reward: { materials: { rare: 1 } }, repeatable: true, weight: 1 },
  // Weekly.
  { id: "w-open", label: "Abre 20 sobres", kind: "weekly", metric: "packs_opened", goal: 20, xp: 800, reward: { packId: "premium", packCount: 1 }, repeatable: true, weight: 2 },
  { id: "w-win", label: "Gana 10 partidos", kind: "weekly", metric: "matches_won", goal: 10, xp: 900, reward: { materials: { epic: 3 } }, repeatable: true, weight: 2 },
  { id: "w-sell", label: "Vende 5 cartas", kind: "weekly", metric: "market_sell", goal: 5, xp: 600, reward: { credits: 3000 }, repeatable: true, weight: 1 },
  // Seasonal.
  { id: "s-collect", label: "Alcanza 40% de colección", kind: "seasonal", metric: "collection_completion", goal: 40, xp: 3000, reward: { packId: "icon", packCount: 1, cosmetics: ["title:s1-collector"] } },
  { id: "s-rank", label: "Consigue 25 victorias ranked", kind: "seasonal", metric: "ranked_wins", goal: 25, xp: 4000, reward: { cosmetics: ["border:s1-ranked"]} },
  // Especial / oculta / comunidad / progresiva.
  { id: "x-legend", label: "Consigue una carta legendaria", kind: "special", metric: "legendary_owned", goal: 1, xp: 1500, reward: { cosmetics: ["avatar:s1-legend"] } },
  { id: "h-secret", label: "Misión oculta", kind: "hidden", metric: "matches_won", goal: 50, xp: 5000, reward: { cosmetics: ["title:s1-hidden"] }, hidden: true },
  { id: "c-community", label: "Objetivo comunitario", kind: "community", metric: "packs_opened", goal: 100, xp: 2000, reward: {} },
  { id: "p-progress", label: "Progresa hasta 500 cartas", kind: "progressive", metric: "cards_owned", goal: 500, xp: 2500, reward: { packId: "prime", packCount: 1 } },
];

export const SEASONS: SeasonDef[] = [
  {
    id: "s1",
    name: "Temporada 1 · Ascenso",
    maxLevel: 50,
    xpPerLevel: 1000,
    free: buildTrack("free"),
    premium: buildTrack("premium"),
    missionPool: MISSIONS,
    durationDays: 90,
  },
];

export const SEASON_BY_ID = new Map(SEASONS.map((s) => [s.id, s]));
/**
 * FASE 34 · Antes se exportaba como `CURRENT_SEASON`, el MISMO nombre que la temporada real del servidor
 * (`data/season.ts`, `nexus-s1`): dos respuestas distintas a «¿cuál es la temporada actual?». Esto es el
 * pase LOCAL heredado de Colección 6/7 (`useBattlePassStore`); su contenido no cambia, solo su nombre.
 * La temporada de NEXUS y sus fechas: `data/seasonCalendar.ts` + `domain/season`.
 */
export const LEGACY_LOCAL_SEASON = SEASONS[0];
export function getSeason(id: string): SeasonDef | undefined {
  return SEASON_BY_ID.get(id);
}
