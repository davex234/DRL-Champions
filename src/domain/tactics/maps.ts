/**
 * MAPAS TÁCTICOS DE NEXUS (Fase 9I).
 *
 * Mapas **PROPIOS**. No son reproducciones de los de VALORANT ni de ningún otro juego: ni
 * su trazado, ni sus nombres, ni sus callejones. La Fase 9 lo prohíbe explícitamente
 * (§0.6: no copiar interfaces, assets, personajes, logos, artwork ni branding ajeno), y
 * un mapa es exactamente eso, artwork de otro.
 *
 * Lo que sí se reproduce es la GRAMÁTICA del género —dos bases, uno o dos sitios de
 * plantado, un centro que los conecta y cuellos de botella entre medias—, porque esa es
 * la estructura del juego táctico, no propiedad de nadie.
 *
 * FORMATO. Las coordenadas están normalizadas a una rejilla de 100×100. Así el mismo mapa
 * sirve para una pizarra de 320 px en un móvil y una de 900 px en un monitor sin recalcular
 * nada, y una posición guardada hace un año sigue significando el mismo punto.
 *
 * Este módulo es DATOS PUROS: sin React, sin red, sin estado. Lo consumen la pizarra y el
 * validador de estrategias.
 */

export type ZoneKind =
  /** Base de salida de un bando. */
  | "spawn"
  /** Sitio de plantado. */
  | "site"
  /** El centro: conecta los dos flancos. */
  | "mid"
  /** Pasillo o rotación. */
  | "corridor"
  /** Cuello de botella: el sitio donde se pelea. */
  | "choke";

export interface MapZone {
  id: string;
  label: string;
  kind: ZoneKind;
  /** Polígono en la rejilla 0..100. Al menos 3 vértices. */
  polygon: readonly (readonly [number, number])[];
}

export interface TacticalMap {
  id: string;
  name: string;
  /** Una línea que explica cómo se juega. Es lo primero que lee un entrenador. */
  identity: string;
  /** Número de sitios de plantado. */
  sites: number;
  zones: readonly MapZone[];
}

/** Bandos. Atacar es plantar; defender es impedirlo. */
export type Side = "attack" | "defense";

export const SIDE_LABEL: Record<Side, string> = {
  attack: "Ataque",
  defense: "Defensa",
};

/** Color por tipo de zona. Lo usa la pizarra; vive aquí para que no se reinvente. */
export const ZONE_COLOR: Record<ZoneKind, string> = {
  spawn: "#3f6ec0",
  site: "#ff2e63",
  mid: "#ffd35c",
  corridor: "#4a5468",
  choke: "#ff8a3d",
};

