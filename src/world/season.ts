/**
 * TEMPORADA — el modelo de RESULTADOS del mundo (rápido y determinista).
 *
 * No corre el simulador táctico para cada partido IA-vs-IA (sería inviable a 10
 * temporadas): la fuerza de un equipo nace del DESARROLLO de su quinteto (progress) +
 * química (relación de vestuario) + entrenador, y los duelos se resuelven con una
 * logística sembrada. Liga (round-robin) → playoffs → campeón + MVP. PURO.
 */
import type { WorldState, WorldTeam } from "./types";
import { progress } from "@/development";
import { makeRng, seedOf, type Rng } from "./rng";

export interface SeasonResult {
  standings: { teamId: string; pos: number; wins: number; losses: number }[];
  championId: string;
  runnerUpId: string;
  mvpId: string;
  /** Rendimiento individual 0..100 por jugador (para la evolución). */
  perf: Record<string, number>;
  /** Emparejamientos de la final/semis (para rivalidades). */
  finalPair: [string, string] | null;
}

/** Fuerza de un equipo (0..~100): desarrollo del quinteto + química + entrenador. */
export function teamStrength(world: WorldState, team: WorldTeam): number {
  const five = team.roster.slice(0, 5).map((id) => world.players[id]).filter(Boolean);
  if (five.length === 0) return 0;
  const skill = five.reduce((a, p) => a + progress(p.dev) + (p.dev.condition.form - 50) * 0.15, 0) / five.length;
  const chem = five.reduce((a, p) => a + (p.contract?.relTeam ?? 50), 0) / five.length;
  const coach = team.coachId ? world.coaches[team.coachId]?.rating ?? 50 : 50;
  return skill * 0.72 + (chem - 50) * 0.12 + (coach - 50) * 0.18;
}

const winProb = (a: number, b: number): number => 1 / (1 + Math.exp(-(a - b) / 7));

/** Juega la temporada y devuelve el resultado (standings + campeón + MVP). */
export function playSeason(world: WorldState): SeasonResult {
  const rng: Rng = makeRng(seedOf(world.seed, "season", world.season));
  const teams = Object.values(world.teams);
  const strength: Record<string, number> = {};
  for (const t of teams) strength[t.id] = teamStrength(world, t) + (rng.next() * 6 - 3); // varianza de temporada

  // — Liga: round-robin —
  const wins: Record<string, number> = {}, losses: Record<string, number> = {};
  for (const t of teams) { wins[t.id] = 0; losses[t.id] = 0; }
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i].id, b = teams[j].id;
      if (rng.next() < winProb(strength[a], strength[b])) { wins[a]++; losses[b]++; } else { wins[b]++; losses[a]++; }
    }
  }
  const table = [...teams].sort((x, y) => (wins[y.id] - wins[x.id]) || (strength[y.id] - strength[x.id]));
  const standings = table.map((t, i) => ({ teamId: t.id, pos: i + 1, wins: wins[t.id], losses: losses[t.id] }));

  // — Playoffs: top 8 single-elim —
  let bracket = table.slice(0, Math.min(8, table.length)).map((t) => t.id);
  let finalPair: [string, string] | null = null;
  while (bracket.length > 1) {
    const next: string[] = [];
    if (bracket.length === 2) finalPair = [bracket[0], bracket[1]];
    for (let i = 0; i < bracket.length; i += 2) {
      const a = bracket[i], b = bracket[i + 1] ?? bracket[i];
      next.push(rng.next() < winProb(strength[a], strength[b]) ? a : b);
    }
    bracket = next;
  }
  const championId = bracket[0] ?? table[0].id;
  const runnerUpId = finalPair ? (finalPair[0] === championId ? finalPair[1] : finalPair[0]) : (table[1]?.id ?? championId);

  // — Rendimiento individual + MVP —
  const perf: Record<string, number> = {};
  const posOf: Record<string, number> = {};
  standings.forEach((s) => { posOf[s.teamId] = s.pos; });
  for (const p of Object.values(world.players)) {
    if (p.status !== "active" || !p.teamId) { perf[p.id] = 30; continue; }
    const pos = posOf[p.teamId] ?? table.length;
    const teamScore = 100 - (pos - 1) * (80 / Math.max(1, table.length));
    const champBonus = p.teamId === championId ? 14 : 0;
    const indiv = (progress(p.dev) - 50) * 0.5;
    perf[p.id] = Math.max(0, Math.min(100, Math.round(teamScore * 0.6 + indiv + champBonus + (rng.next() * 8 - 4))));
  }
  // MVP = mejor rendimiento del campeón.
  const champRoster = world.teams[championId]?.roster ?? [];
  const mvpId = champRoster.filter((id) => world.players[id]?.status === "active")
    .sort((a, b) => (perf[b] ?? 0) - (perf[a] ?? 0))[0] ?? champRoster[0] ?? table[0].roster[0];

  return { standings, championId, runnerUpId, mvpId, perf, finalPair };
}
