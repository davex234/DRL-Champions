/**
 * MANAGER CAREER ENGINE — objetivos de carrera.
 *
 * Objetivos a corto/medio/largo plazo + uno VITALICIO, evaluados contra las estadísticas
 * de carrera (CareerStats). Dinámicos: al cumplir un objetivo de un horizonte se genera el
 * siguiente, más ambicioso (sembrado, determinista). Puro.
 */
import type { CareerObjective, CareerStats, ObjectiveHorizon, ManagerCareer } from "./types";
import type { Rng } from "./rng";

/** Plantillas incrementales por horizonte: cada una mide una métrica de CareerStats. */
const TEMPLATES: Record<ObjectiveHorizon, { metric: keyof CareerStats; step: number; verb: string }[]> = {
  short: [
    { metric: "wins", step: 5, verb: "Gana {n} partidos" },
    { metric: "currentWinStreak", step: 3, verb: "Encadena una racha de {n} victorias" },
  ],
  medium: [
    { metric: "titles", step: 1, verb: "Gana {n} título" },
    { metric: "mvps", step: 3, verb: "Forma {n} MVPs" },
  ],
  long: [
    { metric: "titles", step: 5, verb: "Acumula {n} títulos" },
    { metric: "seasonsCoached", step: 10, verb: "Dirige durante {n} temporadas" },
  ],
  lifetime: [{ metric: "titles", step: 25, verb: "Construye una dinastía: {n} títulos" }],
};

function targetFrom(base: number, step: number): number {
  // Próximo múltiplo de `step` estrictamente mayor que `base`.
  return Math.floor(base / step) * step + step;
}

function makeObjective(
  horizon: ObjectiveHorizon,
  stats: CareerStats,
  season: number,
  rng: Rng,
  personalGoal?: string,
): CareerObjective {
  const pool = TEMPLATES[horizon];
  const t = pool[rng.int(0, pool.length - 1)];
  const base = stats[t.metric];
  const target = targetFrom(base, t.step);
  const text =
    horizon === "lifetime" && personalGoal
      ? personalGoal
      : t.verb.replace("{n}", String(target));
  return {
    id: `obj:${horizon}:${season}:${t.metric}:${target}`,
    horizon,
    text,
    metric: t.metric,
    target,
    base: t.metric === "currentWinStreak" ? 0 : base,
    status: "active",
    createdSeason: season,
  };
}

/** Objetivos iniciales (uno por horizonte). El vitalicio refleja el objetivo personal. */
export function generateObjectives(stats: CareerStats, season: number, rng: Rng, personalGoal: string): CareerObjective[] {
  return (["short", "medium", "long", "lifetime"] as ObjectiveHorizon[]).map((h) =>
    makeObjective(h, stats, season, rng, h === "lifetime" ? personalGoal : undefined),
  );
}

function progressOf(o: CareerObjective, stats: CareerStats): number {
  return stats[o.metric] - o.base;
}

/**
 * Evalúa objetivos: marca cumplidos y REGENERA el horizonte cumplido con uno más alto.
 * Devuelve la nueva lista + ids recién cumplidos.
 */
export function evaluateObjectives(
  career: ManagerCareer,
  rng: Rng,
): { objectives: CareerObjective[]; achievedIds: string[] } {
  const { stats, season, personalGoal } = career;
  const achievedIds: string[] = [];
  const out: CareerObjective[] = [];
  for (const o of career.objectives) {
    if (o.status === "active" && progressOf(o, stats) >= o.target - o.base) {
      achievedIds.push(o.id);
      out.push({ ...o, status: "achieved" });
      // El vitalicio no se regenera (es la meta de toda la carrera); los demás escalan.
      if (o.horizon !== "lifetime") {
        out.push(makeObjective(o.horizon, stats, season, rng));
      }
    } else {
      out.push(o);
    }
  }
  return { objectives: out, achievedIds };
}
