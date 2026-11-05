/**
 * ICON · DISTRIBUCIÓN DE CALIDAD DE LOS SOBRES ICON (2026-10-09) — APROBADA: 65 / 17,5 / 17,5.
 *
 * Los dos sobres ICON (`icon-single`, 1 carta; `icon`, 3 cartas) entregan solo cartas de la clase Icon (`packClass`:
 * Record Breaker y Moments). Qué Icon sale, CARTA A CARTA, se decide en dos pasos —nivel de calidad y, dentro del nivel,
 * una carta con la misma probabilidad— con la tabla APROBADA (`ICON_QUALITY_STATUS`). Sin tabla aprobada, la regla de
 * siempre de la clase (sorteo uniforme).
 *
 * ─────────────────────────── CLASIFICACIÓN (determinista, con datos reales) ───────────────────────────
 *
 * Nivel de calidad = NIVEL DE VALOR de la carta (`marketValue`, la tasación con la que la economía valora un sobre).
 * Las Icon se agrupan por valor exacto y se ordenan de menor a mayor: dos cartas del mismo valor están siempre en el mismo
 * nivel (no se inventan distinciones que el catálogo no tiene). Con el catálogo de hoy (3 Icon) salen DOS niveles:
 *
 *   · 18.400 — Patmen · Record Breaker · OVR 92
 *   · 26.500 — Marteen · Record Breaker · OVR 95 y Mada · Moments · OVR 95
 *
 * La propuesta orientativa (65 % bajo · 25 % medio · 9 % alto · 1 % máximo) necesita CUATRO niveles: con dos no se puede
 * aplicar de forma coherente. El propietario aprobó (2026-10-09) la alternativa A: PatMen 65 %, marteen 17,5 %, mada 17,5 %.
 *
 * FALLO CERRADO: si el catálogo cambia (otra Icon, otro valor) y la tabla deja de ser aplicable, abrir un sobre ICON falla
 * en vez de inventar un reparto (`iconQualityWeights` lanza). Añadir una Icon exige revisar esta tabla.
 */
import type { CardDef } from "../cards/types";
import { marketValue } from "../economy/pricing";

/** Un nivel de calidad: las Icon con el mismo valor exacto. */
export interface IconValueLevel {
  value: number;
  cardIds: string[];
}

