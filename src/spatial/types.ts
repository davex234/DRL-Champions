/**
 * SPATIAL SIMULATION ENGINE — Tipos (map-agnósticos).
 *
 * Un mapa no es un dibujo: es un SISTEMA TÁCTICO. Este módulo modela el lenguaje
 * espacial (líneas de visión, ángulos, crossfires, control, cobertura, rutas,
 * peligro, ruido/info) sobre un `MapDescriptor` genérico, sin conocer el juego ni un
 * mapa concreto. Reutilizable en cualquier mapa: solo cambia el descriptor/adaptador.
 *
 * IMPORTANTE: aún NO hay habilidades reales de Valorant. Esto es el LENGUAJE espacial;
 * las habilidades (smokes/flashes/mollies/recon) llegarán y solo usarán esta capa.
 */
import type { Vec2, Segment } from "../sim/geometry";

export type Side = "ATK" | "DEF";

/** Descripción declarativa de una zona del mapa. */
export interface ZoneDesc {
  id: string;
  pos: Vec2;
  /** Radio aproximado de la zona (para muestrear líneas de visión). */
  radius?: number;
  /** Etiquetas: "site","plant","spawn:ATK","spawn:DEF","choke","mid","back","connector". */
  tags?: string[];
}

/** Entrada del Spatial Engine: el mapa como datos puros. */
export interface MapDescriptor {
  field: { w: number; h: number };
  zones: ZoneDesc[];
  walls: Segment[];
  /** Adyacencia transitable (movimiento). */
  links: [string, string][];
}

/** Mapa espacial PRECOMPUTADO (se construye una vez por mapa). */
export interface SpatialMap {
  desc: MapDescriptor;
  ids: string[];
  index: Record<string, number>;
  /** Fuerza de visión zona→zona en [0,1] (fracción de líneas muestreadas despejadas). */
  sight: number[][];
  /** Distancia entre centros. */
  dist: number[][];
  /** Rumbo (radianes) de A hacia B. */
  bearing: number[][];
  /** Cobertura por zona (0..1): cuántos muros/ángulos hay cerca. */
  cover: number[];
  /** Zonas cuello de botella (betweenness alto o etiquetadas "choke"). */
  chokes: string[];
  /** Crossfires por zona de aproximación: pares de zonas que la baten desde ángulos distintos. */
  crossfires: Record<string, [string, string][]>;
  /** Adyacencia como conjunto por zona (para rutas). */
  adj: Record<string, string[]>;
  /** Rango máximo de visión usado al construir. */
  maxRange: number;
}

/** Ocupación: qué zonas tiene presencia cada bando. */
export type Occupancy = Record<Side, string[]>;

/** Estado de control del mapa (derivado de la ocupación + visión). */
export interface ControlState {
  /** Bando que controla cada zona (o null = disputada/neutral). */
  owner: Record<string, Side | null>;
  /** Puntuación de control por zona y bando. */
  score: Record<string, { ATK: number; DEF: number }>;
  /** Espacio (nº de zonas) controlado por bando. */
  space: Record<Side, number>;
  /** Zonas peligrosas para cada bando (batidas por visión enemiga). */
  danger: Record<Side, string[]>;
  /** Zonas valiosas SIN dueño (espacio a tomar). */
  open: string[];
}

// ---- Lenguaje de UTILIDAD (infraestructura; sin mecánicas reales todavía) ----
export type UtilityKind = "smoke" | "flash" | "molly" | "recon" | "cover";

export interface UtilityEffect {
  kind: UtilityKind;
  /** Smoke: corta esta línea de visión (par de zonas, ambos sentidos). */
  sightline?: [string, string];
  /** Molly/recon/cover: afecta a esta zona. */
  zone?: string;
  /** Tick hasta el que dura (opcional). */
  untilTick?: number;
  side?: Side;
}

/** Superposición dinámica que modifican las utilidades activas. */
export interface SpatialOverlay {
  /** Claves "a|b" de líneas de visión bloqueadas (smoke). */
  blockedSight: Set<string>;
  /** Zonas denegadas (molly): peligrosas/intransitable temporalmente. */
  deniedZones: Set<string>;
  /** Zonas reveladas (recon): info garantizada. */
  revealedZones: Set<string>;
}
