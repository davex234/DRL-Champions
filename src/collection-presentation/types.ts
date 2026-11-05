/**
 * COLLECTION PRESENTATION, MUSEUM & SHOWCASE — vocabulario compartido (Collection Fase 7/7, FINAL).
 *
 * Capa AAA de PRESENTACIÓN de SOLO LECTURA. NO crea otro sistema de colección/inventario/economía/
 * progreso: PROYECTA los datos que ya exponen los motores existentes (Collection/Deck/Marketplace/
 * Craft/Battle Pass/Career/Living World/Competitive). Nunca modifica nada. Determinista (reloj lógico
 * inyectado; sin `Date.now`/`Math.random`). Cierra el módulo Collection.
 *
 *   Collection/Deck/Marketplace/Craft/BattlePass/Career → Presentation (read-only) → View-models
 */
import type { CardView, CollectionStatistics, CollectionProgress, SetProgress, HistoryEntry, CardInstanceView } from "@/collection";

export type { CardView, CollectionStatistics, CollectionProgress, SetProgress, HistoryEntry, CardInstanceView };

/** Versión del (opcional) config persistible de presentación (vitrinas). Migrable. */
export const CP_SCHEMA_VERSION = 1;

// ───────────────────────────── Museo ─────────────────────────────

export interface HallEntry { cardId: string; nick: string; label: string; rank: number; ovr: number; serial: number | null; reason: string }
export interface NamedCollection { id: string; label: string; owned: number; total: number; percent: number; cardIds: string[] }
export interface TimelineEntry { at: number; cardId: string; label: string; origin: string; serial: number | null }
export interface PersonalRecord { key: string; label: string; value: number; cardId?: string }
export interface Milestone { key: string; label: string; reached: boolean; progress: number }

export interface MuseumView {
  hallOfFame: HallEntry[];
  collectionTimeline: TimelineEntry[];
  historic: NamedCollection[];
  seasons: NamedCollection[];
  tournaments: NamedCollection[];
  champions: NamedCollection[];
  legacy: NamedCollection[];
  records: PersonalRecord[];
  milestones: Milestone[];
}

// ───────────────────────────── Showcase ─────────────────────────────

export interface NamedGroup { key: string; label: string; cards: CardView[] }
export interface DisplayCase { id: string; label: string; cards: CardView[] }
export interface DynamicShelf { id: string; label: string; rule: string; cards: CardView[] }

export interface ShowcaseView {
  featured: CardView[];
  favorites: CardView[];
  pinned: CardView[];
  rare: CardView[];
  serials: CardView[];
  byPlayer: NamedGroup[];
  byRegion: NamedGroup[];
  themes: NamedGroup[];
  dynamic: DynamicShelf[];
  cases: DisplayCase[];
}

// ───────────────────────────── Álbum ─────────────────────────────

export interface ProgressBucket { key: string; label: string; owned: number; total: number; percent: number }
export interface HeatCell { region: string; rarity: string; owned: number; total: number; intensity: number }
export interface DuplicateAnalysis { totalDuplicates: number; distinctDuplicated: number; top: { cardId: string; count: number }[] }
export interface SerialProgress { serializedOwned: number; gems: number; best: { cardId: string; serial: number }[] }

export interface AlbumView {
  completion: number;
  progress: CollectionProgress;
  statistics: CollectionStatistics;
  sets: SetProgress[];
  regions: ProgressBucket[];
  variants: ProgressBucket[];
  serials: SerialProgress;
  duplicates: DuplicateAnalysis;
  missing: string[];
  heatmap: HeatCell[];
}

// ───────────────────────────── Analytics ─────────────────────────────

export interface ValuedCard { cardId: string; value: number; nick?: string; label?: string }

export interface AnalyticsView {
  /** Valor de colección = suma de valor de instancia (reutiliza pricing; sin economía nueva). */
  collectionValue: number;
  /** Valor de mercado (si se inyecta la función del Marketplace). */
  marketValue: number;
  /** Valor en materiales de crafting (si se inyectan los materiales). */
  craftValue: number;
  /** Inversión estimada (proxy: valor de mercado − valor base). */
  investment: number;
  mostRare: ValuedCard | null;
  mostValuable: ValuedCard | null;
  fastestGrowing: ValuedCard | null;
  newest: TimelineEntry | null;
  oldest: TimelineEntry | null;
  mostUsed: { cardId: string; decks: number } | null;
  byOrigin: Record<string, number>;
  /** Historiales (proyectados tal cual desde los motores; nunca recalculados). */
  careerHistory: unknown[];
  passHistory: unknown[];
  marketHistory: unknown[];
}

// ───────────────────────────── Presentación (vistas de alto nivel) ─────────────────────────────

export interface CollectionSummary {
  owned: number;
  total: number;
  completion: number;
  distinct: number;
  duplicates: number;
  squadRating: number;
  serializedOwned: number;
  collectionValue: number;
}

export interface CardDetailView {
  card: CardView;
  instances: CardInstanceView[];
  history: HistoryEntry[];
  marketValue: number | null;
  bestSerial: number | null;
}

export interface ProfileView {
  summary: CollectionSummary;
  showcase: ShowcaseView;
  hallOfFame: HallEntry[];
  pass: unknown | null;
  topDecks: unknown[];
}

export interface SeasonReview { seasonId: string; level: number; percentComplete: number; missionsCompleted: number; archive: unknown[] }
export interface CareerReview { records: PersonalRecord[]; timeline: TimelineEntry[]; history: unknown[] }

/** Config OPCIONAL de vitrinas (orden/etiquetas). Deriva de la meta; no crea estado de colección. */
export interface ShowcaseConfig { version: number; caseOrder: string[]; pinned: string[] }
export const freshShowcaseConfig = (): ShowcaseConfig => ({ version: CP_SCHEMA_VERSION, caseOrder: [], pinned: [] });
