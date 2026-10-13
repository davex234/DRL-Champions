/**
 * FASE 40 · CAPTURAS QA SINTÉTICAS (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase40-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Escenas del arnés `/design-system/fase40?scene=…` (QA SYNTHETIC: hechos
 * de cuenta inventados, pantallas y dominio reales). Mide en cada captura: desbordamiento horizontal (también dentro de
 * contenedores recortados), controles < 44 px de la guía, errores de consola propios (los 404 de fotos ausentes aparte) y
 * cuántas cartas de bienvenida hay. `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase40/synthetic/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { FASE40_SCENES } from "../src/app/design-system/fase40/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase40", "synthetic");
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: [1440, 900], tablet: [1024, 800], mid: [768, 1024], mobile: [390, 844], landscape: [844, 390] } as const;
type Size = keyof typeof SIZES;
interface Shot { scene: string; name: string; size: Size; reduced?: boolean; act?: [string, string]; full?: boolean }

const shots: Shot[] = [];
for (const scene of FASE40_SCENES) for (const size of ["desktop", "tablet", "mobile"] as Size[]) shots.push({ scene, name: scene, size, full: size === "mobile" });
const REDUCED = ["welcome", "open-pack", "home-collect", "deck-ready", "deck-saved", "first-match", "match-complete-win", "journey-complete", "dismiss", "collection", "deck-builder-first", "active-draft-override", "offline", "long-text", "match-complete-loss"];
for (const scene of REDUCED) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene, name: `${scene}-reduced`, size, reduced: true });
for (const scene of ["welcome", "home-collect", "deck-saved", "journey-complete", "collection-insufficient", "first-match", "match-complete-draw", "active-pvp-override", "returning-step3", "pack-unavailable", "deck-builder-first", "long-text", "collection", "deck-autocomplete", "match-complete-win", "offline", "dismiss", "active-draft-override"]) shots.push({ scene, name: `${scene}-768`, size: "mid" });
for (const scene of ["welcome", "deck-saved", "journey-complete"]) shots.push({ scene, name: `${scene}-landscape`, size: "landscape" });
shots.push({ scene: "welcome", name: "act-dismiss", size: "desktop", act: ["dismiss", `document.querySelector('[data-testid="journey-dismiss"]')?.click()`] });
shots.push({ scene: "dismiss", name: "act-resume", size: "desktop", act: ["resume", `document.querySelector('[data-testid="journey-resume"]')?.click()`] });
shots.push({ scene: "welcome", name: "act-dismiss", size: "mobile", act: ["dismiss", `document.querySelector('[data-testid="journey-dismiss"]')?.click()`] });
shots.push({ scene: "keyboard", name: "act-tab-focus", size: "tablet", act: ["focus", `document.querySelector('[data-testid="journey-primary-cta"]')?.focus()`] });

async function metrics(t: Tab) {
  return t.js<{ overflow: boolean; clipped: number; small: number; welcomeCards: number }>(`(() => {
    const vw = window.innerWidth;
    const clipped = [...document.querySelectorAll('[data-testid^="journey-"] *')].filter((el) => !el.closest('.nx-lobby-sweep') && !el.classList.contains('nx-lobby-sweep')).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).length;
    const small = [...document.querySelectorAll('[data-testid^="journey-"] a[href], [data-testid^="journey-"] button')].filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44; }).length;
    return { overflow: document.documentElement.scrollWidth > vw + 1, clipped, small, welcomeCards: [...document.querySelectorAll('[data-testid="journey-welcome-cards"] > div')].filter((d) => d.getBoundingClientRect().height > 0).reduce((n, d) => n + d.children.length, 0) };
  })()`);
}

async function main(): Promise<void> {
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
      await t.goto(`${BASE}/design-system/fase40?scene=${s.scene}`, 2200);
      await sleep(s.scene.startsWith("deck-autocomplete") ? 1800 : 400);
      if (s.act) { await t.js(s.act[1]); await sleep(600); }
      await sleep(s.reduced ? 300 : 800);
      const m = await metrics(t);
      const all = t.takeErrors().filter((e) => !/favicon|Download the React DevTools/i.test(e));
      const missingArt = all.filter((e) => /Failed to load resource: .*404/i.test(e)).length;
      const errors = all.filter((e) => !/Failed to load resource: .*404/i.test(e));
      const file = `${String(++n).padStart(3, "0")}-${s.name}-${s.size}.png`;
      await t.shot(join(OUT, file));
      rows.push({ file, scene: s.scene, size: `${w}x${h}`, reduced: !!s.reduced, ...m, errors: errors.length, missingArt, errorText: errors.slice(0, 2) });
      console.log(`${file}  overflow=${m.overflow} clipped=${m.clipped} small<44=${m.small} errores=${errors.length} arte404=${missingArt}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflow || (r.errors as number) > 0);
  console.log(`\n${rows.length} capturas · desbordamiento ${rows.filter((r) => r.overflow).length} · recortes ${rows.filter((r) => (r.clipped as number) > 0).length} · con errores ${rows.filter((r) => (r.errors as number) > 0).length} · controles <44px en la guía (máx) ${Math.max(0, ...rows.map((r) => r.small as number))} · 404 de fotos ausentes ${rows.reduce((a, r) => a + (r.missingArt as number), 0)}`);
  process.exit(bad.length ? 1 : 0);
}

void main();
