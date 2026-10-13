/**
 * DUELOS — CONTRATO ENTRE SERVIDOR E INTERFAZ (Fase 8).
 *
 * Todo lo que la interfaz puede saber de un duelo está aquí, y NADA MÁS. Es deliberado: si un dato
 * no está en estos tipos, el cliente no lo recibe. En particular no existe ningún campo con las
 * cartas no jugadas del rival, ni con el estado del generador, ni con las semillas.
 *
 * Estos tipos NO son reglas: son la forma de lo que el servidor ya decidió. Las reglas viven en
 * `@/domain/cardgame` y no se duplican aquí.
 */
import type { CombatStats, CombatStatKey } from "@/domain/cards/combat";
import type { Region, RoleId, VariantId } from "@/domain/cards/types";
import type { EncounterOutcome, Side } from "@/domain/cardgame/combat";
import type { MatchStatus, TurnPhase } from "@/domain/cardgame/match";
import type { BotDifficulty } from "@/domain/cardgame/opponent";
import type { DuelDeckErrorCode, DuelDeckStatus } from "@/domain/cardgame";
import type { HiddenCardHint, HintType } from "@/domain/cardgame/hints";

/** F71 · pista pública de una carta oculta del rival: `{ type, value }` y nada más. */
export type RivalCardHint = HiddenCardHint;
export type { HintType };

export type { CombatStatKey, BotDifficulty, DuelDeckStatus, Side, EncounterOutcome, MatchStatus, TurnPhase };

/** Una carta tal y como la pinta la interfaz. Datos públicos del catálogo, ya resueltos. */
export interface DuelDeckCardDTO {
  uid: string;
  cardId: string;
  /** Identidad del jugador: permite reutilizar las capas visuales del catálogo (foto, bandera). */
  playerId: string;
  nick: string;
  team: string;
  country: string;
  role: RoleId;
  region: Region;
  variantId: VariantId;
  ovr: number;
  /** Trío de combate ya congelado. La interfaz lo MUESTRA; no lo calcula. */
  combat: CombatStats;
  serial: number | null;
}

/** Error de composición, ya explicado en servidor: la interfaz nunca traduce códigos. */
export interface DuelDeckErrorDTO {
  code: DuelDeckErrorCode;
  message: string;
}

/** Un mazo guardado, con su validación hecha contra el inventario real. */
export interface DuelDeckDTO {
  id: string;
  name: string;
  cardUids: string[];
  cards: DuelDeckCardDTO[];
  valid: boolean;
  status: DuelDeckStatus;
  roleCounts: Record<RoleId, number>;
  missingByRole: Record<RoleId, number>;
  errors: DuelDeckErrorDTO[];
  sumOvr: number;
  updatedAt: number;
  /**
   * FASE 32 · VERSIÓN para la concurrencia optimista: el `updated_at` EXACTO de la fila, tal cual lo
   * devuelve la base de datos (microsegundos incluidos). Se devuelve en `expectedVersion`.
   */
  version?: string;
  /** FASE 32 · es el equipo activo del usuario (0050). Falso si 0050 no está aplicada. */
  active?: boolean;
}

/**
 * FASE 32 · Un ejemplar para el constructor: la carta de duelo + lo que el validador canónico
 * necesita en el cliente (`dataVersion`, `statBoost`) + la fecha de obtención (orden «recientes»).
 */
export interface DeckBuilderCardDTO extends DuelDeckCardDTO {
  dataVersion: string;
  statBoost: number;
  obtainedAt: number;
  /**
   * COLECCIONES ILIMITADAS · copias que el jugador tiene de esta carta. El constructor recibe UN ejemplar por carta
   * (un equipo no repite jugador), no cada copia: el «×N» sale de aquí. Ausente = se cuentan los ejemplares recibidos.
   */
  copies?: number;
}

/** FASE 32 · La foto de «Mis equipos» y del constructor, en una sola lectura. */
export interface DeckWorkspaceDTO {
  decks: DuelDeckDTO[];
  collection: DeckBuilderCardDTO[];
  /** Equipo activo, si existe y sigue siendo del usuario. */
  activeDeckId: string | null;
  /** `false` si la migración 0050 no está aplicada: no se puede elegir equipo activo todavía. */
  activeSupported: boolean;
  maxDecks: number;
  serverNow: number;
}

