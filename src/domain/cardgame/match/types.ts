/**
 * DUEL MATCH — vocabulario del orquestador de turnos (Fase 5).
 *
 * SEPARACIÓN DE RESPONSABILIDADES, que es la regla crítica de esta fase:
 *
 *   · El ORQUESTADOR responde «¿qué ocurre ahora?»: de quién es el turno, qué cartas quedan,
 *     qué selecciones son legales y cuándo se avanza.
 *   · El RESOLVER responde «¿quién gana este combate?»: comparación, marcador, desempate.
 *
 * El orquestador NO calcula estadísticas, NO compara valores y NO decide ganadores. Construye el
 * `CombatPlan` y delega toda la matemática en `@/domain/cardgame/combat`.
 *
 * PURO y DETERMINISTA: sin reloj, sin azar, sin red, sin estado global. El id de la partida entra
 * por parámetro; el dominio nunca lo genera.
 */
import type { CombatStatKey } from "@/domain/cards/combat";
import type {
  CombatError, CombatResult, DuelDeckSnapshot, EncounterOutcome, ResolvedEncounter, Side,
} from "../combat";
import type { DuelDeckCard } from "../types";

export type { CombatStatKey, CombatResult, DuelDeckSnapshot, EncounterOutcome, ResolvedEncounter, Side };

/**
 * Versión del orquestador. Una partida guarda con qué reglas de FLUJO se jugó.
 *
 * `duel-turns-2` (Fase 7) añade `combatRulesVersion` a la partida: las reglas de RESULTADO se
 * congelan al empezar, de modo que una partida guardada se cierra con las reglas con las que
 * empezó aunque el producto cambie después. Las reglas de flujo —10 turnos, atacante alterno,
 * quién declara— no han cambiado.
 */
export const ORCHESTRATOR_VERSION = "duel-turns-2";

/** Turnos de una partida. Sale de las 10 cartas por mazo y de «una estadística por carta». */
export const TURNS_PER_MATCH = 10;

/** Ataques que hace cada bando cuando se alterna (OPD-03). */
export const ATTACKS_PER_SIDE = TURNS_PER_MATCH / 2;

// ───────────────────────────── Estado ─────────────────────────────

/**
 * Estado global de la partida.
 *
 * `WAITING` representa una partida creada que aún no ha empezado; también es el estado en el que
 * queda una partida que nunca se completó. El PDF no define abandono ni rendición, así que NO se
 * inventa un estado `ABANDONED`: una partida sin terminar sencillamente no tiene `result`.
 */
export type MatchStatus =
  | "WAITING"
  | "IN_PROGRESS"
  /** Terminada con ganador. */
  | "COMPLETED"
  /**
   * Terminada en EMPATE explícito: los 10 turnos se jugaron y ningún desempate decidió. Es un
   * resultado válido con `result` presente y `winner: null`, y por eso NO comparte estado con
   * `UNRESOLVED`: un empate no es un fallo.
   */
  | "DRAW"
  /**
   * Terminada sin resultado. Solo alcanzable con las reglas históricas `duel-combat-1`, que no
   * tenían segundo desempate. Con las reglas vigentes no se produce nunca.
   */
  | "UNRESOLVED";

/**
 * Subestado dentro del turno actual. Es la máquina de estados que impide acciones ilegales:
 * ninguna selección se acepta fuera de su fase.
 */
export type TurnPhase =
  | "NOT_STARTED"
  | "ATTACKER_CARD"
  | "ATTACKER_STAT"
  | "DEFENDER_CARD"
  | "DEFENDER_STAT"
  | "READY_TO_CONFIRM"
  | "FINISHED";

/** Selecciones en curso del turno. Se descarta al confirmar. */
export interface TurnDraft {
  attackerCardUid: string | null;
  attackerStat: CombatStatKey | null;
  defenderCardUid: string | null;
  defenderStat: CombatStatKey | null;
}

export const emptyDraft = (): TurnDraft => ({
  attackerCardUid: null, attackerStat: null, defenderCardUid: null, defenderStat: null,
});

// ───────────────────────────── Turno ─────────────────────────────

/**
 * Un turno ya resuelto. Guarda las decisiones Y el enfrentamiento completo del resolver, de modo
 * que se puede reconstruir exactamente qué ocurrió sin volver a calcular nada.
 */
export interface DuelTurn {
  number: number;
  attacker: Side;
  defender: Side;
  attackerCardUid: string;
  attackerStat: CombatStatKey;
  defenderCardUid: string;
  defenderStat: CombatStatKey;
  outcome: EncounterOutcome;
  /** Audit trail del resolver: identidades, valores y explicación. */
  encounter: ResolvedEncounter;
  /** Marcador tras este turno, para poder rebobinar sin recalcular. */
  scoreAfterA: number;
  scoreAfterB: number;
}

// ───────────────────────────── Partida ─────────────────────────────

