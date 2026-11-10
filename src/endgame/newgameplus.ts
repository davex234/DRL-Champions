/**
 * NEW GAME+ — el mundo CONTINÚA y recuerda tu paso (Career Fase 7/7).
 *
 * EMERGE del Living World, que YA reconvierte a los jugadores retirados en coach/analista/
 * caster/scout/manager/embajador (`retireVeterans`). Aquí se SURFACEA esa reconversión y se
 * graba al entrenador retirado como leyenda persistente del mundo. Las leyendas/récords/Hall of
 * Fame PERMANECEN (son estado del mundo). PURO salvo `applyNewGamePlus` (muta el mundo). Determinista.
 */
import type { ManagerCareer } from "@/career";
import type { WorldState, StaffRole } from "@/world";
import type { NewGamePlusSeed, Reconversion, ReconversionRole } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("endgame");

const ROLE_MAP: Record<StaffRole, ReconversionRole> = {
  coach: "coach", analista: "analyst", caster: "caster", scout: "scout", manager: "sporting_director", embajador: "ambassador",
};
const ROLE_LABEL: Record<ReconversionRole, string> = {
  coach: "entrenador", sporting_director: "director deportivo", analyst: "analista", caster: "comentarista", scout: "ojeador", ambassador: "embajador", legend: "leyenda",
};

export function newGamePlusSeed(career: ManagerCareer, world: WorldState): NewGamePlusSeed {
  // Reconversiones recientes (los jugadores del mundo que cuelgan el ratón y se reinventan).
  const reconversions: Reconversion[] = world.history.retirements.slice(-8).map((r) => {
    const role = ROLE_MAP[r.staffRole] ?? "legend";
    return { id: `ngp:${r.nick}:${r.season}`, nick: r.nick, from: "jugador", newRole: role, note: tr("Se reconvierte en {v} (T{season})", { v: td(ROLE_LABEL[role]), season: r.season }) };
  });
  const legendsCarried = Object.values(world.players).filter((p) => p.titles >= 4).length + Object.values(world.coaches).filter((c) => c.fromPlayer).length;
  const recordsCarried = Object.keys(world.history.records).length;
  return {
    retiredCoachId: "coach-user",
    legendsCarried,
    recordsCarried,
    reconversions,
    worldMemoryNote: tr("El mundo recuerda a {name}: sus récords, su Hall of Fame y sus jugadores perduran. El circuito sigue girando.", { name: career.coach.name }),
  };
}

/**
 * Prepara el mundo para New Game+: convierte al entrenador del usuario (`coach-user`) en una
 * LEYENDA persistente (el mundo lo recuerda) y libera el hueco para una nueva carrera. Muta el mundo.
 */
export function applyNewGamePlus(world: WorldState, career: ManagerCareer): void {
  const uc = world.coaches["coach-user"];
  if (uc) {
    const lid = `coach-legend-${career.seed}`;
    world.coaches[lid] = { ...uc, id: lid, teamId: null, name: career.coach.name };
    delete world.coaches["coach-user"];
    for (const t of Object.values(world.teams)) if (t.coachId === "coach-user") t.coachId = null;
    if (!world.freeCoaches.includes(lid)) world.freeCoaches.push(lid);
    world.freeCoaches = world.freeCoaches.filter((id) => id !== "coach-user");
  }
  // El récord del entrenador leyenda perdura en la historia del mundo.
  world.history.records["legend_coach"] = { label: "legend_coach", holder: career.coach.name, value: career.stats.titles, season: world.season };
}
