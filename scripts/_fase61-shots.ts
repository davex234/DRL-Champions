/**
 * FASE 61 · CAPTURAS DE LA PARTIDA (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase61-shots.ts --out=before --shots=fase50:intro,fase50:start
 *   npx tsx scripts/_fase61-shots.ts --out=after  --shots=fase61:found,fase61:vs --sizes=1440x900,390x844
 *   npx tsx scripts/_fase61-shots.ts --out=after  --shots=... --reduced
 *   npx tsx scripts/_fase61-shots.ts --out=after  --shots=... --measure   (desbordes, imágenes rotas)
 *
 * Fotografía escenas de un arnés (`/design-system/<arnés>?scene=…`) y deja un PNG por escena y tamaño en
 * `docs/product/qa/fase61-match/screenshots/<out>/`, más un JSON con errores de consola, imágenes rotas y
 * piezas que se salen del viewport (las pantallas inmersivas RECORTAN: `scrollWidth` no lo ve).
 *
 * Los arneses montan las piezas REALES de la partida sobre partidas del MOTOR PURO con cartas reales del
 * catálogo: no hace falta sesión ni base de datos, y nada se escribe.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg("base") ?? "http://127.0.0.1:3005";
const OUT_NAME = arg("out") ?? "after";
const REDUCED = process.argv.includes("--reduced");
const MEASURE = process.argv.includes("--measure");
const WAIT = Number(arg("wait") ?? 1600);
const SIZES = (arg("sizes") ?? "1440x900,1024x768,390x844").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const SHOTS = (arg("shots") ?? "").split(",").filter(Boolean).map((s) => {
  const [harness, rest] = s.split(":");
  const [scene, waitOverride] = (rest ?? "").split("@");
  return { harness, scene, wait: waitOverride ? Number(waitOverride) : WAIT };
});
const BATCH = Number(arg("batch") ?? 6);
const OUT = join(process.cwd(), "docs/product/qa/fase61-match/screenshots", OUT_NAME);
mkdirSync(OUT, { recursive: true });

const freeMb = () => Math.round(freemem() / 1048576);

/** Medición: piezas visibles que se salen del viewport, imágenes rotas, texto de escena. */
const MEASURE_JS = `(() => {
  const W = innerWidth;
  const over = [];
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed' && e.getBoundingClientRect().width >= W) continue;
    const b = e.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right > W + 1 || b.left < -1) {
      if (e.closest('[aria-hidden="true"]')) continue;
      /* Invisible (a mitad de un fundido) o recortado por un contenedor con scroll/recorte propio que SÍ cabe:
         eso no es desbordar la página, es un carrusel. Se sube por los ancestros. */
      let hidden = false, clipped = false;
      for (let a = e; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (Number(cs.opacity) === 0) { hidden = true; break; }
        if (a !== e && cs.overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) { clipped = true; break; } }
      }
      if (hidden || clipped) continue;
      over.push((e.getAttribute('data-testid') || e.getAttribute('data-f61') || e.tagName) + ' ' + Math.round(b.left) + '..' + Math.round(b.right));
    }
  }
  const imgs = [...document.images];
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  return JSON.stringify({ w: W, h: innerHeight, docScrollW: document.documentElement.scrollWidth, overflow: over.slice(0, 12), overflowCount: over.length, images: imgs.length, broken });
})()`;

async function main() {
  if (SHOTS.length === 0) throw new Error("--shots=arnés:escena,… es obligatorio");
  const tomas = SHOTS.flatMap((s) => SIZES.map(([w, h]) => ({ ...s, w, h })));
  const hechas: { file: string; harness: string; scene: string; size: string; errors: string[]; measure?: unknown }[] = [];
  console.log(`${tomas.length} tomas · RAM libre ${freeMb()} MB`);

  for (let i = 0; i < tomas.length; i += BATCH) {
    for (let espera = 0; freeMb() < 2000 && espera < 20; espera++) await sleep(3000);
    const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--disk-cache-size=1", "--hide-scrollbars"] });
    try {
      for (const t of tomas.slice(i, i + BATCH)) {
        const file = `${t.harness}-${t.scene}-${t.w}x${t.h}${REDUCED ? "-reduced" : ""}.png`;
        try {
          await browser.tab.resize(t.w, t.h, 1);
          await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" }]);
          await browser.tab.goto(`${BASE}/design-system/${t.harness}?scene=${t.scene}`, 300);
          /* El reloj de la escena empieza al montar (tras `HydrationGate`): se espera a la raíz del arnés y DESPUÉS se
             cuenta `wait`, para fotografiar un tiempo concreto de una secuencia (p. ej. el eje antes que las cifras). */
          for (let i = 0; i < 400; i++) {
            if (await browser.tab.js(`!!document.querySelector('[data-synthetic]')`)) break;
            await sleep(50);
          }
          await sleep(t.wait);
          let measure: unknown;
          if (MEASURE) {
            measure = JSON.parse(String(await browser.tab.js(MEASURE_JS)));
          }
          await browser.tab.shot(join(OUT, file));
          const errors = browser.tab.takeErrors();
          hechas.push({ file, harness: t.harness, scene: t.scene, size: `${t.w}x${t.h}`, errors, measure });
          const m = measure as { overflowCount?: number; broken?: string[] } | undefined;
          console.log(`  ✓ ${file}${errors.length ? ` · ${errors.length} errores de consola` : ""}${m ? ` · overflow ${m.overflowCount} · rotas ${m.broken?.length}` : ""}`);
        } catch (e) {
          console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      await browser.close();
    }
  }
  const tag = arg("tag") ?? `${Date.now()}`;
  writeFileSync(join(OUT, `shots-${tag}${REDUCED ? "-reduced" : ""}.json`), JSON.stringify({ base: BASE, generated: new Date().toISOString(), reduced: REDUCED, rows: hechas }, null, 2));
  console.log(`FIN · ${hechas.length}/${tomas.length} · RAM libre ${freeMb()} MB`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
