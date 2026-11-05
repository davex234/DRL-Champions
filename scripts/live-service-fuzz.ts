/**
 * FASE 42 · FUZZERS DEL LIVE SERVICE — `npx tsx scripts/live-service-fuzz.ts <priority|return|temporal|map|all> [--n=100000] [--workers=12]`
 *
 *   priority  → docs/product/qa/fase42/priority-fuzz.json          (combinaciones de hechos → foto → invariantes)
 *   return    → docs/product/qa/fase42/return-state-simulation.json (retornos 0 h…30 d con actividad real)
 *   temporal  → docs/product/qa/fase42/temporal-fuzz.json          (servicios reales + reloj del servidor controlado)
 *   map       → docs/product/qa/fase42/live-service-map.json
 *
 * Cada modo admite `--mutate=<nombre>` para comprobar que el fuzzer DETECTA regresiones conocidas (no escribe el JSON
 * oficial, escribe `*-mutation-<nombre>.json`).
 */
import { fork } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { makeRng } from "../src/sim/rng";
import { buildDailyLoop } from "../src/domain/dailyLoop";
import { randomFacts, checkSnapshot, returnState, RETURN_HORIZONS } from "../src/domain/liveService/fuzz";
import { LIVE_SERVICE_MAP } from "../src/domain/liveService/map";
import { runTemporalSequence, newTemporalStats, type TemporalStats } from "../src/server/services/testing/liveServiceFuzz";

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = join(process.cwd(), "docs/product/qa/fase42");
mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] ?? "all";
const N = Number(arg("n", "100000"));
const W = Math.max(1, Number(arg("workers", "12")));
const mutate = arg("mutate", "");
const outName = (base: string) => join(OUT, mutate ? `${base}-mutation-${mutate}.json` : `${base}.json`);

/** ¿Existe la página de una ruta? (`src/app/<ruta>/page.tsx`, ignorando query y fragmento). */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/^\//, "");
  const dir = join(process.cwd(), "src/app", path);
  if (existsSync(join(dir, "page.tsx"))) return true;
  // Rutas dinámicas de un nivel (p. ej. /torneos/<id>, /abrir/<sobre>, /packs/<id>).
  const parts = path.split("/");
  if (parts.length >= 2) {
    const parent = join(process.cwd(), "src/app", ...parts.slice(0, -1));
    return ["[id]", "[packId]", "[slug]"].some((d) => existsSync(join(parent, d, "page.tsx")));
  }
  return false;
}

function priority() {
  const t0 = performance.now();
  const byInv: Record<string, number> = {}; const primaries: Record<string, number> = {}; const sample: unknown[] = [];
  let returning = 0; let expiring = 0; let urgent = 0;
  for (let i = 1; i <= N; i++) {
    const f = randomFacts(makeRng(i * 2654435761 % 2147483647 + 1));
    let s = buildDailyLoop(f);
    if (mutate === "active-match-lost" && (f.matches ?? []).length > 0) s = { ...s, primaryAction: { ...s.primaryAction, id: "claim", kind: "claim" } };
    if (mutate === "fake-urgency") s = { ...s, primaryAction: { ...s.primaryAction, urgency: "VERY_SOON", endsAt: null } };
    primaries[s.primaryAction.id] = (primaries[s.primaryAction.id] ?? 0) + 1;
    if (s.service?.returning) returning++;
    if ((s.service?.expiring.length ?? 0) > 0) expiring++;
    if (s.primaryAction.urgency === "VERY_SOON") urgent++;
    for (const v of checkSnapshot(f, s, routeExists)) { byInv[v.invariant] = (byInv[v.invariant] ?? 0) + 1; if (sample.length < 20) sample.push({ i, ...v }); }
  }
  const violations = Object.values(byInv).reduce((a, b) => a + b, 0);
  const report = { phase: 42, kind: "priority", combinations: N, mutate: mutate || null, violations, byInvariant: byInv, primaryDistribution: primaries, coverage: { returning, expiring, primaryVerySoon: urgent }, sample, ms: Math.round(performance.now() - t0) };
  writeFileSync(outName("priority-fuzz"), JSON.stringify(report, null, 2) + "\n");
  console.log(`priority: ${N} combinaciones · ${violations} violaciones · ${report.ms} ms`);
  return violations;
}

