"use client";

/**
 * COMPETITIVO — CLIENTE (Fase 28). Solo lecturas de `GET /api/game/competitive`.
 * `useLadderPositionDelta` toma la posición propia ANTES de una partida y DESPUÉS de liquidarse:
 * dos fotos del servidor; el cambio de puestos solo se enseña si existen las dos.
 */
import { useCallback, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type {
  CompetitiveSnapshot, CompetitiveMatchRow, CompetitiveMatchDetail, CompetitivePlayerView,
  CompetitiveLadderPage, CompetitiveMatchup,
} from "@/server/services/competitive";
import { positionDelta } from "@/domain/pvpLadder/ladder";
import { rankedMovement, type RankedMovement } from "@/domain/pvpLadder/ranked";

export type { CompetitiveSnapshot, CompetitiveMatchRow, CompetitiveMatchDetail, CompetitivePlayerView, CompetitiveLadderPage, CompetitiveMatchup };

export class CompetitiveError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "CompetitiveError";
  }
}

async function get<T>(query: string): Promise<T | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const res = await fetch(`/api/game/competitive${query}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new CompetitiveError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

export const fetchCompetitive = (top?: number) => get<CompetitiveSnapshot>(top ? `?top=${top}` : "");
export const fetchCompetitiveHistory = (before: number | null, limit = 10) =>
  get<{ matches: CompetitiveMatchRow[]; nextBefore: number | null }>(`?history=1&limit=${limit}${before ? `&before=${before}` : ""}`);
export const fetchCompetitiveMatch = (matchId: string) => get<CompetitiveMatchDetail>(`?match=${encodeURIComponent(matchId)}`);
export const fetchCompetitivePlayer = (playerId: string) => get<CompetitivePlayerView>(`?player=${encodeURIComponent(playerId)}`);
export const fetchCompetitivePosition = () => get<{ rating: number; position: number | null; rankedTotal: number; gamesPlayed?: number }>("?position=1");
/** Fase 55 · página de la escalera (el servidor acota a ≤ 50 y alinea el offset). */
export const fetchCompetitiveLadder = (offset: number, size?: number) =>
  get<CompetitiveLadderPage>(`?ladder=1&offset=${Math.max(0, Math.floor(offset))}${size ? `&size=${size}` : ""}`);
/** Fase 55 · «rival encontrado»: los dos lados de MI partida ranked (404 si no soy jugador). */
export const fetchCompetitiveMatchup = (matchId: string) => get<CompetitiveMatchup>(`?matchup=${encodeURIComponent(matchId)}`);

export interface LadderDelta {
  before: { rating: number; position: number | null; gamesPlayed?: number } | null;
  after: { rating: number; position: number | null; rankedTotal: number; gamesPlayed?: number };
  /** Puestos ganados (+) o perdidos (−); `null` si no hay foto previa. */
  positions: number | null;
  /** Fase 55 · ascenso / descenso / entrada / fin de colocación, derivado de las MISMAS dos fotos. */
  movement?: RankedMovement;
}

/** `begin()` al empezar la partida; `end()` cuando el servidor ya liquidó. */
export function useLadderPositionDelta() {
  const before = useRef<{ rating: number; position: number | null; gamesPlayed?: number } | null>(null);
  const [delta, setDelta] = useState<LadderDelta | null>(null);

  const begin = useCallback(async () => {
    try {
      const p = await fetchCompetitivePosition();
      before.current = p ? { rating: p.rating, position: p.position, gamesPlayed: p.gamesPlayed } : null;
    } catch { before.current = null; }
  }, []);

  const end = useCallback(async (): Promise<LadderDelta | null> => {
    try {
      const after = await fetchCompetitivePosition();
      if (!after) return null;
      const d: LadderDelta = {
        before: before.current, after, positions: positionDelta(before.current?.position ?? null, after.position),
        movement: rankedMovement(before.current, after),
      };
      setDelta(d);
      return d;
    } catch { return null; }
  }, []);

  const reset = useCallback(() => { setDelta(null); before.current = null; }, []);
  return { begin, end, reset, delta };
}
