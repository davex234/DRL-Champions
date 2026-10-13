/**
 * MAPAS TÁCTICOS DE NEXUS.
 *
 * ────────────────────────── QUÉ SON ESTOS MAPAS (actualizado 2026-09-03) ──────────────────────────
 *
 * Los doce mapas del Entrenador son **assets de mapa adaptados para NEXUS**: imágenes PNG
 * que se usan como capa visual base de la herramienta de estrategias. Se emplean tal cual,
 * sin recortar, escalar, convertir ni redibujar.
 *
 * Este módulo NO afirma nada sobre su titularidad ni sobre licencia alguna: no consta
 * verificada ninguna, y no se inventa. Lo único que se declara aquí es el uso: son los
 * assets visuales de la pizarra.
 *
 * ────────────────────────── QUÉ DECÍA ANTES ──────────────────────────
 *
 * Hasta esta fecha este fichero afirmaba: «Mapas PROPIOS. No son reproducciones de los de
 * VALORANT ni de ningún otro juego: ni su trazado, ni sus nombres, ni sus callejones», y
 * el catálogo contenía cuatro trazados inventados —`terminal`, `cantera`, `orbita` y
 * `meridiano`— dibujados como polígonos.
 *
 * **El 2026-09-03 el responsable del producto sustituye ese catálogo** por los doce assets
 * finales, que pasan a ser los mapas oficiales del Entrenador. Los cuatro trazados
 * anteriores se retiran. Se deja constancia aquí, en vez de borrar el párrafo, para que el
 * cambio sea rastreable y no parezca un descuido de alguien que no leyó la regla.
 *
 * ────────────────────────── COORDENADAS ──────────────────────────
 *
 * Las posiciones tácticas siguen NORMALIZADAS a 0..100 en los dos ejes, como siempre. Lo
 * que cambia es que **cada mapa tiene su tamaño real**, y la pizarra convierte esa rejilla
 * a los píxeles del PNG al pintar. Así una estrategia guardada significa el mismo punto
 * aunque el mapa mida 1204×1306 o 1323×1189, y **ningún mapa se estira para llenar un
 * cuadrado**: no existe un `viewBox="0 0 100 100"` universal.
 *
 * ────────────────────────── GEOMETRÍA ──────────────────────────
 *
 * De estos PNG no se deduce geometría. No hay paredes reconstruidas, ni habitaciones
 * detectadas, ni sitios redibujados: los rótulos A/B/C forman parte del asset. `width`,
 * `height` y `frame` son MEDIDAS del fichero —cabecera IHDR y recuadro del dibujo dentro
 * del lienzo—, no dibujo nuevo. `sites` está verificado mirando cada asset uno por uno.
 *
 * Este módulo es DATOS PUROS: sin React, sin red, sin estado.
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

/**
 * Recuadro que ocupa el DIBUJO dentro del lienzo del PNG, en píxeles del propio fichero.
 *
 * Los assets traen margen oscuro alrededor —entre un 6 % y un 19 % del lienzo—, así que
 * encuadrar por el borde del fichero desperdicia pantalla. Esto es una MEDIDA del PNG
 * (recuadro de los píxeles que difieren del color de fondo), no un recorte: el fichero se
 * pinta entero y esto solo dice dónde apuntar la cámara al abrir.
 */
