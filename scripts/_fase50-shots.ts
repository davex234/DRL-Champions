/**
 * FASE 50 · CAPTURAS DE LA NEXUS ARENA (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase50-shots.ts --out=before --harness=fase45 --scenes=arena-idle,turn-win
 *   npx tsx scripts/_fase50-shots.ts --out=after  --harness=fase50 --sizes=1920x1080,1440x900
 *
 * Fotografía escenas del arnés (`/design-system/<harness>?scene=…`) en los tamaños del encargo y
 * deja un PNG por escena y tamaño en `docs/product/qa/fase50/<out>/`. El arnés monta las piezas
 * REALES de la partida sobre partidas del motor puro: no hace falta sesión ni base de datos.
 *
 * Memoria (lección de la Fase 44.1): un Chrome por lote, cerrado al terminar; no arranca un lote
 * sin 2,5 GB libres; la captura va a disco en cuanto se toma.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT_NAME = arg("out") ?? "after";
const HARNESS = arg("harness") ?? "fase50";
/** Nombre del parámetro de escena del arnés (`scene` casi siempre; el del draft usa `state`). */
const PARAM = arg("param") ?? "scene";
const REDUCED = process.argv.includes("--reduced");
const WAIT = Number(arg("wait") ?? 1400);
const SIZES = (arg("sizes") ?? "1920x1080,1440x900,1366x768,1024x768,768x1024,390x844")
  .split(",").map((s) => s.split("x").map(Number) as [number, number]);
const SCENES = (arg("scenes") ?? "").split(",").filter(Boolean);
const BATCH = Number(arg("batch") ?? 6);
const OUT = join(process.cwd(), "docs/product/qa/fase50", OUT_NAME);

/**
 * Gestos antes de la foto, por escena: la selección de carta vive en el estado del tablero, así que
 * «seleccionando» y «ambas cartas» se consiguen PULSANDO, como lo haría el jugador.
 */
const GESTOS: Record<string, string> = {
  selecting: `(() => { const b = document.querySelectorAll('[aria-label="Tu mano"] button'); b[Math.min(3, b.length - 1)]?.click(); return b.length; })()`,
  both: `(() => { const b = document.querySelectorAll('[aria-label="Tu mano"] button'); b[Math.min(2, b.length - 1)]?.click(); return b.length; })()`,
};
mkdirSync(OUT, { recursive: true });

const freeMb = () => Math.round(freemem() / 1048576);

async function main() {
  if (SCENES.length === 0) throw new Error("--scenes=a,b,c es obligatorio");
  const tomas = SCENES.flatMap((scene) => SIZES.map(([w, h]) => ({ scene, w, h })));
  const hechas: { file: string; scene: string; size: string; errors: string[] }[] = [];
  console.log(`${tomas.length} tomas · ${HARNESS} · RAM libre ${freeMb()} MB`);

  for (let i = 0; i < tomas.length; i += BATCH) {
    for (let espera = 0; freeMb() < 2500 && espera < 20; espera++) await sleep(3000);
    const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--disk-cache-size=1", "--hide-scrollbars"] });
    try {
      for (const t of tomas.slice(i, i + BATCH)) {
        const file = `${t.scene}-${t.w}x${t.h}${REDUCED ? "-reduced" : ""}.png`;
        try {
          await browser.tab.resize(t.w, t.h, 1);
          await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }]);
          await browser.tab.goto(`${BASE}/design-system/${HARNESS}?${PARAM}=${t.scene}`, 900);
          await sleep(WAIT);
          if (process.argv.includes("--scroll-grid")) {
            await browser.tab.js(`(() => { const g = document.querySelector('[data-card]'); g?.scrollIntoView({ block: 'center' }); return !!g; })()`);
            await sleep(700);
          }
          if (HARNESS === "fase50" && GESTOS[t.scene]) {
            await browser.tab.js(GESTOS[t.scene]);
            await sleep(900);
          }
          if (process.argv.includes("--measure")) {
            /* Cajas de cada pieza del tablero: lo que ocupa cada una y si la mano cabe en el pliegue. */
            const m = await browser.tab.js(`(() => {
              const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.width)]; };
              const hand = [...document.querySelectorAll('[aria-label="Tu mano"] button')].map((b) => b.getBoundingClientRect());
              return JSON.stringify({
                vh: innerHeight, scrollH: document.querySelector('[data-scene]')?.scrollHeight,
                bar: r('[data-hud="partida"]'), rival: r('[data-arena="zona-rival"]'), clash: r('[data-arena="clash"]'),
                player: r('[data-arena="zona-jugador"]'), controls: r('[data-arena="controles"]'), mano: r('[data-arena="mano"]'),
                handBottom: hand.length ? Math.round(Math.max(...hand.map((b) => b.bottom))) : null,
                handVisible: hand.filter((b) => b.bottom <= innerHeight + 1).length + "/" + hand.length,
                pos: getComputedStyle(document.querySelector('[data-arena="mesa"]')).getPropertyValue('--pos'),
              });
            })()`);
            console.log(`    ${m}`);
          }
          await browser.tab.shot(join(OUT, file));
          const errors = browser.tab.takeErrors();
          hechas.push({ file, scene: t.scene, size: `${t.w}x${t.h}`, errors });
          console.log(`  ✓ ${file}${errors.length ? ` · ${errors.length} errores de consola` : ""}`);
        } catch (e) {
          console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(join(OUT, `shots-${HARNESS}${REDUCED ? "-reduced" : ""}.json`), JSON.stringify({ base: BASE, harness: HARNESS, generated: new Date().toISOString(), rows: hechas }, null, 2));
  console.log(`FIN · ${hechas.length}/${tomas.length} · RAM libre ${freeMb()} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
