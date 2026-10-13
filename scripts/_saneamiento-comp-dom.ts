/** INSTRUMENTO (no CI) — qué rinde /entrenador/composiciones sin sesión. */
import { launch } from "./lib/cdp";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
async function main() {
  const b = await launch({ width: 1440, height: 900 });
  await b.tab.goto(`${BASE}/entrenador/composiciones`, 1500);
  const r = await b.tab.js<{ h1: string; text: string; links: string[] }>(`(() => ({
    h1: (document.querySelector('h1')||{}).textContent || '(sin h1)',
    text: document.body.innerText.replace(/\s+/g,' ').slice(0, 220),
    links: [...document.querySelectorAll('main a, section a')].map(a => a.getAttribute('href')).slice(0, 12),
  }))()`);
  console.log("h1:", r.h1);
  console.log("texto:", r.text);
  console.log("enlaces:", r.links.join(", "));
  await b.close();
}
main();
