/**
 * JUBILACIONES — los veteranos se retiran y se reconvierten (emergente, no scripts).
 *
 * Cuando la edad supera el declive y la forma cae, el jugador cuelga el ratón y, según
 * su perfil (liderazgo/IQ/comunicación/ambición), se convierte en coach/analista/caster/
 * scout/manager/embajador. Los coaches retirados entran al mercado de entrenadores. PURO.
 */
import type { WorldState, WorldPlayer, StaffRole } from "./types";
import type { Rng } from "./rng";
import { progress, clamp } from "@/development";

function staffRoleFor(p: WorldPlayer, rng: Rng): StaffRole {
  const s = p.dev.skill;
  const td = p.dev.traitDelta;
  // Cada perfil puntúa; gana el más alto (garantiza variedad y suficientes coaches).
  const scores: Record<StaffRole, number> = {
    coach: s.igl + (td.leadershipDrive ?? 0) * 5 + 6,
    analista: 50 + (td.tacticalIQ ?? 0) * 5 + (s.economy - 50),
    caster: 48 + (td.communication ?? 0) * 5 + rng.int(8),
    scout: s.support + (td.lurkTendency ?? 0) * 3,
    manager: p.innate.ambition,
    embajador: 44 + rng.int(14),
  };
  return (Object.entries(scores) as [StaffRole, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** Retira a los veteranos en declive. Devuelve los jugadores retirados esta temporada. */
export function retireVeterans(world: WorldState, rng: Rng): WorldPlayer[] {
  const retired: WorldPlayer[] = [];
  for (const p of Object.values(world.players)) {
    if (p.status !== "active") continue;
    const old = p.dev.age >= p.innate.declineAge + 3 || p.dev.age >= 33;
    const declining = p.dev.condition.form < 42 || progress(p.dev) < 45;
    if (!(old && (declining || rng.chance(0.45)))) continue;

    p.status = "retired";
    const role = staffRoleFor(p, rng);
    p.staffRole = role;
    if (p.teamId) {
      const t = world.teams[p.teamId];
      if (t) t.roster = t.roster.filter((id) => id !== p.id);
    }
    p.teamId = null;
    p.contract = null;
    world.freeAgents = world.freeAgents.filter((id) => id !== p.id);
    world.history.retirements.push({ season: world.season, nick: p.nick, staffRole: role });

    if (role === "coach") {
      const cid = `coach-ret-${p.id}`;
      world.coaches[cid] = {
        id: cid, name: p.nick, teamId: null,
        rating: Math.round(clamp(50 + (progress(p.dev) - 50) * 0.4 + (p.dev.skill.igl - 50) * 0.3, 35, 90)),
        titles: 0, seasons: 0, fromPlayer: p.id,
      };
      world.freeCoaches.push(cid);
    }
    retired.push(p);
  }
  return retired;
}
