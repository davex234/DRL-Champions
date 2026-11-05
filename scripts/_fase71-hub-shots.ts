// F71 · capturas de /jugar y /duelos (1440 y 390) con la cuenta QA, para revisar el diseño. Fuera de CI.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openBrowser, loginUi, goto, sleep } from "./_fase68-lib";

(async () => {
  const out = join(process.cwd(), "docs/product/qa/fase71/shots");
  mkdirSync(out, { recursive: true });
  for (const w of [1440, 390]) {
    const c = await openBrowser("K", w, { label: `f71-hub-${w}` });
    try {
      await loginUi(c, "K");
      for (const [path, name] of [["/jugar", "jugar"], ["/duelos", "duelos"]] as const) {
        await goto(c, path, 3500); await sleep(1500);
        await c.tab.shot(join(out, `${name}-${w}.png`));
        const m = await c.tab.js<string>(`JSON.stringify({ hScroll: document.documentElement.scrollWidth > innerWidth + 1, text: (document.querySelector('main')||document.body).innerText.replace(/\\s+/g,' ').length })`);
        console.log(path, w, m, c.tab.takeErrors().length, "errores");
      }
    } finally { await c.browser.close(); }
  }
  process.exit(0);
})();
