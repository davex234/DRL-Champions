/**
 * DRL CAMERA — motor de cámara (updateCamera).
 *
 * Convierte una DirectorDecision en el SIGUIENTE viewport, de forma cinematográfica
 * y estable. No decide nada (eso es el Director), no renderiza, no modifica el sim
 * ni el Director. Función PURA: toda la memoria va dentro del viewport.
 *
 * Reglas: seguimiento con anticipación + "aire" por delante, zoom adaptativo por
 * situación, muelle crítico (sin saltos), límite de velocidad (anti-teleport),
 * centro siempre dentro del campo y zoom siempre dentro de [ZOOM.min, ZOOM.max].
 */
import { FIELD, ZONES, type RoundState } from "../sim";
import type { DirectorDecision } from "../spectator";
import {
  CAMERA_PROFILES, BASE_SPAN, fromDirectorCamera, type CameraKind, type CameraProfile,
} from "./profiles";
import {
  type Viewport, type Vec2, type CameraState,
  ZOOM, MAX_SPEED, MAX_ZOOM_SPEED, springStep, vadd, vdist, vlen, lerp, clampN, clampVec,
} from "./viewport";

export interface CameraInput {
  decision: DirectorDecision;
  state: RoundState;
  dt: number; // segundos
}

const MAX_FOCUS_VEL = 400; // u/s — tope para la estimación de velocidad del foco
const FOCUS_SMOOTH = 0.3;  // suavizado de la velocidad estimada del foco
const FIT_MARGIN = 1.9;    // holgura para encuadrar dos puntos en un duelo (P-1D: más aire)
const THREAT_RANGE = 430;  // P-1D: amenaza cercana que la cámara tiene en cuenta
const THREAT_BIAS = 0.32;  // P-1D: cuánto se desplaza el encuadre hacia la amenaza

const clampToField = (p: Vec2): Vec2 => ({
  x: clampN(p.x, 0, FIELD.w),
  y: clampN(p.y, 0, FIELD.h),
});

/**
 * Resuelve el foco: su posición, el rival de duelo confirmado (`partner`) y la
 * amenaza cercana (`threat`, enemigo más próximo dentro de rango aunque aún no
 * haya duelo). El centrado se sesga hacia la amenaza para que el kill quede en cuadro.
 */
function resolveFocus(decision: DirectorDecision, state: RoundState): { pos: Vec2 | null; partner: Vec2 | null; threat: Vec2 | null } {
  if (decision.focusPlayerId) {
    const p = state.players.find((q) => q.id === decision.focusPlayerId);
    if (p) {
      let partner: Vec2 | null = null;
      let threat: Vec2 | null = null;
      let td = Infinity;
      for (const e of state.players) {
        if (e.side === p.side || !e.alive) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
        if (e.id === p.targetEnemyId) partner = { x: e.pos.x, y: e.pos.y };
        if (d < td) { td = d; threat = { x: e.pos.x, y: e.pos.y }; }
      }
      if (threat && td > THREAT_RANGE) threat = null;
      return { pos: { x: p.pos.x, y: p.pos.y }, partner, threat };
    }
  }
  if (decision.focusZone) {
    const z = ZONES[decision.focusZone];
    return { pos: { x: z.x, y: z.y }, partner: null, threat: null };
  }
  return { pos: null, partner: null, threat: null };
}

/** Zoom deseado: nivel del perfil, y si procede ajustado para encuadrar el duelo. */
function desiredZoom(profile: CameraProfile, focus: Vec2 | null, partner: Vec2 | null): number {
  let z = profile.baseZoom;
  if (profile.fitDuel && focus && partner) {
    const d = vdist(focus, partner);
    const fit = BASE_SPAN / (d * FIT_MARGIN + 1); // más separados → más abierto
    z = Math.min(profile.baseZoom, fit);          // garantiza que ambos caben
  }
  return clampN(z, ZOOM.min, ZOOM.max);
}

function deriveState(toTarget: number, speed: number, hasMovingFocus: boolean): CameraState {
  if (toTarget > 60) return "transition";
  if (speed > 14) return "settling";
  if (hasMovingFocus && toTarget > 6) return "following";
  return "idle";
}

/**
 * Calcula el siguiente viewport. Devuelve SIEMPRE un objeto nuevo (no muta la
 * entrada). Garantiza centro dentro del campo, zoom en rango y sin teleports.
 */
