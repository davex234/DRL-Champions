/**
 * COACH × PIZARRA TÁCTICA — construir un PLAN paso a paso (no dibujo libre).
 *
 * El entrenador encadena pasos ("Split A → Dos Mid → Un Lurk → Flash → Smoke →
 * Execute → Post Plant") y la pizarra los COMPILA a una `ConceptOrder` que el Tactical
 * Director ya entiende (intent/lane/tempo/style) + el foco de utilidad. NO crea otra IA:
 * traduce intención humana al vocabulario de conceptos existente. PURO/determinista.
 */
import type { ConceptId, ConceptOrder, Lane } from "@/tactics";
import type { Tempo } from "@/sim";
import type { CoachConcept } from "./types";
import type { UtilityFocus } from "./manual";

export type ChalkStepKind =
  | "split" | "stack" | "lurk" | "default" | "fake" | "execute" | "rush"
  | "flash" | "smoke" | "recon" | "molly" | "post_plant" | "retake" | "save";

export interface ChalkStep {
  kind: ChalkStepKind;
  /** Carril objetivo del paso (para stack/split/execute…). */
  lane?: Lane;
  /** Nº de jugadores implicados (informativo, p. ej. "Dos Mid"). */
  count?: number;
}

export interface ChalkboardPlan {
  /** Orden de concepto que alimenta al Tactical Director. */
  order: ConceptOrder;
  /** Concepto del Coach Engine equivalente (para la fase de preparación). */
  concept: CoachConcept;
  tempo: Tempo;
  /** Foco de utilidad derivado de los pasos de utilidad. */
  utility: UtilityFocus;
  /** Nº de lurkers pedidos. */
  lurkers: number;
  /** Resumen legible SIN nombres ("Split A · flash de entrada · execute rápido"). */
  summary: string;
  /** ¿La secuencia es coherente (tiene al menos un paso de intención)? */
  valid: boolean;
}

// FULL GAME AUDIT (2026-10-07) · zonas por su función (`ZONE_LABEL`): «A Main»/«B/Tree» son de Ascent y no existen en los otros once mapas.
const LANE_LABEL: Record<Lane, string> = { main: "Entrada principal", tree: "Flanco", mid: "Mid" };

/** Mapea el intent a un `ConceptId` táctico y a un `CoachConcept` de preparación. */
function intentOf(steps: ChalkStep[]): { intent: ConceptId; concept: CoachConcept } {
  const has = (k: ChalkStepKind) => steps.some((s) => s.kind === k);
  if (has("fake")) return { intent: "fake", concept: "fake" };
  if (has("retake")) return { intent: "retake", concept: "play_retake" };
  if (has("save")) return { intent: "save", concept: "save" };
  if (has("split")) return { intent: "split", concept: "fake" };
  if (has("execute") || has("rush")) return { intent: "explode", concept: "explode_a" };
  if (has("lurk") && !has("execute")) return { intent: "play_picks", concept: "play_picks" };
  return { intent: "default", concept: "default" };
}

/** Carril principal: el del paso de intención (execute/stack/split), o el más citado. */
function primaryLane(steps: ChalkStep[]): Lane {
  const priority = steps.find((s) => (s.kind === "execute" || s.kind === "rush" || s.kind === "stack" || s.kind === "split") && s.lane);
  if (priority?.lane) return priority.lane;
  const tally: Record<Lane, number> = { main: 0, tree: 0, mid: 0 };
  for (const s of steps) if (s.lane) tally[s.lane] += s.count ?? 1;
  return (["main", "tree", "mid"] as Lane[]).reduce((a, b) => (tally[b] > tally[a] ? b : a), "main");
}

function tempoOf(steps: ChalkStep[]): Tempo {
  if (steps.some((s) => s.kind === "rush" || s.kind === "execute")) return "fast";
  if (steps.some((s) => s.kind === "save" || s.kind === "lurk" || s.kind === "retake")) return "slow";
  return "mid";
}

function utilityOf(steps: ChalkStep[]): UtilityFocus {
  if (steps.some((s) => s.kind === "flash")) return "entry";
  if (steps.some((s) => s.kind === "smoke")) return "control";
  if (steps.some((s) => s.kind === "molly")) return "defense";
  if (steps.some((s) => s.kind === "retake")) return "retake";
  if (steps.some((s) => s.kind === "save")) return "save";
  return "control";
}

const STEP_LABEL: Record<ChalkStepKind, string> = {
  split: "split", stack: "stack", lurk: "lurk", default: "default", fake: "finta",
  execute: "execute", rush: "rush", flash: "flash de entrada", smoke: "humos de control",
  recon: "info/recon", molly: "molly de negación", post_plant: "post-plant", retake: "retake", save: "save",
};

/** Compila la secuencia de la pizarra a un plan ejecutable por el Director. */
export function compileChalkboard(steps: ChalkStep[]): ChalkboardPlan {
  const { intent, concept } = intentOf(steps);
  const lane = primaryLane(steps);
  const tempo = tempoOf(steps);
  const utility = utilityOf(steps);
  const lurkers = steps.filter((s) => s.kind === "lurk").reduce((a, s) => a + (s.count ?? 1), 0);
  const style: ConceptOrder["style"] =
    steps.some((s) => s.kind === "execute" || s.kind === "rush") ? "aggressive"
      : steps.some((s) => s.kind === "save") ? "save"
      : steps.some((s) => s.kind === "lurk" || s.kind === "retake") ? "passive" : "default";

  const order: ConceptOrder = { intent, lane, tempo, style };

  // Resumen sin nombres: refleja CÓMO se juega (objetivo final de la fase).
  const parts: string[] = [];
  const head = steps.find((s) => ["split", "stack", "execute", "rush", "fake", "default"].includes(s.kind));
  if (head) parts.push(`${STEP_LABEL[head.kind]} ${head.lane ? LANE_LABEL[head.lane] : ""}`.trim());
  if (lurkers > 0) parts.push(`${lurkers} lurk`);
  const utilSteps = steps.filter((s) => ["flash", "smoke", "recon", "molly"].includes(s.kind));
  for (const u of utilSteps) parts.push(STEP_LABEL[u.kind]);
  if (steps.some((s) => s.kind === "post_plant")) parts.push("post-plant");

  return {
    order, concept, tempo, utility, lurkers,
    summary: parts.length ? parts.join(" · ") : "plan por defecto",
    valid: steps.some((s) => ["split", "stack", "execute", "rush", "fake", "default", "lurk", "retake", "save"].includes(s.kind)),
  };
}
