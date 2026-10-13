/** FASE 68 · doble clic HUMANO (dos pulsaciones de ratón por CDP con `gap` ms) sobre un botón por texto. Fuera de CI. */
import { openBrowser, loginUi, goto, sleep, q, waitFor, token, snapshot, type Client } from "./_fase68-lib";
export async function humanDbl(c: Client, re: string, gap = 60): Promise<boolean> {
  const box = await c.tab.js<any>(`(() => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(${JSON.stringify(re)}, 'i').test((x.innerText||'').trim()) && !x.disabled); if (!b) return null; b.scrollIntoView({block:'center'}); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) return false;
  for (const clickCount of [1, 2]) {
    await c.tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount });
    await c.tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount });
    if (clickCount === 1) await sleep(gap);
  }
  c.actions += 2;
  return true;
}
if (process.argv[1]?.includes("_fase68-dblclick")) (async () => {
  const p = process.argv[2]; const gap = Number(process.argv[3] ?? 60);
  const c = await openBrowser(p, 1440, { label: `dbl-${p}` });
  try {
    const t = await token(p);
    await loginUi(c, p); await goto(c, "/tienda", 3500);
    const s0 = await snapshot(t);
    await c.tab.js(`[...document.querySelectorAll('button')].find(x => /^Comprar$/i.test((x.innerText||'').trim()) && !x.disabled)?.click()`);
    await waitFor(c.tab, q("store-purchase-modal"), 6000); await sleep(600);
    console.log("dbl", await humanDbl(c, "^Confirmar ·", gap));
    await sleep(4000);
    const s1 = await snapshot(t);
    console.log(JSON.stringify({ gap, credits: [s0.credits, s1.credits], packs: [s0.unopenedPacks, s1.unopenedPacks] }));
  } finally { await c.browser.close(); }
})();
