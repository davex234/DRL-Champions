/**
 * F67 · PRUEBA DE CARGA SEGURA (instrumento `_`, fuera de CI). SOLO LECTURAS: anónimas + una cuenta QA. Nada de economía,
 * ranked ni escrituras. Concurrencia creciente contra la app local (:3005 → túnel → Postgres del VPS) y muestreo de la
 * memoria del proceso Node real que escucha en :3005.
 *
 *   npx tsx scripts/ops/_load-test.ts load            etapas 1/5/10/25/50 × 15 s
 *   npx tsx scripts/ops/_load-test.ts soak [segundos] concurrencia 10 sostenida (por defecto 300 s)
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { login, BASE } from "../multiplayer/_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mode = process.argv[2] ?? "load";
const pidOf3005 = () => Number(execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 3005 | Select-Object -First 1).OwningProcess"`, { encoding: "utf8" }).trim());
const rssMb = (pid: number) => { try { return Math.round(Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`, { encoding: "utf8" }).trim()) / 1048576); } catch { return null; } };
const handles = (pid: number) => { try { return Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).HandleCount"`, { encoding: "utf8" }).trim()); } catch { return null; } };
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

interface Target { name: string; path: string; auth: boolean }
const TARGETS: Target[] = [
  { name: "health", path: "/api/health", auth: false },
  { name: "ready", path: "/api/ready", auth: false },
  { name: "home", path: "/", auth: false },
  { name: "competitive", path: "/api/game/competitive", auth: true },
  { name: "state", path: "/api/game/state", auth: true },
  { name: "play-status", path: "/api/game/play-status", auth: true },
];

async function stage(conc: number, seconds: number, token: string) {
  const lat: Record<string, number[]> = {}; const st: Record<string, Record<number, number>> = {};
  let n = 0; const end = Date.now() + seconds * 1000;
  const worker = async (w: number) => {
    let i = w;
    while (Date.now() < end) {
      const t = TARGETS[i++ % TARGETS.length];
      const t0 = performance.now();
      let status = 0;
      try { const r = await fetch(BASE + t.path, { headers: t.auth ? { authorization: `Bearer ${token}` } : {} }); status = r.status; await r.arrayBuffer(); } catch { status = 0; }
      const ms = performance.now() - t0;
      (lat[t.name] ??= []).push(ms); (st[t.name] ??= {}); st[t.name][status] = (st[t.name][status] ?? 0) + 1; n++;
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, (_, w) => worker(w)));
  const secs = (Date.now() - t0) / 1000;
  const all = Object.values(lat).flat();
  const statuses = Object.values(st).reduce<Record<number, number>>((m, x) => { for (const [k, v] of Object.entries(x)) m[Number(k)] = (m[Number(k)] ?? 0) + v; return m; }, {});
  const errors5xx = Object.entries(statuses).filter(([k]) => Number(k) >= 500 || Number(k) === 0).reduce((s, [, v]) => s + v, 0);
  return {
    concurrency: conc, seconds: Math.round(secs), requests: n, rps: Math.round(n / secs),
    p50: Math.round(pct(all, 0.5)!), p95: Math.round(pct(all, 0.95)!), p99: Math.round(pct(all, 0.99)!),
    statuses, rateLimited429: statuses[429] ?? 0, errorRate: +(errors5xx / Math.max(1, n)).toFixed(4),
    perTarget: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: Math.round(pct(v, 0.5)!), p95: Math.round(pct(v, 0.95)!), statuses: st[k] }])),
  };
}

(async () => {
  const C = await login("C");
  const pid = pidOf3005();
  if (mode === "load") {
    const stages: any[] = [];
    for (const c of [1, 5, 10, 25, 50]) {
      const before = rssMb(pid);
      const s = await stage(c, 15, C.token);
      stages.push({ ...s, rssMbBefore: before, rssMbAfter: rssMb(pid), handles: handles(pid) });
      console.log(`c=${c} rps=${s.rps} p50=${s.p50} p95=${s.p95} p99=${s.p99} 429=${s.rateLimited429} err=${s.errorRate}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    writeFileSync("docs/product/qa/fase67-production/load-test.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, pid, targets: TARGETS.map((t) => `${t.auth ? "QA " : "anon "}${t.path}`), writes: 0, topology: "app Next en el PC (Windows) → túnel SSH → Postgres del VPS: cada consulta paga el RTT del túnel", stages }, null, 2));
  } else {
    const secs = Number(process.argv[3] ?? 300);
    const samples: any[] = [];
    const t0 = Date.now();
    const sampler = setInterval(() => samples.push({ t: Math.round((Date.now() - t0) / 1000), rssMb: rssMb(pid), handles: handles(pid) }), 5000);
    const s = await stage(10, secs, C.token);
    clearInterval(sampler);
    const first = samples.slice(0, 6).map((x) => x.rssMb ?? 0), last = samples.slice(-6).map((x) => x.rssMb ?? 0);
    const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length));
    await new Promise((r) => setTimeout(r, 10000));
    const out = { at: new Date().toISOString(), pid, seconds: secs, concurrency: 10, requests: s.requests, rps: s.rps, p50: s.p50, p95: s.p95, p99: s.p99, statuses: s.statuses, errorRate: s.errorRate,
      rssFirstMinuteAvgMb: avg(first), rssLastMinuteAvgMb: avg(last), rssAfterIdleMb: rssMb(pid), handlesStart: samples[0]?.handles, handlesEnd: samples.at(-1)?.handles, handlesAfterIdle: handles(pid), samples };
    writeFileSync("docs/product/qa/fase67-production/memory-soak.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ ...out, samples: samples.length }, null, 2));
  }
})().catch((e) => { console.error(e); process.exit(1); });
