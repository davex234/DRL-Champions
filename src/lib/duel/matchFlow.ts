/**
 * FASE 61 · GAMEPLAY 5.0 — EL RITMO DE LA PARTIDA (presentación pura).
 *
 *     MOTOR (domain/cardgame) → SERVIDOR (duels / duelsPvp) → VISTA (DuelMatchView) → ESTO → PANTALLA
 *
 * Sin React, sin red, sin reloj, sin `window`. Aquí se decide CÓMO y CUÁNDO se enseña lo que el servidor ya
 * resolvió —la entrada a la partida, el orden de la revelación de un turno, el clímax de los últimos turnos,
 * la secuencia del desempate y lo que cuesta salir—, nunca QUÉ pasó. Ninguna función de este módulo recibe una
 * semilla, compara dos valores de combate o produce un punto: si lo hiciera, la pantalla estaría decidiendo.
 *
 * REGLAS REALES LEÍDAS DEL CÓDIGO (F61 §0, `domain/cardgame/combat/rules.ts` + `match/orchestrator.ts`):
 *   · `duel-turns-2`: 10 turnos (uno por carta del mazo de 10), el atacante alterna.
 *   · El atacante elige carta Y estadística; el defensor elige carta y la estadística la IMPONE la tabla
 *     SH↔EF, GS↔GS (`requiredDefenderStat` en servidor; el cliente ni la envía).
 *   · Turno empatado = nadie puntúa (OPD-05 `NO_POINT`).
 *   · Final `duel-combat-2`: marcador → suma de OVR de los 10 (+1 punto, `OVR_TIEBREAK`) → total de
 *     estadística declarada (sin punto, `STAT_MARGIN`) → empate explícito (`DRAW`, `decidedBy: NONE`).
 */
import type { DuelDeckCardDTO, DuelMatchView, DuelResultView, DuelTurnView, CombatStatKey } from "./types";
import { STAT_INFO } from "./types";
import { decisionSteps, type DecisionStep } from "./experience";
import type { RoleId } from "@/domain/cards/types";

/* ═══════════════════════ 1 · LA ENTRADA ═══════════════════════ */

/** Los tres tiempos de la entrada: quién hay enfrente, el VS y los equipos que saltan a la mesa. */
export type EntranceBeat = "FOUND" | "VERSUS" | "LINEUP";
export const ENTRANCE_ORDER: readonly EntranceBeat[] = ["FOUND", "VERSUS", "LINEUP"];

/**
 * Duración de cada tiempo (ms). Total ≈ 3,5 s con movimiento y ≈ 2,9 s sin él: dentro de los 2–5 s del
 * encargo, siempre saltable. El modo reducido NO se come la secuencia (el PC del usuario reporta `reduce`):
 * conserva los tres tiempos, sin desplazamientos, con el tiempo justo para leerlos.
 */
export const ENTRANCE_MS = {
  full: { FOUND: 850, VERSUS: 1250, LINEUP: 1400 },
  reduced: { FOUND: 750, VERSUS: 1000, LINEUP: 1150 },
} as const;

export interface EntranceStep { beat: EntranceBeat; at: number; until: number }

/** Línea de tiempo de la entrada desde un tiempo dado (una partida que llega de «Rival encontrado» empieza en LINEUP). */
export function entranceTimeline(reduced: boolean, from: EntranceBeat = "FOUND"): { steps: EntranceStep[]; total: number } {
  const ms = reduced ? ENTRANCE_MS.reduced : ENTRANCE_MS.full;
  const beats = ENTRANCE_ORDER.slice(ENTRANCE_ORDER.indexOf(from));
  let t = 0;
  const steps = beats.map((beat) => { const s = { beat, at: t, until: t + ms[beat] }; t += ms[beat]; return s; });
  return { steps, total: t };
}

/** Qué tiempo toca a los `elapsed` ms; `"DONE"` cuando la entrada terminó. */
export function entranceBeatAt(elapsed: number, reduced: boolean, from: EntranceBeat = "FOUND"): EntranceBeat | "DONE" {
  const { steps } = entranceTimeline(reduced, from);
  for (const s of steps) if (elapsed < s.until) return s.beat;
  return "DONE";
}

/**
 * ¿Se reproduce la entrada? SOLO en una partida recién creada: en curso, turno 1 y sin ningún turno resuelto.
 * Una recarga a mitad de partida, una reconexión o una partida terminada NUNCA vuelven a presentar el VS.
 */
