/**
 * TACTICAL DIRECTOR 2.0 · ESTILO DE EQUIPO — el "ADN táctico" RECONOCIBLE de un equipo, DERIVADO
 * (no inventado) de la Composición (Agent Engine), la Identidad (ADN de los jugadores) y, si lo
 * hay, el concepto del Coach. Viendo los números se reconoce el equipo sin ver el nombre:
 *
 *   tempo · agresividad · paciencia · control · rotaciones · trade% · lurk% · fake% · execute% ·
 *   retake% · save%
 *
 * PURO y determinista. Cada métrica 0..1.
 */
import type { Identity } from "../sim/identity/traits";
import { clampTrait, unit } from "../sim/identity/traits";
import type { CompositionProfile } from "../agents/composition";

export interface TeamStyle {
  tempo: number;        // 1 = explosivo/rápido, 0 = lento/metódico
  aggression: number;
  patience: number;
  control: number;      // tendencia a jugar control de mapa / defaults
  rotation: number;     // rapidez/propensión a rotar
  trade: number;        // juego en parejas / refrag
  lurk: number;         // jugadores que se separan al flanco
  fake: number;         // engaño / mid-round
  execute: number;      // ejecuciones coordinadas con utilidad
  retake: number;       // fuerza en el retake
  save: number;         // disciplina para guardar
  archetype: string;
  /** Etiqueta legible del estilo dominante. */
  label: string;
  /** Frase corta de identidad (sin nombre). */
  summary: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r01 = (n: number) => clamp01(n / 100);
/** Media de un rasgo de identidad del equipo, normalizada 0..1 (50 = 0.5). */
const trait = (ids: Identity[], k: keyof Identity): number =>
  ids.length ? clamp01(ids.reduce((a, id) => a + clampTrait(id[k]), 0) / ids.length / 100) : 0.5;

/** Sesgo del concepto del coach sobre el estilo (pequeño; el coach PROPONE). */
function coachBias(concept: string | undefined): Partial<Record<keyof TeamStyle, number>> {
  switch (concept) {
    case "slow": return { tempo: -0.2, patience: 0.15, control: 0.2 };
    case "explode_a": case "explode_b": return { tempo: 0.25, aggression: 0.15, execute: 0.2 };
    case "fake": return { fake: 0.3, control: 0.1 };
    case "play_picks": return { tempo: -0.15, patience: 0.2, lurk: 0.1 };
    case "play_retake": return { retake: 0.25, patience: 0.1 };
    case "force": return { tempo: 0.2, aggression: 0.2, save: -0.2 };
    case "save": return { save: 0.4, tempo: -0.2 };
    default: return {};
  }
}

/** Deriva el estilo táctico de un equipo. */
export function teamStyle(
  identities: Identity[],
  composition?: CompositionProfile,
  coachConcept?: string,
): TeamStyle {
  const rt = composition?.ratings;
  const av = composition?.avg;
  // Bases desde la composición (Agent Engine), con respaldo neutro si no hay.
  const cEntry = rt ? r01(rt.entry) : 0.5;
  const cControl = rt ? r01(rt.control) : 0.5;
  const cInfo = rt ? r01(rt.info) : 0.5;
  const cMid = rt ? r01(rt.midround) : 0.5;
  const cRetake = rt ? r01(rt.retake) : 0.5;
  const cExecute = rt ? r01(rt.execute) : 0.5;
  const cScaling = rt ? r01(rt.scaling) : 0.5;
  const aLurk = av ? r01(av.lurk) : 0.5;
  const aTrade = av ? r01(av.trading) : 0.5;
  const aRot = av ? r01(av.rotation) : 0.5;

  const aggrId = trait(identities, "aggression");
  const patId = trait(identities, "patience");
  const discId = trait(identities, "discipline");
  const creatId = trait(identities, "creativity");
  const lurkId = trait(identities, "lurkTendency");
  const tradeId = trait(identities, "tradeInstinct");

  const s: TeamStyle = {
    tempo: clamp01(0.5 + (cEntry - cControl) * 0.7 + (aggrId - patId) * 0.4),
    aggression: clamp01(0.55 * aggrId + 0.45 * cEntry),
    patience: clamp01(0.55 * patId + 0.45 * cControl),
    control: clamp01(0.6 * cControl + 0.2 * cScaling + 0.2 * patId),
    rotation: clamp01(0.5 * cMid + 0.3 * aRot + 0.2 * cInfo),
    trade: clamp01(0.6 * aTrade + 0.4 * tradeId),
    lurk: clamp01(0.6 * aLurk + 0.4 * lurkId),
    fake: clamp01(0.5 * cMid + 0.3 * creatId + 0.2 * cInfo),
    execute: clamp01(0.6 * cExecute + 0.4 * cEntry),
    retake: clamp01(0.7 * cRetake + 0.3 * cInfo),
    save: clamp01(0.6 * discId + 0.4 * cScaling),
    archetype: composition?.archetype ?? "balanced",
    label: composition?.archetypeLabel ?? "Equilibrado",
    summary: "",
  };

  // Sesgo del coach (propone, no impone).
  for (const [k, d] of Object.entries(coachBias(coachConcept))) {
    const key = k as keyof TeamStyle;
    if (typeof s[key] === "number") (s[key] as number) = clamp01((s[key] as number) + (d ?? 0));
  }

  s.summary = summarize(s);
  return s;
}

/** Frase de identidad emergente (sin nombre de equipo). */
function summarize(s: TeamStyle): string {
  const bits: string[] = [];
  bits.push(s.tempo > 0.62 ? "ejecuta rápido" : s.tempo < 0.4 ? "juega lento" : "tempo medio");
  if (s.control > 0.6) bits.push("control de mapa / defaults largos");
  if (s.lurk > 0.6) bits.push("vive de lurks");
  if (s.fake > 0.6) bits.push("vende fakes");
  if (s.aggression > 0.62) bits.push("busca primeros duelos");
  if (s.patience > 0.62) bits.push("castiga pushes");
  if (s.retake > 0.62) bits.push("fuerte en retake");
  if (s.trade > 0.62) bits.push("entra en parejas");
  return bits.slice(0, 4).join(" · ");
}