export const ZONE_LABEL: Record<ZoneKind, string> = {
  spawn: "Base",
  site: "Sitio",
  mid: "Centro",
  corridor: "Pasillo",
  choke: "Cuello",
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Los mapas
 *
 * Cuatro trazados con problemas tácticos distintos, no cuatro variaciones del mismo:
 *   · TERMINAL  — dos sitios simétricos y un centro corto. El mapa de referencia.
 *   · CANTERA   — un solo sitio, enorme. Todo el juego es el ataque a un embudo.
 *   · ORBITA    — dos sitios y DOS centros. Rotar es barato: castiga leer mal.
 *   · MERIDIANO — dos sitios muy separados, sin centro. Rotar cuesta: castiga fallar.
 * ──────────────────────────────────────────────────────────────────────────── */

const TERMINAL: TacticalMap = {
  id: "terminal",
  name: "Terminal",
  identity: "Dos sitios simétricos y un centro corto. Quien controla el centro elige el sitio.",
  sites: 2,
  zones: [
    { id: "atk-spawn", label: "Base de ataque", kind: "spawn",
      polygon: [[35, 88], [65, 88], [65, 100], [35, 100]] },
    { id: "def-spawn", label: "Base de defensa", kind: "spawn",
      polygon: [[35, 0], [65, 0], [65, 12], [35, 12]] },
    { id: "site-a", label: "Sitio A", kind: "site",
      polygon: [[6, 16], [34, 16], [34, 40], [6, 40]] },
    { id: "site-b", label: "Sitio B", kind: "site",
      polygon: [[66, 16], [94, 16], [94, 40], [66, 40]] },
    { id: "mid", label: "Centro", kind: "mid",
      polygon: [[40, 34], [60, 34], [60, 66], [40, 66]] },
    { id: "lane-a", label: "Calle A", kind: "corridor",
      polygon: [[8, 40], [26, 40], [26, 84], [8, 84]] },
    { id: "lane-b", label: "Calle B", kind: "corridor",
      polygon: [[74, 40], [92, 40], [92, 84], [74, 84]] },
    { id: "choke-a", label: "Boca A", kind: "choke",
      polygon: [[20, 38], [34, 38], [34, 48], [20, 48]] },
    { id: "choke-b", label: "Boca B", kind: "choke",
      polygon: [[66, 38], [80, 38], [80, 48], [66, 48]] },
    { id: "choke-mid", label: "Puerta central", kind: "choke",
      polygon: [[43, 28], [57, 28], [57, 36], [43, 36]] },
  ],
};

const CANTERA: TacticalMap = {
  id: "cantera",
  name: "Cantera",
  identity: "Un solo sitio, muy grande, con tres entradas. Atacar es coordinar; defender es aguantar.",
  sites: 1,
  zones: [
    { id: "atk-spawn", label: "Base de ataque", kind: "spawn",
      polygon: [[38, 90], [62, 90], [62, 100], [38, 100]] },
    { id: "def-spawn", label: "Base de defensa", kind: "spawn",
      polygon: [[42, 0], [58, 0], [58, 10], [42, 10]] },
    { id: "site", label: "El pozo", kind: "site",
      polygon: [[24, 14], [76, 14], [80, 44], [20, 44]] },
    { id: "ramp-left", label: "Rampa oeste", kind: "corridor",
      polygon: [[8, 34], [24, 34], [24, 86], [8, 86]] },
    { id: "ramp-right", label: "Rampa este", kind: "corridor",
      polygon: [[76, 34], [92, 34], [92, 86], [76, 86]] },
    { id: "tunnel", label: "Túnel", kind: "corridor",
      polygon: [[42, 50], [58, 50], [58, 88], [42, 88]] },
    { id: "choke-left", label: "Entrada oeste", kind: "choke",
      polygon: [[16, 40], [30, 40], [30, 50], [16, 50]] },
    { id: "choke-right", label: "Entrada este", kind: "choke",
      polygon: [[70, 40], [84, 40], [84, 50], [70, 50]] },
    { id: "choke-tunnel", label: "Salida del túnel", kind: "choke",
      polygon: [[43, 42], [57, 42], [57, 52], [43, 52]] },
  ],
};

const ORBITA: TacticalMap = {
  id: "orbita",
  name: "Órbita",
  identity: "Dos sitios y dos centros. Rotar es barato: leer mal al rival se paga rápido.",
  sites: 2,
  zones: [
    { id: "atk-spawn", label: "Base de ataque", kind: "spawn",
      polygon: [[36, 90], [64, 90], [64, 100], [36, 100]] },
    { id: "def-spawn", label: "Base de defensa", kind: "spawn",
      polygon: [[36, 0], [64, 0], [64, 10], [36, 10]] },
    { id: "site-a", label: "Sitio A", kind: "site",
      polygon: [[8, 14], [32, 14], [32, 36], [8, 36]] },
    { id: "site-b", label: "Sitio B", kind: "site",
      polygon: [[68, 14], [92, 14], [92, 36], [68, 36]] },
    { id: "mid-high", label: "Anillo alto", kind: "mid",
      polygon: [[34, 20], [66, 20], [66, 38], [34, 38]] },
    { id: "mid-low", label: "Anillo bajo", kind: "mid",
      polygon: [[34, 56], [66, 56], [66, 74], [34, 74]] },
    { id: "lane-a", label: "Órbita oeste", kind: "corridor",
      polygon: [[8, 38], [28, 38], [28, 86], [8, 86]] },
    { id: "lane-b", label: "Órbita este", kind: "corridor",
      polygon: [[72, 38], [92, 38], [92, 86], [72, 86]] },
    { id: "choke-a", label: "Compuerta A", kind: "choke",
      polygon: [[24, 34], [36, 34], [36, 44], [24, 44]] },
    { id: "choke-b", label: "Compuerta B", kind: "choke",
      polygon: [[64, 34], [76, 34], [76, 44], [64, 44]] },
    { id: "choke-link", label: "Enlace", kind: "choke",
      polygon: [[44, 40], [56, 40], [56, 54], [44, 54]] },
  ],
};

const MERIDIANO: TacticalMap = {
  id: "meridiano",
  name: "Meridiano",
  identity: "Dos sitios muy separados y sin centro que los una. Rotar cuesta: fallar la lectura se paga caro.",
  sites: 2,
  zones: [
    { id: "atk-spawn", label: "Base de ataque", kind: "spawn",
      polygon: [[40, 92], [60, 92], [60, 100], [40, 100]] },
    { id: "def-spawn", label: "Base de defensa", kind: "spawn",
      polygon: [[44, 0], [56, 0], [56, 8], [44, 8]] },
    { id: "site-a", label: "Sitio A", kind: "site",
      polygon: [[4, 18], [28, 18], [28, 42], [4, 42]] },
    { id: "site-b", label: "Sitio B", kind: "site",
      polygon: [[72, 18], [96, 18], [96, 42], [72, 42]] },
    { id: "rotate", label: "Vía de rotación", kind: "corridor",
      polygon: [[30, 8], [70, 8], [70, 18], [30, 18]] },
    { id: "lane-a", label: "Meridiano oeste", kind: "corridor",
      polygon: [[10, 42], [26, 42], [40, 88], [24, 88]] },
    { id: "lane-b", label: "Meridiano este", kind: "corridor",
      polygon: [[74, 42], [90, 42], [76, 88], [60, 88]] },
    { id: "choke-a", label: "Umbral A", kind: "choke",
      polygon: [[14, 40], [28, 40], [28, 50], [14, 50]] },
    { id: "choke-b", label: "Umbral B", kind: "choke",
      polygon: [[72, 40], [86, 40], [86, 50], [72, 50]] },
  ],
};

export const TACTICAL_MAPS: readonly TacticalMap[] = [TERMINAL, CANTERA, ORBITA, MERIDIANO];

export function getTacticalMap(id: string): TacticalMap | undefined {
  return TACTICAL_MAPS.find((m) => m.id === id);
}

/** Centroide de una zona. Sirve para colocar su etiqueta y para centrar un marcador. */
export function zoneCenter(zone: MapZone): { x: number; y: number } {
  const n = zone.polygon.length;
  let x = 0;
  let y = 0;
  for (const [px, py] of zone.polygon) {
    x += px;
    y += py;
  }
  return { x: x / n, y: y / n };
}

/**
 * ¿El punto cae dentro de la zona? Algoritmo del rayo (par/impar), que funciona con
 * polígonos cóncavos —los pasillos de Meridiano lo son— y no necesita ninguna librería.
 */
export function zoneContains(zone: MapZone, x: number, y: number): boolean {
  const p = zone.polygon;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** La zona que contiene un punto, o `null` si cae en terreno sin nombre. */
export function zoneAt(map: TacticalMap, x: number, y: number): MapZone | null {
  // Se recorre al revés: las zonas pequeñas (cuellos) se declaran después de las
  // grandes y deben ganar cuando se solapan.
  for (let i = map.zones.length - 1; i >= 0; i--) {
    if (zoneContains(map.zones[i], x, y)) return map.zones[i];
  }
  return null;
}