export function shouldPlayEntrance(view: Pick<DuelMatchView, "status" | "history" | "turn"> | null | undefined): boolean {
  return Boolean(view && view.status === "IN_PROGRESS" && view.history.length === 0 && view.turn <= 1);
}

/** Contexto de la partida para rotular la entrada. Lo decide la ruta, no la partida. */
export type FlowMode = "quick" | "campaign" | "draft" | "ranked" | "private";

export interface EntranceCopy {
  /** Titular del primer tiempo. En PvE no se «encuentra» a nadie: el rival es un bot preparado por el servidor. */
  kicker: string;
  mode: string;
  you: string;
  rival: string;
  /** Subtítulo honesto del rival: «Bot · Normal», «Jugador real»… nunca un rango inventado. */
  rivalTag: string;
  opening: string;
}

const MODE_LABEL: Record<FlowMode, string> = {
  quick: "Partida rápida",
  campaign: "Road to Champions",
  draft: "Draft Gauntlet",
  ranked: "Ranked · duelo PvP",
  private: "Duelo privado",
};

export function entranceCopy(
  mode: FlowMode,
  view: Pick<DuelMatchView, "yourDeckName" | "youAreAttacker" | "difficulty" | "rivalLabel">,
  rivalName: string,
  difficultyLabel: string | null,
): EntranceCopy {
  const human = mode === "ranked" || mode === "private";
  /* Contra el bot sin nombre propio, el tablero lo nombra por su dificultad: aquí se dice qué es (un bot) y a qué nivel. */
  const botByLevel = !human && difficultyLabel !== null && rivalName === difficultyLabel;
  return {
    kicker: human ? "Rival encontrado" : mode === "campaign" ? "Rival del nodo" : mode === "draft" ? "Combate del gauntlet" : "Rival preparado",
    mode: MODE_LABEL[mode],
    you: view.yourDeckName,
    rival: botByLevel ? "Bot" : rivalName,
    rivalTag: human ? "Jugador real" : difficultyLabel ? (botByLevel ? `Dificultad ${difficultyLabel}` : `Bot · ${difficultyLabel}`) : "Bot",
    opening: view.youAreAttacker ? "Abres tú: atacas en el turno 1" : "Abre el rival: defiendes en el turno 1",
  };
}

/** Orden de roles en la presentación del equipo (el mismo del constructor). */
const ROLE_ORDER: RoleId[] = ["Duelista", "Iniciador", "Controlador", "Centinela", "Flex"];

export interface LineupSummary {
  /** Las 10 cartas ordenadas por rol y, dentro del rol, por OVR (desempate estable por `uid`). */
  cards: DuelDeckCardDTO[];
  roles: { role: RoleId; count: number }[];
  /** Las tres de más OVR: las que la presentación destaca. Datos de la carta, no un «MVP». */
  stars: DuelDeckCardDTO[];
  sumOvr: number;
}

/** Resumen del equipo propio para la presentación. Sin cálculo de juego: ordenar y contar lo que ya está en la mano. */
export function lineupSummary(hand: readonly DuelDeckCardDTO[]): LineupSummary {
  const byOvr = (a: DuelDeckCardDTO, b: DuelDeckCardDTO) => b.ovr - a.ovr || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
  const idx = (r: RoleId) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? ROLE_ORDER.length : i; };
  const cards = [...hand].sort((a, b) => idx(a.role) - idx(b.role) || byOvr(a, b));
  const counts = new Map<RoleId, number>();
  for (const c of hand) counts.set(c.role, (counts.get(c.role) ?? 0) + 1);
  const roles = [...counts.entries()].sort((a, b) => idx(a[0]) - idx(b[0])).map(([role, count]) => ({ role, count }));
  return { cards, roles, stars: [...hand].sort(byOvr).slice(0, 3), sumOvr: hand.reduce((s, c) => s + c.ovr, 0) };
}

/* ═══════════════════════ 2 · EL CAMPO ═══════════════════════ */

export type RoleKind = "ATTACK" | "DEFENSE" | "WAIT" | "NONE";

export interface RoleBanner {
  kind: RoleKind;
  title: string;
  sub: string;
}

/**
 * QUIÉN ATACA, en letras grandes. Sale de `youAreAttacker` (servidor), `pendingRival` (el rival ya declaró) y
 * `requiredStat` (la tabla del dominio, calculada en servidor). No depende del color: lleva texto e icono.
 */
