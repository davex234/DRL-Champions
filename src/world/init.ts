/**
 * INIT — construye el universo a partir del catálogo REAL (12 equipos, ~26 jugadores).
 *
 * Cada jugador del catálogo → WorldPlayer con estado de desarrollo sembrado a su nivel de
 * carta (vía intel `ratingFromCardStats`), edad/potencial innatos (deriveInnate), contrato
 * y valor. Los rosters incompletos se rellenan con rookies de la academia. Reutiliza el
 * Timeline de `src/live`. Determinista por semilla.
 */
import type { Player, Region } from "@/domain/cards/types";
import { allPlayers, cardsForPlayer } from "@/data/catalog";
import { deriveInnate, freshDevState, clamp } from "@/development";
import { ratingFromCardStats } from "@/intel";
import { createTimeline } from "@/live/timeline";
import type { WorldState, WorldTeam, WorldPlayer, WorldCoach } from "./types";
import { makeRng, seedOf } from "./rng";
import { freshContract } from "./contracts";
import { playerValue } from "./market";
import { generateRookie } from "./academy";

const bestOvr = (p: Player): number => cardsForPlayer(p).reduce((m, c) => Math.max(m, c.ovr), 0);

/** Siembra el estado de desarrollo para reflejar el nivel de carta del jugador. */
function seedDev(player: Player, id: string) {
  const innate = deriveInnate(id);
  const rating = ratingFromCardStats(player.stats, { type: "masters" }); // 1..99
  const delta = clamp(rating - 50, -25, 25);
  const dev = freshDevState(innate);
  dev.attrDelta = { aim: delta, gameSense: delta, utility: delta * 0.8, leadership: delta * 0.7 };
  dev.peak = 50 + delta;
  innate.potential = Math.max(innate.potential, Math.round(50 + delta) + 6); // élite con margen
  return { innate, dev };
}

export function createWorld(seed: number): WorldState {
  const rng = makeRng(seed >>> 0);
  const world: WorldState = {
    seed: seed >>> 0, season: 1, phase: "preseason",
    teams: {}, players: {}, coaches: {}, freeAgents: [], freeCoaches: [],
    timeline: createTimeline(), transfers: [],
    rankings: { players: [], teams: [], coaches: [], promises: [], veterans: [], rookies: [], regions: [] },
    events: [], ecoEvents: [], news: [],
    history: { champions: [], records: {}, rookieOfYear: [], retirements: [] },
    nextId: 1,
  };

  // Agrupa el catálogo en equipos.
  const byTeam = new Map<string, Player[]>();
  for (const p of allPlayers()) {
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team)!.push(p);
  }

  for (const [teamName, members] of byTeam) {
    const tag = members[0].teamTag;
    const region = members[0].region as Region;
    const teamId = `team-${tag.toLowerCase()}`;
    const trng = makeRng(seedOf(seed, teamId));
    const team: WorldTeam = {
      id: teamId, name: teamName, tag, region, roster: [], coachId: null,
      budget: 0, prestige: 0, fanbase: 0, titles: 0, rivalries: {}, standings: [],
    };

    // Jugadores reales del catálogo.
    for (const player of members) {
      const id = player.id;
      const { innate, dev } = seedDev(player, id);
      const wp: WorldPlayer = {
        id, nick: player.nick, region: player.region as Region, role: player.role,
        teamId, innate, dev, contract: null, status: "active",
        value: 0, titles: 0, mvps: 0, origin: "seed", prevValue: 0,
      };
      wp.value = playerValue(wp);
      wp.prevValue = wp.value;
      wp.contract = freshContract(trng, wp.value, innate.ambition);
      world.players[id] = wp;
      team.roster.push(id);
    }

    // Rellena hasta 5 con rookies de la academia.
    while (team.roster.length < 5) {
      const rookie = generateRookie(world, trng, region);
      rookie.teamId = teamId;
      rookie.contract = freshContract(trng, rookie.value, rookie.innate.ambition);
      world.players[rookie.id] = rookie;
      team.roster.push(rookie.id);
    }

    // Prestigio/fanbase/presupuesto sembrados del nivel medio del roster.
    const avgOvr = members.reduce((a, p) => a + bestOvr(p), 0) / Math.max(1, members.length);
    team.prestige = Math.round(clamp(40 + (avgOvr - 75) * 2, 20, 95));
    team.fanbase = Math.round(team.prestige * (8 + trng.next() * 6));
    team.budget = Math.round(team.prestige * 1200 + trng.int(20000));

    // Entrenador.
    const coachId = `coach-${tag.toLowerCase()}`;
    const coach: WorldCoach = { id: coachId, name: `Coach ${tag}`, teamId, rating: Math.round(clamp(team.prestige + trng.int(20) - 10, 30, 95)), titles: 0, seasons: 0 };
    world.coaches[coachId] = coach;
    team.coachId = coachId;

    world.teams[teamId] = team;
  }

  // Unos cuantos agentes libres (cantera global) para alimentar el mercado.
  const regions: Region[] = ["EMEA", "Americas", "Pacific", "China"];
  for (let i = 0; i < 6; i++) {
    const fa = generateRookie(world, rng, regions[i % regions.length]);
    world.players[fa.id] = fa;
    world.freeAgents.push(fa.id);
  }

  return world;
}
