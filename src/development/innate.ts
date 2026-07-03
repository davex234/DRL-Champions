/**
 * PERFIL INNATO — determinista por id del jugador.
 *
 * No todos llegan igual: cada jugador NACE con potencial, techo, ritmo de mejora, ética
 * de trabajo, aguante, ambición y curva de edad. Se deriva con el MISMO patrón de hash
 * estable que `deriveIdentity` (FNV-1a por id+clave) → reproducible, sin RNG ni estado.
 */
import type { InnateProfile, DevState, PlayerCondition, SkillId } from "./types";
import { SKILL_IDS } from "./types";

/** FNV-1a estable (mismo patrón que playerMapper.hashId). */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Valor determinista en [0,1) por (id, clave). */
const r01 = (id: string, key: string): number => (hashId(`${id}#${key}`) % 100000) / 100000;
export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Deriva el perfil innato de un jugador (determinista). */
export function deriveInnate(playerId: string): InnateProfile {
  const startAge = 16 + Math.round(r01(playerId, "age") * 11);     // 16..27
  const peakAge = 23 + Math.round(r01(playerId, "peak") * 4);       // 23..27
  const declineAge = peakAge + 4 + Math.round(r01(playerId, "decl") * 3); // ~27..34
  return {
    playerId,
    startAge,
    potential: Math.round(55 + r01(playerId, "pot") * 44),          // 55..99
    growthRate: Math.round((0.6 + r01(playerId, "grow") * 0.9) * 100) / 100, // 0.6..1.5
    workEthic: Math.round(35 + r01(playerId, "work") * 64),         // 35..99
    durability: Math.round(35 + r01(playerId, "dura") * 64),        // 35..99
    ambition: Math.round(40 + r01(playerId, "amb") * 59),           // 40..99
    peakAge,
    declineAge,
  };
}

const freshCondition = (innate: InnateProfile): PlayerCondition => ({
  fatigue: 8,
  burnout: 0,
  form: 50,
  motivation: clamp100(50 + (innate.ambition - 50) * 0.3),
  confidence: 55,
  morale: 55,
  stress: 8,
});

/** Estado de desarrollo inicial de un jugador (sin progreso aún). */
export function freshDevState(innate: InnateProfile): DevState {
  const skill = {} as Record<SkillId, number>;
  for (const s of SKILL_IDS) skill[s] = 50;
  return {
    playerId: innate.playerId,
    age: innate.startAge,
    matchesPlayed: 0,
    seasonsPlayed: 0,
    traitDelta: {},
    attrDelta: { aim: 0, gameSense: 0, utility: 0, leadership: 0 },
    skill,
    condition: freshCondition(innate),
    peak: 50,
    history: [],
  };
}

/**
 * Multiplicador de crecimiento por EDAD (curva de carrera). Joven mejora rápido; en
 * el pico se estabiliza; en el declive las ganancias físicas se vuelven negativas.
 */
export function ageGrowthFactor(age: number, innate: InnateProfile): number {
  if (age < innate.peakAge) return 1.15 - (innate.peakAge - age) * -0.05; // joven: alto
  if (age <= innate.declineAge) return 0.6;                                // prime: lento
  return Math.max(-1, 0.2 - (age - innate.declineAge) * 0.35);            // declive: negativo
}

/** Banda de edad legible. */
export function ageBand(age: number, innate: InnateProfile): "joven" | "prime" | "veterano" | "declive" {
  if (age < innate.peakAge) return "joven";
  if (age <= innate.declineAge) return "prime";
  if (age <= innate.declineAge + 2) return "veterano";
  return "declive";
}
