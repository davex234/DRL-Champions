// F70.1 · sonda: qué controles de la tienda llevan a comprar un Sobre Bronce (fuera de CI, cuenta QA K).
import { openBrowser, loginUi, goto } from "./_fase68-lib";
(async () => {
  const c = await openBrowser("K", 1440, { label: "f701-modals" });
  await loginUi(c, "K"); await goto(c, "/tienda", 3500);
  const out = await c.tab.js<string>(`JSON.stringify([...document.querySelectorAll('button, a, [role="button"]')].filter(x => { const t = (x.innerText || x.getAttribute('aria-label') || ''); return /bronce|comprar|1[.]000/i.test(t); }).map(x => x.tagName + ' | ' + (x.getAttribute('data-testid') || '') + ' | ' + (x.innerText || x.getAttribute('aria-label') || '').split('\\n').join(' / ').slice(0, 100)))`);
  console.log(out); await c.browser.close(); process.exit(0);
})();
