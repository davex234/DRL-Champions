/**
 * FASE 45 · LA MÁQUINA DE ESTADOS DE UNA PARTIDA, ESCRITA.
 *
 * La arena ya se comportaba así —etapa de la página (`Stage`), cerrojo de la jugada, fase visual (`derivePhase`)— pero
 * ese comportamiento vivía repartido entre un componente y una página, y no se podía fuzzear. Esto lo pone por escrito
 * y lo deja PURO: qué puede pasar en cada momento, qué hace cada suceso y qué está permitido pulsar.
 *
 * LO QUE ESTO NO ES: no es el motor. No decide turnos, ni ganadores, ni recompensas. La única verdad del juego sigue
 * llegando del servidor dentro de `DuelMatchView`; aquí solo se registra en qué punto del camino está la pantalla para
 * que dos clics seguidos no manden dos jugadas y para que un refresco no invente una partida que no existe.
 *
 *   PREPARING ─(start)→ INTRO ─(introDone)→ TURN_READY ⇄ SELECTING ─(confirm)→ SUBMITTING
 *        ↑                                      │                                  │
 *        │                                (serverTurn)                        (serverTurn)
 *        │                                      ↓                                  ↓
 *        └───────(playAgain)── RESULT ← MATCH_COMPLETE ← TURN_COMPLETE ← RESOLVING ─┘
 *
 * `resume` (refresco, volver atrás, otra pestaña) recoloca la sesión en el estado que permita la vista del servidor:
 * nunca inventa una partida terminada ni deja la mesa abierta sobre una partida cerrada.
 */
import type { DuelMatchView } from "./types";

export type MatchState =
  | "PREPARING" | "INTRO" | "TURN_READY" | "SELECTING" | "SUBMITTING" | "RESOLVING"
  | "TURN_COMPLETE" | "MATCH_COMPLETE" | "RESULT";

export interface MatchSession {
  state: MatchState;
  /** Carta elegida (uid) y eje declarado: solo mientras se decide. */
  selectedUid: string | null;
  selectedStat: string | null;
  /** Turnos ya resueltos según el servidor (nunca los cuenta el cliente). */
  resolved: number;
  /** Jugadas enviadas y aceptadas: si esto supera a `resolved`, algo se mandó dos veces. */
  submitted: number;
  /** La partida está terminada según el servidor. */
  terminal: boolean;
}

export const INITIAL_SESSION: MatchSession = {
  state: "PREPARING", selectedUid: null, selectedStat: null, resolved: 0, submitted: 0, terminal: false,
};

/** Foto mínima del servidor que la sesión necesita. Se saca de la vista, no se calcula. */
export interface ServerFacts {
  resolved: number;
  terminal: boolean;
}

export const serverFacts = (view: Pick<DuelMatchView, "history" | "status">): ServerFacts => ({
  resolved: view.history.length,
  terminal: view.status !== "IN_PROGRESS",
});

export type MatchEvent =
  | { type: "start" }
  | { type: "introDone" }
  | { type: "select"; uid: string }
  | { type: "stat"; stat: string }
  | { type: "confirm" }
  /** Respuesta del servidor: su verdad manda sobre cualquier cosa que estuviera pasando en pantalla. */
  | { type: "serverTurn"; facts: ServerFacts }
  | { type: "rejected" }
  | { type: "revealDone" }
  | { type: "completeDone" }
  | { type: "resume"; facts: ServerFacts }
  | { type: "playAgain" }
  | { type: "disconnect" }
  | { type: "reconnect"; facts: ServerFacts };

/** ¿Se puede confirmar una jugada AHORA MISMO? Un solo sitio lo decide. */
export function canConfirm(s: MatchSession, attacking: boolean): boolean {
  if (s.state !== "SELECTING") return false;
  if (s.terminal) return false;
  return Boolean(s.selectedUid) && (!attacking || Boolean(s.selectedStat));
}

/** ¿Se puede tocar la mesa (elegir carta o eje)? */
export const canSelect = (s: MatchSession): boolean => (s.state === "TURN_READY" || s.state === "SELECTING") && !s.terminal;

