/** FASE 68 · F68-003 exacto: equipo NUEVO + autocompletar + dos clics en la MISMA tarea sobre «Guardar equipo». Fuera de CI. */
import { openBrowser, loginUi, goto, sleep, clickText, token, snapshot } from "./_fase68-lib";
(async () => {
  const p = process.argv[2];
  const c = await openBrowser(p, 1440, { label: `diag8-${p}` });
  try {
    const t = await token(p);
    await loginUi(c, p); await goto(c, "/duelos/mazos", 3500);
    const d0 = (await snapshot(t)).decks.length;
    await clickText(c, "^[+] Nuevo equipo$|^[+] Crear equipo|^Crear mi primer equipo$"); await sleep(3000);
    await clickText(c, "^Autocompletar equipo$"); await sleep(2000);
    const dbl = await c.tab.js<boolean>(`(() => { const e = document.querySelector('[data-testid="save-team"]'); if (!e || e.disabled) return false; e.click(); e.click(); return true; })()`);
    await sleep(4000);
    const d1 = (await snapshot(t)).decks.length;
    console.log(JSON.stringify({ dbl, before: d0, after: d1, created: d1 - d0 }));
  } finally { await c.browser.close(); }
})();
