/**
 * ROSÉ · QA VISUAL (instrumento `_`, fuera de CI, SOLO LECTURA: navega SIN sesión, no compra ni abre nada).
 *
 *   npx tsx scripts/_rose-shots.ts [anchos=1440,390]
 *
 * Contra la app real (`npm run start` en :3005): Colección filtrada por equipo BBL, por edición (Base / Masters SDC)
 * y por texto «rosé»; y la ficha de cada carta. Captura y comprueba lo que se ve: nick, equipo, edición, rareza,
 * OVR, rol, las 6 estadísticas impresas y que la imagen carga.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const WIDTHS = (process.argv[2] ?? "1440,390").split(",").map(Number);
const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/rose-import");
mkdirSync(OUT, { recursive: true });

async function waitFor(tab: Tab, expr: string, ms = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(400); }
  return false;
}

const CARDS = [
  { id: "rosa__base", ovr: 72, stats: [61, 59, 56, 52, 56, 56] },
  { id: "rosa__masters-sdc", ovr: 82, stats: [72, 64, 78, 58, 57, 71] },
];

(async () => {
  const report: Record<string, unknown> = {};
  for (const W of WIDTHS) {
    const H = W <= 430 ? 844 : 900;
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.resize(W, H, 1);
      for (const [name, qs] of [["equipo-bbl", "equipo=bbl"], ["bbl-base", "equipo=bbl&edicion=base"], ["bbl-masters-sdc", "equipo=bbl&edicion=masters-sdc"], ["texto-rose", "q=rose"]] as const) {
        await b.tab.goto(`${BASE}/coleccion?${qs}`, 4000);
        await waitFor(b.tab, `document.querySelectorAll('img[src*="/cards/"]').length > 0 || /Sin resultados|Ninguna carta/i.test(document.body.innerText)`);
        await sleep(1500);
        const info = await b.tab.js(`(() => {
          const imgs = [...document.querySelectorAll('img[src*="/cards/"]')];
          const ids = imgs.map((i) => (i.getAttribute('src') || '').match(/cards\\/([^./?]+)/)?.[1]).filter(Boolean);
          return { cartas: ids, rosa: ids.filter((x) => x.startsWith('rosa__')), mojibake: /Ã|Â/.test(document.body.innerText),
            imgRota: imgs.filter((i) => i.complete && i.naturalWidth === 0).length };
        })()`);
        await b.tab.shot(join(OUT, `coleccion-${name}-${W}.png`));
        report[`coleccion ${name} ${W}`] = info;
      }
      for (const c of CARDS) {
        await b.tab.goto(`${BASE}/coleccion/carta/${c.id}`, 4000);
        await waitFor(b.tab, `/ROS[ÉE]|Rosé/i.test(document.body.innerText)`);
        await sleep(2000);
        const info = await b.tab.js<Record<string, unknown>>(`(() => {
          const t = document.body.innerText;
          const img = [...document.querySelectorAll('img[src*="/cards/${c.id}"]')];
          return {
            nick: /Ros[ée]/i.test(t), mojibake: /Ã|Â/.test(t),
            equipo: /BBL/.test(t), edicion: /${c.id.endsWith("base") ? "Base" : "Masters SDC"}/i.test(t),
            rareza: /${c.id.endsWith("base") ? "Com[uú]n" : "Poco com[uú]n"}/i.test(t),
            ovr: new RegExp('\\\\b${c.ovr}\\\\b').test(t), rol: /Iniciador|INT/i.test(t),
            stats: ${JSON.stringify(c.stats)}.every((n) => new RegExp('\\\\b' + n + '\\\\b').test(t)),
            fks: /FKS/i.test(t),
            imagen: img.length > 0 && img.every((i) => i.complete && i.naturalWidth > 0),
            texto: t.slice(0, 600),
          };
        })()`);
        await b.tab.shot(join(OUT, `ficha-${c.id}-${W}.png`));
        report[`ficha ${c.id} ${W}`] = info;
      }
      report[`errores ${W}`] = b.tab.takeErrors().slice(0, 5);
    } finally { await b.close(); }
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, (k, v) => (k === "texto" ? undefined : v), 1));
})();
