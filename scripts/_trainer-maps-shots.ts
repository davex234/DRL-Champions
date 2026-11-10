/**
 * CAPTURAS DEL ENTRENADOR CON LOS MAPAS REALES.
 *
 * Instrumento de comprobación, no parte de CI: prefijado con `_` y fuera de `package.json`,
 * siguiendo la convención del repositorio para los medidores de fase.
 *
 * Fotografía lo que el encargo pide ver: el selector, dos mapas reales distintos (para que se
 * note que no es el mismo dibujo con otro nombre), la pizarra con fichas, y las tres anchuras.
 *
 *   npx tsx scripts/_trainer-maps-shots.ts
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
const OUT = join(ROOT, "docs", "product", "qa", "trainer-maps");
mkdirSync(OUT, { recursive: true });

/**
 * Elige un mapa del selector por su nombre visible.
 *
 * El selector es un `role="radiogroup"` de `role="radio"`, y el nombre del mapa va dentro del
 * botón junto al recuento de sitios. Se busca por el `title`, que es `«Nombre · identidad»`:
 * es lo único del botón que empieza exactamente por el nombre del mapa.
 */
const elegirMapa = (tab: { js: <T>(e: string) => Promise<T> }, nombre: string) =>
  tab.js<boolean>(`(() => {
    const b = [...document.querySelectorAll('[role="radio"]')]
      .find(e => (e.getAttribute('title') || '').toLowerCase()
        .startsWith(${JSON.stringify(nombre)}.toLowerCase() + ' '));
    if (!b) return false;
    b.scrollIntoView({ block: 'center' });
    b.click();
    return true;
  })()`);

/** Qué asset está pintando ahora mismo la capa base. Es la prueba de que el mapa es el real. */
const assetActual = (tab: { js: <T>(e: string) => Promise<T> }) =>
  tab.js<string | null>(`(() => {
    for (const i of document.querySelectorAll('image, img')) {
      const v = i.getAttribute('href') || i.getAttribute('xlink:href') || i.getAttribute('src') || '';
      if (v.includes('/maps/')) return v;
    }
    return null;
  })()`);

async function main(): Promise<void> {
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const { tab, close } = await launch({ width: 1440, height: 900 });
  let shots = 0;
  const shot = async (nombre: string): Promise<void> => {
    await tab.shot(join(OUT, `${nombre}.png`));
    shots++;
    console.log(`  ✓ ${nombre}.png`);
  };

  try {
    console.log(`\n═══ CAPTURAS DEL ENTRENADOR · MAPAS REALES ═══\n  servidor: ${BASE}\n`);

    // ── El selector, con los doce mapas reales ──
    await tab.goto(`${BASE}/entrenador`, 6000);
    await sleep(3000);
    await tab.js(`window.scrollTo(0, document.body.scrollHeight * 0.45)`);
    await sleep(2500);
    await shot("01-selector-1440");

    // ── Mapa real 1 ──
    await tab.goto(`${BASE}/entrenador/mapas`, 6000);
    await sleep(2500);
    console.log(`     asset servido: ${await assetActual(tab)}`);
    await shot("02-mapa-ascent-1440");

    // ── Mapa real 2: otro asset, otra proporción ──
    await tab.js(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(1500);
    if (await elegirMapa(tab, "Lotus")) {
      await sleep(2500);
      await tab.js(`window.scrollTo(0, 0)`);
      await sleep(1500);
      console.log(`     asset servido: ${await assetActual(tab)}`);
      await shot("03-mapa-lotus-1440");
    } else {
      console.log("  ! no se pudo elegir Lotus en el selector");
    }

    // ── La pizarra: fichas de jugador sobre el mapa real ──
    await tab.goto(`${BASE}/entrenador/strats`, 7000);
    await sleep(3000);
    console.log(`     asset servido: ${await assetActual(tab)}`);
    await shot("04-pizarra-jugadores-1440");

    // ── Las tres anchuras del encargo ──
    for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]] as const) {
      await tab.resize(w, h, 1);
      await tab.goto(`${BASE}/entrenador/mapas`, 5000);
      await sleep(2500);
      const m = await tab.js<{ overflow: number; ratio: number | null }>(`(() => {
        const de = document.documentElement;
        const img = document.querySelector('image[href], img[src*="/maps/"]');
        let ratio = null;
        if (img) {
          const b = img.getBoundingClientRect();
          if (b.height > 0) ratio = +(b.width / b.height).toFixed(3);
        }
        return { overflow: de.scrollWidth - de.clientWidth, ratio };
      })()`);
      console.log(`     ${w}px · desbordamiento ${m.overflow}px · proporción pintada ${m.ratio}`);
      await shot(`05-mapa-${w}`);
    }

    console.log(`\n  ${shots} capturas en docs/product/qa/trainer-maps/\n`);
  } finally {
    await close();
  }
}

main().catch((e) => { console.error("\n✕", e instanceof Error ? e.stack : e); process.exit(1); });
