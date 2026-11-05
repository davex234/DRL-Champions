/**
 * FASE 44 · RENDIMIENTO BEFORE/AFTER (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-perf.ts <before|after> <baseUrl> [credsFile]
 *
 * Chrome headless (CDP) sobre una build de PRODUCCIÓN (`next start`), 1440×900. Por pantalla: tareas largas (> 50 ms,
 * PerformanceObserver `longtask`), CLS acumulado, fotogramas lentos durante 3 s tras cargar (intervalo rAF > 34 ms,
 * es decir, por debajo de ~30 FPS), nodos DOM, bytes de JS transferidos y tiempo hasta `load`. Se mide 3 veces y se
 * toma la mediana. No se afirma ningún FPS que no se haya medido aquí.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PHASE = process.argv[2] === "after" ? "after" : "before";
const BASE = process.argv[3] ?? "http://127.0.0.1:3006";
const CREDS = process.argv[4];
const OUT = join(process.cwd(), "docs/product/qa/fase44");
mkdirSync(OUT, { recursive: true });

const PAGES: { id: string; path: string; real: boolean }[] = [
  { id: "home", path: "/", real: true },
  { id: "collection", path: "/coleccion", real: true },
  { id: "deck-builder", path: "/duelos/mazos", real: true },
  { id: "campaign", path: "/jugar/road-to-champions", real: true },
  { id: "pack-legendary", path: "/design-system/fase38?scene=reveal-legendary", real: false },
  { id: "pack-summary", path: "/design-system/fase38?scene=summary-open-another", real: false },
  { id: "combat", path: "/design-system/fase33?scene=turn1-attack", real: false },
  { id: "result", path: "/design-system/fase33?scene=match-win", real: false },
];

const OBSERVER = `
  window.__f44 = { long: 0, longMs: 0, cls: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__f44.long++; window.__f44.longMs += e.duration; } }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) window.__f44.cls += e.value; } }).observe({ type: "layout-shift", buffered: true }); } catch {}
`;

async function frames(tab: Tab): Promise<{ frames: number; slow: number; worstMs: number }> {
  return tab.js(`new Promise((res) => { const t = []; let last = performance.now(); const end = last + 3000; const step = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else { const slow = t.filter((d) => d > 34).length; res({ frames: t.length, slow, worstMs: Math.round(Math.max(...t)) }); } }; requestAnimationFrame(step); })`);
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function main() {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  const b = await launch({ width: 1440, height: 900, userDataDir: CREDS ? join(CREDS, "..", `f44-perf-profile-${PHASE}`) : undefined });
  const tab = b.tab;
  const rows: Record<string, unknown>[] = [];
  let signedIn = false;
  try {
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVER });
    if (creds) {
      await tab.goto(`${BASE}/cuenta`, 4000);
      const signed = await tab.js<boolean>(`!document.querySelector('input[type="password"]')`);
      if (!signed) {
        await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
        for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break; await sleep(500); }
      }
      signedIn = await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false);
      console.log(`sesión QA: ${signedIn ? "OK" : "NO"}`);
    }
    for (const p of PAGES) {
      const runs: any[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        await tab.goto(`${BASE}${p.path}`, 4500);
        const loadMs = Date.now() - t0;
        const f = await frames(tab);
        const m = await tab.js<any>(`(() => ({ ...window.__f44, dom: document.getElementsByTagName('*').length, jsBytes: performance.getEntriesByType('resource').filter((r) => /\\.js(\\?|$)/.test(r.name)).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0), heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }))()`);
        runs.push({ loadMs, ...f, ...m });
      }
      const row = {
        id: p.id, path: p.path, real: p.real,
        longTasks: median(runs.map((r) => r.long)), longTaskMs: Math.round(median(runs.map((r) => r.longMs))),
        cls: Number(median(runs.map((r) => r.cls)).toFixed(4)),
        slowFrames: median(runs.map((r) => r.slow)), frames: median(runs.map((r) => r.frames)), worstFrameMs: median(runs.map((r) => r.worstMs)),
        domNodes: median(runs.map((r) => r.dom)), jsBytes: median(runs.map((r) => r.jsBytes)), heapMb: runs[0].heapMb,
      };
      rows.push(row);
      console.log(`  ${p.id}: long ${row.longTasks} (${row.longTaskMs} ms) · CLS ${row.cls} · frames ${row.frames} lentos ${row.slowFrames} (peor ${row.worstFrameMs} ms) · DOM ${row.domNodes} · JS ${row.jsBytes}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, `performance-${PHASE}.json`), JSON.stringify({ phase: PHASE, base: BASE, measuredAt: new Date().toISOString(), viewport: "1440x900", runsPerPage: 3, signedIn, pages: rows }, null, 2) + "\n");
}
void main();
