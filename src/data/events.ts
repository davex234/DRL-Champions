import type { EventDef, EventType, MissionDef, WeeklyTaskDef } from "@/domain/events/types";
import { EVENT_EDITIONS } from "@/domain/events/editions";
import { availableMissions, LIVE_MISSION_FLAGS, type MissionFlags } from "@/domain/progression/missionAvailability";

/** Nombre legible del torneo. */
function tName(type: EventType): string {
  return type === "masters" ? "Masters" : type === "champions" ? "Champions" : "EWC";
}

/** Conjunto estándar de misiones de un evento (parametrizado por tipo). */
function missions(type: EventType): MissionDef[] {
  const t = tName(type);
  return [
    { id: "open10", label: "Abre 10 sobres", metric: "open_packs", goal: 10, passXp: 120, reward: { credits: 1500} },
    { id: "open50", label: "Abre 50 sobres", metric: "open_packs", goal: 50, passXp: 300, reward: { packId: "premium", packCount: 1} },
    { id: "eventpacks", label: `Abre 5 Sobres ${t}`, metric: "open_event_packs", goal: 5, passXp: 200, reward: {} },
    // «Carta del evento» solo si el catálogo tiene una edición de ese torneo (EWC no la tiene: no se ofrece).
    ...(EVENT_EDITIONS[type].length ? [{ id: "getcard", label: `Consigue una carta ${t}`, metric: "get_event_card", goal: 1, passXp: 150, reward: { credits: 2000} } satisfies MissionDef] : []),
    // Ids estables; las condiciones son las del catálogo diseñado (ver `domain/events/editions`).
    { id: "getmvp", label: "Consigue una carta legendaria", metric: "get_legendary", goal: 1, passXp: 250, reward: {} },
    { id: "getwinner", label: "Consigue una carta épica o superior", metric: "get_epic", goal: 1, passXp: 200, reward: {} },
    { id: "buy", label: "Compra una carta del mercado", metric: "market_buy", goal: 1, passXp: 80, reward: { credits: 1000 } },
    { id: "sell", label: "Vende una carta", metric: "market_sell", goal: 1, passXp: 80, reward: { credits: 800} },
  ];
}

/**
 * Catálogo de eventos. Anclados al inicio de temporada por OFFSET de días, así
 * siempre hay un evento activo desde el primer día de juego.
 *
 * AÑADIR UN EVENTO NUEVO (Masters 2027, Champions 2027, EWC 2027…) = añadir una
 * entrada aquí. No hay que tocar ninguna lógica.
 */
export const EVENTS: EventDef[] = [
  {
    id: "masters-toronto",
    name: "Masters Toronto",
    subtitle: "El primer gran torneo internacional de la temporada.",
    type: "masters",
    accent: "#ff8a3d",
    startOffsetDays: 0,
    durationDays: 30,
    packIds: ["masters"],
    missions: missions("masters"),
    passLevels: 50,
    passXpPerLevel: 100,
    passRewards: {
      25: { packId: "masters", packCount: 1},
      // Catálogo diseñado: las MVP ya no existen. Mismo escalón —una legendaria concreta— por región de sede.
      50: { cardId: "mada__moments"},
    },
  },
  {
    id: "ewc-2026",
    name: "EWC 2026",
    subtitle: "La Copa del Mundo de los Esports. Premios masivos.",
    type: "ewc",
    accent: "#19e3ff",
    startOffsetDays: 18,
    durationDays: 30,
    packIds: ["ewc"],
    missions: missions("ewc"),
    passLevels: 50,
    passXpPerLevel: 100,
    passRewards: {
      25: { packId: "ewc", packCount: 1},
      // La legendaria que queda (Pacific): EWC no tiene edición ni legendaria propia.
      50: { cardId: "patmen__record-breaker"},
    },
  },
  {
    id: "champions-paris",
    name: "Champions Paris",
    subtitle: "El campeonato del mundo. Las cartas más codiciadas del año.",
    type: "champions",
    accent: "#ffd35c",
    startOffsetDays: 36,
    durationDays: 45,
    packIds: ["champions"],
    missions: missions("champions"),
    passLevels: 50,
    passXpPerLevel: 110,
    passRewards: {
      25: { packId: "champions", packCount: 1},
      50: { cardId: "marteen__record-breaker"}, // legendaria de EMEA, sede del evento
    },
  },
];

/** Tareas semanales globales (se reinician cada semana, recompensas mayores). */
export const WEEKLY_TASKS: WeeklyTaskDef[] = [
  { id: "w_open", label: "Abre 20 sobres esta semana", metric: "open_packs", goal: 20, passXp: 0, reward: { credits: 3000} },
  { id: "w_buy", label: "Compra 3 cartas en el mercado", metric: "market_buy", goal: 3, passXp: 0, reward: { credits: 2500 } },
  // Antes «2 cartas MVP» (ya no existen): mismo escalón con la rareza que ocupaban, épica o superior.
  { id: "w_mvp", label: "Consigue 2 cartas épicas o superiores", metric: "get_epic", goal: 2, passXp: 0, reward: { packId: "prime", packCount: 1} },
];

/**
 * Las misiones de un evento y las tareas semanales que se OFRECEN hoy. Las definiciones de arriba se conservan
 * enteras; las que piden el Marketplace solo se ofrecen con él abierto (`missionAvailability`).
 */
export function eventMissions(ev: EventDef, flags: MissionFlags = LIVE_MISSION_FLAGS): MissionDef[] {
  return availableMissions(ev.missions, flags);
}
export function weeklyTasks(flags: MissionFlags = LIVE_MISSION_FLAGS): WeeklyTaskDef[] {
  return availableMissions(WEEKLY_TASKS, flags);
}

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export function getEvent(id: string): EventDef | undefined {
  return EVENT_BY_ID.get(id);
}
