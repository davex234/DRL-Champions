/**
 * RANGOS COMPETITIVOS.
 *
 * Sistema PROPIO, no una copia del de Riot: nombres reconocibles para el público de
 * VALORANT pero umbrales, divisiones y cúspide nuestros. Es una función PURA de los
 * puntos competitivos (`profiles.points`), que solo escribe el servidor al corregir
 * Pick'ems. El usuario nunca escribe su rango: se deriva.
 *
 * La Fase 9D lo amplía sin romperlo. Tres cosas cambian:
 *
 *  1. **SIN CLASIFICAR.** Antes, alguien con 0 puntos ya era «Bronce». Un rango que se
 *     tiene por existir no dice nada; ahora hay que puntuar al menos una vez para entrar
 *     en la escalera, y hasta entonces el estado es explícito.
 *  2. **Divisiones.** Cada rango medio se divide en tres. Entre Bronce y Plata había
 *     150 puntos sin ninguna señal de avance; con divisiones hay un ascenso cada ~50.
 *  3. **Cúspide.** Por encima de Élite están NEXUS y, dentro de NEXUS, CHAMPION, que no
 *     es un umbral sino una POSICIÓN: lo ocupa quien va primero. Solo puede haber uno.
 *
 * Añadir o retocar un rango = tocar `RANKS`. Nada más depende de los umbrales.
 */

export type RankTierId =
  | "unranked" | "bronce" | "plata" | "oro" | "platino"
  | "diamante" | "maestro" | "elite" | "nexus";

export interface RankTier {
  id: RankTierId;
  label: string;
  /** Puntos mínimos para entrar en el rango. */
  min: number;
  /** Número de divisiones internas. 0 = el rango no se divide. */
  divisions: number;
  /** Color de acento (se usa en la UI). */
  color: string;
}

/**
 * Escalera de rangos, de menor a mayor. El primero debe empezar en 0.
 *
 * Los saltos crecen: subir de Bronce a Plata cuesta 150 puntos y de Élite a NEXUS
 * cuesta 1400. Una escalera de tramos iguales hace que la parte alta se alcance
 * demasiado pronto y deje de significar nada.
 */
export const RANKS: RankTier[] = [
  { id: "unranked", label: "Sin clasificar", min: 0,    divisions: 0, color: "#5b6472" },
  { id: "bronce",   label: "Bronce",         min: 1,    divisions: 3, color: "#a16a3c" },
  { id: "plata",    label: "Plata",          min: 150,  divisions: 3, color: "#a8b3c0" },
  { id: "oro",      label: "Oro",            min: 400,  divisions: 3, color: "#e2b13c" },
  { id: "platino",  label: "Platino",        min: 750,  divisions: 3, color: "#3fb9c4" },
  { id: "diamante", label: "Diamante",       min: 1200, divisions: 3, color: "#8a6fe8" },
  { id: "maestro",  label: "Maestro",        min: 1800, divisions: 3, color: "#c8354f" },
  { id: "elite",    label: "Élite",          min: 2600, divisions: 3, color: "#ff8a3d" },
  { id: "nexus",    label: "Nexus",          min: 4000, divisions: 0, color: "#f5e6a8" },
];

/**
 * Sentido de la numeración de las divisiones.
 *
 * DECISIÓN DE PRODUCTO (Fase 9D): la I es la de ENTRADA y la III la más alta, igual que
 * en VALORANT (Hierro 1 → Hierro 3), que es el juego del que viene el público. La
 * convención española con números romanos es la contraria (División I = la mejor), así
 * que esto era ambiguo y se deja escrito. Invertirlo es cambiar esta constante y nada más.
 */
export const DIVISION_I_IS_ENTRY = true;

/** Cúspide posicional: no se alcanza por puntos, se ocupa por ser el primero. */
export const CHAMPION_LABEL = "Champion";
export const CHAMPION_COLOR = "#ffd35c";

export interface RankProgress {
  tier: RankTier;
  /** División dentro del rango (1..tier.divisions). 0 si el rango no se divide. */
  division: number;
  /** Etiqueta completa lista para enseñar: «Oro II», «Nexus», «Sin clasificar». */
  label: string;
  /** Siguiente rango, o null si ya está en el más alto. */
  next: RankTier | null;
  points: number;
  /** Puntos que faltan para el siguiente rango (0 si es el máximo). */
  toNext: number;
  /** Puntos que faltan para la siguiente división (0 si no hay más dentro del rango). */
  toNextDivision: number;
  /** Progreso dentro del rango actual, 0..1. En el rango máximo es 1. */
  progress: number;
  /** Progreso dentro de la división actual, 0..1. */
  divisionProgress: number;
  /** Posición del rango en la escalera (0 = Sin clasificar). */
  index: number;
  /** true mientras no se haya puntuado nunca. */
  unranked: boolean;
}