/** Un bando dentro de un enfrentamiento ya resuelto. */
export interface DuelEncounterSideView {
  uid: string;
  nick: string;
  team: string;
  role: RoleId;
  stat: CombatStatKey;
  value: number;
}

/**
 * Un turno YA JUGADO. Todo lo que contiene ocurrió a la vista de los dos bandos.
 *
 * PERSPECTIVA (Fase 33): `attacker` y `outcome` están expresados desde QUIEN MIRA: `"A"` = tú,
 * `"B"` = el rival, `"TIE"` = empate. Lo garantiza `toTurnView`.
 */
export interface DuelTurnView {
  number: number;
  attacker: Side;
  outcome: EncounterOutcome;
  scoreAfterYou: number;
  scoreAfterRival: number;
  you: DuelEncounterSideView;
  rival: DuelEncounterSideView;
  reason: string;
}

/** Resultado final, tal y como lo explica el Combat Resolver. */
/**
 * Lo que una partida ha dado (Fase 10).
 *
 * Es DETERMINISTA a partir del resultado y la dificultad (`domain/progression/duelRewards`),
 * así que no se guarda en ninguna tabla: se recalcula al proyectar la vista. Lo que sí se
 * guarda es el PAGO, en el libro mayor, con la partida como clave de idempotencia.
 */
export interface DuelAwardView {
  /** Puntos competitivos: los que mueven el rango. Cero en derrota. */
  points: number;
  credits: number;
  /** XP de cuenta (nivel del perfil), no XP del pase. */
  xp: number;
}

/**
 * DUEL GAMEPLAY UX 2.0 · RECIBO de lo que el SERVIDOR concedió por ESTA partida. Sale del libro mayor (el asiento con la
 * clave de idempotencia de la partida y, en campaña, el de la primera victoria que cerró esta partida). Nunca es una
 * estimación del cliente: si el libro no tiene asiento, no hay recompensa que enseñar. Leerlo no concede nada.
 */
export interface MatchRewardGrant {
  /** De dónde viene: el pago de la partida o la primera victoria de un nodo de campaña. */
  source: "MATCH" | "CAMPAIGN_FIRST_CLEAR";
  /** Lo concedido, con la forma común de recompensa (créditos, XP de cuenta, sobre ×N, carta, cosméticos). */
  reward: { credits?: number; xp?: number; packId?: string; packCount?: number; cardId?: string; cosmetics?: string[] };
  /** Puntos de rango concedidos con ella (0 si ninguno). */
  points: number;
}
export interface MatchRewardReceipt {
  matchId: string;
  grants: MatchRewardGrant[];
  /** La partida se pagó con el tope diario agotado: cuenta, pero no concedió nada. */
  capped: boolean;
  /**
   * CORE GAME LOOP · el cupo diario de PvE que ocupó ESTA partida (`duelcap:m:<id>`, `economy_ops`): `slot` = k de
   * `cap` (1…20) o `null` si llegó con el tope agotado. Ausente = sin cupo que enseñar (Draft, PvP, partida anterior a
   * los cupos o lectura fallida). Es un hecho de la partida: F5 enseña lo mismo.
   */
  daily?: { slot: number | null; cap: number };
}

export interface DuelResultView {
  winner: "YOU" | "RIVAL" | null;
  isDraw: boolean;
  scoreYou: number;
  scoreRival: number;
  tiedEncounters: number;
  decidedBy: "SCORE" | "OVR_TIEBREAK" | "STAT_MARGIN" | "NONE";
  reason: string;
  sumOvrYou: number | null;
  sumOvrRival: number | null;
  statTotalYou: number;
  statTotalRival: number;
  rulesVersion: string;
  /**
   * Qué ha dado esta partida. Es la respuesta a «¿para qué sirve jugar?», que hasta la
   * Fase 10 no tenía ninguna: un duelo terminaba y no pasaba nada más.
   */
  /**
   * Lo que la partida concede. **`null` en PvP**: el duelo entre dos personas no mueve economía
   * (bloques 7.4.x), y fingir un premio de cero sería peor que no traerlo. Solo el PvE lo rellena.
   */
  award: DuelAwardView | null;
  /** DUEL GAMEPLAY UX 2.0 · recibo autoritativo (PvE). `null` = sin lectura (PvP, Draft o fallo): no se enseña nada. */
  rewards?: MatchRewardReceipt | null;
}

