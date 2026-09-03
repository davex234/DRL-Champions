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
  DuelDeckDTO, DuelDeckCardDTO, DuelMatchView, DuelReplay, DuelReplayRow, CombatStatKey, BotDifficulty,
} from "./types";

/** Error con el mensaje que el servidor ya redactó para el jugador. */
export class DuelError extends Error {
  constructor(message: string, readonly status: number) {
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
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new DuelError(json.error ?? `Error ${res.status}`, res.status);
  return json as T;
}

const DECKS = "/api/game/duels";
const DUEL = "/api/game/duel";

/* ───────────────────────────── mazos ───────────────────────────── */

/** Mis mazos y las cartas que puedo usar, en una sola petición. */
export async function fetchDuelDecks(): Promise<{ decks: DuelDeckDTO[]; collection: DuelDeckCardDTO[] }> {
  const res = await fetch(DECKS, { headers: await authHeaders(), cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new DuelError(json.error ?? "No se pudieron cargar tus mazos", res.status);
  return json as { decks: DuelDeckDTO[]; collection: DuelDeckCardDTO[] };
}

export const saveDuelDeck = (input: { id?: string; name: string; cardUids: string[] }) =>
  post<{ deck: DuelDeckDTO }>(DECKS, { action: "save", ...input });

export const deleteDuelDeck = (id: string) =>
  post<{ id: string }>(DECKS, { action: "delete", id });

/* ───────────────────────────── partida ───────────────────────────── */

export const startDuel = (deckId: string, difficulty: BotDifficulty) =>
  post<{ view: DuelMatchView }>(DUEL, { action: "start", deckId, difficulty });

/**
 * Juega el turno.
 *
 * Atacando se envían carta y estadística. Defendiendo se envía SOLO la carta: la estadística la
 * impone la tabla de enfrentamientos y la aplica el servidor.
 */
export const playDuelTurn = (matchId: string, cardUid: string, stat?: CombatStatKey) =>
  post<{ view: DuelMatchView }>(DUEL, { action: "play", matchId, cardUid, stat });

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
