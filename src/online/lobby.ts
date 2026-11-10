/**
 * LOBBY ENGINE — sala previa al partido (Online Fase 1/7). SIN matchmaking (llega en Fase 2).
 *
 * El host crea la sala; los clientes se unen por id, eligen lado y marcan "ready". Al arrancar,
 * la sala PRODUCE una `MatchConfig` del ÚNICO Match Engine existente (no duplica config). PURO.
 */
import type { MatchRosters, CoachSetup } from "@/sim";
import { makeMatchConfig, type MatchConfig } from "@/match";
import type { CoachConfig } from "@/coach";
import type { ClientKind } from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("online");

export interface LobbyMember { id: string; name: string; kind: ClientKind; ready: boolean; side: "home" | "away" | null }

/** Borrador de configuración del partido (lo que la sala reúne). */
export interface LobbyDraft {
  seed: number;
  rosters: MatchRosters;
  homeSetup: CoachSetup;
  teamNames: { home: string; away: string };
  coach: CoachConfig;      // "ai" para bots / dedicado; "manual" para jugador humano
}

export type LobbyStatus = "open" | "starting" | "in_match" | "closed";

export interface Lobby {
  id: string;
  hostId: string;
  members: LobbyMember[];
  status: LobbyStatus;
  draft: LobbyDraft;
  capacity: number;
}

export function createLobby(id: string, host: { id: string; name: string; kind?: ClientKind }, draft: LobbyDraft, capacity = 2): Lobby {
  return { id, hostId: host.id, status: "open", draft, capacity, members: [{ id: host.id, name: host.name, kind: host.kind ?? "player", ready: false, side: "home" }] };
}

export function joinLobby(lobby: Lobby, member: { id: string; name: string; kind?: ClientKind }): { lobby: Lobby; error: string | null } {
  if (lobby.status !== "open") return { lobby, error: t("La sala no admite entradas.") };
  if (lobby.members.some((m) => m.id === member.id)) return { lobby, error: null }; // idempotente
  const players = lobby.members.filter((m) => m.kind !== "observer").length;
  if ((member.kind ?? "player") !== "observer" && players >= lobby.capacity) return { lobby, error: t("Sala llena.") };
  const side: "home" | "away" | null = (member.kind ?? "player") === "observer" ? null : (lobby.members.some((m) => m.side === "away") ? null : "away");
  return { lobby: { ...lobby, members: [...lobby.members, { id: member.id, name: member.name, kind: member.kind ?? "player", ready: false, side }] }, error: null };
}

export function leaveLobby(lobby: Lobby, id: string): Lobby {
  const members = lobby.members.filter((m) => m.id !== id);
  if (members.length === 0) return { ...lobby, members, status: "closed" };
  const hostId = id === lobby.hostId ? members[0].id : lobby.hostId; // migración de host
  return { ...lobby, members, hostId };
}

export function setReady(lobby: Lobby, id: string, ready: boolean): Lobby {
  return { ...lobby, members: lobby.members.map((m) => (m.id === id ? { ...m, ready } : m)) };
}

export function assignSide(lobby: Lobby, id: string, side: "home" | "away"): Lobby {
  return { ...lobby, members: lobby.members.map((m) => (m.id === id ? { ...m, side } : m)) };
}

/** ¿Puede arrancar? Host presente + jugadores listos + lados cubiertos (home siempre; away puede ser IA). */
export function canStart(lobby: Lobby): boolean {
  if (lobby.status !== "open") return false;
  const players = lobby.members.filter((m) => m.kind === "player");
  if (players.length === 0) return false;
  return players.every((m) => m.ready) && lobby.members.some((m) => m.side === "home");
}

/** Arranca la sala: produce la `MatchConfig` autoritativa. NO simula (eso es el servidor). */
export function startLobby(lobby: Lobby): { lobby: Lobby; config: MatchConfig } | null {
  if (!canStart(lobby)) return null;
  const d = lobby.draft;
  const config = makeMatchConfig({ seed: d.seed, rosters: d.rosters, homeSetup: d.homeSetup, teamNames: d.teamNames, coach: d.coach });
  return { lobby: { ...lobby, status: "in_match" }, config };
}
