import type { EventDef, EventType, MissionDef, ShopItemDef, WeeklyTaskDef } from "@/domain/events/types";

/** Nombre legible del torneo. */
function tName(type: EventType): string {
  return type === "masters" ? "Masters" : type === "champions" ? "Champions" : "EWC";
}

/** Conjunto estándar de misiones de un evento (parametrizado por tipo). */
function missions(type: EventType): MissionDef[] {
  const t = tName(type);
  return [
    { id: "open10", label: "Abre 10 sobres", metric: "open_packs", goal: 10, passXp: 120, reward: { credits: 1500, tokens: 20 } },
    { id: "open50", label: "Abre 50 sobres", metric: "open_packs", goal: 50, passXp: 300, reward: { packId: "premium", packCount: 1, tokens: 60 } },
    { id: "eventpacks", label: `Abre 5 Sobres ${t}`, metric: "open_event_packs", goal: 5, passXp: 200, reward: { tokens: 80 } },
    { id: "getcard", label: `Consigue una carta ${t}`, metric: "get_event_card", goal: 1, passXp: 150, reward: { credits: 2000, tokens: 30 } },
    { id: "getmvp", label: "Consigue un MVP", metric: "get_mvp", goal: 1, passXp: 250, reward: { tokens: 100 } },
    { id: "getwinner", label: "Consigue un Winner", metric: "get_winner", goal: 1, passXp: 200, reward: { tokens: 70 } },
    { id: "buy", label: "Compra una carta del mercado", metric: "market_buy", goal: 1, passXp: 80, reward: { credits: 1000 } },
    { id: "sell", label: "Vende una carta", metric: "market_sell", goal: 1, passXp: 80, reward: { credits: 800, tokens: 15 } },
  ];
}

/** Tienda estándar del evento. */
function shop(type: EventType, packId: string, mvpCardId: string, mvpName: string): ShopItemDef[] {
  const t = tName(type);
  return [
    { id: "pack", label: `Sobre ${t} extra`, description: "Otro tiro a la suerte.", cost: 120, reward: { packId, packCount: 1 } },
    { id: "mvp", label: `${mvpName} ${t} MVP`, description: "Carta exclusiva del evento.", cost: 650, reward: { cardId: mvpCardId }, stock: 1 },
    { id: "credits", label: "Paquete de 5.000 créditos", cost: 150, reward: { credits: 5000 } },
    { id: "cosmetic", label: `Marco ${t} (cosmético)`, description: "Insignia de coleccionista del evento.", cost: 200, reward: {}, cosmetic: true, stock: 1 },
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
    tokensPerPack: 8,
    missions: missions("masters"),
    shop: shop("masters", "masters", "zekken__masters-mvp", "zekken"),
    passLevels: 50,
    passXpPerLevel: 100,
    passRewards: {
      25: { packId: "masters", packCount: 1, tokens: 60 },
      50: { cardId: "derke__masters-mvp", tokens: 120 },
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
    tokensPerPack: 9,
    missions: missions("ewc"),
    shop: shop("ewc", "ewc", "wo0t__ewc-mvp", "Wo0t"),
    passLevels: 50,
    passXpPerLevel: 100,
    passRewards: {
      25: { packId: "ewc", packCount: 1, tokens: 60 },
      50: { cardId: "wo0t__ewc-mvp", tokens: 120 },
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
    tokensPerPack: 10,
    missions: missions("champions"),
    shop: shop("champions", "champions", "demon1__champions-mvp", "Demon1"),
    passLevels: 50,
    passXpPerLevel: 110,
    passRewards: {
      25: { packId: "champions", packCount: 1, tokens: 70 },
      50: { cardId: "aspas__champions-mvp", tokens: 150 },
    },
  },
];

/** Tareas semanales globales (se reinician cada semana, recompensas mayores). */
export const WEEKLY_TASKS: WeeklyTaskDef[] = [
  { id: "w_open", label: "Abre 20 sobres esta semana", metric: "open_packs", goal: 20, passXp: 0, reward: { credits: 3000, tokens: 50 } },
  { id: "w_buy", label: "Compra 3 cartas en el mercado", metric: "market_buy", goal: 3, passXp: 0, reward: { credits: 2500 } },
  { id: "w_mvp", label: "Consigue 2 cartas MVP", metric: "get_mvp", goal: 2, passXp: 0, reward: { packId: "prime", packCount: 1, tokens: 80 } },
];

export const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export function getEvent(id: string): EventDef | undefined {
  return EVENT_BY_ID.get(id);
}
