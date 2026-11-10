/**
 * MANAGER CAREER ENGINE · Fase 3 — instalaciones del club.
 *
 * Cada instalación (nivel 0..5) produce un MODIFICADOR REAL que afecta al juego: academia →
 * mejores rookies; centro de entrenamiento → más desarrollo; análisis → más info para el
 * coach; médico → menos fatiga; scouting → mejores descubrimientos. Determinista. Puro.
 */
import type { FacilityId, Facilities, FacilityEffects } from "./types";

export const FACILITY_IDS: FacilityId[] = [
  "training_center", "academy", "medical", "analysis", "scouting", "offices", "tactical_room", "gaming_house",
  "psychology", "fitness", "media_studio", "fan_center",
];

export const FACILITY_LABEL: Record<FacilityId, string> = {
  training_center: "Centro de entrenamiento",
  academy: "Academia",
  medical: "Área médica",
  analysis: "Sala de análisis",
  scouting: "Red de scouting",
  offices: "Oficinas",
  tactical_room: "Sala táctica",
  gaming_house: "Gaming House",
  psychology: "Centro psicológico",
  fitness: "Centro físico",
  media_studio: "Estudio multimedia",
  fan_center: "Fan Center",
};

export const FACILITY_EFFECT_LABEL: Record<FacilityId, string> = {
  training_center: "+ desarrollo de jugadores",
  academy: "rookies de más potencial",
  medical: "menos fatiga acumulada",
  analysis: "más información para el coach",
  scouting: "mejores descubrimientos",
  offices: "más ingresos comerciales",
  tactical_room: "ventaja táctica en partido",
  gaming_house: "mejor química y condición",
  psychology: "mejor mental, menos tilt",
  fitness: "recuperación y resistencia a lesiones",
  media_studio: "alcance de contenido y streaming",
  fan_center: "engagement de afición y merchandising",
};

export const MAX_FACILITY_LEVEL = 5;

/** Instalaciones de partida: todo a nivel 1 (operativo básico). */
export function initFacilities(): Facilities {
  return {
    training_center: 1, academy: 1, medical: 1, analysis: 1,
    scouting: 1, offices: 1, tactical_room: 1, gaming_house: 1,
    psychology: 1, fitness: 1, media_studio: 1, fan_center: 1,
  };
}

/** Rellena instalaciones que falten (migración de saves de Fase 3/4 → Fase 5). */
export function backfillFacilities(f: Partial<Facilities> | undefined): Facilities {
  const base = initFacilities();
  if (!f) return base;
  for (const id of FACILITY_IDS) base[id] = f[id] ?? 1;
  return base;
}

/** Coste de subir una instalación del nivel actual al siguiente. Crece de forma convexa. */
export function upgradeCost(level: number): number {
  return Math.round(4000 * Math.pow(1.7, level)); // L0→4000, L1→6800, ... L4→33k
}

/** Mantenimiento total por temporada (suma de niveles). */
export function facilitiesUpkeep(f: Facilities): number {
  let sum = 0;
  for (const id of FACILITY_IDS) sum += f[id] * 600;
  return sum;
}

/** Modificadores REALES (0..1 cada uno) derivados de los niveles. */
export function facilityEffects(f: Facilities): FacilityEffects {
  const n = (lvl: number) => (lvl ?? 1) / MAX_FACILITY_LEVEL; // 0..1 (?? por saves antiguos)
  return {
    devBonus: n(f.training_center) * 0.6,
    academyQuality: n(f.academy),
    fatigueReduction: n(f.medical) * 0.5,
    infoBonus: (n(f.analysis) * 0.6 + n(f.tactical_room) * 0.4) * 0.8,
    scoutBonus: n(f.scouting),
    incomeBonus: n(f.offices) * 0.5,
    chemistryBonus: n(f.gaming_house) * 0.5,
    // ── Career Fase 5 ──
    mentalBonus: n(f.psychology) * 0.6,
    recoveryBonus: (n(f.fitness) * 0.6 + n(f.medical) * 0.4) * 0.6,
    contentReach: n(f.media_studio) * 0.7,
    fanEngagement: n(f.fan_center) * 0.7,
  };
}

/** Sube una instalación un nivel (sin comprobar saldo: lo hace el llamador). */
export function upgradeFacility(f: Facilities, id: FacilityId): { facilities: Facilities; cost: number } | null {
  if (f[id] >= MAX_FACILITY_LEVEL) return null;
  const cost = upgradeCost(f[id]);
  return { facilities: { ...f, [id]: f[id] + 1 }, cost };
}
