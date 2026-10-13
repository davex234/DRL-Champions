/**
 * FASE 57.6 · QA VISUAL (instrumento `_`, fuera de CI, SOLO LECTURA). Chrome headless con perfil TEMPORAL y SIN sesión:
 * es el modo LOCAL. Para ver el desguace local se siembran duplicados en el `localStorage` de ESE perfil temporal
 * (no toca ninguna cuenta ni la BD). No compra, no abre y no pulsa ningún botón de economía.
 *
 *   npx tsx scripts/_fase57-6-shots.ts [base]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";
import { salvageValue } from "@/domain/economy/salvage";
import { getCard } from "@/data/catalog";

const BASE = process.argv[2] ?? "http://localhost:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase57-6-economy-final");
mkdirSync(OUT, { recursive: true });

const SEED = [["xross__future-star", 3], ["mada__moments", 2]] as const;
const owned = SEED.flatMap(([cardId, n]) => Array.from({ length: n }, (_, i) => ({ uid: `qa-${cardId}-${i}`, cardId, obtainedAt: 1 })));
const expectedLocal = SEED.reduce((a, [id, n]) => a + (n - 1) * salvageValue(getCard(id)!), 0);
const state = JSON.stringify({ state: { credits: 5000, ownedCards: owned }, version: 1 });

(async () => {
  const report: Record<string, unknown> = { expectedLocalSalvage: expectedLocal };
  for (const W of [1440, 390]) {
    const H = W <= 430 ? 844 : 900;
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.resize(W, H, 1);
      await b.tab.goto(`${BASE}/`, 2500);
      await b.tab.setStorage("drl-champions", state);
      for (const route of ["/tienda", "/packs", "/inventario", "/coleccion"]) {
        b.tab.takeErrors();
        await b.tab.goto(`${BASE}${route}`, 5000);
        await sleep(2500);
        const name = `${route.slice(1)}-${W}`;
        await b.tab.shot(join(OUT, `${name}.png`));
        report[name] = await b.tab.js(`(() => {
          const vw = window.innerWidth, t = document.body.innerText;
          return {
            scrollX: document.documentElement.scrollWidth - vw,
            prices: (t.match(/\\d{1,2}\\.\\d{3}\\s*créditos/g) || []).slice(0, 40),
            desguace: [...document.querySelectorAll('button')].map((b) => b.innerText.replace(/\\s+/g, ' ')).filter((s) => /Desguazar|Vender/i.test(s)),
            texto6: /un 6 %/.test(t), vender: /Vender todos|Vendidos/.test(t),
          };
        })()`);
        (report[name] as Record<string, unknown>).errors = b.tab.takeErrors();
      }
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, "runtime-shots.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1).slice(0, 5000));
})();
