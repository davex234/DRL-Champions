/**
 * MERCADO DE FICHAJES — los equipos IA deciden: comprar, vender, ceder, renovar, despedir,
 * ascender cantera. Emergente: cada club evalúa necesidades (huecos, contratos que expiran,
 * presupuesto) y actúa. Reutiliza el Timeline (`ensurePlayer` = detección de stint) y mueve
 * rosters de verdad (con fee y finanzas). Determinista (Rng sembrado). PURO.
 */
import type { WorldState, WorldTeam, WorldPlayer } from "./types";
import { makeRng, seedOf, type Rng } from "./rng";
import { ensurePlayer } from "@/live/timeline";
import { freshContract } from "./contracts";
import { generateRookie } from "./academy";

const valueOf = (world: WorldState, id: string): number => world.players[id]?.value ?? 0;
const weakestStarter = (world: WorldState, team: WorldTeam): WorldPlayer | null => {
  const five = team.roster.map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p && p.status === "active");
  if (five.length === 0) return null;
  return five.reduce((a, b) => (a.value <= b.value ? a : b));
};

function placeOnTeam(world: WorldState, team: WorldTeam, p: WorldPlayer, rng: Rng): void {
  // Si el equipo está lleno, libera al más flojo.
  if (team.roster.length >= 5) {
    const weak = weakestStarter(world, team);
    if (weak && weak.value < p.value) {
      team.roster = team.roster.filter((id) => id !== weak.id);
      weak.teamId = null; weak.contract = null;
      world.freeAgents.push(weak.id);
    } else return;
  }
  team.roster.push(p.id);
  p.teamId = team.id;
  p.contract = freshContract(rng, p.value, p.innate.ambition);
  ensurePlayer(world.timeline, { id: p.id, nick: p.nick }, world.season, team.id); // stint (detección de fichaje)
}

/**
 * Ejecuta el mercado completo de una temporada. `opts.protectTeamId` blinda a un club: sus
 * jugadores no se mueven por la IA (lo controla el usuario en el mercado interactivo de la
 * carrera, `src/market`). Aditivo: sin opts se comporta EXACTAMENTE igual que antes.
 */