export function roleBanner(
  view: Pick<DuelMatchView, "status" | "youAreAttacker" | "pendingRival" | "requiredStat">,
  waitingRival = false,
): RoleBanner {
  if (view.status !== "IN_PROGRESS") return { kind: "NONE", title: "", sub: "" };
  if (waitingRival) return { kind: "WAIT", title: "Esperando al rival", sub: view.youAreAttacker ? "Tu ataque está enviado" : "El rival está eligiendo" };
  if (view.youAreAttacker) return { kind: "ATTACK", title: "Atacas", sub: "Elige carta y estadística" };
  const imposed = view.requiredStat ? STAT_INFO[view.requiredStat].label : null;
  if (!view.pendingRival) return { kind: "DEFENSE", title: "Defiendes", sub: "El rival está declarando" };
  return { kind: "DEFENSE", title: "Defiendes", sub: imposed ? `Respondes con ${imposed}` : "Responde con una carta" };
}

/** El tramo de la partida. Presentación: sube un grado la luz y el sonido; no toca ni un milisegundo del servidor. */
export type Climax = "NORMAL" | "LATE" | "FINAL";

export function climaxLevel(turn: number, total: number): Climax {
  if (!Number.isFinite(turn) || !Number.isFinite(total) || total <= 0) return "NORMAL";
  if (turn >= total) return "FINAL";
  if (turn >= total - 2) return "LATE";
  return "NORMAL";
}

export const CLIMAX_LABEL: Record<Climax, string | null> = { NORMAL: null, LATE: "Recta final", FINAL: "Último turno" };

/* ═══════════════════════ 3 · LA REVELACIÓN DEL TURNO ═══════════════════════ */

/**
 * Los tiempos de la revelación (s). Orden del encargo §14: cartas → atacante → ESTADÍSTICA → valores →
 * tensión → comparación → ganador → marcador. Con movimiento reducido la secuencia se conserva a base de
 * fundidos (sin desplazamientos) y más corta: la estadística se ve ANTES que los valores en los dos modos.
 */
export const MOMENT_BEATS = {
  full: { cards: 0, stat: 0.34, values: 0.72, compare: 1.08, verdict: 1.28 },
  reduced: { cards: 0, stat: 0.22, values: 0.48, compare: 0.72, verdict: 0.86 },
} as const;
export interface MomentBeats { cards: number; stat: number; values: number; compare: number; verdict: number }

export const momentBeats = (reduced: boolean): MomentBeats => (reduced ? MOMENT_BEATS.reduced : MOMENT_BEATS.full);

/** Cuánto se queda la revelación en pantalla (se puede cerrar antes: el estado ya está aplicado). */
export function momentHoldMs(climax: Climax, reduced: boolean): number {
  const base = reduced ? 2600 : 3000;
  return climax === "FINAL" ? base + 500 : climax === "LATE" ? base + 200 : base;
}

export interface StatReveal {
  attacker: "YOU" | "RIVAL";
  /** La estadística que DECLARÓ el atacante (la que eligió). */
  declared: CombatStatKey;
  /** La que respondió el defensor (la impone la tabla; llega en el turno). */
  answered: CombatStatKey;
  declaredLabel: string;
  answeredLabel: string;
  /** «Stronghold contra Entryfrag» o solo «Gamesense» si es el mismo eje. */
  line: string;
}

/** El eje del turno tal y como lo guarda el servidor. `null` si el turno llegó incompleto. */
export function statReveal(turn: Pick<DuelTurnView, "attacker" | "you" | "rival"> | null | undefined): StatReveal | null {
  if (!turn || !turn.you || !turn.rival || !(turn.you.stat in STAT_INFO) || !(turn.rival.stat in STAT_INFO)) return null;
  const youAttack = turn.attacker === "A";
  const declared = youAttack ? turn.you.stat : turn.rival.stat;
  const answered = youAttack ? turn.rival.stat : turn.you.stat;
  const dl = STAT_INFO[declared].label;
  const al = STAT_INFO[answered].label;
  return { attacker: youAttack ? "YOU" : "RIVAL", declared, answered, declaredLabel: dl, answeredLabel: al, line: declared === answered ? dl : `${dl} contra ${al}` };
}

/* ═══════════════════════ 4 · EL FINAL ═══════════════════════ */

export const TIEBREAK_STEP_MS = { full: 1150, reduced: 950 } as const;

export interface TiebreakPlan {
  title: string;
  /** Los pasos que DE VERDAD se aplicaron (`decisionSteps`), en orden. */
  steps: DecisionStep[];
  /** Cuánto dura la secuencia antes del golpe final. */
  totalMs: number;
  /** El punto extra solo existe en el desempate por OVR. */
  bonusPoint: boolean;
}

