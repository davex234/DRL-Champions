/**
 * DRL VISUALIZER — scene builder (PURO).
 *
 * Traduce el estado de juego en un `RenderFrame` agnóstico del backend. Es el
 * ÚNICO punto que conoce a la vez la simulación y la Render API. No muta el
 * estado y no contiene lógica de juego: solo describe la escena a dibujar.
 */
import { ZONES, WALLS, PLANT_ZONE, PLANT_RADIUS, FIELD, type RoundState, type ZoneId } from "../sim";
import { toViewBox } from "../render";
import type { Viewport } from "../camera";
import type { BroadcastState } from "../broadcast";
import type { RenderFrame, RenderEntity, RenderEffect, Team } from "./types";

export interface SceneInput {
  state: RoundState;
  viewport: Viewport;
  broadcast?: BroadcastState | null;
}

export function buildRenderFrame({ state, viewport, broadcast }: SceneInput): RenderFrame {
  const focusId = broadcast?.observer.focusPlayerId ?? null;
  const coachSide = state.coachSide;
  const entities: RenderEntity[] = [];
  const effects: RenderEffect[] = [];

  for (const p of state.players) {
    const fx: RenderEffect[] = [];
    if (p.alive && p.flashedUntil > state.tick) fx.push({ kind: "flash" });
    if (p.id === focusId) fx.push({ kind: "focus" });
    if (p.side === coachSide) fx.push({ kind: "coached" });

    entities.push({
      id: p.id, type: "player", team: p.side as Team, role: p.role, label: p.name,
      transform: { position: { x: p.pos.x, y: p.pos.y }, rotation: p.facing, scale: 1 },
      state: p.alive ? "alive" : "dead",
      animation: null,
      effects: fx,
      visibility: p.alive ? "visible" : "faded",
    });

    // Duelo en curso → efecto de escena (línea de enfrentamiento).
    if (p.alive && p.targetEnemyId) {
      const e = state.players.find((q) => q.id === p.targetEnemyId && q.alive);
      if (e) effects.push({ kind: "engagement", from: { x: p.pos.x, y: p.pos.y }, to: { x: e.pos.x, y: e.pos.y } });
    }
  }

  // Spike (entidad) + anillos de progreso (efectos).
  if (state.spike.planted && state.spike.pos) {
    entities.push({
      id: "spike", type: "spike",
      transform: { position: { x: state.spike.pos.x, y: state.spike.pos.y }, rotation: 0, scale: 1 },
      state: state.spike.defuseProgress > 0 ? "defusing" : "planted",
      animation: null, effects: [], visibility: "visible",
    });
    if (state.spike.defuseProgress > 0) {
      effects.push({ kind: "defuse", at: { x: state.spike.pos.x, y: state.spike.pos.y }, progress: state.spike.defuseProgress });
    }
  } else if (state.spike.plantProgress > 0) {
    effects.push({ kind: "plant", at: { x: PLANT_ZONE.x, y: PLANT_ZONE.y }, progress: state.spike.plantProgress });
  }

  const vb = toViewBox(viewport);

  return {
    tick: state.tick,
    camera: {
      center: { x: viewport.center.x, y: viewport.center.y },
      zoom: viewport.zoom, rotation: viewport.rotation, viewBox: vb,
    },
    world: {
      bounds: { w: FIELD.w, h: FIELD.h },
      walls: WALLS.map((w) => ({ a: { x: w.a.x, y: w.a.y }, b: { x: w.b.x, y: w.b.y } })),
      zones: (Object.keys(ZONES) as ZoneId[]).map((id) => ({
        id, label: id.replace(/_/g, " "), position: { x: ZONES[id].x, y: ZONES[id].y },
      })),
      plant: { position: { x: PLANT_ZONE.x, y: PLANT_ZONE.y }, radius: PLANT_RADIUS },
    },
    entities,
    effects,
    uiAnchors: [], // preparado para callouts/marcadores en coords de mundo
  };
}