/** Agrupa las cartas por valor exacto, de menor a mayor (orden de ids estable dentro del nivel). */
export function iconValueLevels(cards: readonly CardDef[], value: (c: CardDef) => number): IconValueLevel[] {
  const by = new Map<number, string[]>();
  for (const c of cards) {
    const v = value(c);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Icon ${c.id} sin valor válido (${v})`);
    by.set(v, [...(by.get(v) ?? []), c.id]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([v, ids]) => ({ value: v, cardIds: ids.sort() }));
}

/** Reparto por nivel, en POR MIL (enteros, suma 1000), del nivel de menor valor al de mayor. */
export interface IconQualityTable {
  id: string;
  label: string;
  /** Cuántos niveles de valor exige el catálogo para aplicarse tal cual. */
  levels: number;
  shares: readonly number[];
  rationale: string;
}

/** La propuesta original del encargo (orientativa): exige 4 niveles. */
export const ICON_QUALITY_PROPOSAL: IconQualityTable = {
  id: "proposal-4", label: "Propuesta 65 / 25 / 9 / 1", levels: 4, shares: [650, 250, 90, 10],
  rationale: "Bajo 65 %, medio 25 %, alto 9 %, máximo 1 %. Necesita cuatro niveles de valor; el catálogo tiene dos.",
};

/**
 * ALTERNATIVAS para el catálogo real (2 niveles). A es la APROBADA (2026-10-09).
 *
 *   A · 65 / 35 (RECOMENDADA) — conserva el 65 % del nivel bajo de la propuesta y suma en el nivel máximo lo que la
 *       propuesta repartía entre medio, alto y máximo (25 + 9 + 1). Cada 95 sale el 17,5 % de las veces.
 *   B · 50 / 50 — el nivel bajo sigue siendo la carta más probable (50 % frente a 25 % de cada 95); el valor esperado baja
 *       menos que con A.
 */
export const ICON_QUALITY_ALTERNATIVES: readonly IconQualityTable[] = [
  { id: "two-level-65-35", label: "A · 65 / 35", levels: 2, shares: [650, 350],
    rationale: "Nivel bajo con el 65 % de la propuesta; medio + alto + máximo (35 %) caen en el único nivel superior que existe." },
  { id: "two-level-50-50", label: "B · 50 / 50", levels: 2, shares: [500, 500],
    rationale: "La Icon de menor valor sigue siendo la más probable (50 % frente a 25 % de cada una de las dos de 95)." },
];

/** ESTADO: APROBADA la alternativa A (decisión del propietario, 2026-10-09). */
export type IconQualityStatus = { status: "PENDING_APPROVAL" } | { status: "APPROVED"; table: IconQualityTable };
export const ICON_QUALITY_STATUS: IconQualityStatus = { status: "APPROVED", table: ICON_QUALITY_ALTERNATIVES[0] };

/** ¿La tabla se puede aplicar tal cual a estos niveles? (mismo nº de niveles, enteros ≥ 0, suma 1000, todos > 0). */
export function qualityTableApplies(table: IconQualityTable, levels: readonly IconValueLevel[]): boolean {
  return table.shares.length === levels.length && levels.length === table.levels
    && table.shares.every((s) => Number.isInteger(s) && s > 0)
    && table.shares.reduce((a, b) => a + b, 0) === 1000;
}

/**
 * Peso de cada carta Icon con una tabla: share(nivel) / nº de cartas del nivel. Con `pickWeighted` es exactamente
 * «nivel con su probabilidad y, dentro del nivel, selección justa», en UNA tirada.
 */
export function iconQualityWeights(table: IconQualityTable, levels: readonly IconValueLevel[]): Map<string, number> {
  if (!qualityTableApplies(table, levels)) throw new Error(`Tabla de calidad ${table.id} no aplicable a ${levels.length} niveles`);
  const out = new Map<string, number>();
  levels.forEach((lv, i) => { for (const id of lv.cardIds) out.set(id, table.shares[i] / lv.cardIds.length); });
  return out;
}

/** La tabla ACTIVA, o `null` mientras esté pendiente de aprobación. */
export function activeIconQuality(status: IconQualityStatus = ICON_QUALITY_STATUS): IconQualityTable | null {
  return status.status === "APPROVED" ? status.table : null;
}

/** Los sobres cuyas cartas Icon gobierna la tabla de calidad (por plantilla: un sobre del panel basado en ellos, también). */
export const ICON_QUALITY_PACKS: ReadonlySet<string> = new Set(["icon-single", "icon"]);

/**
 * Peso por carta para sortear (motor) o calcular (ficha, economía) la Icon de un sobre: con una tabla APROBADA y un
 * sobre ICON, share(nivel) / cartas del nivel × `base`; en cualquier otro caso, `base` tal cual (la regla de siempre).
 * `icons` = las Icon del pool del sobre (la clasificación se hace sobre las cartas que de verdad pueden salir).
 */
export function iconQualityWeightOf<C extends CardDef>(templateId: string | null, icons: readonly C[], base: (c: C) => number, status: IconQualityStatus = ICON_QUALITY_STATUS): (c: C) => number {
  const table = templateId !== null && ICON_QUALITY_PACKS.has(templateId) ? activeIconQuality(status) : null;
  if (!table) return base;
  const w = iconQualityWeights(table, iconValueLevels(icons, marketValue));
  return (c) => (w.has(c.id) ? w.get(c.id)! * base(c) : base(c));
}
