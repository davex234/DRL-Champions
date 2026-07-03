/**
 * DRL VISUALIZER — Render API (representación intermedia, PURA).
 *
 * El `RenderFrame` es una descripción de la escena INDEPENDIENTE del backend
 * gráfico: cualquier renderizador (SVG hoy; Canvas/Pixi/Three/WebGPU mañana) debe
 * poder dibujarlo sin tocar la simulación. La simulación JAMÁS conoce el render:
 * un `scene builder` traduce (estado + viewport + broadcast) → `RenderFrame`.
 *
 * No contiene modelos ni assets: solo QUÉ existe, DÓNDE, en QUÉ estado y con QUÉ
 * efectos. Cómo se ve (color, malla, sprite) lo decide cada backend.
 */

export interface Vec2 { x: number; y: number }

/** Tipos de entidad de la escena (modelos a definir por backend en el futuro). */
export type EntityType = "player" | "spike" | "weapon" | "bullet" | "utility";

export type Team = "ATK" | "DEF";

/** Estado lógico de una entidad (semántico, no visual). */
export type EntityState =
  | "alive" | "dead" | "planted" | "defusing" | "active" | "idle" | "flying";

/** Visibilidad para el render (no es la visión del jugador). */
export type Visibility = "visible" | "faded" | "hidden";

export interface RenderTransform {
  position: Vec2;
  rotation: number; // radianes
  scale: number;
}

/** Estado de animación (preparado; sin modelos todavía). */
export interface RenderAnimation {
  name: string;
  /** Progreso 0..1 o tiempo normalizado. */
  t: number;
}

/** Efecto visual (por-entidad o de escena). Genérico para cualquier backend. */
export type EffectKind =
  | "flash" | "focus" | "coached" | "lowhp"        // por-entidad
  | "engagement" | "tracer" | "plant" | "defuse" | "explosion" | "smoke"; // de escena

export interface RenderEffect {
  kind: EffectKind;
  /** Punto de origen (tracer/engagement) o posición del efecto. */
  from?: Vec2;
  to?: Vec2;
  at?: Vec2;
  /** Progreso 0..1 (anillos de plant/defuse, etc.). */
  progress?: number;
  intensity?: number;
}

export interface RenderEntity {
  id: string;
  type: EntityType;
  /** Bando (jugadores/spike). */
  team?: Team;
  /** Rol (jugadores) — pista semántica, no visual. */
  role?: string;
  /** Etiqueta legible (nombre del jugador, etc.). */
  label?: string;
  transform: RenderTransform;
  state: EntityState;
  animation: RenderAnimation | null;
  effects: RenderEffect[];
  visibility: Visibility;
}

/** Cámara de la escena (semántica + viewBox ya calculado para 2D). */
export interface RenderCamera {
  center: Vec2;
  zoom: number;
  rotation: number;
  /** Rectángulo visible (coords de mundo). El backend 2D lo usa como viewBox. */
  viewBox: { x: number; y: number; w: number; h: number };
}

/** Geometría estática del mapa (no cambia durante la ronda). */
export interface RenderWorld {
  bounds: { w: number; h: number };
  walls: { a: Vec2; b: Vec2 }[];
  zones: { id: string; label: string; position: Vec2 }[];
  plant: { position: Vec2; radius: number };
}

/** Anclaje de UI en coordenadas de MUNDO (marcadores, callouts). Preparado. */
export interface UIAnchor {
  id: string;
  kind: string;
  position: Vec2;
  label?: string;
}

/** Un fotograma completo, listo para que CUALQUIER backend lo dibuje. */
export interface RenderFrame {
  tick: number;
  camera: RenderCamera;
  world: RenderWorld;
  entities: RenderEntity[];
  effects: RenderEffect[];
  uiAnchors: UIAnchor[];
}
