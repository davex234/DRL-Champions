/**
 * TACTICAL DIRECTOR 2.0 · BROADCAST — DATOS tácticos en vivo, listos para que una futura UI los
 * muestre (no construye UI). Reúne plan/fase/concepto, control del mapa (Spatial Engine), carril
 * prioritario, lurk, objetivo, win-probability, momentum y las lecturas del rival. PURO.
 */
import type { RoundState, Side } from "../sim";
import { CONCEPTS } from "./concepts";
import { tacticalPhaseLabel } from "./phases";
import { controlSpace } from "./spatial";
import { LANE_CHOKE } from "./map";
import type { Lane, TacticalPhaseId, TeamTacticState } from "./types";
import { ns } from "@/i18n/runtime";

const tr = ns("tactics");

// FULL GAME AUDIT (2026-10-07) · zonas por su función (`ZONE_LABEL`): «A Main»/«B/Tree» son de Ascent y no existen en los otros once mapas.
const LANE_LABEL: Record<Lane, string> = { main: "la entrada principal", tree: "el flanco", mid: "mid" };
const aliveN = (s: RoundState, side: Side) => s.players.filter((p) => p.side === side && p.alive).length;

export interface SideTacticalBroadcast {
  side: Side;
  concept: string;
  conceptLabel: string;
  phase: TacticalPhaseId;
  phaseLabel: string;
  lane: Lane;
  laneLabel: string;
  fakeLane: Lane | null;
  tempo: string;
  retakeStyle: string;
  objective: string;
  priorityZone: string;
  lurking: boolean;
  adapted: boolean;
  reads: string[];
  notes: string[];
}

export interface TacticalBroadcast {
  tick: number;
  /** Espacio controlado por bando (0..1). */
  control: Record<Side, number>;
  /** Probabilidad de ganar la ronda del ATAQUE (0..1). */
  winProbATK: number;
  /** Momentum de la ronda hacia el ATK (-1..1) por ventaja numérica + spike + control. */
  momentum: number;
  sides: { ATK: SideTacticalBroadcast | null; DEF: SideTacticalBroadcast | null };
}

function objectiveOf(s: RoundState, side: Side, phase: TacticalPhaseId): string {
  if (side === "ATK") {
    if (s.spike.planted) return tr("Aguantar post-plant");
    if (phase === "execute") return tr("Ejecutar el sitio");
    if (phase === "fake") return tr("Vender la finta");
    if (phase === "map_control" || phase === "default") return tr("Control de mapa");
    return tr("Tomar espacio / info");
  }
  if (s.spike.planted) return phase === "retake" ? tr("Retomar el sitio") : tr("Preparar el retake");
  if (phase === "rotation") return tr("Rotar al contacto");
  return tr("Defender / sacar info");
}

function sideBroadcast(s: RoundState, side: Side, st: TeamTacticState): SideTacticalBroadcast {
  const concept = st.plan.nodes.find((n) => n.id === st.activeNode)?.concept ?? st.concept;
  const lurking = side === "ATK" && (st.concept === "lurk" || s.players.some((p) => p.side === side && p.alive && p.intent === "fight" && p.identity.lurkTendency > 60));
  return {
    side, concept, conceptLabel: CONCEPTS[concept]?.label ?? concept,
    phase: st.phase, phaseLabel: tacticalPhaseLabel(st.phase),
    lane: st.lane, laneLabel: LANE_LABEL[st.lane], fakeLane: st.fakeLane,
    tempo: st.commitTick > 95 ? "lento" : st.commitTick < 60 ? "rápido" : "medio",
    retakeStyle: st.style, objective: objectiveOf(s, side, st.phase),
    priorityZone: LANE_CHOKE[st.lane], lurking, adapted: st.adapted,
    reads: st.reads, notes: st.notes.slice(-3),
  };
}

/** Construye los datos tácticos de broadcast del estado actual. */
export function tacticalBroadcast(s: RoundState): TacticalBroadcast {
  const ctrl = controlSpace(s);
  const atk = aliveN(s, "ATK"), def = aliveN(s, "DEF");
  const tot = Math.max(1, atk + def);
  let win = atk / tot;                                  // base por ventaja numérica
  win += (ctrl.ATK - 0.5) * 0.18;                        // control del mapa
  if (s.spike.planted) win += 0.18;                      // post-plant favorece al ATK
  win = Math.max(0.02, Math.min(0.98, win));
  const momentum = Math.max(-1, Math.min(1, (atk - def) / 5 + (s.spike.planted ? 0.2 : 0) + (ctrl.ATK - 0.5) * 0.4));

  const t = s.tactical;
  return {
    tick: s.tick, control: ctrl, winProbATK: win, momentum,
    sides: {
      ATK: t?.ATK ? sideBroadcast(s, "ATK", t.ATK) : null,
      DEF: t?.DEF ? sideBroadcast(s, "DEF", t.DEF) : null,
    },
  };
}
