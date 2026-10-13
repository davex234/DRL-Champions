/**
 * FASE 46 · CAPTURAS DEL MENÚ PRINCIPAL (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase46-home-shots.ts [baseUrl] [--only=1440,390] [--hover]
 *
 * Fotografía la Home en los anchos del encargo y, con `--hover`, los tres estados de apuntado más el menú
 * secundario y el movimiento reducido. Mismo guardián de memoria que la Fase 44.1: un Chrome por lote, cierre
 * garantizado, y parada si la RAM libre baja de 2 GB (nunca se matan procesos del usuario).
 */
import { mkdirSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const HOVER = process.argv.includes("--hover");
const OUT = join(process.cwd(), "docs/product/qa/fase46");
mkdirSync(OUT, { recursive: true });

const STOP_FREE_MB = 2048;
const freeMb = () => Math.round(freemem() / 1048576);
const alto = (w: number) => (w <= 430 ? 844 : w >= 2560 ? 1440 : w >= 1920 ? 1080 : w >= 1440 ? 900 : 800);

interface Toma { nombre: string; ancho: number; hover?: string; reducido?: boolean; abrirMas?: boolean }

const tomas: Toma[] = [];
for (const w of [390, 768, 1024, 1440, 1920, 2560]) {
  if (!ONLY || ONLY.includes(String(w))) tomas.push({ nombre: `home-${w}`, ancho: w });
}
if (HOVER) {
  for (const a of ["play", "vault", "store"]) tomas.push({ nombre: `hover-${a}`, ancho: 1440, hover: `[data-action="${a}"]` });
  tomas.push({ nombre: "more-menu", ancho: 1440, abrirMas: true });
  tomas.push({ nombre: "reduced", ancho: 1440, reducido: true });
  tomas.push({ nombre: "reduced-390", ancho: 390, reducido: true });
}

async function main() {
  console.log(`${tomas.length} tomas · RAM libre ${freeMb()} MB`);
  for (let i = 0; i < tomas.length; i += 4) {
    if (freeMb() < STOP_FREE_MB) { console.log(`PARADA: RAM libre ${freeMb()} MB`); break; }
    const lote = tomas.slice(i, i + 4);
    const browser = await launch({ args: ["--in-process-gpu", "--mute-audio"] });
    try {
      for (const t of lote) {
        await browser.tab.resize(t.ancho, alto(t.ancho), 1);
        await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: t.reducido ? "reduce" : "no-preference" }]);
        await browser.tab.goto(`${BASE}/`, 1500);
        /*
         * La Home enseña el esqueleto mientras el Daily Loop no ha contestado. Con 1,4 s la captura
         * salía del ESQUELETO, no del menú. Se espera al menú de verdad —y no a un reloj— hasta 25 s.
         */
        for (let w = 0; w < 100; w++) {
          if (await browser.tab.js<boolean>(`!!document.querySelector('[data-testid="main-menu"]')`).catch(() => false)) break;
          await sleep(250);
        }
        await sleep(1200);
        if (t.hover) {
          // Apuntar de verdad: se dispara el `mouseenter`, que es lo que enciende la escena.
          await browser.tab.js(`(() => { const e = document.querySelector(${JSON.stringify(t.hover)}); if (e) { e.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } })()`);
          await sleep(700);
        }
        if (t.abrirMas) {
          await browser.tab.js(`(() => { const b = document.querySelector('[data-testid="more-toggle"]'); if (b) b.click(); })()`);
          await sleep(700);
        }
        await browser.tab.shot(join(OUT, `${t.nombre}.png`));
        const errs = browser.tab.takeErrors();
        console.log(`· ${t.nombre}${errs.length ? `  ⚠ ${errs[0]}` : ""}`);
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`FIN · RAM libre ${freeMb()} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
