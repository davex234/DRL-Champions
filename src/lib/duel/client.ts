"use client";

/**
 * DUELOS — CAPA DE DATOS DEL CLIENTE (Fase 8).
 *
 * Todo pasa por `/api/game/duel*`, que es donde vive la autoridad. Aquí no hay ni una regla del
 * juego: no se compara nada, no se decide nada y no se guarda nada de la partida. Solo se piden
 * acciones y se devuelve la proyección que responde el servidor.
 *
 * Reutiliza el mismo patrón de autorización que `@/lib/game/client`: el token de Supabase en la
 * cabecera, jamás el identificador de usuario en el cuerpo.
 */
import { getSupabase } from "@/lib/supabase/client";
import type {
  DuelDeckDTO, DuelMatchView, DuelReplay, DuelReplayRow, CombatStatKey, BotDifficulty, DeckWorkspaceDTO,
} from "./types";

/** Error con el mensaje que el servidor ya redactó para el jugador. */
export class DuelError extends Error {
  /**
   * `code` (Fase 32): código estable del servidor (`CONFLICT`, `DECK_NOT_READY`, `ACTIVE_DECK`…).
   * `payload`: el resto del cuerpo de error (p. ej. la versión vigente del equipo en un conflicto).
   */
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "DuelError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) throw new DuelError("Los duelos necesitan una cuenta online", 401);
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new DuelError("Inicia sesión para jugar", 401);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new DuelError(json.error ?? `Error ${res.status}`, res.status, json.code ?? null, json as Record<string, unknown>);
  return json as T;
}

const DECKS = "/api/game/duels";
const DUEL = "/api/game/duel";

/* ───────────────────────────── mazos ───────────────────────────── */

/** Mis mazos y las cartas que puedo usar, en una sola petición. */
export async function fetchDuelDecks(): Promise<DeckWorkspaceDTO> {
  const res = await fetch(DECKS, { headers: await authHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new DuelError(json.error ?? "No se pudieron cargar tus equipos", res.status, json.code ?? null);
  const w = json as Partial<DeckWorkspaceDTO>;
  // Tolerante con un servidor anterior a la Fase 32: sin equipo activo, sin tope conocido.
  return {
    decks: w.decks ?? [], collection: w.collection ?? [], activeDeckId: w.activeDeckId ?? null,
    activeSupported: w.activeSupported ?? false, maxDecks: w.maxDecks ?? 8, serverNow: w.serverNow ?? Date.now(),
  };
}

export const saveDuelDeck = (input: { id?: string; name: string; cardUids: string[] }) =>
  post<{ deck: DuelDeckDTO }>(DECKS, { action: "save", ...input });

export const deleteDuelDeck = (id: string) =>
  post<{ id: string }>(DECKS, { action: "delete", id });

/* ───────────────────────────── equipos (Fase 32) ───────────────────────────── */

/** Guardado ATÓMICO del constructor: nombre + las 10 referencias de una vez, con la versión leída. */
export const saveTeamDeck = (input: { id: string; name: string; cardUids: string[]; version: string }) =>
  post<{ deck: DuelDeckDTO; unchanged: boolean }>(DECKS, { action: "save_composition", id: input.id, name: input.name, cardUids: input.cardUids, baseVersion: input.version });

/** Crea un equipo. Sin nombre, el servidor pone «Equipo N». */
export const createTeamDeck = (input: { name?: string | null; cardUids?: string[] }) =>
  post<{ deck: DuelDeckDTO }>(DECKS, { action: "create", ...(input.name ? { name: input.name } : {}), cardUids: input.cardUids ?? [] });

export const renameTeamDeck = (id: string, name: string, version: string) =>
  post<{ deck: DuelDeckDTO; unchanged: boolean }>(DECKS, { action: "rename", id, name, baseVersion: version });

export const duplicateTeamDeck = (id: string) =>
  post<{ deck: DuelDeckDTO }>(DECKS, { action: "duplicate", id });

/** Borrar el equipo ACTIVO exige `confirmActive`: el servidor no lo hace sin que se diga. */
export const deleteTeamDeck = (id: string, version: string | null, confirmActive = false) =>
  post<{ id: string; wasActive: boolean }>(DECKS, { action: "delete", id, ...(version ? { baseVersion: version } : {}), confirmActive });

export const activateTeamDeck = (id: string, version: string | null) =>
  post<{ activeDeckId: string; deck: DuelDeckDTO }>(DECKS, { action: "set_active", id, ...(version ? { baseVersion: version } : {}) });

/* ───────────────────────────── partida ───────────────────────────── */

export const startDuel = (deckId: string, difficulty: BotDifficulty) =>
  post<{ view: DuelMatchView }>(DUEL, { action: "start", deckId, difficulty });

/**
 * Juega el turno.
 *
 * Atacando se envían carta y estadística. Defendiendo se envía SOLO la carta: la estadística la
 * impone la tabla de enfrentamientos y la aplica el servidor.
 */
export const playDuelTurn = (matchId: string, cardUid: string, stat?: CombatStatKey, expectedVersion?: number) =>
  post<{ view: DuelMatchView }>(DUEL, { action: "play", matchId, cardUid, stat, ...(typeof expectedVersion === "number" ? { expectedVersion } : {}) });

export const fetchDuelState = (matchId: string) =>
  post<{ view: DuelMatchView }>(DUEL, { action: "state", matchId });

export const fetchActiveDuel = () =>
  post<{ view: DuelMatchView | null }>(DUEL, { action: "active" });

export const abandonDuel = (matchId: string) =>
  post<{ id: string }>(DUEL, { action: "abandon", matchId });

/* ───────────────────────────── repeticiones ───────────────────────────── */

export const fetchDuelReplay = (matchId: string) =>
  post<DuelReplay>(DUEL, { action: "replay", matchId });

export const fetchDuelReplays = () =>
  post<{ matches: DuelReplayRow[] }>(DUEL, { action: "replays" });
