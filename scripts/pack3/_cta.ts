import { openBrowser, sleep } from "../_fase68-lib";
(async () => {
  const c = await openBrowser("QA", 1440, { label: "cta" });
  await c.tab.goto("http://127.0.0.1:3011/design-system/fase81?scene=plata-ref&reset=1", 1500);
  for (let i = 0; i < 60; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-open"]')`)) break; await sleep(150); }
  await c.tab.js(`document.querySelector('[data-testid="pack-open"]').click()`);
  for (let i = 0; i < 80; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="pack-skip"]')`)) break; await sleep(150); }
  await c.tab.js(`document.querySelector('[data-testid="pack-skip"]').click()`); await sleep(2500);
  console.log(await c.tab.js(`[...document.querySelectorAll('[data-cta="primary"]')].map(e => (e.closest('[data-testid]')?.dataset.testid ?? '') + ' | ' + e.tagName + ' | ' + (e.textContent||'').trim().slice(0,40) + ' | ' + (e.getAttribute('href')||''))`));
  await c.browser.close();
})();
