/* F73 · cierre — depuración de la detección de rechazos del panel (cuenta QA admin temporal; valores inválidos: el servidor no guarda nada). */
import { PERSONA_FILES, openBrowser, loginUi, goto, sleep, waitFor } from "./_fase68-lib";
PERSONA_FILES.Q = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/738eeaef-6ef7-4f65-abd1-2ca435caa596/scratchpad/qa352-creds.json";
(async () => {
  const c = await openBrowser("Q", 1440, { label: "f73c-dbg" });
  try {
    await loginUi(c, "Q"); await goto(c, "/admin/crafting", 3000);
    await waitFor(c.tab, `!!document.querySelector('[role="tablist"]')`, 20000); await sleep(800);
    const btns = await c.tab.js<string[]>(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => JSON.stringify(b.innerText.trim()))`);
    console.log("botones", btns.join(" | "));
    const clicked = await c.tab.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Nueva de sobres$/i.test((x.innerText||'').trim())); if (!b) return 'no'; b.click(); return 'ok'; })()`);
    await sleep(600);
    console.log("click nueva", clicked, "f-in?", await c.tab.js(`!!document.getElementById('f-in')`), "f-qty?", await c.tab.js(`!!document.getElementById('f-qty')`));
    const btns2 = await c.tab.js<string[]>(`[...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => JSON.stringify(b.innerText.trim()))`);
    console.log("botones tras abrir", btns2.join(" | "));
  } finally { await c.browser.close(); }
})();
