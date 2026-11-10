/**
 * POST-REEMPLAZO · FILTROS DE LA COLECCIÓN (instrumento `_`, fuera de CI, SOLO LECTURA: navega sin sesión).
 *   npx tsx scripts/_postreplace-filters-shot.ts [ancho]
 * Abre el panel de filtros con «Masters L» aplicado, lo captura y lista los chips de edición y de equipo.
 */
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";
const W = Number(process.argv[2] ?? 1440);
const OUT = join(process.cwd(), "docs/product/qa/catalog-post-replace");
(async () => {
  const b = await launch({ width: W, height: W <= 430 ? 844 : 900, args: ["--in-process-gpu", "--mute-audio"] });
  try {
    await b.tab.resize(W, W <= 430 ? 844 : 900, 1);
    await b.tab.goto("http://127.0.0.1:3005/coleccion?edicion=masters-l&equipo=team-heretics", 6000);
    for (let i = 0; i < 40 && !(await b.tab.js<boolean>(`!!document.querySelector('[data-testid="collection-filters-toggle"]')`)); i++) await sleep(500);
    await b.tab.js(`document.querySelector('[data-testid="collection-filters-toggle"]').scrollIntoView({ block: "start" })`);
    await b.tab.js(`document.querySelector('[data-testid="collection-filters-toggle"]').click()`);
    await sleep(1500);
    await b.tab.js(`(document.querySelector('[data-testid="collection-filters"]') || document.body).scrollIntoView({ block: "start" })`);
    await sleep(500);
    await b.tab.shot(join(OUT, `filtros-edicion-equipo-${W}.png`));
    const info = await b.tab.js(`(() => { const f = document.querySelector('[data-testid="collection-filters"]'); const t = f ? f.innerText : ''; return {
      panel: !!f, ediciones: ['Base','Masters L','Masters SDC','Future Star','Champions S','Record Breaker','Moments'].filter((x) => t.includes(x)),
      fantasma: ['Regional','Ganadores','Exclusivas','Internacional','MVP'].filter((x) => new RegExp('\\b' + x + '\\b').test(t)),
      mojibake: /Ã|Â/.test(document.body.innerText), kru: /KRÜ Esports/.test(t), cards: document.querySelectorAll('img[src*="/cards/"]').length }; })()`);
    console.log(JSON.stringify(info), b.tab.takeErrors().slice(0, 2));
  } finally { await b.close(); }
})();
