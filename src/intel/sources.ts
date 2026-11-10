/**
 * LIVE INTEL — ORQUESTACIÓN DE FUENTES (prioridad + failover).
 *
 * No depende de una sola web: envuelve N `DataSource` por PRIORIDAD y hace FAILOVER —
 * si la de mayor prioridad falla o no devuelve datos, prueba la siguiente. Reutiliza la
 * interfaz `DataSource` existente (mock/vlr/…); no implementa scraping. Determinista.
 */
import type { DataSource, RawTournament, RawTeam, RawMatch, RawResult } from "@/engine/types";

export interface RankedSource {
  source: DataSource;
  /** Mayor = se intenta antes. */
  priority: number;
}

/** Registro de intentos (para logs/validación). */
export interface SourceAttempt { method: string; source: string; ok: boolean; error?: string }

export interface FailoverSource extends DataSource {
  /** Intentos del último ciclo (para el admin/harness). */
  attempts: SourceAttempt[];
}

/**
 * Compone un `DataSource` con failover por prioridad. Para métodos de lista, "sin datos"
 * (array vacío) también dispara el siguiente. `getResult` usa el primer no-nulo.
 */
export function failoverSource(ranked: RankedSource[], label = "failover"): FailoverSource {
  const ordered = [...ranked].sort((a, b) => b.priority - a.priority).map((r) => r.source);
  const attempts: SourceAttempt[] = [];

  async function tryEach<T>(method: string, fn: (s: DataSource) => Promise<T>, isEmpty: (v: T) => boolean): Promise<T> {
    let last: T | undefined;
    for (const s of ordered) {
      try {
        const v = await fn(s);
        attempts.push({ method, source: s.id, ok: !isEmpty(v) });
        if (!isEmpty(v)) return v;
        last = v;
      } catch (e) {
        attempts.push({ method, source: s.id, ok: false, error: (e as Error).message });
      }
    }
    if (last !== undefined) return last;
    throw new Error(`Todas las fuentes fallaron en ${method}`);
  }

  return {
    id: label,
    label,
    attempts,
    getTournaments: () => tryEach<RawTournament[]>("getTournaments", (s) => s.getTournaments(), (v) => v.length === 0),
    getTeams: (id) => tryEach<RawTeam[]>("getTeams", (s) => s.getTeams(id), (v) => v.length === 0),
    getMatches: (id) => tryEach<RawMatch[]>("getMatches", (s) => s.getMatches(id), (v) => v.length === 0),
    getResult: (id) => tryEach<RawResult | null>("getResult", (s) => s.getResult(id), (v) => v == null),
  };
}
