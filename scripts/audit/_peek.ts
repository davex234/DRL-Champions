/** FULL GAME AUDIT · instrumento: texto visible de unas rutas (anónimo o con sesión). */
import { readFileSync } from "node:fs";
import { openBrowser, sleep } from "../_fase68-lib";
(async () => {
  const c = await openBrowser("QA", Number(process.env.W ?? 1440), { label: "peek" });
  try {
    await c.tab.goto(`${process.env.BASE_URL}/robots.txt`, 300);
    if (process.env.QA_SESSION_FILE) await c.tab.setStorage("sb-valorosters-auth-token", readFileSync(process.env.QA_SESSION_FILE, "utf8"));
    for (const r of process.argv.slice(2)) {
      await c.tab.goto(`${process.env.BASE_URL}${r}`, 3000); await sleep(Number(process.env.WAIT ?? 2500));
      const t = await c.tab.js<string>(`(document.querySelector('main')||document.body).innerText.split(String.fromCharCode(10)).join(' | ').slice(0, ${Number(process.env.LEN ?? 300)})`);
      console.log(`== ${r} → ${await c.tab.js<string>("location.pathname+location.search")}\n${t}`);
      for (const e of c.tab.takeErrors()) console.log("   ERR", e.slice(0, 200));
    }
  } finally { await c.browser.close().catch(() => null); }
})();
