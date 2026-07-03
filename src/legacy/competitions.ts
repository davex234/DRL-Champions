/**
 * COMPETICIONES — el circuito mundial más allá de la liga (Career Fase 6/7).
 *
 * El mundo ya juega la liga+playoffs (`playSeason`). Aquí EMERGEN las competiciones globales:
 * Masters, Invitacional y World Championship — los mejores clubes clasifican y compiten por
 * prestigio, dinero y fanbase. Alimenta prestigio/dinero/fanbase/timeline/noticias. REUTILIZA
 * los standings del mundo. Determinista (Rng sembrado). PURO salvo la aplicación de premios.
 */
import type { WorldState, WorldTeam, Rng } from "@/world";
import { makeRng, seedOf } from "@/world";
import type { Competition, CompetitionTierId } from "./types";

/** Puntuación de un club para clasificar (prestigio + última posición + jitter sembrado). */
function score(world: WorldState, t: WorldTeam, rng: Rng): number {
  const last = t.standings[t.standings.length - 1];
  const posScore = last ? 100 - (last.pos - 1) * 6 : 40;
  return t.prestige * 0.6 + posScore * 0.4 + rng.next() * 8;
}

/** Resuelve un torneo entre `pool` (bracket sembrado). Devuelve campeón y finalista. */
function resolve(world: WorldState, pool: WorldTeam[], rng: Rng): { champ: WorldTeam; runner: WorldTeam | null } {
  if (pool.length === 0) return { champ: Object.values(world.teams)[0], runner: null };
  // Puntúa UNA vez por club (score() consume rng); ordenar por el comparador anterior llamaba a
  // score() un nº impredecible de veces → comparador no transitivo y nº de draws no determinista.
  const scored = pool.map((t) => ({ t, s: score(world, t, rng) }));
  scored.sort((a, b) => b.s - a.s);
  const ranked = scored.map((x) => x.t);
  // Bracket simple: el mejor gana con alta probabilidad, con sorpresas sembradas.
  let field = ranked.slice(0, 8);
  let runner: WorldTeam | null = field[1] ?? null;
  while (field.length > 1) {
    const next: WorldTeam[] = [];
    if (field.length === 2) runner = field[0] === winner(field[0], field[1], world, rng) ? field[1] : field[0];
    for (let i = 0; i < field.length; i += 2) next.push(winner(field[i], field[i + 1] ?? field[i], world, rng));
    field = next;
  }
  return { champ: field[0], runner };
}
function winner(a: WorldTeam, b: WorldTeam, world: WorldState, rng: Rng): WorldTeam {
  const sa = score(world, a, rng), sb = score(world, b, rng);
  return rng.next() < 1 / (1 + Math.exp(-(sa - sb) / 6)) ? a : b;
}

const TIER_PRIZE: Record<CompetitionTierId, number> = { regional: 4000, qualifier: 3000, masters: 12000, invitational: 8000, worlds: 25000 };
const TIER_PRESTIGE: Record<CompetitionTierId, number> = { regional: 1, qualifier: 1, masters: 3, invitational: 2, worlds: 6 };
const TIER_NAME: Record<CompetitionTierId, string> = { regional: "Regional", qualifier: "Clasificatorio", masters: "DRL Masters", invitational: "Invitacional", worlds: "World Championship" };

/** Deriva las competiciones globales de la temporada (sin aplicar premios). Determinista. */
export function deriveCompetitions(world: WorldState): Competition[] {
  const rng = makeRng(seedOf(world.seed, "comp", world.season));
  const teams = Object.values(world.teams);
  const out: Competition[] = [];
  const tiers: CompetitionTierId[] = ["masters", "invitational", "worlds"];
  for (const tier of tiers) {
    const pool = tier === "invitational" ? teams.filter((t) => t.prestige >= 45) : teams;
    const { champ, runner } = resolve(world, pool, makeRng(seedOf(world.seed, "comp", world.season, tier)));
    out.push({ id: `comp:${world.season}:${tier}`, name: `${TIER_NAME[tier]} T${world.season}`, tier, season: world.season, championId: champ.id, championName: champ.name, runnerUpId: runner?.id ?? null, prizePool: TIER_PRIZE[tier], prestige: TIER_PRESTIGE[tier] });
  }
  return out;
}

/** Ejecuta las competiciones: aplica premios (prestigio/dinero/fanbase) y registra el récord de Worlds. */
export function runCompetitions(world: WorldState, protectTeamId: string | null): Competition[] {
  const comps = deriveCompetitions(world);
  for (const c of comps) {
    const champ = world.teams[c.championId];
    if (!champ) continue;
    if (!(protectTeamId && champ.id === protectTeamId)) champ.budget = Math.round(champ.budget + c.prizePool);
    champ.prestige = Math.max(0, Math.min(100, champ.prestige + c.prestige));
    champ.fanbase = Math.round(champ.fanbase + c.prestige * 40);
    if (c.tier === "worlds") { champ.titles += 1; world.history.records["worlds"] = { label: "worlds", holder: champ.name, value: (world.history.records["worlds"]?.value ?? 0) + 1, season: world.season }; }
  }
  return comps;
}
