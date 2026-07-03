/**
 * NECESIDADES DE PLANTILLA — cada club sabe qué le falta (Career Fase 4/7).
 *
 * CALCULADO, nunca aleatorio: huecos de rol vs la composición ideal, falta de estrella, de
 * líder (IGL), de juventud/veteranía y de fondo de armario. Reutiliza `progress`/`ageBand`
 * del Player Development. PURO y DETERMINISTA. Es el cerebro que dispara la IA de fichajes.
 */
import type { WorldPlayer, WorldTeam } from "@/world";
import type { RoleId } from "@/domain/cards/types";
import { progress, ageBand } from "@/development";
import type { SquadNeed } from "./types";
import { IDEAL_COMP, roleCounts } from "./roles";

const startersOf = (team: WorldTeam, players: Record<string, WorldPlayer>): WorldPlayer[] =>
  team.roster.slice(0, 5).map((id) => players[id]).filter((p): p is WorldPlayer => !!p && p.status === "active");

/** Necesidades ordenadas por severidad (mayor primero). */
export function squadNeeds(team: WorldTeam, players: Record<string, WorldPlayer>): SquadNeed[] {
  const five = startersOf(team, players);
  const needs: SquadNeed[] = [];
  const push = (kind: SquadNeed["kind"], role: RoleId | null, severity: number, reason: string) =>
    needs.push({ teamId: team.id, kind, role, severity: Math.max(0, Math.min(100, Math.round(severity))), reason });

  // 1) Huecos de rol vs composición ideal.
  const counts = roleCounts(five.map((p) => p.role));
  for (const role of Object.keys(IDEAL_COMP) as RoleId[]) {
    const missing = IDEAL_COMP[role] - counts[role];
    if (missing > 0) push("role_gap", role, 55 + missing * 20, `Sin ${role} titular`);
  }

  // 2) Falta de estrella: el mejor del quinteto por debajo del umbral top.
  const ratings = five.map((p) => progress(p.dev));
  const best = ratings.length ? Math.max(...ratings) : 0;
  if (best < 74) push("star", null, 40 + (74 - best) * 1.4, `Sin una estrella diferencial (top ${Math.round(best)})`);

  // 3) Falta de líder (IGL): nadie con skill de IGL alto.
  const bestIgl = five.length ? Math.max(...five.map((p) => p.dev.skill.igl ?? 50)) : 0;
  if (bestIgl < 60) push("igl", "Iniciador", 45 + (60 - bestIgl), `Sin un líder en pista claro`);

  // 4) Equilibrio de edad: sin juventud (proyección) o sin veteranía (experiencia).
  const hasYoung = five.some((p) => ageBand(p.dev.age, p.innate) === "joven" && p.innate.potential >= 78);
  const hasVeteran = five.some((p) => p.dev.age >= 27);
  if (!hasYoung) push("rookie", null, 35, "Sin juventud con proyección");
  if (!hasVeteran) push("veteran", null, 30, "Sin veteranía que dé estabilidad");

  // 5) Fondo de armario: menos de 6 jugadores en propiedad (5 titulares + ≥1 suplente).
  const owned = team.roster.length;
  if (owned < 6) push("depth", null, 25 + (6 - owned) * 10, `Plantilla corta (${owned} jugadores)`);

  // 6) Exceso: demasiados jugadores ⇒ conviene vender/ceder.
  if (owned > 8) push("sell_surplus", null, 30 + (owned - 8) * 12, `Plantilla inflada (${owned})`);

  return needs.sort((a, b) => b.severity - a.severity);
}

/** ¿La plantilla necesita este rol? (para priorizar objetivos de fichaje). */
export function needsRole(needs: SquadNeed[], role: RoleId): number {
  const n = needs.find((x) => x.kind === "role_gap" && (x.role === role || x.role === "Flex" || role === "Flex"));
  return n?.severity ?? 0;
}
