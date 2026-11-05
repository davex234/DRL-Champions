/**
 * TACTICAL INTELLIGENCE ENGINE — Tipos (hoja, sin imports del sim).
 *
 * El entrenador deja de ordenar JUGADORES y ordena CONCEPTOS. La IA traduce esos
 * conceptos a una estrategia construida en caliente (un Tactical Graph de datos, no
 * un árbol gigante ni scripts). Todo el estado es PLANO y clonable (vive dentro del
 * RoundState, que el motor clona cada tick).
 */

/** Carriles del mapa (slice de un solo sitio: A=Main, "B"=Tree, Mid). Map-agnóstico. */
export type Lane = "main" | "tree" | "mid";

/** Estado de compra estimado (el sim no tiene economía real; se modela aquí). */
export type Buy = "full" | "force" | "eco" | "bonus";

/**
 * Vocabulario de conceptos que la IA "conoce". No son estrategias completas: son
 * ÁTOMOS que el planner compone en un grafo. (Algunos son de economía o meta.)
 */
export type ConceptId =
  // ataque
  | "default" | "contact" | "explode" | "split" | "fake" | "rehit" | "lurk"
  | "map_control" | "play_picks" | "eco_rush" | "save"
  // defensa
  | "spread" | "stack" | "crossfire" | "aggro_info" | "rotate" | "retake" | "anchor"
  // economía / meta
  | "force" | "bonus" | "anti_eco" | "conditioning" | "anti_strat" | "adapt"
  | "timeout" | "trade" | "pick";

export type ConceptPhase = "attack" | "defense" | "economy" | "meta";

/** Metadato declarativo de un concepto (la "ficha" que hace que la IA lo conozca). */
export interface ConceptInfo {
  id: ConceptId;
  label: string;
  phase: ConceptPhase;
  summary: string;
}

// ---- Tactical Graph (DATOS, no código) ----
export type NodeKind = "objective" | "action" | "fallback" | "adaptation";

/** Condición que dispara una transición (evaluada por el runner). */
export type ConditionKind =
  | "always" | "atCommit" | "mapControlDone" | "contactBad" | "laneOpen"
  | "manDown" | "planted" | "contactDetected" | "outnumbered";

export interface TacticNode {
  id: string;
  kind: NodeKind;
  concept: ConceptId;
  /** Parámetros del concepto (carril, tempo, estilo…). */
  params: Record<string, unknown>;
}

export interface TacticEdge {
  from: string;
  to: string;
  when: ConditionKind;
}

export interface TacticalPlan {
  nodes: TacticNode[];
  edges: TacticEdge[];
  rootId: string;
}

/** Orden de CONCEPTO del entrenador (lo que sustituye a "mover al jugador X"). */
export interface ConceptOrder {
  intent: ConceptId;        // "default" | "explode" | "fake" | "retake" | "play_picks" | ...
  lane?: Lane;
  tempo?: "slow" | "mid" | "fast";
  style?: "aggressive" | "default" | "passive" | "save";
}

/** Modelo del rival (memoria de partido; se actualiza ronda a ronda). */
export interface OpponentModel {
  rounds: number;
  /** Cuántas veces el rival ATACÓ por cada carril. */
  attackLane: Record<Lane, number>;
  /** Dónde aguantó el rival en DEFENSA (densidad por carril). */
  defendLane: Record<Lane, number>;
  /** Carriles donde NOSOTROS perdimos / ganamos atacando. */
  ourLaneLost: Record<Lane, number>;
  ourLaneWon: Record<Lane, number>;
  /** Últimos carriles de ataque del rival (para detectar patrón). */
  recentAttack: Lane[];
  /** Bajas acumuladas por nick rival (para el jugador dominante). */
  fragCount: Record<string, number>;
  /** Nick del rival con más impacto observado. */
  dominantFragger: string | null;
}

export interface TeamEconomy {
  credits: number;
  buy: Buy;
  lossStreak: number;
}

/** Estado táctico de UN equipo en la ronda actual (plano y clonable). */
export interface TeamTacticState {
  side: "ATK" | "DEF";
  buy: Buy;
  order: ConceptOrder | null;
  /** Concepto cabecera elegido para la ronda (para telemetría/narrativa). */
  concept: ConceptId;
  plan: TacticalPlan;
  activeNode: string;
  /** Carril principal (ataque) o carril a reforzar (defensa). */
  lane: Lane;
  /** Carril de la finta (solo fake). */
  fakeLane: Lane | null;
  /** Tick en el que el ataque compromete el execute. */
  commitTick: number;
  /** Estilo (p. ej. retake: aggressive/default/save). */
  style: string;
  /** Ya se adaptó esta ronda (evita re-adaptar en bucle). */
  adapted: boolean;
  /** Consume el Spatial Engine (holds/crossfires/rutas surgen del mapa, no hardcode). */
  spatial: boolean;
  /** Fase TÁCTICA reconocible en curso (default/map_control/info/pressure/fake/read/rotation/
   *  execute/post_plant/retake/save). La actualiza el runner cada tick (Tactical Director 2.0). */
  phase: TacticalPhaseId;
  /** Lecturas EN VIVO del rival (anti-strat): "siempre pushean Mid", "rotan pronto", … */
  reads: string[];
  /** Notas legibles de lo que decidió (para narrativa/depuración). */
  notes: string[];
}

/** Fases tácticas RECONOCIBLES de una ronda (Tactical Director 2.0). */
export type TacticalPhaseId =
  | "prepare" | "default" | "map_control" | "info" | "pressure" | "fake" | "read"
  | "rotation" | "execute" | "post_plant" | "retake" | "save" | "ended";

/** Cada lado es opcional: permite un equipo táctico contra uno estático (comparación). */
export interface TacticalRuntime {
  ATK?: TeamTacticState;
  DEF?: TeamTacticState;
}

/** Semilla de un equipo para arrancar la ronda (lo que arrastra la partida). */
export interface TeamSeed {
  economy: TeamEconomy;
  model: OpponentModel;
  order?: ConceptOrder | null;
  /** Activa la inteligencia ESPACIAL (holds/crossfires/rutas del Spatial Engine). */
  useSpatial?: boolean;
}

export interface TacticalSetup {
  ATK?: TeamSeed;
  DEF?: TeamSeed;
}

export const LANES: Lane[] = ["main", "tree", "mid"];

export function emptyModel(): OpponentModel {
  const z = (): Record<Lane, number> => ({ main: 0, tree: 0, mid: 0 });
  return {
    rounds: 0, attackLane: z(), defendLane: z(), ourLaneLost: z(), ourLaneWon: z(),
    recentAttack: [], fragCount: {}, dominantFragger: null,
  };
}