export function matchSessionReducer(s: MatchSession, e: MatchEvent): MatchSession {
  switch (e.type) {
    case "start":
      return s.state === "PREPARING" ? { ...s, state: "INTRO" } : s;
    case "introDone":
      return s.state === "INTRO" ? { ...s, state: s.terminal ? "MATCH_COMPLETE" : "TURN_READY" } : s;
    case "select":
      return canSelect(s) ? { ...s, state: "SELECTING", selectedUid: e.uid } : s;
    case "stat":
      return canSelect(s) ? { ...s, state: "SELECTING", selectedStat: e.stat } : s;
    case "confirm":
      // El doble clic muere aquí: desde SUBMITTING/RESOLVING no se vuelve a enviar.
      return s.state === "SELECTING" && s.selectedUid && !s.terminal
        ? { ...s, state: "SUBMITTING", submitted: s.submitted + 1 }
        : s;
    case "rejected":
      // El servidor no aceptó (versión vieja, turno ajeno): se devuelve el control sin contar la jugada.
      return s.state === "SUBMITTING" ? { ...s, state: "SELECTING", submitted: Math.max(0, s.submitted - 1) } : s;
    case "serverTurn": {
      const avanzó = e.facts.resolved > s.resolved;
      return {
        ...s,
        state: avanzó ? "RESOLVING" : e.facts.terminal ? "MATCH_COMPLETE" : "TURN_READY",
        resolved: e.facts.resolved,
        submitted: Math.min(s.submitted, e.facts.resolved),
        terminal: e.facts.terminal,
        selectedUid: null,
        selectedStat: null,
      };
    }
    case "revealDone":
      if (s.state !== "RESOLVING") return s;
      return { ...s, state: s.terminal ? "MATCH_COMPLETE" : "TURN_READY" };
    case "completeDone":
      return s.state === "MATCH_COMPLETE" ? { ...s, state: "RESULT" } : s;
    case "resume":
    case "reconnect": {
      const f = e.facts;
      return {
        ...s,
        state: f.terminal ? (s.state === "RESULT" ? "RESULT" : "MATCH_COMPLETE") : "TURN_READY",
        resolved: f.resolved,
        submitted: Math.min(s.submitted, f.resolved),
        terminal: f.terminal,
        selectedUid: null,
        selectedStat: null,
      };
    }
    case "disconnect":
      // Sin red no se pierde la partida: se deja de poder tocar hasta que el servidor conteste.
      return s.state === "SUBMITTING" || s.state === "RESOLVING" ? s : { ...s, state: s.terminal ? s.state : "TURN_READY", selectedUid: null, selectedStat: null };
    case "playAgain":
      return s.state === "RESULT" ? { ...INITIAL_SESSION } : s;
    default:
      return s;
  }
}

/** Estados en los que la pantalla enseña el resultado o su golpe previo. */
export const isEnded = (s: MatchSession): boolean => s.state === "MATCH_COMPLETE" || s.state === "RESULT";

/**
 * Invariantes que deben cumplirse SIEMPRE (las comprueba el fuzzer):
 *  · nunca se envían más jugadas de las que el servidor ha resuelto (+1 en vuelo);
 *  · no hay resultado antes de que el servidor dé la partida por terminada;
 *  · no se puede confirmar dos veces seguidas sin respuesta del servidor;
 *  · el número de turnos resueltos nunca baja ni pasa del total.
 */
export function sessionInvariants(s: MatchSession, totalTurns: number): string[] {
  const bad: string[] = [];
  if (s.submitted > s.resolved + 1) bad.push("jugadas enviadas de más");
  if (s.resolved > totalTurns) bad.push("más turnos resueltos que turnos de la partida");
  if (s.resolved < 0) bad.push("turnos negativos");
  if ((s.state === "RESULT" || s.state === "MATCH_COMPLETE") && !s.terminal) bad.push("resultado sin partida terminada");
  if (s.state === "SUBMITTING" && !s.selectedUid && s.submitted === 0) bad.push("envío sin carta");
  if (s.terminal && (s.state === "SELECTING" || s.state === "TURN_READY") && s.selectedUid) bad.push("mesa abierta sobre partida terminada");
  return bad;
}
