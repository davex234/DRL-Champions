/**
 * TACTICAL DIRECTOR 2.0 · FASES RECONOCIBLES — deriva la fase TÁCTICA en curso de un equipo a
 * partir del estado de la ronda + el Tactical Graph. No es otra máquina de estados: LEE el nodo
 * activo, el concepto, la fase del sim y el spike. PURO. El runner la fija en `st.phase` cada tick.
 *
 *   default · map_control · info · pressure · fake · read · rotation · execute · post_plant ·
 *   retake · save
 */
import type { RoundState, Side } from "../sim/types";
import type { TacticalPhaseId, TeamTacticState } from "./types";
import { contactLane } from "./assign";

const PHASE_LABEL: Record<TacticalPhaseId, string> = {
  prepare: "Preparación", default: "Default", map_control: "Control de mapa", info: "Información",
  pressure: "Presión", fake: "Fake", read: "Lectura", rotation: "Rotación", execute: "Ejecución",
  post_plant: "Post-plant", retake: "Retake", save: "Save", ended: "Fin",
};
export const tacticalPhaseLabel = (p: TacticalPhaseId): string => PHASE_LABEL[p];

const activeConcept = (st: TeamTacticState): string =>
  st.plan.nodes.find((n) => n.id === st.activeNode)?.concept ?? "default";

/** Deriva la fase táctica de un equipo (ATK/DEF). Determinista. */
export function tacticalPhase(s: RoundState, side: Side, st: TeamTacticState): TacticalPhaseId {
  if (s.phase === "ENDED") return "ended";
  const concept = activeConcept(st);

  if (st.activeNode === "save" || concept === "save") return "save";

  if (side === "ATK") {
    if (s.spike.planted) return "post_plant";
    if (s.phase === "EXECUTE") {
      if (concept === "fake") {
        const since = s.executeTick != null ? s.tick - s.executeTick : 999;
        return since < 32 ? "fake" : "execute";
      }
      return "execute";
    }
    // SETUP: control de mapa / info / presión según concepto y proximidad al commit.
    if (concept === "fake") return "fake";
    if (concept === "map_control" || concept === "default") {
      return s.tick >= st.commitTick - 25 ? "pressure" : "map_control";
    }
    if (concept === "play_picks" || concept === "contact") return "info";
    return s.tick >= st.commitTick - 20 ? "pressure" : "default";
  }

  // DEFENSA
  if (s.spike.planted) return st.activeNode === "retake" || concept === "retake" ? "retake" : "read";
  if (st.activeNode === "react" && contactLane(s).contact) return "rotation";
  if (concept === "aggro_info") return "info";
  if (concept === "stack") return "read"; // stack = lectura aplicada (anti-strat)
  return "default";
}
