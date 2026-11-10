/**
 * COACH × BROADCAST — alimenta al Broadcast con la decisión del entrenador.
 * No modifica el Broadcast Engine: produce el contexto que este acepta de forma
 * opcional (plan elegido, cambio respecto al inicial, confianza, objetivo).
 */
import type { RoundState } from "@/sim";
import type { CoachDecision } from "./types";
import type { CoachEvent } from "./narrative";
import { ns, td } from "@/i18n/runtime";

const t = ns("coach");

export interface CoachBroadcastContext {
  objective: string;
  buy: string;
  risk: string;
  entry: string;
  tempo: string;
  concept: string;
  confidence: number;
  /** ¿El coach cambió el plan automático inicial? */
  changed: boolean;
}

export function coachBroadcastContext(decision: CoachDecision): CoachBroadcastContext {
  return {
    objective: decision.primaryObjective,
    buy: decision.economy.buy,
    risk: decision.riskLevel,
    entry: decision.entryType,
    tempo: decision.tempo,
    concept: decision.concept,
    confidence: decision.confidence,
    changed: decision.changes.length > 0,
  };
}

/**
 * Datos EN VIVO del entrenador para el Broadcast (órdenes/voz/sesgos/última llamada).
 * Solo PRODUCE datos (no construye la UI definitiva): lo consumirá el broadcast en una
 * fase futura. PURO: lee `RoundState`.
 */
export interface CoachLiveBroadcast {
  /** "Voz" restante / total de la ronda. */
  voz: { left: number; total: number };
  /** Nº de órdenes emitidas esta ronda y cuántas fueron efectivas. */
  orders: { total: number; effective: number };
  /** Última orden emitida (id) o null. */
  lastCommand: string | null;
  /** Sesgos activos legibles ("ritmo↑", "agresivo", "foco Mid", "stack", "guarda util."). */
  activeBiases: string[];
}

// FULL GAME AUDIT (2026-10-07) · zonas por su función (`ZONE_LABEL`): «A Main»/«B/Tree» son de Ascent y no existen en los otros once mapas.
const LANE_LABEL: Record<string, string> = { main: "la entrada principal", tree: "el flanco", mid: "mid" };

export function coachLiveBroadcast(s: RoundState): CoachLiveBroadcast {
  const calls = s.events.filter((e) => e.type === "coachCall");
  const effective = calls.filter((e) => (e.data as { effective?: boolean }).effective).length;
  const last = calls.length ? String((calls[calls.length - 1].data as { id?: string }).id ?? "") : null;
  const cf = s.coachFlags;
  const biases: string[] = [];
  if (cf.tempoBias > 0) biases.push("ritmo↑");
  if (cf.tempoBias < 0) biases.push("ritmo↓");
  if (cf.aggressionBias > 0) biases.push("agresivo");
  if (cf.aggressionBias < 0) biases.push("paciente");
  if (cf.laneFocus) biases.push(t("foco en {v}", { v: td(LANE_LABEL[cf.laneFocus]) ?? cf.laneFocus }));
  if (cf.stack) biases.push("stack");
  if (cf.forceRotation) biases.push("rotar");
  if (cf.saveUtility) biases.push(t("guarda util."));
  if (cf.pushUtility) biases.push(t("usa util."));
  if (cf.iglOverrideId) biases.push("IGL cambiado");
  if (cf.forceRetake) biases.push("retake");

  return {
    voz: { left: s.voz.left, total: s.voz.total },
    orders: { total: calls.length, effective },
    lastCommand: last,
    activeBiases: biases,
  };
}

/** Resumen de eventos de entrenador del partido (para broadcast/ceremonia). */
export interface CoachEventSummary { type: string; round: number; team: "home" | "away"; magnitude: number; detail?: string }
export function coachEventsBroadcast(events: CoachEvent[]): CoachEventSummary[] {
  return [...events].sort((a, b) => b.magnitude - a.magnitude).slice(0, 8)
    .map((e) => ({ type: e.type, round: e.round, team: e.team, magnitude: e.magnitude, detail: e.detail }));
}
