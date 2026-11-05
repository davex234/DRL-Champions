/**
 * FASE 51.2 · TACTICAL NAVIGATION GRAPH — tipos.
 *
 * Un grafo LIGERO por mapa: los NODOS son estados tácticos (las zonas que usa el simulador) y las
 * ARISTAS son desplazamientos físicamente posibles sobre el asset real. La trayectoria visual de una
 * arista son sus WAYPOINTS: geometría (rodear una pared, seguir un pasillo), no decisiones.
 *
 * Coordenadas NORMALIZADAS 0..1 sobre el asset completo (x = columna / ancho, y = fila / alto), las
 * mismas que la pizarra guarda en 0..100. Nada de píxeles ni de CSS.
 */
import type { ZoneId } from "@/sim/map/ascentA";

export type NavPoint = readonly [number, number];

export interface NavNode {
  /** Identificador estable. Para los nodos tácticos coincide con la zona del simulador. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Zona táctica del simulador que representa (si representa alguna). */
  readonly zone?: ZoneId;
}

export interface NavEdge {
  readonly from: string;
  readonly to: string;
  /** Puntos intermedios de la trayectoria `from → to` (sin los extremos). Vacío = tramo recto VALIDADO. */
  readonly waypoints: readonly NavPoint[];
  /** Coste de recorrerla: longitud de la trayectoria en píxeles del asset / 1000. */
  readonly cost: number;
  /**
   * Holgura lateral segura (normalizada, respecto al lado menor del asset): cuánto puede separarse una
   * ficha de la trayectoria sin salir del suelo en NINGÚN punto de la arista. Medida en el asset.
   */
  readonly halfWidth?: number;
  /** Por defecto las aristas son de doble sentido. */
  readonly oneWay?: boolean;
}

export interface MapNavigationGraph {
  readonly mapId: string;
  /** Tamaño del asset del que se derivó (para validar que sigue siendo el mismo). */
  readonly asset: { readonly width: number; readonly height: number };
  readonly nodes: readonly NavNode[];
  readonly edges: readonly NavEdge[];
}

export type NavPathResult =
  | { readonly ok: true; readonly nodes: readonly string[]; readonly points: readonly NavPoint[]; readonly cost: number }
  | { readonly ok: false; readonly reason: "UNKNOWN_MAP" | "UNKNOWN_NODE" | "NO_ROUTE" };