export function updateCamera(vp: Viewport, input: CameraInput): Viewport {
  const { decision, state } = input;
  const dt = clampN(input.dt, 1 / 1000, 0.1); // estabilidad ante dt extremos
  const kind: CameraKind = fromDirectorCamera(decision.camera);
  const profile = CAMERA_PROFILES[kind] ?? CAMERA_PROFILES.observer;

  const { pos: focusPos, partner, threat } = resolveFocus(decision, state);
  const other = partner ?? threat; // punto secundario para encuadre/zoom

  // Estimación de velocidad del foco → anticipación ("aire" por delante).
  let focusVel: Vec2 = { x: 0, y: 0 };
  let lead: Vec2 = { x: 0, y: 0 };
  const sameFocus = vp.lastFocusId != null && vp.lastFocusId === decision.focusPlayerId;
  if (focusPos && sameFocus && vp.lastFocusPos) {
    const inst: Vec2 = { x: (focusPos.x - vp.lastFocusPos.x) / dt, y: (focusPos.y - vp.lastFocusPos.y) / dt };
    focusVel = clampVec(
      { x: lerp(vp.focusVel.x, inst.x, FOCUS_SMOOTH), y: lerp(vp.focusVel.y, inst.y, FOCUS_SMOOTH) },
      MAX_FOCUS_VEL,
    );
    if (profile.followsPlayer) lead = { x: focusVel.x * profile.leadTime, y: focusVel.y * profile.leadTime };
  }

  // Centro objetivo: punto medio del duelo confirmado; si no, sesgo hacia la
  // amenaza cercana (mantiene al jugador en cuadro y trae el kill al centro);
  // si no hay nada, el foco o el centro del mapa.
  let base: Vec2;
  if (!focusPos) {
    base = { x: FIELD.w / 2, y: FIELD.h / 2 };
  } else if (partner && profile.fitDuel) {
    base = { x: (focusPos.x + partner.x) / 2, y: (focusPos.y + partner.y) / 2 };
  } else if (threat && profile.followsPlayer) {
    base = { x: lerp(focusPos.x, threat.x, THREAT_BIAS), y: lerp(focusPos.y, threat.y, THREAT_BIAS) };
  } else {
    base = focusPos;
  }
  const target = clampToField(vadd(base, lead));
  const targetZoom = desiredZoom(profile, focusPos, other);

  // Muelle crítico hacia el objetivo (centro y zoom).
  const sx = springStep(vp.center.x, vp.velocity.x, target.x, dt, profile.centerOmega);
  const sy = springStep(vp.center.y, vp.velocity.y, target.y, dt, profile.centerOmega);
  const sz = springStep(vp.zoom, vp.zoomVelocity, targetZoom, dt, profile.zoomOmega);

  let next: Vec2 = { x: sx.x, y: sy.x };
  let vel: Vec2 = { x: sx.v, y: sy.v };

  // Anti-teleport: limita el desplazamiento por paso a MAX_SPEED·dt.
  const stepLen = vdist(next, vp.center);
  const maxStep = MAX_SPEED * dt;
  if (stepLen > maxStep) {
    const k = maxStep / stepLen;
    next = { x: vp.center.x + (next.x - vp.center.x) * k, y: vp.center.y + (next.y - vp.center.y) * k };
    vel = clampVec(vel, MAX_SPEED);
  }
  next = clampToField(next);

  // Zoom: límite de velocidad + rango.
  let nextZoom = sz.x;
  const zStep = nextZoom - vp.zoom;
  const maxZStep = MAX_ZOOM_SPEED * dt;
  if (Math.abs(zStep) > maxZStep) nextZoom = vp.zoom + Math.sign(zStep) * maxZStep;
  nextZoom = clampN(nextZoom, ZOOM.min, ZOOM.max);

  const acceleration: Vec2 = { x: (vel.x - vp.velocity.x) / dt, y: (vel.y - vp.velocity.y) / dt };
  const speed = vlen(vel);
  const toTarget = vdist(next, target);
  const hasMovingFocus = focusPos != null && vlen(focusVel) > 8;
  const camState = deriveState(toTarget, speed, hasMovingFocus);

  // Transición: se activa con un salto grande de objetivo; se cierra al llegar.
  const jump = vdist(target, vp.target);
  let transition = vp.transition;
  if (jump > 80) {
    transition = { active: true, elapsed: 0, duration: clampN(toTarget / MAX_SPEED, 0.2, 2) };
  } else if (transition.active) {
    transition = toTarget < 8 ? { active: false, elapsed: 0, duration: 0 } : { ...transition, elapsed: transition.elapsed + dt };
  }

  return {
    center: next,
    zoom: nextZoom,
    rotation: vp.rotation, // preparada; sin uso en P-1B
    velocity: vel,
    zoomVelocity: clampN(sz.v, -MAX_ZOOM_SPEED, MAX_ZOOM_SPEED),
    acceleration,
    target,
    targetZoom,
    state: camState,
    transition,
    cameraType: kind,
    lastFocusId: decision.focusPlayerId,
    lastFocusPos: focusPos,
    focusVel,
  };
}
