/**
 * F58 · SOBRES EN EL PANEL — filas, salud económica y simulación «¿y si…?» (SOLO LECTURA).
 *
 * Fuente de los números: `PACK_STATS` (motor real, 20.000 aperturas por sobre, regenerado en F57.6) y la tabla F57.3.
 * En el catálogo diseñado cada bucket de rareza es una clase: `rare` = Prime (future-star) y `legendary` = Icon
 * (record-breaker/moments), así que `drawn.rare`/`drawn.legendary` SON la probabilidad por carta de Prime/Icon.
 *
 * La economía de sobres está CONGELADA (F57.3–F57.6): precios, probabilidades y pools viven en código y los fija
 * `economyFinal.test.ts`. El panel no los escribe. La simulación sirve para ENSEÑAR el efecto de un cambio candidato
 * (precio o nº de cartas) antes de proponerlo; no hay «guardar».
 */
import { PACKS, getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { CARDS } from "@/data/catalog";
import { marketValue } from "@/domain/economy/pricing";
import { salvageValue } from "@/domain/economy/salvage";
import { packLifecycle } from "@/domain/packs/lifecycle";
import { MAIN_PACK_LINE, mainPackDistribution, mainPackPlan, packPlan, packCardClass } from "@/domain/packs/packClass";
import { packEconomyReport } from "@/domain/packs/economyGate";
import { CardRegistry } from "@/collection/registry";
import { openPack } from "@/domain/packs/openPack";
import { freshPity } from "@/domain/packs/pity";
import type { PackDef } from "@/domain/packs/types";

export type HealthLevel = "HEALTHY" | "WARNING" | "CRITICAL";
export interface HealthCheck { id: string; label: string; level: HealthLevel; detail: string }

export interface PackRow {
  id: string; name: string; tag: string | null; lifecycle: string; kind: "principal" | "evento" | "regional" | "equipo" | "inicial" | "especial";
  price: number; cardCount: number; ev: number | null; evOverPrice: number | null; salvageEV: number | null; salvageOverPrice: number | null;
  primePct: number | null; iconPct: number | null; drawMode: "clase" | "rareza"; team: string | null; region: string | null;
  /** Pack Opening 3.1 · informe económico exacto (`economyGate`): P(mejor ≥ 90/95), pool, targeting y avisos de la compuerta. */
  p90: number | null; p95: number | null; poolSize: number; featuredSlot: boolean; targeting: string; gate: { code: string; message: string }[];
}

function kindOf(p: PackDef): PackRow["kind"] {
  if (MAIN_PACK_LINE.includes(p.id)) return "principal";
  if (p.price <= 0) return "inicial";
  if (p.team) return "equipo";
  if (p.restrictRegion) return "regional";
  if (p.eventId) return "evento";
  return "especial";
}

export function packRow(p: PackDef): PackRow {
  const s = PACK_STATS[p.id];
  return {
    id: p.id, name: p.name, tag: p.tag ?? null, lifecycle: packLifecycle(p), kind: kindOf(p), price: p.price, cardCount: p.cardCount,
    ev: s ? s.meanValue : null, evOverPrice: s && p.price > 0 ? s.meanValue / p.price : null,
    salvageEV: s ? s.meanSalvage : null, salvageOverPrice: s && p.price > 0 ? s.meanSalvage / p.price : null,
    primePct: s ? s.drawn.rare : null, iconPct: s ? s.drawn.legendary : null,
    drawMode: packPlan(p.id) ? "clase" : "rareza", team: p.team ?? null, region: p.restrictRegion ?? null,
    ...(() => { const r = packEconomyReport(p); return { p90: r.hasPlan ? r.p90 : null, p95: r.hasPlan ? r.p95 : null, poolSize: r.poolSize, featuredSlot: r.featuredSlot, targeting: r.targeting, gate: r.issues }; })(),
  };
}

export const packRows = (): PackRow[] => PACKS.map(packRow);

/** Banda de la línea principal (F57.6): mediana de Bronce…Champions ±12 %. */
export function mainBand(): { median: number; lo: number; hi: number } {
  const r = MAIN_PACK_LINE.filter((id) => id !== "icon").map((id) => PACK_STATS[id].meanValue / getPack(id)!.price).sort((a, b) => a - b);
  const median = r[2];
  return { median, lo: median * 0.88, hi: median * 1.12 };
}

/** Salud económica calculada con los datos reales del repositorio (nada decorativo). */
export function economyHealth(): HealthCheck[] {
  const out: HealthCheck[] = [];
  const band = mainBand();
  const buyable = PACKS.filter((p) => p.price > 0 && packLifecycle(p) === "ACTIVE");
  const liq = buyable.map((p) => ({ p, r: PACK_STATS[p.id] ? PACK_STATS[p.id].meanSalvage / p.price : NaN }));
  const bad = liq.filter((x) => !(x.r < 0.7));
  const worst = liq.filter((x) => Number.isFinite(x.r)).sort((a, b) => b.r - a.r)[0];
  out.push({ id: "liquidation", label: "Liquidación < 70 % del precio", level: bad.length ? "CRITICAL" : worst && worst.r > 0.45 ? "WARNING" : "HEALTHY",
    detail: bad.length ? `Bucle posible: ${bad.map((x) => x.p.id).join(", ")}` : `Peor sobre comprable: ${worst?.p.name ?? "—"} (${Math.round((worst?.r ?? 0) * 100)} %)` });
  // Pack Opening 3.0/3.1 · la línea sube de valor por crédito a propósito (Bronce 0,50 → Icon 0,83): «dominar» es que un
  // sobre ESPECIAL rinda más por crédito que el Sobre Plata (el ancla de la compuerta económica), no la banda plana de F57.6.
  const plata = PACK_STATS.premium.meanValue / getPack("premium")!.price;
  const dominant = buyable.filter((p) => !MAIN_PACK_LINE.includes(p.id) && PACK_STATS[p.id] && PACK_STATS[p.id].meanValue / p.price > plata);
  out.push({ id: "dominance", label: "Ningún sobre especial domina la línea principal", level: dominant.length ? "WARNING" : "HEALTHY",
    detail: dominant.length ? `Por encima del Sobre Plata (${plata.toFixed(2)}×): ${dominant.map((p) => p.name).join(", ")}` : `Ningún especial supera al Sobre Plata (${plata.toFixed(2)}×); línea ${band.lo.toFixed(2)}–${band.hi.toFixed(2)}× alrededor de su mediana` });
  // Pack Opening 3.1 · compuerta económica de los especiales comprables (fallo cerrado: si falla, ni se vende ni se ofrece).
  const gated = buyable.filter((p) => packEconomyReport(p).issues.length > 0);
  out.push({ id: "economy-gate", label: "Compuerta económica de sobres especiales", level: gated.length ? "CRITICAL" : "HEALTHY",
    detail: gated.length ? `Bloqueados: ${gated.map((p) => `${p.name} (${packEconomyReport(p).issues.map((i) => i.code).join(", ")})`).join(" · ")}` : "Todos los especiales a la venta están dentro de los límites del Sobre Plata" });
  const noStats = PACKS.filter((p) => p.price > 0 && packLifecycle(p) !== "DRAFT" && !PACK_STATS[p.id]); // el Sobre Inicial (gratis) no se mide
  const stale = PACKS.filter((p) => PACK_STATS[p.id] && PACK_STATS[p.id].price !== p.price);
  out.push({ id: "packstats", label: "packStats al día", level: noStats.length || stale.length ? "WARNING" : "HEALTHY",
    detail: noStats.length || stale.length ? `Sin estadística: ${noStats.map((p) => p.id).join(", ") || "—"} · precio desfasado: ${stale.map((p) => p.id).join(", ") || "—"}` : `${Object.keys(PACK_STATS).length} sobres medidos con el precio vigente` });
  const badPrice = buyable.filter((p) => !(p.price > 0) || !Number.isInteger(p.price));
  out.push({ id: "prices", label: "Precios válidos", level: badPrice.length ? "CRITICAL" : "HEALTHY", detail: badPrice.length ? badPrice.map((p) => p.id).join(", ") : `${buyable.length} sobres comprables con precio entero > 0` });
  // Pack Opening 3.0 · el contrato es el plan por ranuras: cada tabla suma 1000 ‰ y nada negativo.
  const badDist = MAIN_PACK_LINE.filter((id) => { const pl = mainPackPlan(id)!; return [pl.regular, pl.featured].some((t) => Object.values(t).reduce((a, b) => a + b, 0) !== 1000 || Object.values(t).some((v) => v < 0)); });
  out.push({ id: "distribution", label: "Probabilidades F57.3 suman 100", level: badDist.length ? "CRITICAL" : "HEALTHY", detail: badDist.length ? badDist.join(", ") : "Las 6 tablas por clase suman 100" });
  const zero = CARDS.filter((c) => !(marketValue(c) > 0) || !(salvageValue(c) > 0) || salvageValue(c) >= marketValue(c));
  out.push({ id: "values", label: "Valor y desguace de las cartas", level: zero.length ? "CRITICAL" : "HEALTHY", detail: zero.length ? `${zero.length} cartas con valor/desguace inválido` : `${CARDS.length} cartas con valor > 0 y desguace < valor` });
  const noClass = CARDS.filter((c) => !packCardClass(c));
  out.push({ id: "classes", label: "Clase de sobre de cada carta", level: noClass.length ? "WARNING" : "HEALTHY", detail: noClass.length ? `${noClass.length} cartas sin clase` : "Todas las cartas tienen clase" });
  return out;
}

export const worstLevel = (checks: readonly { level: HealthLevel }[]): HealthLevel =>
  checks.some((c) => c.level === "CRITICAL") ? "CRITICAL" : checks.some((c) => c.level === "WARNING") ? "WARNING" : "HEALTHY";

/*
 * ────────────────────────── SIMULACIÓN (solo lectura) ──────────────────────────
 */
export interface SimSummary { price: number; cardCount: number; ev: number; evOverPrice: number; salvageEV: number; salvageOverPrice: number; primePct: number; iconPct: number; p50: number; p90: number; p99: number }
export const SIM_MAX_N = 6000;

let registry: CardRegistry | null = null;
const reg = () => (registry ??= new CardRegistry());

export function simulatePack(pack: PackDef, n = 3000): SimSummary {
  const N = Math.min(Math.max(Math.trunc(n), 200), SIM_MAX_N);
  const vals: number[] = []; let salv = 0, prime = 0, icon = 0, cards = 0;
  for (let i = 0; i < N; i++) {
    const r = openPack(reg(), pack, { seed: (i * 2654435761 + 97) >>> 0, owned: new Set(), pity: freshPity() });
    let v = 0;
    for (const d of r.decisions) {
      v += marketValue(d.card); salv += salvageValue(d.card); cards++;
      const cls = packCardClass(d.card); if (cls === "prime") prime++; else if (cls === "icon") icon++;
    }
    vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(N - 1, Math.floor(p * N))];
  const ev = vals.reduce((a, b) => a + b, 0) / N, sev = salv / N;
  return { price: pack.price, cardCount: pack.cardCount, ev: Math.round(ev), evOverPrice: pack.price > 0 ? ev / pack.price : 0, salvageEV: Math.round(sev), salvageOverPrice: pack.price > 0 ? sev / pack.price : 0,
    primePct: prime / cards, iconPct: icon / cards, p50: q(0.5), p90: q(0.9), p99: q(0.99) };
}

export interface WhatIf { price?: number; cardCount?: number }
export function parseWhatIf(body: Record<string, unknown>): { ok: true; value: WhatIf } | { ok: false; error: string } {
  const w: WhatIf = {};
  if (body.price !== undefined && body.price !== null && body.price !== "") {
    const p = Number(body.price);
    if (!Number.isInteger(p) || p < 1 || p > 100_000) return { ok: false, error: "Precio inválido (1–100.000)" };
    w.price = p;
  }
  if (body.cardCount !== undefined && body.cardCount !== null && body.cardCount !== "") {
    const c = Number(body.cardCount);
    if (!Number.isInteger(c) || c < 1 || c > 10) return { ok: false, error: "Nº de cartas inválido (1–10)" };
    w.cardCount = c;
  }
  return { ok: true, value: w };
}

/** BEFORE/AFTER con las MISMAS semillas: el único cambio entre columnas es el que pide el admin. */
export function whatIf(packId: string, w: WhatIf, n = 3000): { before: SimSummary; after: SimSummary; warnings: string[] } | null {
  const pack = getPack(packId);
  if (!pack) return null;
  const before = simulatePack(pack, n);
  const changed: PackDef = { ...pack, ...(w.price !== undefined ? { price: w.price } : {}), ...(w.cardCount !== undefined ? { cardCount: w.cardCount } : {}) };
  const after = w.cardCount !== undefined && w.cardCount !== pack.cardCount ? simulatePack(changed, n)
    : { ...before, price: changed.price, evOverPrice: changed.price > 0 ? before.ev / changed.price : 0, salvageOverPrice: changed.price > 0 ? before.salvageEV / changed.price : 0 };
  const warnings: string[] = [];
  if (after.salvageOverPrice >= 0.7) warnings.push("La liquidación llegaría al 70 % del precio: bucle económico. Configuración NO válida.");
  const band = mainBand();
  if (pack.id !== "icon" && after.evOverPrice > band.hi) warnings.push(`Valor/precio por encima de la banda (${band.hi.toFixed(2)}×): sobre dominante.`);
  if (pack.id !== "icon" && after.evOverPrice < band.lo && MAIN_PACK_LINE.includes(pack.id)) warnings.push(`Valor/precio por debajo de la banda (${band.lo.toFixed(2)}×).`);
  warnings.push("La economía de sobres está congelada (F57.6): esta simulación no guarda nada.");
  return { before, after, warnings };
}

/*
 * ────────────────────────── F58.1 · DE DÓNDE SACA SUS CARTAS UN SOBRE ──────────────────────────
 *
 * Dos productos distintos que el panel no debe confundir:
 *   · LÍNEA PRINCIPAL (Bronce, Plata, Oro, Masters, Champions, Icon): la PROBABILIDAD la decide la tabla por clase F57.3
 *     (`mainPackDistribution`); el pool `pack-<id>` (EXPLICIT, peso 1) decide qué cartas son ELEGIBLES dentro de cada
 *     clase (`openByClass` → `classPool` → `buildPool(…, dist)`). Sin pool vinculado, la elegibilidad cae a las reglas
 *     del `PackDef` (hoy, las mismas 331 cartas): funciona igual, pero el sobre queda fuera de la administración de
 *     pools (una carta retirada del pool no dejaría de salir en él). Por eso TODOS los sobres llevan su `pack-<id>`.
 *   · SOBRES POR RAREZA (regionales, equipo, eventos, Inicial): la probabilidad la deciden los pesos por rareza del
 *     `PackDef`; el pool `pack-<id>` restringe (región…) y los `boost-<id>` (RULE) reponderan cartas del equipo.
 */
export interface PackBinding { pack_id: string; pool_id: string; priority: number; enabled: boolean }
export interface DrawSource { mode: "class-distribution" | "rarity-weights"; probability: string; eligibility: string; pools: { poolId: string; priority: number; role: "eligibility" | "boost" | "other" }[]; missingEligibilityPool: boolean }

export function drawSourceOf(pack: PackDef, bindings: readonly PackBinding[]): DrawSource {
  const mine = bindings.filter((b) => b.pack_id === pack.id && b.enabled).sort((a, b) => a.priority - b.priority);
  const pools = mine.map((b) => ({ poolId: b.pool_id, priority: b.priority, role: b.pool_id === `pack-${pack.id}` ? "eligibility" as const : b.pool_id.startsWith("boost-") ? "boost" as const : "other" as const }));
  const hasEligibility = pools.some((p) => p.role === "eligibility");
  const byClass = !!mainPackDistribution(pack.id);
  return {
    mode: byClass ? "class-distribution" : "rarity-weights",
    probability: byClass ? "Tabla por clase F57.3 (fija): primero se sortea la clase del hueco" : "Pesos por rareza del sobre (PackDef.weights), medidos en packStats",
    eligibility: hasEligibility ? `Pool pack-${pack.id} (EXPLICIT, peso 1): qué cartas pueden salir dentro de cada ${byClass ? "clase" : "rareza"}` : "SIN pool vinculado: elegibilidad deducida de las reglas del sobre (fuera de la administración de pools)",
    pools, missingEligibilityPool: !hasEligibility,
  };
}

/** Sobres públicos (no DRAFT) sin su pool de elegibilidad `pack-<id>`. Vacío = coherente. */
export function packsMissingEligibilityPool(packs: readonly PackDef[], bindings: readonly PackBinding[]): string[] {
  return packs.filter((p) => packLifecycle(p) !== "DRAFT" && drawSourceOf(p, bindings).missingEligibilityPool).map((p) => p.id);
}
