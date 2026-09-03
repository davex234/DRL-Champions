/**
 * DUEL OPPONENT — vocabulario (Fase 6).
 *
 * SEPARACIÓN DE RESPONSABILIDADES, la regla crítica de esta fase:
 *
 *   · El OPONENTE responde «¿qué decisión tomo?». Solo produce decisiones.
 *   · El ORQUESTADOR responde «¿qué ocurre ahora?». Valida y avanza.
 *   · El RESOLVER responde «¿quién gana?». Compara y puntúa.
 *
 * El bot NUNCA resuelve el combate, NUNCA modifica el estado y NUNCA puede saltarse una regla:
 * sus decisiones pasan por las mismas acciones del orquestador que usaría una persona. Si un bot
 * propusiera una jugada ilegal, el orquestador la rechazaría igual.
 *
 * El oponente NO tiene acceso a Supabase, al catálogo, a la propiedad, a la red ni a React:
 * trabaja únicamente con el contexto que recibe.
 */
import type { CombatStatKey } from "@/domain/cards/combat";
import type { DuelDeckCard } from "../types";
import type { DuelMatch, Side } from "../match";
import type { RngState } from "./rng";

export type { CombatStatKey, DuelDeckCard, DuelMatch, RngState, Side };

/** Versión del motor de oponente. Una partida guarda con qué bot se jugó. */
export const OPPONENT_ENGINE_VERSION = "duel-opponent-2";

/** Quién controla un bando. `ASYNC` y `REALTIME` quedan declarados pero sin implementar. */
export type ParticipantKind = "HUMAN" | "BOT";

/** Un participante de la partida. El dominio NO asume que «A» sea siempre humano. */
export interface DuelParticipant {
  side: Side;
  kind: ParticipantKind;
  /** Identificador del controlador. Para un bot, su id; para una persona, su id de usuario. */
  id: string;
}

/**
 * Dificultad del bot. Se define por la CALIDAD DE DECISIÓN, no por ventajas artificiales: ningún
 * nivel modifica estadísticas, cartas ni reglas.
 */
export type BotDifficulty = "EASY" | "NORMAL" | "HARD";

/**
 * Perfil de un nivel de dificultad (OPD-42).
 *
 * `heuristicRate` es la fracción de decisiones que el bot toma con heurística; el resto las toma
 * al azar DETERMINISTA con el mismo generador serializable. Es el único mando de la escalera: no
 * existe ningún nivel que vea más, puntúe más ni juegue con otras reglas.
 *
 * `perfectInformation` es independiente y está medida aparte (OPD-04): un bot con información
 * perfecta ve las cartas que le QUEDAN al rival, no solo las que ya jugó.
 */
export interface BotProfile {
  /** Fracción de decisiones heurísticas, en [0,1]. */
  heuristicRate: number;
  /** Si el bot ve las cartas no jugadas del rival. */
  perfectInformation: boolean;
}

// ───────────────────────────── Contexto de decisión ─────────────────────────────

/** Qué papel juega el bot en este turno. */
export type DecisionRole = "ATTACKER" | "DEFENDER";

/**
 * Todo lo que el bot puede ver para decidir. Es su ÚNICA fuente: no consulta nada más.
 *
 * `visibleOpponentCards` implementa el modelo de información, que desde la Fase 7 es el MISMO para
 * los tres niveles: solo las cartas del rival YA JUGADAS, es decir información pública (OPD-04
 * cerrada). Ningún nivel de la escalera ve lo que el jugador no puede ver.
 *
 * El campo `perfectInformation` del bot puede ampliarlo a las cartas que le quedan al rival, pero
 * ningún perfil de dificultad lo activa: existe para poder MEDIR cuánto aportaría, que es como se
 * cerró la decisión, y para poder reabrirla con evidencia si el producto lo pide.
 */
export interface DecisionContext {
  role: DecisionRole;
  side: Side;
  turn: number;
  /** Cartas propias todavía disponibles. */
  available: DuelDeckCard[];
  /** Estadísticas que el bot puede declarar ahora. Al defender es exactamente una. */
  legalStats: CombatStatKey[];
  /** Estadística que declaró el atacante, cuando el bot defiende. */
  attackerStat: CombatStatKey | null;
  /** Valor que el bot debe superar para ganar, cuando defiende y lo conoce. */
  attackerValue: number | null;
  /** Cartas del rival que el bot puede ver, según su dificultad. */
  visibleOpponentCards: DuelDeckCard[];
  scoreSelf: number;
  scoreOpponent: number;
  /** Estado del generador. El bot devuelve el estado siguiente; nunca guarda estado propio. */
  rng: RngState;
}

/** Decisión del bot: el valor elegido, el generador avanzado y por qué. */
export interface Decision<T> {
  value: T;
  rng: RngState;
  /** Explicación legible. Telemetría: siempre se puede contar por qué eligió eso. */
  explanation: string;
}

/**
 * Contrato de un oponente controlado por el sistema.
 *
 * `chooseDefenderStat` existe por simetría, pero NO es una elección libre: la estadística del
 * defensor la impone la tabla del PDF. Toda implementación debe devolver la única legal, y hay un
 * test que lo verifica sobre las dos estrategias.
 */
export interface DuelOpponent {
  readonly id: string;
  readonly kind: "BOT";
  readonly difficulty: BotDifficulty;
  /**
   * Si el bot ve las cartas que le QUEDAN al rival. Lo declara el bot y lo obedece el controlador:
   * la visibilidad dejó de deducirse de la dificultad para poder medirla por separado (OPD-04).
   */
  readonly perfectInformation: boolean;
  chooseAttackerCard(ctx: DecisionContext): Decision<string>;
  chooseAttackerStat(ctx: DecisionContext): Decision<CombatStatKey>;
  chooseDefenderCard(ctx: DecisionContext): Decision<string>;
  chooseDefenderStat(ctx: DecisionContext): Decision<CombatStatKey>;
}

// ───────────────────────────── Telemetría ─────────────────────────────

/** Una decisión registrada. NO sustituye a `DuelTurn`: lo acompaña. */
export interface DecisionLogEntry {
  turn: number;
  side: Side;
  role: DecisionRole;
  step: "ATTACKER_CARD" | "ATTACKER_STAT" | "DEFENDER_CARD" | "DEFENDER_STAT";
  /** Quién decidió. */
  actor: ParticipantKind;
  /** Estrategia usada, si fue un bot. */
  strategy: string | null;
  /** Valor elegido: uid de carta o estadística. */
  chosen: string;
  /** Opciones que tenía. */
  options: string[];
  explanation: string;
}

// ───────────────────────────── Errores ─────────────────────────────

export type OpponentErrorCode =
  | "NOT_BOT_TURN"
  | "NO_AVAILABLE_CARDS"
  | "NO_LEGAL_STATS"
  | "MATCH_NOT_IN_PROGRESS"
  | "INVALID_RNG_STATE"
  | "ILLEGAL_DECISION";

export interface OpponentError {
  code: OpponentErrorCode;
  side?: Side;
  turn?: number;
  /** Detalle del rechazo que produjo el orquestador, si la decisión resultó ilegal. */
  detail?: string;
}

/** Resultado de hacer avanzar al bot. Nunca lanza excepción. */
export type BotStepResult =
  | { ok: true; match: DuelMatch; rng: RngState; log: DecisionLogEntry[] }
  | { ok: false; error: OpponentError; match: DuelMatch; rng: RngState };
