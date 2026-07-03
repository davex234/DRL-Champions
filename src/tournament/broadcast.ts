/**
 * TOURNAMENT PRESENTATION — vistas listas para pintar (Online Fase 6/7). PURO.
 */
import type { Tournament } from "./engine";
import type { Fixture } from "./types";

export interface BracketView {
  status: string;
  format: string;
  rounds: { round: number; stage: string; fixtures: { id: string; a: string | null; b: string | null; scoreA: number; scoreB: number; winner: string | null; status: string; label: string }[] }[];
  champion: string | null;
}

export function bracketView(t: Tournament): BracketView {
  const b = t.bracket;
  const rounds = new Map<number, Fixture[]>();
  for (const f of Object.values(b?.fixtures ?? {})) { const arr = rounds.get(f.round) ?? []; arr.push(f); rounds.set(f.round, arr); }
  return {
    status: t.status, format: t.cfg.format,
    rounds: [...rounds.entries()].sort((a, b2) => a[0] - b2[0]).map(([round, fs]) => ({
      round, stage: fs[0].stage,
      fixtures: fs.map((f) => ({ id: f.id, a: f.slotA, b: f.slotB, scoreA: f.series.scoreA, scoreB: f.series.scoreB, winner: f.winner, status: f.status, label: f.label })),
    })),
    champion: t.champion(),
  };
}

export function standingsView(t: Tournament): { rank: number; teamId: string; name: string; wins: number; losses: number }[] {
  return t.standings().map((s, i) => ({ rank: i + 1, teamId: s.teamId, name: s.name, wins: s.wins, losses: s.losses }));
}
