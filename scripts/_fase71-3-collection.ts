// F71.3 · el desplegable de orden de /coleccion en navegador real (cuenta QA): opciones, que cada una ordena y que
// un enlace antiguo con ?orden=player/team cae al orden por defecto. Fuera de CI.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, loginUi, goto, sleep } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
(async () => {
  const out = join(process.cwd(), "docs/product/qa/fase71");
  mkdirSync(out, { recursive: true });
  const c = await openBrowser(process.argv[2] ?? "I", 1440, { label: "f713" });
  const res: any = { steps: [] };
  try {
    await loginUi(c, process.argv[2] ?? "I");
    await goto(c, "/coleccion", 4000);
    res.options = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="collection-sort"] option')].map(o => o.textContent.trim())`);
    res.ownership = await c.tab.js<string[]>(`[...document.querySelectorAll('button, a')].map(b => (b.innerText||'').trim()).filter(t => /^(Todas|Poseídas|No conseguidas)$/i.test(t))`);
    const read = `(() => [...document.querySelectorAll('[data-testid="collection-album"] [aria-label], [data-testid="collection-album"] button')].slice(0, 24).map(e => e.getAttribute('aria-label') || '').filter(Boolean))()`;
    for (const v of ["ovr-desc", "ovr-asc", "rarity", "copies"]) {
      await c.tab.js(`(() => { const s = document.querySelector('[data-testid="collection-sort"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(1500);
      const url = await c.tab.js<string>("location.search");
      const first = await c.tab.js<string[]>(read);
      const ovrs = first.map((l) => Number(/OVR (\d+)/.exec(l)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
      res.steps.push({ sort: v, url, count: first.length, ovrs: ovrs.slice(0, 8) });
    }
    await goto(c, "/coleccion?orden=player", 3500);
    res.legacyPlayer = await c.tab.js<any>(`({ value: document.querySelector('[data-testid="collection-sort"]')?.value, error: /Algo ha fallado/i.test(document.body.innerText) })`);
    await goto(c, "/coleccion?orden=team", 3500);
    res.legacyTeam = await c.tab.js<any>(`({ value: document.querySelector('[data-testid="collection-sort"]')?.value, error: /Algo ha fallado/i.test(document.body.innerText) })`);
    res.errors = c.tab.takeErrors();
    await c.tab.shot(join(out, "shots", "collection-sort-1440.png")).catch(() => null);
  } finally { await c.browser.close(); }
  const ovrSorted = (s: any, dir: 1 | -1) => s.ovrs.every((n: number, i: number, a: number[]) => i === 0 || (a[i - 1] - n) * dir >= 0);
  res.ok = JSON.stringify(res.options) === JSON.stringify(["OVR (mayor primero)", "OVR (menor primero)", "Rareza", "Copias"])
    && ovrSorted(res.steps[0], 1) && ovrSorted(res.steps[1], -1) && res.steps.every((s: any) => s.count > 0)
    && res.legacyPlayer.value === "ovr-desc" && !res.legacyPlayer.error && res.legacyTeam.value === "ovr-desc" && !res.legacyTeam.error
    && res.errors.length === 0;
  writeFileSync(join(out, "collection-sort.json"), JSON.stringify(res, null, 2) + "\n");
  console.log(JSON.stringify(res, null, 1));
  console.log(res.ok ? "COLLECTION_SORT PASS" : "COLLECTION_SORT FAIL");
  process.exit(res.ok ? 0 : 1);
})();
