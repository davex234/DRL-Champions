/** FASE 49 · ¿de dónde sale el aviso de hidratación? (instrumento `_`, solo lectura). */
import { readFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp";
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string };
const BASE = process.argv[3] ?? "http://127.0.0.1:3006";
(async () => {
  const b = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
  try {
    await b.tab.goto(`${BASE}/cuenta`, 3500);
    await b.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)});
      document.querySelector('form button[type="submit"]').click(); })()`);
    for (let i = 0; i < 60 && await b.tab.js<boolean>(`!!document.querySelector('input[type="password"]')`); i++) await sleep(500);
    await sleep(1500); b.tab.takeErrors();
    for (const path of ["/coleccion", "/tienda", "/tienda/creditos", "/tienda/creditos"]) {
      await b.tab.goto(`${BASE}${path}`, 5000);
      const e = b.tab.takeErrors();
      console.log(path, e.length, e.map((x) => x.split("\n").find((l) => /^\s*[+-] /.test(l)) ?? x.slice(0, 120)).slice(0, 3));
    }
    // Reduced motion (Chrome sin cabeza lo declara por defecto): nada de la tienda se anima.
    await b.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await b.tab.goto(`${BASE}/tienda/creditos`, 5000);
    console.log("reduced-motion", await b.tab.js(`[...document.querySelectorAll('.nx-credits-card, .nx-credits-hero-art, .nx-store-section, .nx-store-hero-text')].map((e) => getComputedStyle(e).animationName).filter((n) => n !== 'none').length + ' animaciones activas de ' + document.querySelectorAll('.nx-credits-card, .nx-credits-hero-art, .nx-store-section, .nx-store-hero-text').length`));
  } finally { await b.close(); }
})();
