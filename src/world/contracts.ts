/**
 * CONTRATOS — salario/duración/cláusula + felicidad/lealtad/ambición/relaciones.
 *
 * Cada temporada los contratos avanzan: la felicidad se mueve con el éxito del equipo,
 * los minutos (titular) y el salario frente al valor; la lealtad y las relaciones derivan.
 * Un contrato a 0 años caduca (lo gestiona el mercado). PURO + determinista (Rng sembrado).
 */
import type { Contract, WorldPlayer, WorldState } from "./types";
import type { Rng } from "./rng";

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** Contrato inicial coherente con el valor del jugador. */
export function freshContract(rng: Rng, value: number, ambition: number): Contract {
  return {
    salary: Math.max(20, Math.round(value * (0.10 + rng.next() * 0.10))),
    years: 1 + rng.int(3),
    releaseClause: Math.round(value * (1.5 + rng.next() * 1.5)),
    happiness: 55 + rng.int(25),
    loyalty: 45 + rng.int(35),
    ambition,
    relCoach: 50 + rng.int(30),
    relTeam: 50 + rng.int(30),
  };
}

/**
 * Avanza los contratos una temporada: felicidad/lealtad/relaciones según el rendimiento
 * del equipo y el encaje salario/valor. NO caduca aquí (eso lo hace el mercado).
 */
export function tickContracts(world: WorldState, rng: Rng): void {
  for (const p of Object.values(world.players)) {
    if (p.status !== "active" || !p.contract || !p.teamId) continue;
    const team = world.teams[p.teamId];
    if (!team) continue;
    const c = p.contract;
    c.years = Math.max(0, c.years - 1);

    const last = team.standings[team.standings.length - 1];
    const success = last ? (last.champion ? 20 : last.pos <= 2 ? 10 : last.pos <= 4 ? 2 : -8) : 0;
    const starter = team.roster.indexOf(p.id) < 5 ? 4 : -6; // jugar de titular da felicidad
    const paidFair = c.salary >= p.value * 0.1 ? 3 : -5;
    const ambitionGap = c.ambition > 70 && success < 5 ? -6 : 0; // ambicioso sin títulos se frustra

    c.happiness = clamp100(c.happiness + success + starter + paidFair + ambitionGap + (rng.next() * 4 - 2));
    c.loyalty = clamp100(c.loyalty + (c.happiness > 60 ? 2 : -3));
    c.relCoach = clamp100(c.relCoach + (success > 5 ? 2 : -1));
    c.relTeam = clamp100(c.relTeam + (success > 0 ? 1 : -1));
  }
}
