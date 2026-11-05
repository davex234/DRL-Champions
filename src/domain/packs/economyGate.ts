/**
 * PACK OPENING 3.1 · COMPUERTA ECONÓMICA DE LOS SOBRES ESPECIALES — fallo CERRADO.
 *
 * Antes de 3.1 un sobre especial (regional, de equipo, EWC) podía venderse con cualquier reparto: los pesos por rareza
 * heredados lo dejaron rindiendo 5–6× el valor por crédito de la línea principal. Esta compuerta mide cada sobre especial
 * con el MISMO cálculo exacto que el contrato (`tierIdentity` sobre su pool real y sus pesos, `packClassPools`) y lo
 * compara con LÍMITES DERIVADOS de la línea principal (nada escrito a mano que pueda quedarse viejo):
 *
 *   · VALUE_PER_CREDIT_OUTLIER — rinde más valor por crédito que el Sobre Plata (su targeting ya es su ventaja);
 *   · P95_TOO_HIGH             — da una carta ≥ 95 más a menudo que el Sobre Plata (el 95 sigue siendo un golpe raro);
 *   · SALVAGE_ARBITRAGE        — desguazar lo que trae recupera más del 10 % de su precio (la línea: 3–5 %);
 *   · POOL_TOO_SMALL           — menos de 25 cartas posibles;
 *   · TEAM_POOL_TOO_SMALL      — un sobre de equipo con menos de 3 cartas de su equipo (el sesgo sería ruido);
 *   · PLAN_REQUIRED            — un especial comprable sin plan por ranuras (sortearía con los pesos por rareza heredados).
 *
 * Todos bloquean (fallo cerrado): el servidor rechaza la COMPRA (`buyPack`, 409) y la tienda no lo ofrece. Abrir un sobre
 * que ya se tiene (recompensa) nunca se bloquea. La línea principal tiene su propio contrato y el Sobre Inicial (precio 0)
 * su propia regla de servidor: quedan fuera. El panel de admin enseña el informe de cada sobre.
 */
import type { PackDef } from "./types";
import { MAIN_PACK_LINE, packPlan, planTemplate, PACK_CLASS_ORDER } from "./packClass";
import { tierIdentity } from "./tierIdentity";
import { packClassPools } from "./packPools";
import { marketValue } from "../economy/pricing";
import { salvageValue } from "../economy/salvage";
import { getPack } from "@/data/packs";
import { ns, td } from "@/i18n/runtime";

const tr = ns("packs");

export type EconomyIssueCode = "VALUE_PER_CREDIT_OUTLIER" | "P95_TOO_HIGH" | "SALVAGE_ARBITRAGE" | "POOL_TOO_SMALL" | "TEAM_POOL_TOO_SMALL" | "PLAN_REQUIRED" | "EMPTY_CLASS";
export interface EconomyIssue { code: EconomyIssueCode; message: string }

export const SALVAGE_MAX_OVER_PRICE = 0.1;
export const MIN_POOL = 25;
export const MIN_TEAM_CARDS = 3;
/** El ancla: el Sobre Plata (el primero de la línea por encima del precio de los especiales baratos). */
export const ANCHOR_PACK = "premium";

export interface PackEconomyReport {
  packId: string; price: number; cards: number; hasPlan: boolean; featuredSlot: boolean; ovrTilt: number;
  ev: number; perCredit: number | null; p90: number; p95: number; salvageOverPrice: number | null;
  poolSize: number; teamCards: number; targeting: "ninguno" | "región" | "equipo"; issues: EconomyIssue[];
}

const CACHE = new Map<string, PackEconomyReport>();

function measure(pack: PackDef): Omit<PackEconomyReport, "issues"> & { emptyClass: string | null } {
  const plan = packPlan(pack.id);
  const pp = packClassPools(pack);
  const targeting = pack.team ? "equipo" : pack.restrictRegion ? "región" : "ninguno";
  const base = { packId: pack.id, price: pack.price, cards: pack.cardCount, hasPlan: !!plan, featuredSlot: !!plan, ovrTilt: plan?.ovrTilt ?? 0, poolSize: pp.size, teamCards: pp.teamCards, targeting } as const;
  if (!plan) return { ...base, ev: 0, perCredit: null, p90: 0, p95: 0, salvageOverPrice: null, emptyClass: null };
  const empty = PACK_CLASS_ORDER.find((k) => (plan.regular[k] > 0 || plan.featured[k] > 0) && pp.pools[k].length === 0) ?? null;
  if (empty) return { ...base, ev: 0, perCredit: null, p90: 0, p95: 0, salvageOverPrice: null, emptyClass: empty };
  const v = tierIdentity(plan, pp.pools, marketValue, pp.weightOf);
  const s = tierIdentity(plan, pp.pools, salvageValue, pp.weightOf);
  return { ...base, ev: v.expectedValue, perCredit: pack.price > 0 ? v.expectedValue / pack.price : null, p90: v.bestAtLeast[90], p95: v.bestAtLeast[95], salvageOverPrice: pack.price > 0 ? s.expectedValue / pack.price : null, emptyClass: null };
}

