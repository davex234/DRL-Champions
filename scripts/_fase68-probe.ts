/**
 * FASE 68 · sonda de pantallas (solo navegación, sin acciones de juego): qué testids/botones tiene cada pantalla.
 *   npx tsx scripts/_fase68-probe.ts <persona> /ruta1 /ruta2 …
 */
import { openBrowser, loginUi, goto, screen, sleep, writeRaw, collectErrors } from "./_fase68-lib";

(async () => {
  const [persona, ...paths] = process.argv.slice(2);
  const c = await openBrowser(persona, 1440, { label: `probe-${persona}` });
  const out: any = {};
  try {
    await loginUi(c, persona);
    for (const p of paths) {
      await goto(c, p, 2500);
      await sleep(1500);
      out[p] = await screen(c);
      await collectErrors(c);
    }
    out.errors = c.errors;
  } finally { await c.browser.close(); }
  writeRaw(`probe-${persona}-${Date.now()}`, out);
  for (const [k, v] of Object.entries<any>(out)) if (k !== "errors") console.log(k, JSON.stringify({ h: v.h, testids: v.testids, buttons: v.buttons }).slice(0, 1800));
  console.log("errors", JSON.stringify(out.errors).slice(0, 1500));
})().catch((e) => { console.error(e); process.exit(1); });
