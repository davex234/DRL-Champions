/**
 * FASE 44 · MATRIZ RESPONSIVE (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-responsive.ts <credsFile> [baseUrl]
 *
 * Anchos del encargo (320 → 2560) sobre pantallas core reales (sesión QA) y escenas de arnés (partida, resultado, resumen
 * de sobre, capas abiertas). Bloqueo = desbordamiento horizontal, CTA dominante recortado, capa (diálogo/hoja) más
 * ancha que la pantalla o sin su botón de cierre visible, o control interactivo fuera del ancho. Escribe
 * docs/product/qa/fase44/responsive-matrix.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3005";
const WIDTHS = [320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1920, 2560];
const HEIGHT = (w: number) => (w < 500 ? 844 : w < 1100 ? 1024 : w < 2000 ? 900 : 1440);
const REAL = ["/", "/jugar", "/inventario", "/coleccion", "/duelos/mazos", "/duelos/competitivo", "/temporada"];
const HARNESS = [
  "/design-system/fase44?scene=result-victory", "/design-system/fase38?scene=summary-open-another", "/design-system/fase44?scene=overlays",
  "/design-system/fase44?scene=shell-menu", "/design-system/fase33?scene=turn1-attack", "/design-system/fase39?state=pick-1", "/design-system/fase44?scene=mode-select",
];

const PROBE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const overflow = document.documentElement.scrollWidth > vw + 1;
  const offX = [...document.querySelectorAll('a[href], button')].filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; })
    .filter((el) => !el.closest('[data-carousel], .overflow-x-auto, [class*="overflow-x-auto"], [class*="snap-x"]'));
  const primaries = [...document.querySelectorAll('[data-cta="primary"], [data-game-cta]')].filter(vis);
  const clippedCta = primaries.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 || r.width < 40; }).length;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(vis);
  const badDialogs = dialogs.filter((d) => { const r = d.getBoundingClientRect(); const close = [...d.querySelectorAll('button')].find((b) => /cerrar|seguir jugando/i.test(b.getAttribute('aria-label') || b.innerText)); const cr = close ? close.getBoundingClientRect() : null; return r.width > vw + 1 || r.left < -1 || (cr && (cr.bottom > vh + 1 || cr.right > vw + 1)); }).length;
  const small = [...document.querySelectorAll('[data-cta="primary"], [data-game-cta], nav a, [role="dialog"] button')].filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.height < 40; }).length;
  return { overflow, offscreenControls: offX.length, offscreenSample: offX.slice(0, 3).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)), primaries: primaries.length, clippedCta, dialogs: dialogs.length, badDialogs, smallTargets: small };
})()`;

async function main() {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  const b = await launch({ width: 1440, height: 900, userDataDir: CREDS ? join(CREDS, "..", "f44-responsive-profile") : undefined });
  const tab = b.tab;
  const rows: any[] = [];
  try {
    if (creds) {
      await tab.goto(`${BASE}/cuenta`, 4000);
      if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
        await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
        for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break; await sleep(500); }
      }
    }
    for (const w of WIDTHS) {
      await tab.resize(w, HEIGHT(w));
      const paths = [...REAL, ...(w === 320 || w === 390 || w === 768 || w === 1024 || w === 1440 || w === 2560 ? HARNESS : [])];
      for (const p of paths) {
        await tab.goto(`${BASE}${p}`, p.startsWith("/design-system") ? 3500 : 5000);
        const m = await tab.js<any>(PROBE);
        const blockers = (m.overflow ? 1 : 0) + m.offscreenControls + m.clippedCta + m.badDialogs;
        rows.push({ width: w, path: p, ...m, blockers });
        console.log(`  ${w} ${p}: ${blockers ? `BLOQUEOS ${blockers} ${JSON.stringify(m)}` : "ok"}`);
      }
    }
  } finally {
    await b.close();
  }
  const blockers = rows.reduce((s, r) => s + r.blockers, 0);
  writeFileSync(join(process.cwd(), "docs/product/qa/fase44/responsive-matrix.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, widths: WIDTHS, screens: { real: REAL, harness: HARNESS }, rows, blockers }, null, 2) + "\n");
  console.log(`\n${rows.length} mediciones · ${blockers} bloqueos`);
}
void main();
