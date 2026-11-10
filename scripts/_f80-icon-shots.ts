/**
 * F80 · INSTRUMENTO (fuera de CI): el precio más ancho (Icon 60.000) en la tarjeta del catálogo y en el detalle de
 * compra, a 1440/1024/390, contra BASE_URL con la cuenta QA indicada. Solo abre el detalle: NO compra.
 *   (cwd temporal con .env.local público + tsconfig con paths)  BASE_URL=https://valorosters.com npx tsx scripts/_f80-icon-shots.ts A
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep, waitFor } from "./_fase68-lib";

const P = process.argv[2] ?? "A";
const OUT = join("C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f80-pack-prices/icon");
mkdirSync(OUT, { recursive: true });
const rows: Record<string, unknown>[] = [];
let fails = 0;
const check = (w: number, id: string, ok: boolean, detail: unknown) => { rows.push({ w, id, ok, detail }); if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} [${w}] ${id} ${JSON.stringify(detail).slice(0, 220)}`); };

async function main() {
for (const width of [1440, 1024, 390]) {
  const c = await openBrowser(P, width, { label: "f80-icon" });
  try {
    await loginUi(c, P);
    await goto(c, "/tienda", 3000);
    await waitFor(c.tab, `!!document.querySelector('[data-product-id="pack:icon"]')`, 20000);
    await c.tab.js(`document.querySelector('[data-product-id="pack:icon"]').scrollIntoView({block:"center"})`);
    await sleep(900);
    c.tab.takeErrors();
    const card = await c.tab.js<any>(`(() => { const a = document.querySelector('[data-product-id="pack:icon"]'); const p = a.querySelector('[data-testid="store-price"]'); const r = a.getBoundingClientRect(); const pr = p.getBoundingClientRect();
      return { text: (p.querySelector('.tabular-nums') || p).innerText.trim(), srOnly: (p.querySelector('.sr-only') || {}).innerText || null, priceInside: pr.left >= r.left - 0.5 && pr.right <= r.right + 0.5, priceOverflow: p.scrollWidth > p.clientWidth + 1, docOverflowX: document.documentElement.scrollWidth - innerWidth }; })()`);
    check(width, "tarjeta Icon: precio 60.000, entero, sin desbordar", card.text.replace(/\s/g, "") === "60.000" && card.priceInside && !card.priceOverflow && card.docOverflowX <= 0, card);
    await c.tab.shot(join(OUT, `card-icon-${width}.png`));
    await c.tab.js(`document.querySelector('[data-product-id="pack:icon"] button').click()`);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="store-purchase-modal"]')`, 8000);
    await sleep(700);
    const m = await c.tab.js<any>(`(() => { const d = document.querySelector('[data-testid="store-purchase-modal"]'); const r = d.getBoundingClientRect(); const t = d.innerText.replace(/\\s+/g, " ");
      const btns = [...d.querySelectorAll('button')].map(b => ({ text: b.innerText.replace(/\\s+/g, " ").trim(), disabled: b.disabled }));
      const wide = [...d.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.children.length === 0).length;
      return { inViewport: r.left >= -0.5 && r.right <= innerWidth + 0.5, has60k: /60\\.000/.test(t), insufficient: /faltan/i.test(t), confirm: btns.filter(b => /Confirmar compra/i.test(b.text)), text: t.slice(0, 260), clipped: wide }; })()`);
    check(width, "detalle Icon: dentro del viewport y precio 60.000", m.inViewport && m.has60k, { inViewport: m.inViewport, has60k: m.has60k });
    check(width, "detalle Icon: saldo insuficiente explícito y sin confirmar posible", m.insufficient && m.confirm.every((b: any) => b.disabled || !/60\.000/.test(b.text) || b.disabled), { insufficient: m.insufficient, confirm: m.confirm });
    await c.tab.shot(join(OUT, `detail-icon-${width}.png`));
    const errs = c.tab.takeErrors();
    check(width, "0 errores de consola", errs.length === 0, errs.slice(0, 3));
  } finally { await c.browser.close(); }
}
writeFileSync(join(OUT, "icon.json"), JSON.stringify({ at: new Date().toISOString(), persona: P, fails, rows }, null, 1) + "\n");
console.log(`f80 icon: ${rows.length - fails}/${rows.length}`);
process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
