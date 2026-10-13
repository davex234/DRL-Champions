/**
 * F83 · ROTACIÓN DE RETOS (pura y determinista). Mismos retos GLOBALES para todos en el mismo periodo: operación y
 * balance sencillos. La semilla es (temporada, periodo): la misma fecha produce SIEMPRE la misma selección, sin
 * `Math.random`. Periodos en UTC (la arquitectura ya usa UTC: `domain/progression/periods.ts`):
 *   diario  `d:YYYY-MM-DD`   00:00 UTC → 00:00 UTC
 *   semanal `w:YYYY-MM-DD`   lunes 00:00 UTC → lunes siguiente (fecha del lunes)
 * La BD (`app_season_apply`) vuelve a calcular el periodo con SU hora y descarta un periodo viejo o futuro.
 */
import type { ChallengeDef, ChallengeKind, SeasonConfig } from "./types";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (now: number) => Math.floor(now / DAY) * DAY;
/** Lunes 00:00 UTC de la semana de `now` (ISO: la semana empieza en lunes). */
const weekStart = (now: number) => { const d = dayStart(now); const dow = (new Date(d).getUTCDay() + 6) % 7; return d - dow * DAY; };

export function periodOf(kind: ChallengeKind, now: number): { key: string; startsAt: number; endsAt: number } {
  if (kind === "daily") { const s = dayStart(now); return { key: `d:${iso(s)}`, startsAt: s, endsAt: s + DAY }; }
  const s = weekStart(now);
  return { key: `w:${iso(s)}`, startsAt: s, endsAt: s + 7 * DAY };
}

/** FNV-1a de 32 bits: estable entre servidor, cliente y tests. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * `count` retos del pool: orden por hash(semilla|id) y una familia por reto; si no hay familias suficientes, se completa
 * con los siguientes del orden (nunca se repite un reto).
 */
export function selectChallenges(pool: readonly ChallengeDef[], count: number, seed: string): ChallengeDef[] {
  const ordered = [...pool].sort((a, b) => fnv1a(`${seed}|${a.id}`) - fnv1a(`${seed}|${b.id}`) || a.id.localeCompare(b.id));
  const out: ChallengeDef[] = [];
  const families = new Set<string>();
  for (const c of ordered) { if (out.length >= count) break; if (!families.has(c.family)) { out.push(c); families.add(c.family); } }
  for (const c of ordered) { if (out.length >= count) break; if (!out.includes(c)) out.push(c); }
  return out;
}

export interface ActiveChallenges {
  daily: { period: ReturnType<typeof periodOf>; challenges: ChallengeDef[] };
  weekly: { period: ReturnType<typeof periodOf>; challenges: ChallengeDef[] };
}

export function activeChallenges(seasonId: string, config: SeasonConfig, now: number): ActiveChallenges {
  const d = periodOf("daily", now), w = periodOf("weekly", now);
  return {
    daily: { period: d, challenges: selectChallenges(config.challenges.daily.pool, config.challenges.daily.count, `${seasonId}|${d.key}`) },
    weekly: { period: w, challenges: selectChallenges(config.challenges.weekly.pool, config.challenges.weekly.count, `${seasonId}|${w.key}`) },
  };
}
