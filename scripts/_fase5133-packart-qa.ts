/**
 * ARTES OFICIALES DE SOBRE · QA visual (fuera de CI).
 *
 *   npx tsx scripts/_fase5133-packart-qa.ts
 *
 * Recorre las pantallas donde se ve un sobre —tienda, catálogo, ficha, apertura y temporada— y
 * comprueba en el NAVEGADOR lo que un test de ficheros no puede: que cada `<img>` de sobre carga
 * de verdad (`naturalWidth > 0`, ningún 404), que la proporción no se deforma y que la ruta sale
 * de la convención. Captura a `docs/product/qa/fase5133-pack-art/`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase5133-pack-art");
mkdirSync(OUT, { recursive: true });

/** Todas las imágenes de sobre de la pantalla, con su estado real de carga. */
const SONDA = `(() => {
  const imgs = [...document.querySelectorAll('img')].filter((i) => /\\/packs\\/pack-/.test(i.currentSrc || i.src));
  const fondos = [...document.querySelectorAll('*')].filter((e) => /\\/packs\\/pack-/.test(getComputedStyle(e).backgroundImage || ""));
  return {
    total: imgs.length,
    fondos: fondos.length,
    rotas: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src).split('/').pop()),
    packs: [...new Set(imgs.map((i) => (i.currentSrc || i.src).split('/').pop()))].sort(),
    sinCargar: imgs.filter((i) => !i.complete).length,
    proporciones: [...new Set(imgs.filter((i) => i.naturalWidth).map((i) => (i.naturalWidth / i.naturalHeight).toFixed(3)))],
    render: [...new Set(imgs.map((i) => { const r = i.getBoundingClientRect(); return r.width && r.height ? (r.width / r.height).toFixed(2) : "0"; }))],
    fit: [...new Set(imgs.map((i) => getComputedStyle(i).objectFit))],
  };
})()`;

async function shot(tab: Tab, name: string, settle = 700) {
  await sleep(settle);
  const r = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

interface Escena { id: string; path: string; w?: number; h?: number; gesto?: string; espera?: string }
const ESCENAS: Escena[] = [
  { id: "01-tienda-1440", path: "/tienda" },
  { id: "02-tienda-390", path: "/tienda", w: 390, h: 844 },
  { id: "03-catalogo-sobres", path: "/packs" },
  { id: "03b-equipos-1440", path: "/packs#equipos" },
  { id: "03c-equipos-390", path: "/packs#equipos", w: 390, h: 844 },
  { id: "03d-equipos-1024", path: "/packs#equipos", w: 1024, h: 768 },
  { id: "24-gama-base-1440", path: "/packs?tab=rareza#rareza" },
  { id: "25-gama-base-1024", path: "/packs?tab=rareza#rareza", w: 1024, h: 768 },
  { id: "26-gama-base-390", path: "/packs?tab=rareza#rareza", w: 390, h: 844 },
  { id: "31-ficha-inicial", path: "/packs/inicial" },
  { id: "32-ficha-inicial-390", path: "/packs/inicial", w: 390, h: 844 },
  { id: "27-ficha-bronce", path: "/packs/estandar" },
  { id: "28-ficha-plata", path: "/packs/premium" },
  { id: "29-ficha-oro", path: "/packs/oro" },
  { id: "30-ficha-oro-390", path: "/packs/oro", w: 390, h: 844 },
  { id: "22-ficha-g2", path: "/packs/team-g2" },
  { id: "23-ficha-g2-390", path: "/packs/team-g2", w: 390, h: 844 },
  { id: "19-ficha-liquid", path: "/packs/team-liquid" },
  { id: "20-ficha-karmine", path: "/packs/team-karmine" },
  { id: "21-ficha-ewc", path: "/packs/ewc" },
  { id: "04-ficha-champions", path: "/packs/champions" },
  { id: "05-ficha-icon", path: "/packs/icon" },
  { id: "06-ficha-masters-390", path: "/packs/masters", w: 390, h: 844 },
  { id: "07-ficha-emea", path: "/packs/emea" },
  { id: "08-ficha-china", path: "/packs/china" },
  { id: "09-temporada", path: "/temporada" },
  { id: "10-eventos", path: "/eventos" },
  /* Temporada y apertura piden sesión y sobres en el inventario: se ven por sus arneses. */
  { id: "12-temporada-recompensas", path: "/design-system/fase52?scene=reward-card" },
  { id: "13-temporada-carril", path: "/design-system/fase52?scene=full" },
  { id: "14-apertura-sobre", path: "/design-system/fase38?scene=stage-ready" },
  { id: "15-apertura-premium", path: "/design-system/fase38?scene=stage-ready-premium" },
  { id: "16-apertura-corte", path: "/design-system/fase38?scene=stage-opening" },
  {
    id: "11-compra-champions", path: "/tienda",
    gesto: `(() => { const b = [...document.querySelectorAll('button')].find((x) => /Comprar|Champions/i.test(x.textContent)); b?.click(); return !!b; })()`,
  },
];

(async () => {
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const filas: Record<string, unknown>[] = [];
  const red: string[] = [];
  try {
    for (const e of ESCENAS) {
      await browser.tab.resize(e.w ?? 1440, e.h ?? 900, 1);
      await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
      await browser.tab.goto(`${BASE}${e.path}`, 2500);
      if (e.gesto) { await browser.tab.js(e.gesto); await sleep(600); }
      await sleep(1500);   /* loading="lazy": medir antes de que carguen daba falsos «rotas» */
      const sonda = await browser.tab.js<Record<string, unknown>>(SONDA);
      await shot(browser.tab, e.id, 200);
      const errores = browser.tab.takeErrors();
      const fila = { escena: e.id, ...sonda, errores: errores.length, muestra: errores.slice(0, 2) };
      filas.push(fila);
      console.log(JSON.stringify(fila));
      red.push(...errores.filter((x) => /packs\/pack-/.test(x)));
    }
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "qa.json"), JSON.stringify({ base: BASE, generado: new Date().toISOString(), filas, erroresDeArte: red }, null, 2));
})();