/**
 * Partida completa. Plano y serializable a JSON: sin clases, sin funciones, sin referencias
 * circulares. Guardar, cargar y continuar desde `currentTurn` no pierde información.
 */
export interface DuelMatch {
  id: string;
  orchestratorVersion: string;
  /**
   * Reglas de RESULTADO congeladas al empezar (OPD-05 / OPD-08). Se guardan en la partida para que
   * una partida pausada hoy se cierre con las reglas de hoy, aunque el producto las cambie mañana.
   */
  combatRulesVersion: string;
  snapshotA: DuelDeckSnapshot;
  snapshotB: DuelDeckSnapshot;

  status: MatchStatus;
  phase: TurnPhase;
  /** 0 antes de empezar; 1..10 durante la partida. */
  currentTurn: number;
  /**
   * Quién ataca este turno. Se guarda EXPLÍCITAMENTE en vez de deducirlo de la paridad del turno:
   * si mañana el orden deja de ser alterno, el modelo no cambia.
   */
  attacker: Side | null;

  draft: TurnDraft;
  turns: DuelTurn[];

  /** uids ya consumidos. Una carta se usa exactamente una vez. */
  usedA: string[];
  usedB: string[];

  scoreA: number;
  scoreB: number;
  ties: number;

  /** Solo existe cuando la partida termina. Nunca se fabrica. */
  result: DuelMatchResult | null;
}

/**
 * Resultado final. ENVUELVE al `CombatResult`, que sigue siendo la autoridad matemática: el
 * orquestador no recalcula el marcador ni el desempate, los toma del resolver.
 */
export interface DuelMatchResult {
  matchId: string;
  orchestratorVersion: string;
  /** Autoridad matemática. Marcador final, desempates y audit trail salen de aquí. */
  combat: CombatResult;
  winner: Side | null;
  loser: Side | null;
  /**
   * Empate EXPLÍCITO. Se copia del resolver, no se deduce de `winner === null`: así una partida
   * empatada nunca se confunde con una que no se pudo resolver.
   */
  isDraw: boolean;
  /** Marcador final, tomado del resolver (incluye el punto del desempate si lo hubo). */
  scoreA: number;
  scoreB: number;
  tiedEncounters: number;
  /**
   * Comprobación de integridad: el recuento incremental de los 10 turnos coincide con el que
   * produce el resolver sobre el plan completo. Si fuese `false`, hay un error interno y NO se
   * corrige el resultado: se marca.
   */
  integrityOk: boolean;
}

// ───────────────────────────── Errores ─────────────────────────────

/** Códigos de rechazo del orquestador. Identificadores de dominio, nunca texto de interfaz. */
export type MatchErrorCode =
  | "INVALID_MATCH"
  | "WRONG_PHASE"
  | "CARD_ALREADY_USED"
  | "CARD_NOT_IN_SNAPSHOT"
  | "STAT_ALREADY_CONSUMED"
  | "ILLEGAL_STAT_MATCHUP"
  | "MISSING_ATTACKER_CARD"
  | "MISSING_ATTACKER_STAT"
  | "MISSING_DEFENDER_CARD"
  | "MISSING_DEFENDER_STAT"
  | "MATCH_ALREADY_COMPLETE"
  | "INVALID_PLAN";

export interface MatchError {
  code: MatchErrorCode;
  /** Bando afectado. */
  side?: Side;
  uid?: string;
  stat?: CombatStatKey;
  /** Fase esperada frente a la actual, en `WRONG_PHASE`. */
  expectedPhase?: TurnPhase;
  actualPhase?: TurnPhase;
  turn?: number;
  /** Problemas del resolver, en `INVALID_MATCH` e `INVALID_PLAN`. */
  combatErrors?: CombatError[];
}

/** Toda acción devuelve esto: nunca un booleano suelto, nunca una excepción. */
export type MatchAction =
  | { ok: true; match: DuelMatch }
  | { ok: false; error: MatchError; match: DuelMatch };

// ───────────────────────────── Vista para la interfaz ─────────────────────────────

/**
 * Proyección de solo lectura con todo lo que una futura pantalla necesita. Se calcula, no se
 * guarda: la interfaz no debe derivar reglas por su cuenta.
 */
export interface MatchView {
  matchId: string;
  status: MatchStatus;
  phase: TurnPhase;
  turn: number;
  attacker: Side | null;
  defender: Side | null;
  scoreA: number;
  scoreB: number;
  ties: number;
  /** Cartas que el atacante puede declarar ahora. Vacío si no toca elegir. */
  attackerChoices: DuelDeckCard[];
  /** Cartas con las que el defensor puede responder ahora. */
  defenderChoices: DuelDeckCard[];
  /** Estadísticas legales para quien deba declarar ahora. */
  statChoices: CombatStatKey[];
  draft: TurnDraft;
  usedA: DuelDeckCard[];
  usedB: DuelDeckCard[];
  availableA: DuelDeckCard[];
  availableB: DuelDeckCard[];
  history: DuelTurn[];
  result: DuelMatchResult | null;
}
