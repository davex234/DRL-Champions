import { ns } from "@/i18n/runtime";

const tr = ns("ranked");

/**
 * F84 · RANKED 2.0 — CONFIGURACIÓN DE RANGOS VERSIONADA (puro).
 *
 * El rango NO se guarda: se DERIVA del rating canónico (`duel_pvp_ratings.rating`, Elo K 40/24 de 0033–0035) con una
 * configuración de fronteras VERSIONADA. Una temporada competitiva (`competitive_seasons.rank_config_version`) fija la
 * versión con la que se lee; una versión publicada no cambia nunca (lo congela `f84.ranked.test.ts` con su huella).
 * Cambiar qué significa «1100» en el futuro = versión nueva + temporada nueva, nunca editar esta.
 *
 * IDENTIDAD PROPIA (no copiada de otros juegos): la carrera de un jugador de esports, de la cantera a la cumbre.
 *   CANTERA → PROMESA → TITULAR → VETERANO → CAPITÁN → ESTRELLA, con divisiones III → II → I (I es la alta), y
 *   CUMBRE por encima (sin divisiones): la élite. El «Top 500» no es un rango: es tu puesto numerado si eres elegible.
 *
 * Fronteras de `rank-v1` (anchura de división 30 = ~2,5 victorias netas con K 24 contra un rival igual): calibradas con la
 * distribución REAL de producción (10 jugadores con partidas, P10 912 · P50 1004 · P90 1091, desviación 75) y con la
 * simulación del informe F84 (`scripts/_f84-simulate.ts`). 1000 (rating inicial) cae en TITULAR II: el jugador medio es
 * titular. CUMBRE (≥ 1310) exige ~85 % de victorias sostenidas contra la media: rendimiento, no volumen.
 *
 * Sin React, sin red, sin reloj.
 */

export type DivisionNumber = 3 | 2 | 1;

export interface RankTierDef {
  /** Identificador estable (no se traduce, no cambia). */
  id: string;
  /** Nombre visible. */
  name: string;
  /** Rating mínimo del tier (incluido). */
  floor: number;
  /** Divisiones III → II → I; `null` = tier sin divisiones (la cumbre). */
  divisions: 3 | null;
  /** Color de acento (nunca la única señal: forma y nombre también identifican el tier). */
  color: string;
  /** Glifo del emblema (forma distinta por tier). */
  shape: "chevron" | "diamond" | "shield" | "hex" | "star" | "crest" | "summit";
}

export interface RankConfig {
  version: string;
  /** Anchura de cada división en puntos de rating (tiers con divisiones). */
  divisionWidth: number;
  /** Tiers en orden ascendente. El primero tiene suelo 0 (recoge todo lo que queda por debajo). */
  tiers: readonly RankTierDef[];
}

export const RANK_V1: RankConfig = {
  version: "rank-v1",
  divisionWidth: 30,
  tiers: [
    { id: "cantera", name: "Cantera", floor: 0, divisions: 3, color: "#8fa3b8", shape: "chevron" },
    { id: "promesa", name: "Promesa", floor: 860, divisions: 3, color: "#4fd1a5", shape: "diamond" },
    { id: "titular", name: "Titular", floor: 950, divisions: 3, color: "#19e3ff", shape: "shield" },
    { id: "veterano", name: "Veterano", floor: 1040, divisions: 3, color: "#7d8cff", shape: "hex" },
    { id: "capitan", name: "Capitán", floor: 1130, divisions: 3, color: "#c86bff", shape: "crest" },
    { id: "estrella", name: "Estrella", floor: 1220, divisions: 3, color: "#ff5c85", shape: "star" },
    { id: "cumbre", name: "Cumbre", floor: 1310, divisions: null, color: "#ffd35c", shape: "summit" },
  ],
};

