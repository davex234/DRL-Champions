/** Tipos del sistema de eventos en vivo (estilo FUT). */

export type EventType = "masters" | "champions" | "ewc";

/** Métricas que pueden medir las misiones. */
export type MissionMetric =
  | "open_packs"
  | "open_event_packs"
  | "get_event_card"
  | "get_mvp"
  | "get_winner"
  | "market_buy"
  | "market_sell";

/** Recompensa genérica (cualquier combinación). */
export interface Reward {
  credits?: number;
  /** XP de cuenta (nivel global del jugador). */
  xp?: number;
  /** Tokens de evento. */
  tokens?: number;
  /** Sobres otorgados. */
  packId?: string;
  packCount?: number;
  /** Carta concreta otorgada (CardDef.id). */
  cardId?: string;
}

export interface MissionDef {
  id: string;
  label: string;
  metric: MissionMetric;
  goal: number;
  reward: Reward;
  /** XP que aporta al pase de evento al completarse. */
  passXp: number;
}

export interface ShopItemDef {
  id: string;
  label: string;
  description?: string;
  /** Coste en tokens de evento. */
  cost: number;
  reward: Reward;
  /** Límite de compras (opcional). */
  stock?: number;
  /** Marca de cosmético (no afecta a la jugabilidad). */
  cosmetic?: boolean;
}

export interface EventDef {
  id: string;
  name: string;
  subtitle: string;
  type: EventType;
  accent: string;
  /** Días desde el inicio de temporada en que arranca el evento. */
  startOffsetDays: number;
  durationDays: number;
  /** Sobres exclusivos del evento (ids en packs.ts). */
  packIds: string[];
  /** Tokens otorgados por abrir un sobre del evento. */
  tokensPerPack: number;
  missions: MissionDef[];
  shop: ShopItemDef[];
  /** Niveles del pase de evento. */
  passLevels: number;
  /** XP necesaria por nivel del pase. */
  passXpPerLevel: number;
  /** Recompensas concretas por nivel (override del generador por defecto). */
  passRewards?: Record<number, Reward>;
}

/** Tarea semanal global (misión que se reinicia cada semana). */
export interface WeeklyTaskDef extends MissionDef {}

export interface NotificationItem {
  id: string;
  kind: "event_start" | "event_end" | "mission" | "reward" | "daily";
  title: string;
  message: string;
  at: number;
  read: boolean;
}
