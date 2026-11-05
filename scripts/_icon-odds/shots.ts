/**
 * ICON (2026-10-09) · INSTRUMENTO (fuera de CI): evidencia de los DOS sobres ICON en la tienda (tarjeta + detalle de
 * compra) y en su ficha de probabilidades, como INVITADO contra un `next start` local. Solo mira: NO compra ni abre.
 *
 *   npx next start -p 3022   y luego   BASE_URL=http://127.0.0.1:3022 npx tsx scripts/_icon-odds/shots.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "../lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3022";
const OUT = join(process.cwd(), "docs/product/qa/icon-odds/shots");
mkdirSync(OUT, { recursive: true });
const rows: Record<string, unknown>[] = [];
let fails = 0;
const check = (w: number, id: string, ok: boolean, detail: unknown) => { rows.push({ w, id, ok, detail }); if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} [${w}] ${id} ${JSON.stringify(detail).slice(0, 260)}`); };

async function waitFor(tab: Awaited<ReturnType<typeof launch>>["tab"], expr: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
}

const PACKS = [
  { id: "icon-single", price: "30.000", cards: /1 carta/, text: "Contiene exactamente 1 carta ICON garantizada." },
  { id: "icon", price: "80.000", cards: /3 cartas/, text: "Contiene exactamente 3 cartas ICON garantizadas." },
];

async function main() {
  for (const width of [1440, 390]) {
    const b = await launch({ width, height: width === 390 ? 844 : 900 });
    const { tab } = b;
    // Cada respuesta ≥ 400 con su URL (para saber QUÉ falla, no solo que algo falla).
    const bad: { url: string; status: number }[] = [];
    await tab.send("Network.enable");
    tab.on("Network.responseReceived", (p: { response: { url: string; status: number } }) => { if (p.response.status >= 400) bad.push({ url: p.response.url.replace(BASE, ""), status: p.response.status }); });
    try {
      // ── Tienda: las dos tarjetas ──
      await tab.goto(`${BASE}/tienda`, 2500);
      for (const p of PACKS) {
        const sel = `[data-product-id="pack:${p.id}"]`;
        const found = await waitFor(tab, `!!document.querySelector('${sel}')`, 25000);
        check(width, `tienda: tarjeta ${p.id}`, found, { sel });
        if (!found) continue;
        await tab.js(`document.querySelector('${sel}').scrollIntoView({block:"center"})`);
        await sleep(900);
        const card = await tab.js<any>(`(() => { const a = document.querySelector('${sel}'); return { text: a.innerText.replace(/\\s+/g, " ").trim().slice(0, 200) }; })()`);
        check(width, `tienda: ${p.id} con su precio ${p.price} (y sin el antiguo 60.000)`, card.text.includes(p.price) && !card.text.includes("60.000"), card);
        await tab.shot(join(OUT, `store-card-${p.id}-${width}.png`));
        // ── Detalle de compra (solo se abre: no se confirma nada) ──
        await tab.js(`document.querySelector('${sel} button').click()`);
        const modal = await waitFor(tab, `!!document.querySelector('[data-testid="store-purchase-modal"]')`, 8000);
        check(width, `detalle: ${p.id} se abre`, modal, {});
        if (modal) {
          await sleep(700);
          const m = await tab.js<any>(`(() => { const d = document.querySelector('[data-testid="store-purchase-modal"]'); const t = d.innerText.replace(/\\s+/g, " ");
            const icon = d.querySelector('[data-testid="odds-icon"]'); return { price: t.includes(${JSON.stringify(p.price)}), icon: icon ? icon.innerText.replace(/\\s+/g, " ") : null }; })()`);
          check(width, `detalle: ${p.id} precio y probabilidades ICON reales`, m.price && !!m.icon && m.icon.includes(p.text) && /65 % por carta/.test(m.icon) && /17,5 % por carta/.test(m.icon), m);
          await tab.js(`(() => { const s = document.querySelector('[data-testid="odds-icon"]'); if (s) s.scrollIntoView({block:"center"}); })()`);
          await sleep(500);
          await tab.shot(join(OUT, `store-detail-${p.id}-${width}.png`));
          await tab.js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
          await sleep(600);
        }
      }
      // ── Ficha de probabilidades de cada sobre ──
      for (const p of PACKS) {
        await tab.goto(`${BASE}/packs/${p.id}`, 2500);
        const ok = await waitFor(tab, `!!document.querySelector('[data-icon-odds]')`, 20000);
        const f = ok ? await tab.js<any>(`(() => { const s = document.querySelector('[data-icon-odds]'); s.scrollIntoView({block:"center"}); return s.innerText.replace(/\\s+/g, " "); })()`) : null;
        check(width, `ficha: ${p.id} enseña su frase y los pesos`, !!f && f.includes(p.text) && /65 %/.test(f) && /17,5 %/.test(f) && (p.id !== "icon" || /72,54 %/.test(f)), f);
        await sleep(500);
        await tab.shot(join(OUT, `odds-${p.id}-${width}.png`));
      }
      const errs = tab.takeErrors();
      const byUrl = [...new Map(bad.map((x) => [`${x.status} ${x.url.split("?")[0]}`, x])).keys()];
      rows.push({ w: width, id: "respuestas ≥ 400 (diagnóstico)", ok: true, detail: byUrl });
      console.log(`INFO [${width}] respuestas ≥ 400: ${JSON.stringify(byUrl)}`);
      check(width, "sin errores de consola", errs.length === 0, { errs: errs.slice(0, 3), responses: byUrl });
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, fails, rows }, null, 1) + "\n");
  console.log(`icon shots: ${rows.length - fails}/${rows.length}`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
