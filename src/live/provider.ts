/**
 * LIVE ECOSYSTEM — PROVEEDORES de datos.
 *
 * NO es un scraper: es una ARQUITECTURA. Cualquier fuente (VLR, Liquipedia, Riot, RSS,
 * API oficial, mock…) implementa `LiveDataProvider`. El orquestador los consume por
 * PRIORIDAD con FAILOVER y comprobación de salud. Reutiliza los tipos crudos del DRL
 * Data Engine existente (RawTournament/RawTeam/RawMatch/RawResult) — sin duplicar modelos.
 */
import type { RawTournament, RawTeam, RawMatch, RawResult, RawPlayerStat } from "@/engine/types";
import { resolveIdentity } from "@/intel";

export interface ProviderHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Contrato de una fuente de datos en vivo. Independiente del juego concreto. */
export interface LiveDataProvider {
  id: string;
  /** Mayor = se intenta antes. */
  priority(): number;
  /** ¿Soporta este juego/circuito? (p. ej. "valorant"). */
  supports(game: string): boolean;
  /** Estado de la fuente (para saltarla si está caída). */
  health(): Promise<ProviderHealth>;
  /** Novedades: torneos nuevos o actualizados. */
  discover(): Promise<RawTournament[]>;
  fetchTournament(id: string): Promise<RawTournament | null>;
  fetchTeams(id: string): Promise<RawTeam[]>;
  fetchMatches(id: string): Promise<RawMatch[]>;
  fetchResult(id: string): Promise<RawResult | null>;
  fetchPlayer?(id: string): Promise<RawPlayerStat | null>;
  fetchTeam?(id: string): Promise<RawTeam | null>;
}

export interface ProviderAttempt {
  method: string;
  provider: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/**
 * Enruta una llamada a través de los proveedores por prioridad, saltando los no sanos
 * y haciendo failover ante fallo o respuesta vacía. Registra cada intento (analytics).
 * Si todos fallan, devuelve el fallback (no lanza) → el sistema sigue estable.
 */
export async function viaProviders<T>(
  providers: LiveDataProvider[],
  game: string,
  method: string,
  call: (p: LiveDataProvider) => Promise<T>,
  isEmpty: (v: T) => boolean,
  fallback: T,
  attempts: ProviderAttempt[],
  now: () => number,
): Promise<{ value: T; provider: string | null }> {
  const ordered = providers.filter((p) => p.supports(game)).sort((a, b) => b.priority() - a.priority());
  let last: { value: T; provider: string } | null = null;
  for (const p of ordered) {
    const t0 = now();
    try {
      const h = await p.health();
      if (!h.ok) { attempts.push({ method: "health", provider: p.id, ok: false, ms: now() - t0, error: h.error }); continue; }
      const value = await call(p);
      const ms = now() - t0;
      const empty = isEmpty(value);
      attempts.push({ method, provider: p.id, ok: !empty, ms });
      if (!empty) return { value, provider: p.id };
      last = { value, provider: p.id };
    } catch (e) {
      attempts.push({ method, provider: p.id, ok: false, ms: now() - t0, error: (e as Error).message });
    }
  }
  return last ?? { value: fallback, provider: null };
}

/**
 * DISCOVER en TODO el ecosistema: une las novedades de cada proveedor sano y deduplica
 * torneos por IDENTIDAD (jamás dos torneos duplicados). El detalle de cada torneo se
 * obtiene luego por `viaProviders` (failover). Robusto: una fuente caída no detiene al resto.
 */
export async function discoverAcross(
  providers: LiveDataProvider[], game: string, attempts: ProviderAttempt[], now: () => number,
): Promise<{ tournaments: RawTournament[]; used: string[] }> {
  const ordered = providers.filter((p) => p.supports(game)).sort((a, b) => b.priority() - a.priority());
  const out: RawTournament[] = [];
  const seen = new Set<string>();
  const used: string[] = [];
  for (const p of ordered) {
    const t0 = now();
    try {
      const h = await p.health();
      if (!h.ok) { attempts.push({ method: "health", provider: p.id, ok: false, ms: now() - t0, error: h.error }); continue; }
      const list = await p.discover();
      attempts.push({ method: "discover", provider: p.id, ok: list.length > 0, ms: now() - t0 });
      if (list.length) used.push(p.id);
      for (const t of list) {
        const id = resolveIdentity({ id: t.id, name: t.name });
        if (!seen.has(id)) { seen.add(id); out.push(t); }
      }
    } catch (e) {
      attempts.push({ method: "discover", provider: p.id, ok: false, ms: now() - t0, error: (e as Error).message });
    }
  }
  return { tournaments: out, used };
}