export interface MapFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TacticalMap {
  id: string;
  /** Nombre visible. Es un nombre propio: no se traduce, igual que el de un equipo. */
  name: string;
  /** Ruta del asset bajo `/maps`. La construye `mapImageSrc`, nunca un componente. */
  asset: string;
  /** Anchura real del PNG, en píxeles. */
  width: number;
  /** Altura real del PNG, en píxeles. */
  height: number;
  /** Encuadre inicial de la cámara. Medido, no inventado. */
  frame: MapFrame;
  /** Sitios de plantado, contados sobre el propio asset. */
  sites: number;
  /** Una línea para el entrenador. */
  identity: string;
  /** Un mapa no disponible no se ofrece en el selector, pero su id sigue siendo válido. */
  available: boolean;
  /**
   * Zonas tácticas. **Opcional a propósito**: los assets no traen esa geometría y deducirla
   * sería redibujar el mapa. Si algún día se quieren zonas interactivas se definirán mapa a
   * mapa como dato independiente; hasta entonces, la pizarra funciona sin ellas.
   */
  zones?: readonly MapZone[];
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
 * El catálogo
 *
 * `width`/`height` salen de la cabecera IHDR de cada PNG. `frame` es el recuadro del
 * dibujo dentro del lienzo, medido comparando cada píxel con el color de la esquina.
 * `sites` está verificado mirando los doce assets: dos en todos salvo Haven y Lotus.
 *
 * El orden es alfabético. Es el único orden que no obliga a justificar por qué un mapa
 * está antes que otro.
 * ────────────────────────────────────────────────────────────────────────── */

const map = (
  id: string,
  name: string,
  width: number,
  height: number,
  frame: MapFrame,
  sites: number,
): TacticalMap => ({
  id,
  name,
  asset: `${id}.png`,
  width,
  height,
  frame,
  sites,
  identity: sites === 3
    ? "Tres sitios de plantado (A, B y C)."
    : "Dos sitios de plantado (A y B).",
  available: true,
});

export const TACTICAL_MAPS: readonly TacticalMap[] = [
  map("abyss",    "Abyss",    1300, 1210, { x: 54, y: 26, width: 1141, height: 1115 }, 2),
  map("ascent",   "Ascent",   1227, 1281, { x: 24, y: 17, width: 1168, height: 1235 }, 2),
  map("bind",     "Bind",     1254, 1254, { x: 53, y: 12, width: 1162, height: 1218 }, 2),
  map("breeze",   "Breeze",   1272, 1236, { x: 36, y: 16, width: 1209, height: 1181 }, 2),
  map("corrode",  "Corrode",  1204, 1306, { x: 38, y:  8, width: 1127, height: 1271 }, 2),
  map("fracture", "Fracture", 1268, 1240, { x:  0, y: 26, width: 1249, height: 1186 }, 2),
  map("haven",    "Haven",    1216, 1293, { x: 29, y: 12, width: 1128, height: 1267 }, 3),
  map("icebox",   "Icebox",   1206, 1304, { x: 53, y: 17, width: 1046, height: 1217 }, 2),
  map("lotus",    "Lotus",    1323, 1189, { x: 12, y: 39, width: 1269, height: 1123 }, 3),
  map("pearl",    "Pearl",    1306, 1204, { x: 57, y: 24, width: 1210, height: 1129 }, 2),
  map("split",    "Split",    1296, 1213, { x: 35, y: 27, width: 1224, height: 1142 }, 2),
  map("sunset",   "Sunset",   1236, 1272, { x: 32, y: 15, width: 1159, height: 1224 }, 2),
];

/** El mapa por defecto al abrir la pizarra sin nada elegido. */
export const DEFAULT_MAP_ID = "ascent";

export function getTacticalMap(id: string): TacticalMap | undefined {
  return TACTICAL_MAPS.find((m) => m.id === id);
}

/** Los que se ofrecen en el selector. Un mapa retirado conserva su id, pero no se elige. */
export function availableMaps(): readonly TacticalMap[] {
  return TACTICAL_MAPS.filter((m) => m.available);
}

/** Proporción real del asset. Es lo que impide estirar un mapa para llenar un cuadrado. */
export const aspectRatio = (m: TacticalMap): number => m.width / m.height;

/**
 * Convierte la rejilla normalizada 0..100 a los PÍXELES del PNG.
 *
 * Es la única traducción entre el modelo y el dibujo, y está aquí —no en la pizarra— para
 * que el editor, la miniatura y el modo presentación coincidan siempre.
 */
export const toPixels = (m: TacticalMap, x: number, y: number): { px: number; py: number } => ({
  px: (x / 100) * m.width,
  py: (y / 100) * m.height,
});

/** La vuelta: de píxeles del PNG a la rejilla 0..100 que se guarda. */
export const toGrid = (m: TacticalMap, px: number, py: number): { x: number; y: number } => ({
  x: (px / m.width) * 100,
  y: (py / m.height) * 100,
});

/* ─────────────────────────── Utilidades de zona ───────────────────────────
 * Se conservan enteras: siguen siendo correctas y las usará quien defina zonas para un
 * mapa concreto. Con `zones` sin definir, `zoneAt` devuelve `null`, que es la respuesta
 * honesta a «¿en qué zona está este punto?» cuando no hay zonas.
 * ────────────────────────────────────────────────────────────────────────── */

export function zoneCenter(zone: MapZone): { x: number; y: number } {
  const n = zone.polygon.length;
  const sx = zone.polygon.reduce((s, p) => s + p[0], 0);
  const sy = zone.polygon.reduce((s, p) => s + p[1], 0);
  return { x: sx / n, y: sy / n };
}

/** ¿Cae el punto dentro del polígono? Lanzado de rayo, el de toda la vida. */
export function zoneContains(zone: MapZone, x: number, y: number): boolean {
  let inside = false;
  const poly = zone.polygon;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Zona bajo un punto, o `null`. Un mapa sin zonas definidas devuelve siempre `null`. */
export function zoneAt(mapDef: TacticalMap, x: number, y: number): MapZone | null {
  for (const z of mapDef.zones ?? []) {
    if (zoneContains(z, x, y)) return z;
  }
  return null;
}
