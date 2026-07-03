/**
 * RIVALIDADES DINÁMICAS — nacen solas, no predefinidas (Career Fase 6/7).
 *
 * REUTILIZA `WorldTeam.rivalries` (que el mundo ya alimenta con finalistas) y AÑADE fuentes
 * emergentes: dominio compartido del circuito, traspasos entre clubes, misma región. Calcula
 * los EFECTOS de la rivalidad (prestigio/asistencia/sponsor/motivación). PURO. Determinista.
 */
import type { WorldState } from "@/world";
import type { Rivalry, RivalryOrigin } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Refuerza `WorldTeam.rivalries` con fuentes emergentes. Muta el mundo (dato ya persistido). */
export function detectRivalries(world: WorldState): void {
  const teams = Object.values(world.teams);
  const season = world.season;

  // 1) Traspasos entre dos clubes → tensión.
  for (const t of world.transfers.filter((x) => x.season === season && x.kind === "transfer" && x.from && x.to)) {
    const a = world.teams[t.from!], b = world.teams[t.to!];
    if (!a || !b || a.id === b.id) continue;
    bump(a, b.id, 8); bump(b, a.id, 8);
  }
  // 2) Dominio compartido: dos clubes ambos en el top-3 esta temporada → rivalidad deportiva.
  const top = teams.filter((t) => { const s = t.standings[t.standings.length - 1]; return s && s.pos <= 3; });
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) { bump(top[i], top[j].id, 5); bump(top[j], top[i].id, 5); }
  // 3) Misma región + ambos con títulos → clásico regional.
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    const a = teams[i], b = teams[j];
    if (a.region === b.region && a.titles > 0 && b.titles > 0) { bump(a, b.id, 3); bump(b, a.id, 3); }
  }
}

function bump(team: { rivalries: Record<string, number> }, rivalId: string, by: number): void {
  team.rivalries[rivalId] = clamp((team.rivalries[rivalId] ?? 0) + by, 0, 100);
}

function originOf(world: WorldState, aId: string, bId: string): RivalryOrigin {
  const a = world.teams[aId], b = world.teams[bId];
  if (world.transfers.some((t) => (t.from === aId && t.to === bId) || (t.from === bId && t.to === aId))) return "transfer";
  if (a && b && a.region === b.region) return "region";
  const aTop = a?.standings[a.standings.length - 1]?.pos ?? 99, bTop = b?.standings[b.standings.length - 1]?.pos ?? 99;
  if (aTop <= 3 && bTop <= 3) return "dominance";
  return "final";
}

/** Rivalidades del club, con sus efectos en el ecosistema. Ordenadas por intensidad. */
export function rivalriesOf(world: WorldState, clubId: string): Rivalry[] {
  const t = world.teams[clubId];
  if (!t) return [];
  return Object.entries(t.rivalries)
    .filter(([rid, val]) => val >= 20 && world.teams[rid])
    .map(([rid, intensity]) => {
      const origin = originOf(world, clubId, rid);
      const k = intensity / 100;
      return {
        a: clubId, b: rid, aName: t.name, bName: world.teams[rid].name,
        intensity: Math.round(intensity), origin,
        effects: { prestige: +(k * 2).toFixed(2), attendance: +(k * 0.25).toFixed(2), sponsor: +(k * 0.15).toFixed(2), motivation: +(k * 0.3).toFixed(2) },
        note: origin === "transfer" ? "Tensión por fichajes" : origin === "region" ? "Clásico regional" : origin === "dominance" ? "Duelo por el dominio" : "Herencia de finales",
      } as Rivalry;
    })
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 6);
}

/** Aplica los efectos de las rivalidades intensas: más audiencia ⇒ prestigio/fanbase. Muta el mundo. */
export function applyRivalryEffects(world: WorldState, protectTeamId: string | null): { born: { a: string; b: string; intensity: number }[] } {
  const born: { a: string; b: string; intensity: number }[] = [];
  for (const t of Object.values(world.teams)) {
    for (const [rid, intensity] of Object.entries(t.rivalries)) {
      if (t.id >= rid) continue; // una vez por par
      if (intensity >= 56) {
        // Rivalidad intensa: llena estadios ⇒ pequeño empuje de fanbase/prestigio a ambos.
        for (const id of [t.id, rid]) {
          const team = world.teams[id];
          if (!team) continue;
          team.fanbase = Math.round(team.fanbase * 1.005 + 10);
          team.prestige = clamp(team.prestige + 0.1, 0, 100);
        }
        if (intensity >= 56 && intensity < 62) born.push({ a: t.name, b: world.teams[rid]?.name ?? rid, intensity: Math.round(intensity) });
      }
    }
  }
  return { born };
}
