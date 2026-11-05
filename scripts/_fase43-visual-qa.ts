/**
 * FASE 43 · CAPTURAS QA SINTÉTICAS (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase43-visual-qa.ts`
 *
 * App en :3005. Escenas `/design-system/fase43?scene=…` (QA SYNTHETIC). Mide por captura: desbordamiento horizontal,
 * botones/enlaces < 44 px dentro de las piezas estratégicas, errores de consola, piezas presentes (laboratorio,
 * foco, alternativas, impacto, lectura de partida), cartas del rival no jugadas visibles (debe ser 0) y foco visible.
 * `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase43/synthetic/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { FASE43_SCENES } from "../src/app/design-system/fase43/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase43", "synthetic");
mkdirSync(OUT, { recursive: true });
const SIZES = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof SIZES;
interface Shot { scene: string; name: string; size: Size; reduced?: boolean; act?: string; scroll?: string }

const shots: Shot[] = [];
for (const scene of FASE43_SCENES) for (const size of ["desktop", "tablet", "mobile"] as Size[]) shots.push({ scene, name: scene, size });
// Lo que queda bajo el pliegue: el laboratorio en móvil y la lectura de la partida.
for (const scene of ["legal-balanced", "legal-entryfrag", "polarized", "suggest-balanced", "pareto-options"]) shots.push({ scene, name: `${scene}-lab`, size: "mobile", scroll: '[data-testid="strategy-lab"]' });
for (const scene of ["post-match-win", "post-match-loss", "ovr-tiebreak", "stat-tiebreak", "post-match-draw", "replay-summary"]) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene, name: `${scene}-reading`, size, scroll: '[data-testid="match-strategy"]' });
for (const scene of ["selected-controller", "many-alternatives", "large-5000"]) shots.push({ scene, name: `${scene}-alternatives`, size: "desktop", scroll: '[data-testid="swap-alternatives"]' });
for (const scene of ["legal-balanced", "swap-tradeoff", "post-match-win", "selected-flex"]) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene, name: `${scene}-reduced`, size, reduced: true });
for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene: "keyboard", name: "act-tab-focus", size, act: "TAB" });
shots.push({ scene: "legal-balanced", name: "act-advanced-open", size: "desktop", act: `document.querySelector('[data-testid="lab-advanced"]')?.setAttribute('open',''); document.querySelector('[data-testid="lab-advanced"]')?.scrollIntoView({block:'center'})` });
shots.push({ scene: "post-match-win", name: "act-cards-open", size: "desktop", act: `document.querySelector('[data-testid="card-performance"]')?.setAttribute('open',''); document.querySelector('[data-testid="card-performance"]')?.scrollIntoView({block:'center'})` });

async function metrics(t: Tab) {
  return t.js<{ overflow: boolean; small: number; lab: boolean; focus: boolean; alternatives: number; impact: boolean; reading: boolean; insights: number; focusVisible: boolean; focusIn: string | null }>(`(() => {
    const vw = window.innerWidth;
    const scope = [...document.querySelectorAll('[data-testid="strategy-lab"], [data-testid="card-focus"], [data-testid="strategy-impact"], [data-testid="suggest-objective"], [data-testid="match-strategy"], [data-testid="deck-compare"], [data-testid="prematch-strategy"]')];
    const small = scope.flatMap((s) => [...s.querySelectorAll('button, a[href], summary, select')]).filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44; }).length;
    const f = document.activeElement;
    return {
      overflow: document.documentElement.scrollWidth > vw + 1, small,
      lab: !!document.querySelector('[data-testid="strategy-lab"]'), focus: !!document.querySelector('[data-testid="card-focus"]'),
      alternatives: document.querySelectorAll('[data-alternative]').length, impact: !!document.querySelector('[data-testid="strategy-impact"]'),
      reading: !!document.querySelector('[data-testid="match-strategy"]'), insights: document.querySelectorAll('[data-testid="match-insights"] li').length,
      focusVisible: !!f && f !== document.body && f.matches(':focus-visible'),
      focusIn: f && f !== document.body ? (f.closest('[data-testid]')?.getAttribute('data-testid') ?? f.tagName) : null,
    };
  })()`);
}

async function main() {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: Record<string, unknown>[] = [];
  let n = 0;
  try {
    for (const s of shots) {
      if (only && !only.has(s.scene)) continue;
      const [w, h] = SIZES[s.size];
      await t.resize(w, h);
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      t.takeErrors();
      await t.goto(`${BASE}/design-system/fase43?scene=${s.scene}`, 2600);
      await sleep(700);
      if (s.scroll) { await t.js(`document.querySelector('${s.scroll}')?.scrollIntoView({ block: "start" })`); await sleep(500); }
      if (s.act === "TAB") {
        for (let i = 0; i < 80; i++) {
          await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          if (await t.js<boolean>(`!!document.activeElement?.closest('[data-slot]')`)) break;
        }
        await t.js(`document.activeElement?.scrollIntoView({ block: "center" })`);
        await sleep(400);
      } else if (s.act) { await t.js(s.act); await sleep(700); }
      await sleep(s.reduced ? 300 : 700);
      const m = await metrics(t);
      const all = t.takeErrors().filter((e) => !/favicon|Download the React DevTools/i.test(e));
      const missingArt = all.filter((e) => /Failed to load resource: .*404/i.test(e)).length;
      const errors = all.filter((e) => !/Failed to load resource: .*404/i.test(e));
      const file = `${String(++n).padStart(3, "0")}-${s.name}-${s.size}.png`;
      await t.shot(join(OUT, file));
      rows.push({ file, scene: s.scene, size: `${w}x${h}`, reduced: !!s.reduced, synthetic: true, ...m, errors: errors.length, missingArt, errorText: errors.slice(0, 2) });
      console.log(`${file}  overflow=${m.overflow} small<44=${m.small} lab=${m.lab} alts=${m.alternatives} impact=${m.impact} reading=${m.reading} errores=${errors.length}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflow || (r.errors as number) > 0);
  console.log(`\n${rows.length} capturas · desbordamiento ${rows.filter((r) => r.overflow).length} · con errores ${rows.filter((r) => (r.errors as number) > 0).length} · controles <44px (máx) ${Math.max(0, ...rows.map((r) => r.small as number))}`);
  process.exit(bad.length ? 1 : 0);
}
void main();