/**
 * La partida tal y como puede verla el jugador.
 *
 * `rivalRemaining` es un NÚMERO a propósito: cuántas cartas le quedan al rival es público, cuáles
 * son no lo es.
 */
export interface DuelMatchView {
  matchId: string;
  /** F67 · versión del estado en servidor (PvE). El cliente la devuelve al jugar; si cambió, 409 + estado actual. */
  stateVersion?: number;
  difficulty: BotDifficulty;
  /**
   * Cómo nombrar al rival en el tablero. En PvE se omite y el tablero usa la etiqueta de
   * dificultad de siempre; en PvP se pasa un texto neutro, porque de la otra persona no se puede
   * decir nada más sin filtrar quién es.
   */
  rivalLabel?: string;
  status: MatchStatus;
  phase: TurnPhase;
  turn: number;
  totalTurns: number;
  attacker: Side | null;
  youAreAttacker: boolean;
  scoreYou: number;
  scoreRival: number;
  ties: number;
  yourHand: DuelDeckCardDTO[];
  yourUsed: DuelDeckCardDTO[];
  rivalUsed: DuelDeckCardDTO[];
  rivalRemaining: number;
  /**
   * F71 · Una pista por carta oculta del rival (`length === rivalRemaining`, o vacía si no hay).
   * Solo `{ type, value }`: nunca uid, carta, jugador, OVR ni estadísticas. La calcula el servidor
   * con un hash estable del id de la partida y la carta; el orden no sigue el del mazo.
   */
  /** F72.2 · una por carta oculta; `null` = esa carta no tiene pista representable (dorso normal). */
  rivalHints: (RivalCardHint | null)[];
  yourDeckName: string;
  /** FASE 43 · id del equipo propio con el que se juega (snapshot congelado del propio bando). */
  yourDeckId?: string | null;
  yourSumOvr: number;
  rivalSumOvr: number;
  /**
   * DUEL GAMEPLAY UX 2.0 · el rival ataca y YA COMPROMETIÓ su carta, pero sigue OCULTA hasta que respondas. Solo viaja
   * la ESTADÍSTICA declarada (la necesitas: tu respuesta la impone la tabla). Ni la carta, ni su uid, ni su valor, ni su
   * jugador, OVR, ni cifras: la carta se revela cuando tu respuesta ya está comprometida (en `lastTurn`).
   *
   * AJUSTE · `hint` y `role` son las PISTAS PÚBLICAS de esa carta (regla del juego, no una fuga): exactamente la pista
   * y el rol que esa misma carta muestra en la fila superior (`rivalHints`/`rivalRoles`), calculados igual en servidor.
   */
  pendingRival: { committed: true; stat: CombatStatKey; hint: RivalCardHint | null; role: RoleId | null } | null;
  /**
   * DUEL GAMEPLAY UX 2.0 · rol CANÓNICO de cada carta oculta del rival, en el MISMO orden que `rivalHints` (o vacía).
   * No es información nueva: un equipo lleva siempre 2 cartas de cada rol y las jugadas son públicas.
   */
  rivalRoles?: (RoleId | null)[];
  /** Estadística con la que estás obligado a responder, si defiendes. */
  requiredStat: CombatStatKey | null;
  yourDraftCardUid: string | null;
  yourDraftStat: CombatStatKey | null;
  history: DuelTurnView[];
  lastTurn: DuelTurnView | null;
  result: DuelResultView | null;
  /**
   * F72.8 · plazo (epoch ms, reloj del SERVIDOR) de la decisión humana en curso; `null` si no hay ninguna pendiente.
   * Lo fija el servidor al empezar la decisión; el cliente solo pinta `turnDeadlineAt − serverNow` (PvE; en PvP viaja
   * en la sincronización).
   */
  turnDeadlineAt?: number | null;
  /** F72.8 · hora del servidor al construir esta respuesta (para corregir el reloj del dispositivo). */
  serverNow?: number;
  /** F72.8 · decisiones que se agotaron y jugó el servidor, vistas desde este bando. Sin carta ni estadística. */
  timeouts?: DuelTimeoutView[];
  /**
   * Contexto CANÓNICO de una partida PvE TERMINADA, decidido por el servidor con la BD (`duel_matches.mode` y
   * `campaign_attempts.match_id`): partida rápida, nodo de Road to Champions o combate de Draft Gauntlet. Ausente mientras
   * la partida sigue o si no se pudo determinar (en ese caso el cliente enseña el resultado completo de siempre).
   */
  context?: PveMatchContext;
}