/** Versiones PUBLICADAS. Nunca se edita una entrada: se añade otra. */
export const RANK_CONFIGS: Readonly<Record<string, RankConfig>> = { [RANK_V1.version]: RANK_V1 };
export const CURRENT_RANK_CONFIG_VERSION = RANK_V1.version;

export function rankConfig(version: string | null | undefined): RankConfig {
  return (version && RANK_CONFIGS[version]) || RANK_CONFIGS[CURRENT_RANK_CONFIG_VERSION];
}

/* ───────────────────────────── validación ───────────────────────────── */

/**
 * Una configuración es válida si: el primer suelo es 0, los suelos son estrictamente crecientes, cada tier con divisiones
 * cabe EXACTAMENTE en `3 × divisionWidth` hasta el suelo siguiente (sin huecos ni solapes), solo el último tier puede no
 * tener divisiones, los ids son únicos y la versión no está vacía. Devuelve la lista de problemas (vacía = válida).
 */
export function validateRankConfig(c: RankConfig): string[] {
  const out: string[] = [];
  if (!c.version.trim()) out.push(tr("versión vacía"));
  if (!(Number.isInteger(c.divisionWidth) && c.divisionWidth > 0)) out.push(tr("divisionWidth debe ser un entero positivo"));
  if (c.tiers.length < 2) out.push(tr("hacen falta al menos dos tiers"));
  if (c.tiers[0]?.floor !== 0) out.push(tr("el primer tier debe empezar en 0"));
  const ids = new Set<string>();
  c.tiers.forEach((t, i) => {
    if (ids.has(t.id)) out.push(`id repetido: ${t.id}`);
    ids.add(t.id);
    const next = c.tiers[i + 1];
    if (next && !(next.floor > t.floor)) out.push(tr("suelos no crecientes: {id} → {id2}", { id: t.id, id2: next.id }));
    if (t.divisions === null && next) out.push(tr("solo el último tier puede no tener divisiones ({id})", { id: t.id }));
    // El primer tier recoge desde 0: su anchura real es la de sus divisiones contadas desde su suelo ALTO.
    if (t.divisions !== null && next && i > 0 && next.floor - t.floor !== t.divisions * c.divisionWidth) {
      out.push(tr("hueco o solape en {id}: {v} ≠ {v2}", { id: t.id, v: next.floor - t.floor, v2: t.divisions * c.divisionWidth }));
    }
    if (t.divisions !== null && next && i === 0 && next.floor - t.divisions * c.divisionWidth <= 0) {
      out.push(tr("el primer tier no tiene sitio para sus divisiones"));
    }
  });
  if (c.tiers[c.tiers.length - 1]?.divisions !== null) out.push(tr("el último tier (élite) no debe tener divisiones"));
  return out;
}

/* ───────────────────────────── derivación ───────────────────────────── */

export interface DerivedRank {
  version: string;
  tierId: string;
  tierName: string;
  /** 0 = el más bajo. Sirve para comparar tiers. */
  tierIndex: number;
  division: DivisionNumber | null;
  /** «Titular II», «Cumbre». */
  label: string;
  /** Orden total de escalón (tier × división): sube 1 por cada división. */
  step: number;
  /** Suelo del escalón actual (incluido) y techo (excluido; `null` en la cumbre). */
  floor: number;
  ceil: number | null;
  /** Posición dentro del escalón, 0..1 (`null` en la cumbre: no hay techo que prometer). */
  progress: number | null;
  /** Puntos que faltan para el escalón siguiente (`null` en la cumbre). */
  pointsToNext: number | null;
  /** Etiqueta del escalón siguiente (`null` en la cumbre). */
  nextLabel: string | null;
  color: string;
  shape: RankTierDef["shape"];
}

const ROMAN: Record<DivisionNumber, string> = { 3: "III", 2: "II", 1: "I" };
export const divisionLabel = (d: DivisionNumber | null): string => (d === null ? "" : ROMAN[d]);

