/**
 * MANAGER CAREER ENGINE · Fase 2 — clubes y directores deportivos.
 *
 * Deriva la FILOSOFÍA del director deportivo y las EXPECTATIVAS de un club a partir de sus
 * datos del Living World (prestigio/presupuesto/región). Determinista (Rng sembrado). Puro.
 * No duplica el club: lee una `ClubView` desacoplada del `WorldTeam`.
 */
import type { ClubView, ClubPhilosophy, ClubObjective, ClubObjectiveKind } from "./types";
import type { Rng } from "./rng";

export const PHILOSOPHY_LABEL: Record<ClubPhilosophy, string> = {
  develop_youth: "Desarrollar jóvenes",
  buy_stars: "Comprar estrellas",
  financial_control: "Control económico",
  long_project: "Proyecto a largo plazo",
  win_now: "Ganar ya",
};

/** Filosofía determinista del director deportivo según prestigio + presupuesto. */
export function derivePhilosophy(prestige: number, budget: number, rng: Rng): ClubPhilosophy {
  const rich = budget >= 30000;
  const elite = prestige >= 70;
  const poor = budget < 10000;
  if (elite && rich) return rng.chance(0.6) ? "win_now" : "buy_stars";
  if (poor) return rng.chance(0.6) ? "financial_control" : "develop_youth";
  if (prestige < 45) return rng.chance(0.5) ? "develop_youth" : "long_project";
  return rng.chance(0.5) ? "long_project" : "buy_stars";
}

/** Posición de liga que el club ESPERA por temporada (1 = campeón). Top clubs exigen más. */
export function expectedPosition(club: ClubView): number {
  // prestigio 100 ⇒ pos 1-2; prestigio 50 ⇒ mitad de tabla; prestigio 0 ⇒ evitar el fondo.
  const expected = Math.round(1 + ((100 - club.prestige) / 100) * (club.totalTeams - 1) * 0.85);
  return Math.max(1, Math.min(club.totalTeams, expected));
}

const OBJ_TEXT: Record<ClubObjectiveKind, string> = {
  win_league: "Ganar la liga",
  reach_playoffs: "Clasificar a playoffs",
  top4: "Terminar Top 4",
  win_major: "Ganar un Major",
  win_worlds: "Ganar el Mundial",
  develop_rookies: "Desarrollar a los rookies",
  cut_costs: "Reducir gastos",
  raise_prestige: "Subir el prestigio del club",
  grow_fanbase: "Aumentar la masa social",
  keep_dynasty: "Mantener la dinastía",
  qualify_international: "Clasificar a competición internacional",
};

function obj(kind: ClubObjectiveKind, mandatory: boolean, targetPosition = 0): ClubObjective {
  return { kind, text: OBJ_TEXT[kind], targetPosition, mandatory, status: "pending" };
}

/**
 * Objetivos del contrato que impone el club: dependen de su prestigio y de su filosofía
 * (director deportivo). El primero es POSICIONAL y obligatorio; el segundo refleja la
 * filosofía. Determinista.
 */
export function boardObjectivesFor(club: ClubView): ClubObjective[] {
  const expect = expectedPosition(club);
  const out: ClubObjective[] = [];

  // Objetivo posicional obligatorio acorde al prestigio.
  if (expect <= 1) out.push(obj("win_league", true, 1));
  else if (expect <= Math.ceil(club.totalTeams * 0.34)) out.push(obj("top4", true, Math.min(4, expect)));
  else if (expect <= Math.ceil(club.totalTeams * 0.6)) out.push(obj("reach_playoffs", true, expect));
  else out.push(obj("reach_playoffs", false, expect));

  // Objetivo de filosofía (director deportivo).
  switch (club.philosophy) {
    case "win_now": out.push(obj("win_major", true)); break;
    case "buy_stars": out.push(obj("qualify_international", true)); break;
    case "develop_youth": out.push(obj("develop_rookies", true)); break;
    case "financial_control": out.push(obj("cut_costs", true)); break;
    case "long_project": out.push(obj(club.titles > 0 ? "keep_dynasty" : "raise_prestige", false)); break;
  }
  // Los clubes con gran afición piden crecerla.
  if (club.fanbase >= 500) out.push(obj("grow_fanbase", false));
  return out;
}
