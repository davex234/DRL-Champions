/** Tipos del sistema de eventos en vivo (estilo FUT). */

export type EventType = "masters" | "champions" | "ewc";

/** Métricas que pueden medir las misiones. */
export type MissionMetric =
  | "open_packs"
  | "open_event_packs"
  | "get_event_card"
  /** Legendaria (Record Breaker, Moments). Sustituye a «MVP», que ya no existe (catálogo diseñado). */
  | "get_legendary"
  /** Épica o superior (Champions S y legendarias). Sustituye a «Winner». */
  | "get_epic"
  | "market_buy"
  | "market_sell";

/** Recompensa genérica (cualquier combinación). */
export interface Reward {
  credits?: number;
  /** XP de cuenta (nivel global del jugador). */
  xp?: number;
  /** Sobres otorgados. */
  packId?: string;
  packCount?: number;
  /** Carta concreta otorgada (CardDef.id). */
  cardId?: string;
  // ── Battle Pass (Collection Fase 6/7) — campos AÑADIDOS, todos opcionales ──
  /** Materiales de crafting (polvo por rareza). Reutiliza el recurso de `@/craft`. */
  materials?: Partial<Record<"common" | "uncommon" | "rare" | "epic" | "legendary", number>>;
  /** Cosméticos de cuenta (títulos/iconos/avatares/marcos/cosméticos de coach o jugador). Ids con prefijo. */
  cosmetics?: string[];
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
  missions: MissionDef[];
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
