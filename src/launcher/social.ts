/**
 * NEXUS LAUNCHER — SOCIAL (amigos, presencia y perfil).
 *
 * Datos de escaparate con la forma exacta que tendría una respuesta del servicio de
 * presencia. `getFriends()` es el único punto que habría que sustituir por una llamada real.
 */
import type { ActivityEntry, Friend, LauncherUser, PresenceId } from "./types";

export const FRIENDS: Friend[] = [
  { id: "f1", name: "Kaori", tag: "#EU1", presence: "in-game", gameId: "project-alpha", activity: "Competitiva · Ronda 14", color: "#19e3ff" },
  { id: "f2", name: "Vareth", tag: "#EU7", presence: "in-queue", gameId: "drl-champions", activity: "Buscando duelo", color: "#ff2e63" },
  { id: "f3", name: "Nokk", tag: "#NA2", presence: "in-game", gameId: "project-zero", activity: "Incursión · Dique seco", color: "#ffb03d" },
  { id: "f4", name: "Suri", tag: "#EU3", presence: "online", activity: "En el launcher", color: "#8b5cf6" },
  { id: "f5", name: "Damaris", tag: "#BR1", presence: "online", gameId: "project-nexus", activity: "Menú principal", color: "#3fc07a" },
  { id: "f6", name: "Teo", tag: "#EU9", presence: "away", activity: "Ausente", color: "#c8d2dc" },
  { id: "f7", name: "Lynx", tag: "#AP4", presence: "in-game", gameId: "drl-champions", activity: "Torneo · Semifinal", color: "#ff5c8a" },
  { id: "f8", name: "Ordo", tag: "#EU2", presence: "offline", color: "#5b6478" },
  { id: "f9", name: "Bex", tag: "#NA8", presence: "offline", color: "#5b6478" },
  { id: "f10", name: "Sable", tag: "#EU5", presence: "offline", color: "#5b6478" },
];

export function getFriends(): Friend[] {
  return FRIENDS;
}

const PRESENCE_ORDER: Record<PresenceId, number> = {
  "in-game": 0,
  "in-queue": 1,
  online: 2,
  away: 3,
  offline: 4,
};

export const PRESENCE_LABEL: Record<PresenceId, string> = {
  "in-game": "En partida",
  "in-queue": "En cola",
  online: "En línea",
  away: "Ausente",
  offline: "Desconectado",
};

/**
 * Tono SEMÁNTICO de cada presencia. No es un color: es un papel del sistema
 * (`@/components/ui/tone`), y quien lo pinta es la primitiva.
 *
 * Antes esto era una tabla de hexadecimales y por eso el mismo verde de «en línea» convivía
 * con otros dos verdes distintos en el cliente.
 */
export const PRESENCE_TONE: Record<PresenceId, "ok" | "info" | "gold" | "warn" | "muted"> = {
  "in-game": "info",
  "in-queue": "gold",
  online: "ok",
  away: "warn",
  offline: "muted",
};

/** Conectados arriba, desconectados al final, alfabético dentro de cada grupo. */
export function sortFriends(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => {
    const d = PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence];
    return d !== 0 ? d : a.name.localeCompare(b.name, "es");
  });
}

export function isConnected(p: PresenceId): boolean {
  return p !== "offline";
}

export function countConnected(friends: Friend[]): number {
  return friends.filter((f) => isConnected(f.presence)).length;
}

export const USER: LauncherUser = {
  id: "me",
  name: "Comandante",
  tag: "#DRL",
  presence: "online",
  level: 42,
  levelProgress: 0.64,
  color: "#ff2e63",
};

export const ACTIVITY: ActivityEntry[] = [
  { id: "a1", at: "2026-09-05T09:20:00.000Z", text: "Duelo ganado · 13-9 en la Serie Ascenso", gameId: "drl-champions" },
  { id: "a2", at: "2026-09-04T21:05:00.000Z", text: "Carta de edición limitada obtenida", gameId: "drl-champions" },
  { id: "a3", at: "2026-09-04T18:40:00.000Z", text: "Project Alpha actualizado a 3.14.0", gameId: "project-alpha" },
  { id: "a4", at: "2026-09-03T20:12:00.000Z", text: "Nivel 42 alcanzado", gameId: "drl-champions" },
];
