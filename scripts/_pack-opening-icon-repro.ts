/**
 * REPRODUCCIÓN · carta ICON invisible tras el giro (instrumento de depuración, stack de QA aislado; 2026-10-15).
 * Compra Sobres ICON con créditos SINTÉTICOS y los abre a 768 px con movimiento normal hasta ver la hero indicada
 * (por defecto `mada__moments`); muestrea el giro, la opacidad y lo que se pinta en el centro de la carta, y fotografía.
 *   qa-run … scripts/_pack-opening-icon-repro.ts [cardId] [máx. sobres]
 */
import { mkdirSync } from "node:fs";
import { BASE, api, goto, loginUi, open, sleep, token, waitFor } from "./_i18n-auth-lib";

if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const WANT = process.argv[2] ?? "mada__moments"; // «any» = no parar en ninguna carta concreta
const MAX = Number(process.argv[3] ?? 6);
const WIDTH = Number(process.argv[4] ?? 768);
const TIMES = (process.argv[5] ?? "200,700,1200,2000,3000,5000").split(",").map(Number);
const OUT = "/work/docs/pack-opening-repro";
mkdirSync(OUT, { recursive: true });
const PROBE = `(() => { const f = document.querySelector('[data-face="front"]'); const flip = f?.parentElement; if (!flip) return null;
  const m = new DOMMatrix(getComputedStyle(flip).transform); const box = document.querySelector('[data-testid="hero-card-box"]').getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); const img = f.querySelector('img');
  return { angle: Math.round(Math.atan2(-m.m13, m.m11) * 180 / Math.PI), op: getComputedStyle(flip).opacity, img: img ? [img.naturalWidth, img.complete, img.getBoundingClientRect().width] : null,
    hit: hit ? hit.tagName + '.' + (hit.getAttribute('data-testid') || String(hit.className).slice(0, 24)) : null, box: [Math.round(box.width), Math.round(box.height)] }; })()`;

(async () => {
  const tok = await token("PLAYER");
  const c = await open(WIDTH, { reduced: false });
  await goto(c, "/cuenta", 1500);
  console.log("login", await loginUi(c, "PLAYER"));
  for (let n = 1; n <= MAX; n++) {
    const r = await api(tok.access, "/api/game/store", { action: "checkout", productId: "pack:icon-single", method: "GAME_CURRENCY", ref: `qa-repro-${Date.now()}` });
    if (r.status !== 200) { console.log("compra", r.status); break; }
    await goto(c, "/abrir/icon-single", 1200);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="pack-open"]')`, 20000);
    await c.tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
    await waitFor(c.tab, `document.querySelector('[data-testid="pack-opening"]')?.dataset.phase === "hero"`, 25000);
    const id = await c.tab.js<string>(`document.querySelector('[data-testid="hero-reveal"]')?.dataset.cardId ?? ""`);
    const t0 = Date.now();
    for (const at of TIMES) {
      while (Date.now() - t0 < at) await sleep(20);
      const probe = await c.tab.js(PROBE);
      await c.tab.shot(`${OUT}/${WIDTH}-${n}-${id}-${at}.png`);
      console.log(n, id, at, `+${Date.now() - t0 - at}ms`, JSON.stringify(probe));
    }
    if (id === WANT) { console.log("ENCONTRADA", WANT); break; }
  }
  await c.browser.close();
  console.log("FIN");
})();