/** Contexto de una partida PvE terminada (lo decide el servidor). */
export type PveMatchContext = "QUICK" | "CAMPAIGN" | "DRAFT";

/** F72.8 · una decisión agotada: de qué turno, si era ataque o defensa, y si era tuya. */
export interface DuelTimeoutView { turn: number; kind: "ATTACK" | "DEFENSE"; you: boolean }

/** Repetición completa de una partida terminada. */
export interface DuelReplay {
  matchId: string;
  difficulty: BotDifficulty;
  rulesVersion: string;
  yourDeckName: string;
  turns: DuelTurnView[];
  result: DuelResultView | null;
  yourCards: DuelDeckCardDTO[];
  /** FASE 33 · SOLO las cartas que el rival JUGÓ. Las no jugadas no salen nunca del servidor. */
  rivalCards: DuelDeckCardDTO[];
  /** FASE 33 · modo de la partida (ausente = PVE, repeticiones anteriores). */
  mode?: "PVE" | "PVP" | "PVP_PRIVATE";
  /** FASE 33 · nombre público del rival en PvP; `null` contra el bot. */
  rivalName?: string | null;
  /** FASE 43 · equipo PROPIO con el que se jugó (solo PvE del dueño; nunca el de otra persona). */
  deckId?: string | null;
}

/** Entrada de la lista de repeticiones. */
export interface DuelReplayRow {
  matchId: string;
  difficulty: string;
  status: string;
  scoreYou: number;
  scoreRival: number;
  deckName: string;
  playedAt: number;
}

/** Descripción de cada nivel, en lenguaje de producto. Sin porcentajes internos. */
export const DIFFICULTY_INFO: Record<BotDifficulty, { label: string; tagline: string; detail: string; level: 1 | 2 | 3 }> = {
  EASY: {
    label: "Fácil",
    tagline: "Imprevisible",
    detail: "Juega de forma legal pero sin plan. Perfecto para aprender el ritmo de los diez turnos.",
    level: 1,
  },
  NORMAL: {
    label: "Normal",
    tagline: "Competitivo",
    detail: "Mezcla decisiones estratégicas con decisiones improvisadas. Se le gana, pero castiga los errores.",
    level: 2,
  },
  HARD: {
    label: "Difícil",
    tagline: "Exigente",
    detail: "Elige con criterio casi siempre: guarda cartas, responde con el margen justo y sacrifica lo que no le sirve.",
    level: 3,
  },
};

/** Presentación de las tres estadísticas. La tabla de enfrentamientos vive en el dominio. */
export const STAT_INFO: Record<CombatStatKey, { abbr: string; label: string; color: string; blurb: string }> = {
  stronghold: { abbr: "SH", label: "Stronghold", color: "#e8595b", blurb: "Aguantar la posición" },
  gamesense: { abbr: "GS", label: "Gamesense", color: "#4f9ede", blurb: "Leer el juego" },
  entryfrag: { abbr: "EF", label: "Entryfrag", color: "#4fbe78", blurb: "Abrir la ronda" },
};
