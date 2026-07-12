/**
 * TIPOS DEL CONECTOR VLR (Tournament Automation · Fase 1/5).
 *
 * El conector convierte páginas HTML de vlr.gg en el `RawSnapshot` OFICIAL que ya espera el
 * Data Import Engine (`@/importer`). Aquí viven las formas INTERMEDIAS (`Vlr*`): lo que se extrae
 * literalmente del HTML antes de normalizar. La red vive SOLO detrás de `VlrFetcher` (inyectable):
 * todo el parsing es puro (string → datos), verificable offline con fixtures.
 */
import type { RawSnapshot } from "@/importer";

/** Referencia a un torneo de VLR extraída de la URL. */
export interface VlrEventRef {
  /** Id numérico del torneo en vlr.gg (p. ej. "2765"). */
  eventId: string;
  /** Slug legible de la URL (p. ej. "valorant-masters-london-2026"). Puede faltar. */
  slug?: string;
}

/** Fuente de HTML inyectable: la implementación real hace HTTP; los tests inyectan fixtures. */
export type VlrFetcher = (url: string) => Promise<string>;

// ── Formas intermedias extraídas del HTML (crudas, sin decidir nada) ──

/** Cabecera del torneo (página /event/{id}). */
export interface VlrEventInfo {
  name: string;
  subtitle?: string;
  /** Texto crudo de fechas ("Aug 1–25, 2024"). */
  datesText?: string;
  /** Fechas ya resueltas a ISO (YYYY-MM-DD). */
  startDate?: string;
  endDate?: string;
  prizePool?: number;
  location?: string;
  /** Código de país del flag de la sede ("KR"). */
  country?: string;
  /** Breadcrumb del circuito ("Valorant Champions Tour 2024") y su slug ("/vct-2024"). */
  circuitName?: string;
  circuitSlug?: string;
}

export interface VlrRosterPlayer {
  vlrId?: string;
  nick: string;
  country?: string;
}

/** Equipo participante (tarjeta event-team de la página del torneo). */
export interface VlrTeam {
  vlrId?: string;
  name: string;
  players: VlrRosterPlayer[];
  /** Nota de la tarjeta ("Group A #1") — texto informativo, no se interpreta. */
  note?: string;
}

/** Fila agregada de la página /event/stats (una por jugador en el torneo). */
export interface VlrStatsRow {
  vlrPlayerId?: string;
  nick: string;
  /** Tag del equipo tal y como lo muestra VLR bajo el nick ("VIT", "FNC"). */
  teamTag?: string;
  country?: string;
  /** Agentes jugados (nombres canónicos, ver agents.ts). */
  agents: string[];
  mapsPlayed?: number;
  roundsPlayed?: number;
  rating?: number;
  acs?: number;
  kd?: number;
  kast?: number;
  adr?: number;
  hsPct?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  fk?: number;
  fd?: number;
}

/** Fila de scoreboard de UN mapa (página de partido, valores "both sides"). */
export interface VlrMapPlayerRow {
  vlrPlayerId?: string;
  nick: string;
  teamTag?: string;
  /** Índice de la tabla dentro del mapa (0 = equipo A del partido, 1 = equipo B). */
  tableIdx: number;
  agent?: string;
  rating?: number;
  acs?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  kast?: number;
  adr?: number;
  hsPct?: number;
  fk?: number;
  fd?: number;
}

/** Un mapa jugado dentro de un partido (contenedor vm-stats-game). */
export interface VlrMap {
  /** data-game-id de VLR ("180369"). */
  gameId: string;
  name?: string;
  order: number;
  /** Marcadores alineados a teamA/teamB del PARTIDO (no al lado izquierdo/derecho del HTML). */
  scoreA?: number;
  scoreB?: number;
  /** Nombre del equipo ganador del mapa. */
  winner?: string;
  /** Nombre del equipo que pickeó el mapa. */
  pickedBy?: string;
  playerStats: VlrMapPlayerRow[];
}

/** Partido de la lista /event/matches, enriquecido con su página de detalle si se descarga. */
export interface VlrMatch {
  /** Id numérico de VLR ("378662"). */
  vlrId: string;
  /** Ruta relativa de la página del partido ("/378662/gen-g-vs-sentinels-..."). */
  urlPath: string;
  teamA: string;
  teamB: string;
  scoreA?: number;
  scoreB?: number;
  /** Nombre del ganador (mod-winner en la lista). */
  winner?: string;
  /** Texto de estado de VLR ("Completed", "LIVE", "1d 2h"). */
  statusText?: string;
  /** Serie dentro de la fase ("Opening (B)"). */
  series?: string;
  /** Fase ("Group Stage", "Playoffs"). */
  stage?: string;
  /** Día (label de la lista, "Thu, August 1, 2024") y hora local mostrada ("10:00 AM"). */
  dayText?: string;
  timeText?: string;
  /** Timestamp UTC exacto de la página de detalle ("2024-08-01 04:00:00"). */
  utcTs?: string;
  bestOf?: number;
  maps: VlrMap[];
  /**
   * Equipos con id de VLR extraídos de la cabecera de la página de detalle (/team/{id}).
   * Fuente complementaria: la página del evento no siempre lista todas las tarjetas de equipo.
   */
  teamRefs?: { name: string; vlrId: string }[];
}

// ── Opciones y salida del motor ──

export interface VlrImportOptions {
  /** Fuente de HTML. Por defecto, HTTP real (client.ts). Los tests inyectan fixtures. */
  fetcher?: VlrFetcher;
  /**
   * Descargar también la página de CADA partido (mapas + stats por mapa). Recomendado: el
   * Importer trabaja con stats por mapa. Con `false` solo se usan las 3 páginas del evento.
   */
  includeMatchDetails?: boolean;
  /** Tope de páginas de partido a descargar (protección; por defecto sin tope real: 512). */
  maxMatchPages?: number;
  /** Pausa entre descargas de páginas de partido (ms). 0 si el fetcher es inyectado. */
  politeDelayMs?: number;
}

/** Metadatos del proceso (trazabilidad; NO forman parte del RawSnapshot). */
export interface VlrImportMeta {
  sourceUrl: string;
  eventId: string;
  slug?: string;
  pagesFetched: number;
  matchesListed: number;
  matchDetailsFetched: number;
  mapsParsed: number;
  mapStatRows: number;
}

/** Salida del conector: el RawSnapshot OFICIAL + trazabilidad + avisos no fatales. */
export interface VlrImportOutput {
  ref: VlrEventRef;
  snapshot: RawSnapshot;
  meta: VlrImportMeta;
  /** Avisos no fatales (p. ej. "página del partido X ilegible: mapas omitidos"). */
  warnings: string[];
}
