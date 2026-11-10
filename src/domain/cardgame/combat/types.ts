/**
 * COMBAT RESOLVER — vocabulario (Fase 4).
 *
 * ALCANCE, y por qué es este y no otro:
 *
 * El PDF cierra CUATRO reglas de combate y deja abierta la quinta. Cierra la tabla de
 * emparejamientos (SH↔EF, GS↔GS), que una carta gasta UNA estadística y queda fuera del resto de la
 * partida, que gana el valor mayor, y el desempate por suma de las medias de las 10 cartas. NO cierra
 * CÓMO se decide qué carta se enfrenta a cuál ni quién declara la estadística.
 *
 * Por eso el resolver NO elige los enfrentamientos: los RECIBE como `CombatPlan` y los resuelve.
 * Es la separación que permite implementar hoy todo lo que el documento define, sin inventar la
 * mecánica de turnos que sigue siendo una decisión de producto (OPD-01/02/03).
 *
 *   Snapshot A + Snapshot B + CombatPlan → validación → enfrentamientos → marcador → desempate
 *
 * PURO y DETERMINISTA: sin reloj, sin azar, sin red, sin estado global.
 */
import type { CombatStatKey } from "@/domain/cards/combat";
import type { DuelDeckCard, DuelDeckSnapshot, RoleId } from "../types";
import { CURRENT_COMBAT_RULES } from "./rules";

export type { CombatStatKey, DuelDeckSnapshot };

/**
 * Versión del resolver VIGENTE. Una partida guarda con qué reglas se jugó y se vuelve a resolver
 * con esas: las versiones antiguas siguen disponibles en `COMBAT_RULESETS` (ver `rules.ts`).
 */
export const RESOLVER_VERSION = CURRENT_COMBAT_RULES.version;

/** Versión de esquema de snapshot que este resolver sabe leer. */
export const SUPPORTED_SNAPSHOT_SCHEMA = 1;

/** Los dos bandos. */
export type Side = "A" | "B";

// ───────────────────────────── Plan de enfrentamientos ─────────────────────────────

/**
 * Un enfrentamiento DECLARADO: qué carta de cada bando y con qué estadística.
 *
 * Se declaran AMBAS estadísticas y el resolver comprueba que el par es legal según la tabla del
 * PDF. Así el resolver queda neutral ante OPD-02: sirva quien sirva para declararlas —el atacante,
 * los dos a ciegas o la propia tabla—, lo que llega aquí es un par que debe ser legal.
 */
export interface DeclaredEncounter {
  aUid: string;
  aStat: CombatStatKey;
  bUid: string;
  bStat: CombatStatKey;
}

/**
 * Plan completo de la partida. Lo produce la capa de orquestación (fase posterior), NO el resolver.
 *
 * Debe agotar los dos mazos: cada carta se usa exactamente una vez, que es la regla explícita del
 * PDF («solo se puede utilizar una estadística por carta, después esa carta no se podrá utilizar»).
 */
export interface CombatPlan {
  encounters: DeclaredEncounter[];
}

// ───────────────────────────── Resultado ─────────────────────────────

/** Quién gana un enfrentamiento. `TIE` solo si los dos valores son idénticos. */
export type EncounterOutcome = Side | "TIE";

/** La cara de un bando en un enfrentamiento, con todo lo necesario para auditarlo. */
export interface EncounterSide {
  uid: string;
  cardId: string;
  playerId: string;
  playerName: string;
  team: string;
  role: RoleId;
  variantId: string;
  /** Estadística declarada. */
  stat: CombatStatKey;
  /** Valor de esa estadística en el snapshot congelado. */
  value: number;
}

/** Un enfrentamiento ya resuelto. Es la unidad del audit trail. */
export interface ResolvedEncounter {
  index: number;
  a: EncounterSide;
  b: EncounterSide;
  outcome: EncounterOutcome;
  /** Explicación legible: «Stronghold 84 > Entryfrag 71». */
  reason: string;
}

/** Desglose del desempate del PDF: suma de las medias de las 10 cartas. */
export interface TiebreakBreakdown {
  applied: true;
  sumOvrA: number;
  sumOvrB: number;
  /** Bando que recibe el punto adicional, o `null` si las sumas empatan (regla no definida). */
  awardedTo: Side | null;
}

/**
 * Desglose del SEGUNDO y último desempate (OPD-08): diferencia total de estadística declarada.
 *
 * NO otorga punto y NO toca el marcador: el marcador refleja los enfrentamientos y el desempate
 * que sí define el PDF. Este criterio solo nombra un ganador, y lo deja escrito aquí.
 */
