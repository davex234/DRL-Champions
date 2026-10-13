/**
 * INSTRUMENTO (no CI) — saneamiento post F47.
 * Comprueba en Chrome headless, a tres anchos, que el acceso a COMPOSICIONES desde el hub del
 * Entrenador se ve, no desborda y funciona; y recoge los errores de consola de cada pantalla.
 */
import { launch } from "./lib/cdp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "docs", "product", "qa");
const WIDTHS = [390, 768, 1440];
const ROUTES = ["/entrenador", "/entrenador/composiciones"];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  let bad = 0;
  for (const w of WIDTHS) {
    await t.resize(w, w < 500 ? 844 : 900);
    for (const r of ROUTES) {
      await t.goto(`${BASE}${r}`, 1400);
      const m = await t.js<{ scrollW: number; clientW: number; comp: number; compText: string; back: number }>(`(() => {
        const d = document.documentElement;
        const links = [...document.querySelectorAll('a[href="/entrenador/composiciones"]')];
        const back = document.querySelectorAll('a[href="/entrenador"]').length;
        return { scrollW: d.scrollWidth, clientW: d.clientWidth, comp: links.length,
                 compText: links.map(a => a.textContent.trim().replace(/\s+/g, ' ')).join(' | '), back };
      })()`);
      const overflow = m.scrollW > m.clientW + 1;
      if (overflow) bad++;
      console.log(`${r.padEnd(28)} ${String(w).padStart(4)}  scroll=${m.scrollW}/${m.clientW}  overflowX=${overflow ? "SÍ" : "no"}  →composiciones=${m.comp}  →entrenador=${m.back}  ${m.compText.slice(0, 60)}`);
      const errs = t.takeErrors();
      if (errs.length) { bad++; console.log("   consola:", errs.slice(0, 5).join(" ⏐ ")); }
      if (w === 390 || w === 1440) await t.shot(join(OUT, `_saneamiento-${r.replace(/\W+/g, "-").replace(/^-|-$/g, "")}-${w}.png`));
    }
  }
  await b.close();
  console.log(bad === 0 ? "OK · sin desbordes ni errores de consola" : `PROBLEMAS: ${bad}`);
  process.exit(bad === 0 ? 0 : 1);
}
main();
