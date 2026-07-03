/**
 * COLLECTION CORE — vocabulario compartido (Collection Fase 1/7).
 *
 * El Collection Engine es una capa PURA y DETERMINISTA sobre lo que YA existe: el Card Registry
 * (`@/data/catalog`), las variantes (`@/domain/cards/variants`), la propiedad (`OwnedCard[]` del
 * `useGameStore`) y los selectores (`@/store/selectors`). NO duplica cartas, ni inventario, ni
 * catálogo, ni identidad: PROYECTA esos datos en vistas de colección. La única información NUEVA es
 * `CollectionMeta` (favoritos/etiquetas/bloqueos/orígenes). Sin `Date.now`/`Math.random` (reloj
 * lógico inyectado). Depende de cards/data/store; nadie depende de collection.
 */
import type {
  CardDef, OwnedCard, Player, VariantDef, VariantId, VariantGroup, Region, RoleId, PlayerStats,
} from "@/domain/cards/types";

export type { CardDef, OwnedCard, Player, VariantDef, VariantId, VariantGroup, Region, RoleId, PlayerStats };

/** Versión del esquema persistible de la colección (para migraciones/compat futura). */
export const COLLECTION_SCHEMA_VERSION = 1;

/**
 * De dónde vino una instancia (Card Origin). No muta `OwnedCard`: se lleva en la meta.
 * El Pack/Drop Engine (Collection Fase 2/7) es el ÚNICO que acuña instancias y sella su origen.
 */
export type CardOrigin =
  | "pack" | "market" | "reward" | "tournament" | "starter" | "craft" | "unknown"
  | "event" | "battlepass" | "admin" | "gift" | "promo" | "code";

/** Calidad DERIVADA de una instancia (de la posición de serie / rareza). No es un campo nuevo. */
export type QualityGrade = "standard" | "fine" | "pristine" | "mint" | "gem";

/**
 * Metadatos de colección — la ÚNICA información nueva y persistible. Todo es plano/serializable y se
 * opera de forma INMUTABLE (cada acción devuelve una meta nueva). Favoritos/etiquetas/ocultas por
 * `cardId`; bloqueos/orígenes por `uid` de instancia.
 */
export interface CollectionMeta {
  version: number;
  favorites: string[];                    // cardIds marcados como favoritos
  tags: Record<string, string[]>;         // cardId -> etiquetas del usuario
  locks: string[];                        // uids de instancias bloqueadas (anti-venta)
  hidden: string[];                       // cardIds ocultos de la vista
  origins: Record<string, CardOrigin>;    // uid -> origen
}

export const emptyMeta = (): CollectionMeta => ({ version: COLLECTION_SCHEMA_VERSION, favorites: [], tags: {}, locks: [], hidden: [], origins: {} });

/** Vista unificada de una CARTA (definición + jugador + variante + propiedad + meta). Proyección. */
export interface CardView {
  cardId: string;
  playerId: string;
  variantId: VariantId;
  nick: string;
  team: string;
  teamTag: string;
  region: Region;
  role: RoleId;
  country: string;
  label: string;                 // etiqueta de la variante
  group: VariantGroup;
  rank: number;                  // rareza (variant.rank)
  ovr: number;
  stats: PlayerStats;
  serialized: boolean;
  serialLimit: number | null;
  owned: boolean;
  count: number;                 // copias poseídas
  bestSerial: number | null;     // menor nº de serie poseído (más valioso)
  favorite: boolean;
  hidden: boolean;
  tags: string[];
}

/** Vista de una INSTANCIA concreta (Card Instance). */
export interface CardInstanceView {
  uid: string;
  cardId: string;
  serial: number | null;
  obtainedAt: number;
  origin: CardOrigin;
  locked: boolean;
  quality: QualityGrade;
}

// ───────────────────────────── Filtros / orden / agrupación ─────────────────────────────

/** Especificación de filtro (todos los criterios son AND; los arrays son OR internos). */
export interface FilterSpec {
  text?: string;                 // busca en nick/equipo/etiqueta de variante
  regions?: Region[];
  roles?: RoleId[];
  groups?: VariantGroup[];
  variants?: VariantId[];
  minRank?: number;
  maxRank?: number;
  minOvr?: number;
  owned?: boolean;               // true=solo poseídas, false=solo faltantes
  favorite?: boolean;
  serialized?: boolean;
  tags?: string[];
  includeHidden?: boolean;       // por defecto false
}

export type SortKey = "ovr" | "rank" | "name" | "team" | "region" | "count" | "serial" | "obtained";
export interface SortSpec { key: SortKey; dir: "asc" | "desc" }

export type GroupKey = "region" | "role" | "group" | "variant" | "rarity" | "team" | "owned";

// ───────────────────────────── Sets / series / temporadas ─────────────────────────────

export type SetKind = "group" | "region" | "role" | "series" | "season";
export interface SetDef { id: string; kind: SetKind; label: string; cardIds: string[] }
export interface SetProgress { id: string; kind: SetKind; label: string; owned: number; total: number; percent: number; complete: boolean; missing: string[] }

// ───────────────────────────── Álbum / binder ─────────────────────────────

export interface AlbumEntry { cardId: string; owned: boolean; count: number }
export interface BinderPage { index: number; cards: CardView[] }

// ───────────────────────────── Estadísticas / progreso / analytics ─────────────────────────────

export interface CollectionProgress { distinct: number; total: number; percent: number; owned: number; missing: number }
export interface CollectionStatistics {
  progress: CollectionProgress;
  totalInstances: number;
  duplicates: number;
  squadRating: number;
  byRarity: Record<string, number>;   // rank -> distinct owned
  byRegion: Record<string, number>;
  byGroup: Record<string, number>;
  byRole: Record<string, number>;
}
export interface CollectionAnalytics {
  rarestOwned: string | null;         // cardId
  mostDuplicated: string | null;      // cardId
  completionByGroup: Record<string, number>;
  completionByRegion: Record<string, number>;
  serializedOwned: number;
  ovrSum: number;                     // proxy de valor (sin economía)
}

// ───────────────────────────── Eventos / broadcast ─────────────────────────────

export type CollectionEventType =
  | "acquired" | "new_card" | "duplicate" | "set_completed" | "series_completed" | "milestone"
  | "favorited" | "unfavorited" | "locked" | "unlocked";

export interface CollectionEvent { type: CollectionEventType; at: number; cardId?: string; uid?: string; data?: unknown }

export interface BroadcastView {
  completion: number;                 // %
  distinct: number;
  total: number;
  recent: string[];                   // cardIds recién adquiridos
  featured: string | null;            // carta más rara poseída
  nearingSet: SetProgress | null;     // set más cerca de completarse
}

// ───────────────────────────── Comparación ─────────────────────────────

export interface CompareResult {
  a: string; b: string;
  ovrDelta: number;
  rankDelta: number;
  statDeltas: Record<keyof PlayerStats, number>;
  better: "a" | "b" | "equal";
}