export function runTransferMarket(world: WorldState, opts?: { protectTeamId?: string }): void {
  const season = world.season;
  const rng: Rng = makeRng(seedOf(world.seed, "market", season));
  const teams = Object.values(world.teams);
  const protect = opts?.protectTeamId ?? null;

  // 1) Contratos caducados → renovación o agencia libre. Estrellas infelices se liberan.
  for (const p of Object.values(world.players)) {
    if (p.status !== "active" || !p.teamId || !p.contract) continue;
    if (protect && p.teamId === protect) continue; // el usuario gestiona sus contratos
    const team = world.teams[p.teamId];
    if (!team) continue;
    const expired = p.contract.years <= 0;
    const unhappy = p.contract.happiness < 32;
    if (!expired && !unhappy) continue;

    const wantsKeep = !unhappy && p.contract.happiness > 52 && rng.chance(0.6);
    if (wantsKeep) {
      p.contract = freshContract(rng, p.value, p.innate.ambition);
      world.transfers.push({ season, playerId: p.id, nick: p.nick, from: team.id, to: team.id, fee: 0, kind: "renewal" });
    } else {
      team.roster = team.roster.filter((id) => id !== p.id);
      p.teamId = null; p.contract = null;
      world.freeAgents.push(p.id);
      world.transfers.push({ season, playerId: p.id, nick: p.nick, from: team.id, to: null, fee: 0, kind: "release" });
    }
  }

  // 2) Rellenar huecos con agentes libres / cantera (ascensos).
  for (const team of teams) {
    if (protect && team.id === protect) continue; // el usuario rellena su propio hueco
    let guard = 0;
    while (team.roster.length < 5 && guard++ < 8) {
      // Mejor agente libre que pueda pagar (coste de fichaje = 20% del valor).
      const affordable = world.freeAgents
        .map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p && p.status === "active" && p.teamId === null)
        .filter((p) => p.value * 0.2 <= team.budget)
        .sort((a, b) => b.value - a.value);
      let target = affordable[0];
      let kind: "free" | "promotion" = "free";
      if (!target) { target = generateRookie(world, rng, team.region); world.players[target.id] = target; kind = "promotion"; } // sube cantera
      const fee = Math.round(target.value * 0.2);
      team.budget = Math.max(0, team.budget - fee);
      world.freeAgents = world.freeAgents.filter((id) => id !== target!.id);
      placeOnTeam(world, team, target, rng);
      world.transfers.push({ season, playerId: target.id, nick: target.nick, from: null, to: team.id, fee, kind });
    }
  }

  // 3) Un fichaje de MEJORA por equipo con presupuesto (compra a otro club, con fee).
  for (const team of teams) {
    if (protect && team.id === protect) continue; // el usuario decide sus compras
    if (team.budget < 6000) continue;
    const weak = weakestStarter(world, team);
    const weakVal = weak?.value ?? 0;
    const candidates = Object.values(world.players)
      .filter((p) => p.status === "active" && p.teamId && p.teamId !== team.id && (!protect || p.teamId !== protect) && p.value > weakVal + 8 && p.value <= team.budget)
      .filter((p) => (world.teams[p.teamId!]?.roster.length ?? 0) >= 5) // no dejar al vendedor por debajo de 4
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
    if (candidates.length === 0) continue;
    const target = candidates[rng.int(candidates.length)];
    const seller = world.teams[target.teamId!];
    if (!seller) continue;
    const fee = Math.min(target.contract?.releaseClause ?? target.value, team.budget);
    // El vendedor cobra; el comprador paga; el jugador se mueve.
    seller.roster = seller.roster.filter((id) => id !== target.id);
    seller.budget += fee;
    team.budget = Math.max(0, team.budget - fee);
    placeOnTeam(world, team, target, rng);
    world.transfers.push({ season, playerId: target.id, nick: target.nick, from: seller.id, to: team.id, fee, kind: "transfer" });
  }
}

/**
 * Mercado de entrenadores en DOS pasadas: primero despidos (los del fondo), luego
 * contrataciones — sin recontratar al recién destituido por el MISMO equipo (rotación
 * real). Los coaches retirados (en `freeCoaches`) entran a un banquillo de verdad.
 */
export function manageCoaches(world: WorldState): void {
  const rng: Rng = makeRng(seedOf(world.seed, "coaches", world.season));
  const teams = Object.values(world.teams);
  const total = teams.length;
  const justFired: Record<string, string> = {};

  // Pasada 1: despidos.
  for (const team of teams) {
    const last = team.standings[team.standings.length - 1];
    if (!last || !team.coachId) continue;
    if (last.pos > total * 0.7 && rng.chance(0.5)) {
      const fired = world.coaches[team.coachId];
      if (fired) { fired.teamId = null; world.freeCoaches.push(fired.id); }
      justFired[team.id] = team.coachId;
      team.coachId = null;
    }
  }

  // Pasada 2: contrataciones (no recontrata al recién cesado por el mismo equipo).
  for (const team of teams) {
    if (team.coachId) continue;
    const free = world.freeCoaches
      .map((id) => world.coaches[id])
      .filter((c) => c && !c.teamId && c.id !== justFired[team.id])
      .sort((a, b) => b.rating - a.rating);
    let hire = free[0];
    if (!hire) {
      const cid = `coach-gen-${world.season}-${world.nextId++}`;
      hire = { id: cid, name: `Coach ${team.tag}+`, teamId: null, rating: Math.round(45 + rng.int(35)), titles: 0, seasons: 0 };
      world.coaches[cid] = hire;
    }
    hire.teamId = team.id;
    team.coachId = hire.id;
    world.freeCoaches = world.freeCoaches.filter((id) => id !== hire!.id);
  }
}
