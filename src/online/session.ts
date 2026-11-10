/**
 * SESSION ENGINE — la sesión online de un cliente + RECONEXIÓN (Online Fase 1/7).
 *
 * Máquina de estados PURA: handshaking → authenticating → ready → in_lobby → in_match, con
 * `reconnecting` y token de reconexión (determinista). El token permite reanudar el partido
 * autoritativo tras una caída. Reutiliza la identidad (`@/online/identity`). Sin wall-clock.
 */
import { seedFrom } from "@/sim/rng";
import type { ClientIdentity } from "./types";

export type SessionPhase = "handshaking" | "authenticating" | "ready" | "in_lobby" | "in_match" | "reconnecting" | "closed";

export interface OnlineSession {
  id: string;
  identity: ClientIdentity;
  phase: SessionPhase;
  reconnectToken: string;
  lobbyId: string | null;
  since: number;
}

const VALID: Record<SessionPhase, SessionPhase[]> = {
  handshaking: ["authenticating", "closed"],
  authenticating: ["ready", "closed"],
  ready: ["in_lobby", "closed"],
  in_lobby: ["in_match", "ready", "closed"],
  in_match: ["reconnecting", "ready", "closed"],
  reconnecting: ["in_match", "closed"],
  closed: [],
};

export function createSession(identity: ClientIdentity, now: number): OnlineSession {
  const reconnectToken = `rt-${(seedFrom(`${identity.id}:${now}`) >>> 0).toString(36)}`;
  return { id: `s-${(seedFrom(identity.id) >>> 0).toString(36)}`, identity, phase: "handshaking", reconnectToken, lobbyId: null, since: now };
}

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return VALID[from].includes(to);
}

/** Transición validada. Devuelve la misma sesión si la transición es ilegal (seguridad). */
export function transition(s: OnlineSession, phase: SessionPhase, now: number): OnlineSession {
  if (!canTransition(s.phase, phase)) return s;
  return { ...s, phase, since: now };
}

export function attachLobby(s: OnlineSession, lobbyId: string, now: number): OnlineSession {
  return transition({ ...s, lobbyId }, "in_lobby", now);
}