function returns() {
  const t0 = performance.now();
  const byInv: Record<string, number> = {}; const byHorizon: Record<string, { states: number; withReturning: number; factsMax: number; primary: Record<string, number> }> = {}; const sample: unknown[] = [];
  for (let i = 1; i <= N; i++) {
    const h = RETURN_HORIZONS[i % RETURN_HORIZONS.length];
    const r = returnState(makeRng(i * 40503 % 2147483647 + 7), `ret-${i}`, h);
    const key = `${Math.round(h / 3_600_000)}h`;
    const b = (byHorizon[key] ??= { states: 0, withReturning: 0, factsMax: 0, primary: {} });
    b.states++; if (r.snap.service?.returning) b.withReturning++;
    b.factsMax = Math.max(b.factsMax, r.snap.service?.returning?.facts.length ?? 0);
    b.primary[r.snap.primaryAction.id] = (b.primary[r.snap.primaryAction.id] ?? 0) + 1;
    for (const v of r.violations) { byInv[v.invariant] = (byInv[v.invariant] ?? 0) + 1; if (sample.length < 20) sample.push({ i, horizon: key, ...v }); }
  }
  const violations = Object.values(byInv).reduce((a, b) => a + b, 0);
  const report = { phase: 42, kind: "return-state", states: N, horizons: RETURN_HORIZONS.map((h) => `${Math.round(h / 3_600_000)}h`), violations, byInvariant: byInv, byHorizon, sample, ms: Math.round(performance.now() - t0) };
  writeFileSync(outName("return-state-simulation"), JSON.stringify(report, null, 2) + "\n");
  console.log(`return: ${N} estados · ${violations} violaciones · ${report.ms} ms`);
  return violations;
}

async function temporalChild(from: number, to: number) {
  const stats = newTemporalStats();
  console.error = () => {}; console.warn = () => {};
  for (let s = from; s < to; s++) await runTemporalSequence(s, stats);
  process.send!(stats);
}

async function temporal() {
  const t0 = performance.now();
  const chunk = Math.ceil(N / W);
  const parts = await Promise.all(Array.from({ length: W }, (_, w) => new Promise<TemporalStats>((resolve, reject) => {
    const from = 1 + w * chunk; const to = Math.min(N + 1, from + chunk);
    const cp = fork(process.argv[1], ["temporal-child", `--range=${from}:${to}`], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    cp.on("message", (m) => resolve(m as TemporalStats));
    cp.on("error", reject);
    cp.on("exit", (c) => { if (c !== 0) reject(new Error(`worker ${w} exit ${c}`)); });
  })));
  const total = newTemporalStats();
  for (const p of parts) {
    total.sequences += p.sequences; total.actions += p.actions; total.claimsPaid += p.claimsPaid; total.resetsCrossed += p.resetsCrossed;
    for (const [k, v] of Object.entries(p.byAction)) total.byAction[k] = (total.byAction[k] ?? 0) + v;
    total.violations.push(...p.violations);
  }
  const byInv: Record<string, number> = {};
  for (const v of total.violations) byInv[v.invariant] = (byInv[v.invariant] ?? 0) + 1;
  const report = { phase: 42, kind: "temporal", sequences: total.sequences, actions: total.actions, workers: W, byAction: total.byAction, claimsPaid: total.claimsPaid, resetsCrossed: total.resetsCrossed, violations: total.violations.length, byInvariant: byInv, sample: total.violations.slice(0, 30), ms: Math.round(performance.now() - t0) };
  writeFileSync(outName("temporal-fuzz"), JSON.stringify(report, null, 2) + "\n");
  console.log(`temporal: ${report.sequences} secuencias · ${report.actions} acciones · ${report.violations} violaciones · ${(report.ms / 1000).toFixed(0)} s`);
  return report.violations;
}

function map() {
  writeFileSync(join(OUT, "live-service-map.json"), JSON.stringify({ phase: 42, generatedAt: new Date().toISOString(), systems: LIVE_SERVICE_MAP }, null, 2) + "\n");
  console.log(`map: ${LIVE_SERVICE_MAP.length} sistemas`);
  return 0;
}

async function main() {
  if (mode === "temporal-child") { const [from, to] = arg("range", "1:2").split(":").map(Number); await temporalChild(from, to); return; }
  let bad = 0;
  if (mode === "map" || mode === "all") bad += map();
  if (mode === "priority" || mode === "all") bad += priority();
  if (mode === "return" || mode === "all") bad += returns();
  if (mode === "temporal" || mode === "all") bad += await temporal();
  if (bad > 0 && !mutate) process.exitCode = 1;
}
void main();
