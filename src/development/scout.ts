/**
 * SCOUTING — los ojeadores leen a un jugador: potencial, personalidad, fuertes,
 * débiles y RIESGOS (burnout, edad, techo, motivación). Compone el perfil innato + el
 * estado de desarrollo. PURO: solo lee.
 */
import type { TraitKey } from "@/sim";
import { TRAIT_KEYS } from "@/sim";
import type { DevState, InnateProfile, ScoutReport, SkillId } from "./types";
import { SKILL_IDS } from "./types";
import { ageBand } from "./innate";
import { progress } from "./evolve";

const TRAIT_LABEL: Partial<Record<TraitKey, string>> = {
  composure: "sangre fría", clutchFactor: "clutch", entryDrive: "entrada", leadershipDrive: "liderazgo",
  tacticalIQ: "IQ táctico", utilityLean: "utilidad", tradeInstinct: "trades", aggression: "agresividad",
  discipline: "disciplina", communication: "comunicación", consistency: "consistencia", selfBelief: "confianza",
};
const SKILL_LABEL: Record<SkillId, string> = {
  entry: "entradas", retake: "retakes", postplant: "post-plant", clutch: "clutch", igl: "shot-calling",
  trade: "trades", support: "apoyo/utilidad", lurk: "lurk", economy: "economía",
};

export function scoutPlayer(innate: InnateProfile, state: DevState): ScoutReport {
  const band = ageBand(state.age, innate);
  const prog = progress(state);
  const ceilingReached = Math.round(Math.min(100, (prog / Math.max(1, innate.potential)) * 100));
  const growth = Math.round(((innate.growthRate - 0.6) / 0.9) * 100);

  // Fuertes / débiles desde deltas de ADN + habilidades.
  const traitsSorted = (Object.entries(state.traitDelta) as [TraitKey, number][]).sort((x, y) => y[1] - x[1]);
  const skillsSorted = SKILL_IDS.map((k) => [k, state.skill[k]] as [SkillId, number]).sort((x, y) => y[1] - x[1]);
  const strengths = [
    ...traitsSorted.filter(([, v]) => v >= 2).slice(0, 2).map(([k]) => TRAIT_LABEL[k] ?? k),
    ...skillsSorted.filter(([, v]) => v >= 62).slice(0, 2).map(([k]) => SKILL_LABEL[k]),
  ];
  const weaknesses = [
    ...traitsSorted.filter(([, v]) => v <= -2).slice(-2).map(([k]) => TRAIT_LABEL[k] ?? k),
    ...skillsSorted.filter(([, v]) => v <= 42).slice(-2).map(([k]) => SKILL_LABEL[k]),
  ];

  const risks: string[] = [];
  if (state.condition.burnout >= 45 || state.condition.fatigue >= 78) risks.push("riesgo de burnout");
  if (band === "veterano" || band === "declive") risks.push("declive por edad");
  if (ceilingReached >= 88) risks.push("cerca de su techo");
  if (state.condition.motivation < 42) risks.push("motivación baja");
  if (innate.workEthic < 42) risks.push("ética de trabajo floja");
  if (risks.length === 0) risks.push("sin riesgos relevantes");

  const personality =
    innate.workEthic >= 70 && innate.ambition >= 70 ? "trabajador y ambicioso"
      : innate.workEthic >= 65 ? "muy profesional"
      : innate.ambition >= 70 ? "ambicioso"
      : innate.workEthic < 45 ? "talento sin constancia"
      : "equilibrado";

  const recommendation =
    band === "joven" && innate.potential >= 85 ? "Joya: invertir en su desarrollo."
      : band === "joven" ? "Proyecto con margen de mejora."
      : band === "prime" && ceilingReached >= 80 ? "Estrella consolidada en su pico."
      : band === "prime" ? "Jugador fiable, aún con margen."
      : "Veterano: aporta cabeza y liderazgo, vigilar el físico.";

  return {
    playerId: state.playerId, age: state.age, ageBand: band,
    potential: innate.potential, ceilingReached, growth, personality,
    strengths: strengths.length ? [...new Set(strengths)] : ["perfil sin picos marcados"],
    weaknesses: weaknesses.length ? [...new Set(weaknesses)] : ["sin debilidades marcadas"],
    risks, recommendation,
  };
}