function stepsOf(c: RankConfig): { tier: RankTierDef; tierIndex: number; division: DivisionNumber | null; floor: number }[] {
  const out: { tier: RankTierDef; tierIndex: number; division: DivisionNumber | null; floor: number }[] = [];
  c.tiers.forEach((t, i) => {
    if (t.divisions === null) { out.push({ tier: t, tierIndex: i, division: null, floor: t.floor }); return; }
    const next = c.tiers[i + 1];
    // Las divisiones se cuentan hacia ABAJO desde el suelo del tier siguiente; la III del primer tier llega hasta 0.
    const top = next ? next.floor : t.floor + t.divisions * c.divisionWidth;
    for (let d = t.divisions; d >= 1; d--) {
      const floor = d === t.divisions && i === 0 ? 0 : top - d * c.divisionWidth;
      out.push({ tier: t, tierIndex: i, division: d as DivisionNumber, floor });
    }
  });
  return out;
}

const STEPS_CACHE = new Map<string, ReturnType<typeof stepsOf>>();
function steps(c: RankConfig) {
  let s = STEPS_CACHE.get(c.version);
  if (!s) { s = stepsOf(c); STEPS_CACHE.set(c.version, s); }
  return s;
}

/** Rango DERIVADO de un rating con una versión de fronteras. Determinista; ratings fuera de [0, ∞) se acotan a 0. */
export function deriveRank(rating: number, version: string = CURRENT_RANK_CONFIG_VERSION): DerivedRank {
  const c = rankConfig(version);
  const r = Number.isFinite(rating) ? Math.max(0, Math.floor(rating)) : 0;
  const all = steps(c);
  let idx = 0;
  for (let i = 0; i < all.length; i++) if (r >= all[i].floor) idx = i;
  const s = all[idx];
  const next = all[idx + 1] ?? null;
  const ceil = next ? next.floor : null;
  const label = s.division === null ? s.tier.name : `${s.tier.name} ${ROMAN[s.division]}`;
  const span = ceil !== null ? ceil - s.floor : 0;
  return {
    version: c.version, tierId: s.tier.id, tierName: s.tier.name, tierIndex: s.tierIndex, division: s.division,
    label, step: idx, floor: s.floor, ceil,
    progress: ceil !== null && span > 0 ? Math.max(0, Math.min(1, (r - s.floor) / span)) : null,
    pointsToNext: ceil !== null ? Math.max(0, ceil - r) : null,
    nextLabel: next ? (next.division === null ? next.tier.name : `${next.tier.name} ${ROMAN[next.division]}`) : null,
    color: s.tier.color, shape: s.tier.shape,
  };
}

/** F84 · rango visible compacto (lo que viaja en filas de clasificación, perfiles y emparejamientos). */
export interface RankChip { label: string; tierId: string; tierName: string; division: DivisionNumber | null; color: string; shape: RankTierDef["shape"]; step: number }
export const rankChip = (r: DerivedRank): RankChip => ({ label: r.label, tierId: r.tierId, tierName: r.tierName, division: r.division, color: r.color, shape: r.shape, step: r.step });

/** Todos los escalones de una versión, de abajo arriba (para el panel admin y la leyenda). */
export function rankLadder(version: string = CURRENT_RANK_CONFIG_VERSION): { label: string; tierId: string; division: DivisionNumber | null; floor: number; ceil: number | null; color: string }[] {
  const all = steps(rankConfig(version));
  return all.map((s, i) => ({
    label: s.division === null ? s.tier.name : `${s.tier.name} ${ROMAN[s.division]}`,
    tierId: s.tier.id, division: s.division, floor: s.floor, ceil: all[i + 1]?.floor ?? null, color: s.tier.color,
  }));
}

/** Huella estable de una configuración (para congelar versiones publicadas en los tests). */
export function rankConfigFingerprint(c: RankConfig): string {
  return [c.version, c.divisionWidth, ...c.tiers.map((t) => `${t.id}:${t.floor}:${t.divisions ?? "-"}`)].join("|");
}