export interface MarginBreakdown {
  applied: true;
  /** Suma del valor declarado por cada bando en los 10 enfrentamientos. */
  statTotalA: number;
  statTotalB: number;
  /** Bando ganador, o `null` si los totales también coinciden (empate declarado). */
  awardedTo: Side | null;
}

/** Estado del resultado. */
export type CombatStatus =
  /** Resuelto: hay ganador. */
  | "RESOLVED"
  /** La entrada no cumple el contrato: no se resuelve nada. */
  | "INVALID_INPUT"
  /**
   * EMPATE EXPLÍCITO: ningún desempate decidió. Es un resultado VÁLIDO y terminal, no un fallo;
   * `winner` y `loser` son `null` a propósito. Solo lo produce un ruleset con `terminal: "DRAW"`.
   */
  | "DRAW"
  /**
   * Marcador empatado Y sumas del desempate también empatadas, SIN regla para deshacerlo. El motor
   * declara que no sabe. Solo lo produce el ruleset histórico `duel-combat-1` (OPD-08).
   */
  | "UNRESOLVED_TIEBREAK";

/** Qué nivel de la cadena decidió el resultado. Identificador de dominio, nunca texto. */
export type CombatDecidedBy =
  /** Los enfrentamientos: un bando ganó más. */
  | "SCORE"
  /** El desempate del PDF: suma de las medias de las 10 cartas. */
  | "OVR_TIEBREAK"
  /** El desempate de Fase 7: diferencia total de estadística declarada. */
  | "STAT_MARGIN"
  /** Nada decidió: empate declarado, sin resolver, o entrada inválida. */
  | "NONE";

/** Códigos de rechazo de entrada. Identificadores de dominio, nunca texto de interfaz. */
export type CombatErrorCode =
  | "SNAPSHOT_SCHEMA_UNSUPPORTED"
  | "SNAPSHOT_SIZE"
  | "SNAPSHOT_COMPOSITION"
  | "SNAPSHOT_CHECKSUM_MISMATCH"
  | "SNAPSHOT_MISSING_COMBAT"
  | "SNAPSHOT_DUPLICATE_CARD"
  | "DATA_VERSION_MISMATCH"
  | "PLAN_SIZE"
  | "PLAN_CARD_NOT_IN_SNAPSHOT"
  | "PLAN_CARD_REUSED"
  | "PLAN_CARD_UNUSED"
  | "PLAN_ILLEGAL_MATCHUP";

export interface CombatError {
  code: CombatErrorCode;
  side?: Side;
  uid?: string;
  expected?: number | string;
  actual?: number | string;
  role?: RoleId;
  /** El par de estadísticas declarado, cuando no está en la tabla. */
  matchup?: [CombatStatKey, CombatStatKey];
}

/** Identidad mínima de un mazo dentro del resultado. */
export interface CombatDeckRef {
  deckId: string;
  deckName: string;
  checksum: string;
}

/**
 * Resultado completo de un combate. Serializable, auditable y versionado: una partida guardada hoy
 * se puede volver a explicar dentro de un año aunque las reglas hayan cambiado.
 */
export interface CombatResult {
  status: CombatStatus;
  /** Reglas con las que se resolvió. */
  resolverVersion: string;
  /** Calibración de las cartas (ambos mazos comparten la misma). */
  dataVersion: string;
  schemaVersion: number;
  deckA: CombatDeckRef;
  deckB: CombatDeckRef;
  /** Huellas de entrada, para detectar manipulación posterior. */
  inputChecksumA: string;
  inputChecksumB: string;
  encounters: ResolvedEncounter[];
  scoreA: number;
  scoreB: number;
  /** Enfrentamientos con valores idénticos, que no puntúan para nadie. Ver OPD-05. */
  tiedEncounters: number;
  /** Suma del valor declarado por cada bando. Siempre presente: es dato de auditoría, no una regla. */
  statTotalA: number;
  statTotalB: number;
  tiebreak: TiebreakBreakdown | null;
  /** Segundo desempate, solo si hizo falta y las reglas lo contemplan. */
  marginTiebreak: MarginBreakdown | null;
  /** Nivel de la cadena que decidió. Permite explicar el resultado sin volver a razonarlo. */
  decidedBy: CombatDecidedBy;
  winner: Side | null;
  loser: Side | null;
  errors: CombatError[];
}

/** Vista congelada de un bando, tal y como entra al resolver. */
export interface SideInput {
  snapshot: DuelDeckSnapshot;
  byUid: Map<string, DuelDeckCard>;
}
