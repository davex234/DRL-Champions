/**
 * ANALYTICS · TELEMETRY · METRICS · HEATMAPS (Online Fase 7/7).
 *
 * Analítica DERIVADA (nunca duplicada) de datos ya autoritativos: Match Analytics desde el Replay
 * (reutiliza `ReplayTimeline`), Tournament/Competitive Analytics desde sus vistas, Player Analytics
 * agregando ambos, Heatmaps de intensidad temporal, Telemetría (ingesta) y Metrics (contadores +
 * histogramas p50/p95). Todo PURO y determinista: mismas entradas ⇒ mismas cifras.
 */
import { ReplayTimeline, type Replay } from "@/replay";

// ───────────────────────────── Match Analytics ─────────────────────────────

export interface MatchAnalytics {
  matchId: string;
  rounds: number;
  totalTicks: number;
  avgRoundTicks: number;
  atkRounds: number;
  defRounds: number;
  endReasons: Record<string, number>;
  eventsPerRound: number[];
  intensity: number[];       // heatmap temporal: eventos por bucket de tiempo (0..9)
  winner: "home" | "away" | null;
}

/** Deriva la analítica de un partido desde su Replay (reutiliza el ÚNICO Gameplay vía ReplayTimeline). */
export function analyzeMatch(rep: Replay): MatchAnalytics {
  const tl = new ReplayTimeline(rep);
  const bounds = tl.bounds();
  const rounds = tl.roundCount();
  const total = tl.totalTicks();
  let atk = 0, def = 0;
  const endReasons: Record<string, number> = {};
  const eventsPerRound: number[] = [];
  const intensity = new Array(10).fill(0);
  for (let r = 0; r < rounds; r++) {
    const b = bounds[r];
    if (b?.winner === "ATK") atk++; else if (b?.winner === "DEF") def++;
    if (b?.endReason) endReasons[b.endReason] = (endReasons[b.endReason] ?? 0) + 1;
    const evs = tl.eventsInRound(r);
    eventsPerRound.push(evs.length);
    // heatmap temporal: reparte la actividad de la ronda en 10 buckets según el progreso del partido
    const bucket = rounds <= 1 ? 0 : Math.min(9, Math.floor((r / rounds) * 10));
    intensity[bucket] += evs.length;
  }
  return {
    matchId: rep.meta.matchId, rounds, totalTicks: total,
    avgRoundTicks: rounds > 0 ? Math.round(total / rounds) : 0,
    atkRounds: atk, defRounds: def, endReasons, eventsPerRound, intensity,
    winner: rep.meta.winner,
  };
}

// ───────────────────────────── Tournament / Competitive / Player ─────────────────────────────

export interface StandingRow { teamId: string; placement: number; wins: number; losses: number }
export interface TournamentAnalytics {
  tournamentId: string; teams: number; matchesPlayed: number; champion: string | null;
  avgRoundsPerMatch: number; competitiveness: number; // 0..100: cuán reñido (menor margen medio)
}

/** Analítica de torneo desde standings + los replays de sus partidos. */
export function analyzeTournament(
  tournamentId: string, standings: StandingRow[], matchAnalytics: MatchAnalytics[],
): TournamentAnalytics {
  const champion = standings.find((s) => s.placement === 1)?.teamId ?? null;
  const played = matchAnalytics.length;
  const avgRounds = played > 0 ? matchAnalytics.reduce((a, m) => a + m.rounds, 0) / played : 0;
  // reñido = margen medio pequeño entre atk/def por partido
  const margin = played > 0
    ? matchAnalytics.reduce((a, m) => a + Math.abs(m.atkRounds - m.defRounds), 0) / played
    : 0;
  const competitiveness = Math.max(0, Math.round(100 - margin * 8));
  return { tournamentId, teams: standings.length, matchesPlayed: played, champion, avgRoundsPerMatch: Math.round(avgRounds * 10) / 10, competitiveness };
}

export interface PlayerAnalytics { playerId: string; matches: number; wins: number; winRate: number; rounds: number; avgRoundsPerMatch: number }

/** Analítica de jugador agregando sus partidos (por lado ganador vs su lado). */
export function analyzePlayer(playerId: string, reps: { rep: Replay; side: "home" | "away" }[]): PlayerAnalytics {
  let wins = 0, rounds = 0;
  for (const { rep, side } of reps) { if (rep.meta.winner === side) wins++; rounds += rep.meta.rounds; }
  const n = reps.length;
  return { playerId, matches: n, wins, winRate: n > 0 ? Math.round((wins / n) * 1000) / 10 : 0, rounds, avgRoundsPerMatch: n > 0 ? Math.round((rounds / n) * 10) / 10 : 0 };
}

// ───────────────────────────── Telemetry (ingesta) ─────────────────────────────

export interface TelemetryEvent { kind: string; value: number; at: number; tags?: Record<string, string> }

export class TelemetrySink {
  private counts = new Map<string, number>();
  private sums = new Map<string, number>();
  private samples = new Map<string, number[]>();
  ingest(e: TelemetryEvent): void {
    this.counts.set(e.kind, (this.counts.get(e.kind) ?? 0) + 1);
    this.sums.set(e.kind, (this.sums.get(e.kind) ?? 0) + e.value);
    const s = this.samples.get(e.kind) ?? []; s.push(e.value); this.samples.set(e.kind, s);
  }
  count(kind: string): number { return this.counts.get(kind) ?? 0; }
  sum(kind: string): number { return this.sums.get(kind) ?? 0; }
  avg(kind: string): number { const c = this.count(kind); return c > 0 ? this.sum(kind) / c : 0; }
  total(): number { return [...this.counts.values()].reduce((a, b) => a + b, 0); }
  kinds(): string[] { return [...this.counts.keys()]; }
}

// ───────────────────────────── Metrics (contadores + histogramas) ─────────────────────────────

export class Metrics {
  private c = new Map<string, number>();
  private g = new Map<string, number>();
  private h = new Map<string, number[]>();
  inc(name: string, by = 1): void { this.c.set(name, (this.c.get(name) ?? 0) + by); }
  gauge(name: string, v: number): void { this.g.set(name, v); }
  observe(name: string, v: number): void { const a = this.h.get(name) ?? []; a.push(v); this.h.set(name, a); }
  counter(name: string): number { return this.c.get(name) ?? 0; }
  getGauge(name: string): number { return this.g.get(name) ?? 0; }
  /** Percentil determinista (nearest-rank) sobre las observaciones. */
  percentile(name: string, p: number): number {
    const a = (this.h.get(name) ?? []).slice().sort((x, y) => x - y);
    if (a.length === 0) return 0;
    const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
    return a[idx];
  }
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return { counters: Object.fromEntries(this.c), gauges: Object.fromEntries(this.g) };
  }
}