/**
 * La secuencia del desempate, SOLO si el marcador no decidió (`decidedBy !== "SCORE"`). Si no hubo desempate,
 * `null`: una victoria por turnos no se disfraza de final ajustado.
 */
export function tiebreakPlan(result: DuelResultView | null | undefined, reduced: boolean): TiebreakPlan | null {
  if (!result || result.decidedBy === "SCORE") return null;
  const steps = decisionSteps(result);
  const per = reduced ? TIEBREAK_STEP_MS.reduced : TIEBREAK_STEP_MS.full;
  const title = result.decidedBy === "OVR_TIEBREAK" ? "Desempate · suma de OVR"
    : result.decidedBy === "STAT_MARGIN" ? "Desempate · total de estadísticas"
      : "Empate total";
  return { title, steps, totalMs: per * (steps.length + 1), bonusPoint: result.decidedBy === "OVR_TIEBREAK" };
}

export type EndBeat = "TIEBREAK" | "COMPLETE";

/**
 * Qué se enseña entre el último turno y el resultado. Solo si la partida terminó DELANTE del jugador
 * (`witnessedLive`): una recarga sobre una partida terminada va directa al resultado y no vuelve a
 * escenificar nada (la concesión, además, ya ocurrió una vez en el servidor).
 */
export function endSequence(result: DuelResultView | null | undefined, witnessedLive: boolean): EndBeat[] {
  if (!result || !witnessedLive) return [];
  return result.decidedBy === "SCORE" ? ["COMPLETE"] : ["TIEBREAK", "COMPLETE"];
}

/* ═══════════════════════ 5 · SALIR ═══════════════════════ */

export interface LeaveConsequence {
  title: string;
  body: string;
  /** Salida que conserva la partida (si existe). */
  keep: { label: string; note: string } | null;
  /** Salida destructiva (si existe) y su consecuencia REAL. */
  abandon: { label: string; note: string } | null;
  stay: string;
}

/**
 * LO QUE CUESTA SALIR, leído del servidor (no inventado):
 *   · PvE (`abandonMatch`): borra la partida → no cuenta, no paga y no consume cupo. Sin penalización.
 *     Salir SIN abandonar la deja guardada: `getActiveMatch` la retoma y JUGAR ofrece «Continuar partida».
 *   · Campaña: además, el intento del nodo queda ABANDONADO en la siguiente lectura; el nodo se puede reintentar.
 *   · Draft Gauntlet: «Salir» vuelve al gauntlet con el combate guardado; abandonar es cosa de la run.
 *   · PvP: la partida sigue en el servidor y el reloj de turno corre (agotarlo la cierra EXPIRED y pierde quien no
 *     jugó); abandonar cuenta como derrota.
 */
export function leaveConsequence(mode: FlowMode): LeaveConsequence {
  switch (mode) {
    case "draft":
      return {
        title: "¿Volver al gauntlet?",
        body: "El combate queda guardado en tu run: puedes retomarlo desde Draft Gauntlet.",
        keep: { label: "Volver al gauntlet", note: "El combate sigue guardado." },
        abandon: null,
        stay: "Seguir jugando",
      };
    case "ranked":
    case "private":
      return {
        title: "¿Salir de la partida?",
        body: "Tu rival sigue en la mesa y el reloj de tu turno corre en el servidor.",
        keep: { label: "Salir sin abandonar", note: "La partida sigue: si se agota tu tiempo de turno, la pierdes por tiempo." },
        abandon: { label: "Abandonar", note: mode === "ranked" ? "Cuenta como derrota y mueve tu rating." : "Cuenta como derrota del duelo privado (sin rating)." },
        stay: "Seguir jugando",
      };
    case "campaign":
      return {
        title: "¿Salir de la partida?",
        body: "Puedes dejarla guardada y volver luego, o abandonarla.",
        keep: { label: "Salir y guardar", note: "La retomas desde JUGAR · Continuar partida." },
        abandon: { label: "Abandonar", note: "La partida se descarta: no cuenta ni da recompensa. El nodo se puede reintentar." },
        stay: "Seguir jugando",
      };
    default:
      return {
        title: "¿Salir de la partida?",
        body: "Puedes dejarla guardada y volver luego, o abandonarla.",
        keep: { label: "Salir y guardar", note: "La retomas desde JUGAR · Continuar partida." },
        abandon: { label: "Abandonar", note: "La partida se descarta: no cuenta ni da recompensa. Sin penalización." },
        stay: "Seguir jugando",
      };
  }
}