/**
 * Los límites, derivados del ancla (Sobre Plata) con el mismo cálculo. Un sobre del panel hecho con una plantilla de la
 * LÍNEA PRINCIPAL se mide contra su plantilla (puede costar lo mismo y rendir lo mismo; no puede ser una versión más
 * barata de ella).
 */
export function economyLimits(pack?: Pick<PackDef, "id">): { maxPerCredit: number; maxP95: number } {
  const t = pack ? planTemplate(pack.id) : null;
  if (t && t !== pack!.id && MAIN_PACK_LINE.includes(t)) {
    const m = measure(getPack(t)!);
    return { maxPerCredit: m.perCredit ?? 0, maxP95: m.p95 };
  }
  const a = measure(getPack(ANCHOR_PACK)!);
  return { maxPerCredit: a.perCredit ?? 0, maxP95: a.p95 };
}

/** ¿Se le aplica la compuerta? Solo a especiales vendibles por créditos (no línea principal, no gratis). */
export const gatedPack = (pack: Pick<PackDef, "id" | "price">): boolean => !MAIN_PACK_LINE.includes(pack.id) && pack.price > 0;

export function packEconomyReport(pack: PackDef): PackEconomyReport {
  const hit = CACHE.get(pack.id);
  if (hit && hit.price === pack.price) return hit;
  const m = measure(pack);
  const issues: EconomyIssue[] = [];
  if (gatedPack(pack)) {
    const lim = economyLimits(pack);
    if (!m.hasPlan) issues.push({ code: "PLAN_REQUIRED", message: tr("Sin plan por ranuras: sortearía con los pesos por rareza heredados") });
    if (m.emptyClass) issues.push({ code: "EMPTY_CLASS", message: tr("La clase {emptyClass} tiene probabilidad y ninguna carta en el pool", { emptyClass: m.emptyClass }) });
    if (m.perCredit !== null && m.perCredit > lim.maxPerCredit + 1e-9) issues.push({ code: "VALUE_PER_CREDIT_OUTLIER", message: tr("Rinde {perCredit} de valor por crédito; el Sobre Plata, {maxPerCredit}", { perCredit: m.perCredit.toFixed(3), maxPerCredit: lim.maxPerCredit.toFixed(3) }) });
    if (m.hasPlan && !m.emptyClass && m.p95 > lim.maxP95 + 1e-9) issues.push({ code: "P95_TOO_HIGH", message: tr("Carta ≥ 95 en el {v} % de los sobres; el Sobre Plata, {v2} %", { v: (m.p95 * 100).toFixed(2), v2: (lim.maxP95 * 100).toFixed(2) }) });
    if (m.salvageOverPrice !== null && m.salvageOverPrice > SALVAGE_MAX_OVER_PRICE) issues.push({ code: "SALVAGE_ARBITRAGE", message: tr("Desguazar lo que trae recupera el {v} % del precio (máx. {v2} %)", { v: (m.salvageOverPrice * 100).toFixed(1), v2: SALVAGE_MAX_OVER_PRICE * 100 }) });
    if (m.poolSize < MIN_POOL) issues.push({ code: "POOL_TOO_SMALL", message: tr("Solo {poolSize} cartas posibles (mín. {MIN_POOL})", { poolSize: m.poolSize, MIN_POOL }) });
    if (pack.team && m.teamCards < MIN_TEAM_CARDS) issues.push({ code: "TEAM_POOL_TOO_SMALL", message: tr("Solo {teamCards} cartas de {team} (mín. {MIN_TEAM_CARDS})", { teamCards: m.teamCards, team: td(pack.team), MIN_TEAM_CARDS }) });
  }
  const { emptyClass: _e, ...rest } = m;
  void _e;
  const out = { ...rest, issues };
  CACHE.set(pack.id, out);
  return out;
}

/** Veredicto de venta: `ok` si se puede vender por créditos; si no, el motivo (fallo cerrado). */
export function economySellable(pack: PackDef): { ok: true } | { ok: false; reason: string; issues: EconomyIssue[] } {
  if (!gatedPack(pack)) return { ok: true };
  const r = packEconomyReport(pack);
  return r.issues.length === 0 ? { ok: true } : { ok: false, reason: tr("Este sobre no está a la venta: no supera la compuerta económica"), issues: r.issues };
}