const ROMAN = ["", "I", "II", "III", "IV", "V"];

const clampPoints = (points: number) =>
  Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;

/** Rango correspondiente a unos puntos. Nunca devuelve undefined. */
export function rankFromPoints(points: number): RankTier {
  const p = clampPoints(points);
  let current = RANKS[0];
  for (const r of RANKS) if (p >= r.min) current = r;
  return current;
}

/** Progresión completa. Pura y determinista: mismos puntos, mismo resultado siempre. */
export function rankProgress(points: number): RankProgress {
  const p = clampPoints(points);
  const tier = rankFromPoints(p);
  const index = RANKS.findIndex((r) => r.id === tier.id);
  const next = index >= 0 && index < RANKS.length - 1 ? RANKS[index + 1] : null;
  const unranked = tier.id === "unranked";

  // Sin siguiente rango (Nexus) o sin puntuar todavía: no hay tramo que recorrer.
  if (!next) {
    return {
      tier, division: 0, label: tier.label, next: null, points: p,
      toNext: 0, toNextDivision: 0, progress: 1, divisionProgress: 1, index, unranked,
    };
  }

  const span = next.min - tier.min;
  const done = p - tier.min;
  const progress = span > 0 ? Math.min(1, Math.max(0, done / span)) : 1;

  if (tier.divisions <= 1) {
    return {
      tier, division: 0, label: tier.label, next, points: p,
      toNext: Math.max(0, next.min - p), toNextDivision: 0,
      progress, divisionProgress: progress, index, unranked,
    };
  }

  // El tramo del rango se reparte en divisiones iguales. `min(…, divisions)` cubre el
  // borde exacto en el que `done === span` y la división saldría fuera de rango.
  const band = span / tier.divisions;
  const slot = Math.min(tier.divisions, Math.floor(done / band) + 1);
  const division = DIVISION_I_IS_ENTRY ? slot : tier.divisions - slot + 1;
  const intoBand = done - (slot - 1) * band;

  return {
    tier,
    division,
    label: `${tier.label} ${ROMAN[division] ?? division}`,
    next,
    points: p,
    toNext: Math.max(0, next.min - p),
    toNextDivision: Math.max(0, Math.ceil(tier.min + slot * band - p)),
    progress,
    divisionProgress: band > 0 ? Math.min(1, Math.max(0, intoBand / band)) : 1,
    index,
    unranked,
  };
}

/**
 * ¿Este jugador es el CHAMPION? Es posicional y exige las dos cosas: estar en Nexus y
 * ser el primero. Un primero de Bronce no es campeón de nada.
 */
export function isChampion(points: number, globalPosition: number | null): boolean {
  return globalPosition === 1 && rankFromPoints(points).id === "nexus";
}

/**
 * Etiqueta y color definitivos para enseñar, campeón incluido.
 * Se separa de `rankProgress` porque necesita la posición, que viene del servidor.
 */
export function rankDisplay(points: number, globalPosition: number | null): {
  label: string;
  color: string;
  champion: boolean;
} {
  if (isChampion(points, globalPosition)) {
    return { label: CHAMPION_LABEL, color: CHAMPION_COLOR, champion: true };
  }
  const r = rankProgress(points);
  return { label: r.label, color: r.tier.color, champion: false };
}

// ───────────────────────────── Ámbitos de clasificación ─────────────────────────────

/**
 * Regiones competitivas. Son las cuatro del circuito de VALORANT, las mismas que ya usa
 * el catálogo de cartas (`Region`): no se inventa una taxonomía paralela.
 *
 * «Europa» en la clasificación es EMEA. No es lo mismo —EMEA incluye Oriente Medio y
 * África— y por eso en la interfaz se escribe «Europa · EMEA» y no solo «Europa».
 */
export const RANK_REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;
export type RankRegion = (typeof RANK_REGIONS)[number];

export const EUROPE_REGION: RankRegion = "EMEA";

export const REGION_LABEL: Record<RankRegion, string> = {
  EMEA: "Europa · EMEA",
  Americas: "América",
  Pacific: "Pacífico",
  China: "China",
};

export function isRankRegion(value: unknown): value is RankRegion {
  return typeof value === "string" && (RANK_REGIONS as readonly string[]).includes(value);
}
