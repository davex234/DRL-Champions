/**
 * FASE 39 · CAPTURAS QA SINTÉTICAS (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase39-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Estados del arnés `/design-system/fase39?state=…` (QA SYNTHETIC:
 * fotos construidas por el dominio real sobre el catálogo del código; solo el ESTADO de la run es sintético).
 * Mide en cada captura: desbordamiento horizontal, controles < 44 px dentro de la sala, errores de consola propios y
 * cuántas cartas 3D hay montadas. `ONLY=a,b` limita estados. Guarda en docs/product/qa/fase39/synthetic/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { FASE39_STATES } from "../src/app/design-system/fase39/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase39", "synthetic");
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: [1440, 900], tablet: [1024, 800], mid: [768, 1024], mobile: [390, 844], landscape: [844, 390] } as const;
type Size = keyof typeof SIZES;

interface Shot { state: string; name: string; size: Size; reduced?: boolean; act?: string; full?: boolean }
const shots: Shot[] = [];
for (const state of FASE39_STATES) for (const size of ["desktop", "tablet", "mobile"] as Size[]) shots.push({ state, name: state, size, full: size === "mobile" });
const REDUCED = ["pick-1", "pick-5", "preview", "compare", "loading-pick", "draft-complete", "gauntlet-map", "final", "in-match", "win", "completed", "failed", "abandon-confirm", "offline", "long-names"];
for (const state of REDUCED) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ state, name: `${state}-reduced`, size, reduced: true });
for (const state of ["landing", "pick-1", "pick-5", "preview", "compare", "draft-complete", "stage-3", "final", "in-match", "loss", "art-failure", "long-names"]) shots.push({ state, name: `${state}-768`, size: "mid" });
for (const state of ["pick-5", "preview", "draft-complete"]) shots.push({ state, name: `${state}-landscape`, size: "landscape" });
const ACTS: [string, string][] = [
  ["select-1", `document.querySelectorAll('[data-testid="draft-option"] button')[0]?.click()`],
  ["select-2", `document.querySelectorAll('[data-testid="draft-option"] button')[1]?.click()`],
  ["select-3", `document.querySelectorAll('[data-testid="draft-option"] button')[2]?.click()`],
  ["cancel", `document.querySelector('[data-testid="draft-cancel"]')?.click()`],
  ["abandon-open", `document.querySelector('[data-testid="draft-abandon"]')?.click()`],
  ["abandon-cancel", `document.querySelector('[data-testid="draft-abandon-no"]')?.click()`],
];

async function metrics(t: Tab) {
  return t.js<{ overflow: boolean; small: number; card3d: number; options: number }>(`(() => {
    const root = document.querySelector('[data-testid="draft-screen"]');
    const controls = root ? [...root.querySelectorAll('button, a[href]')] : [];
    const small = controls.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !el.closest('[data-testid="draft-roster"]'); }).length;
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      small,
      card3d: root ? root.querySelectorAll('[data-testid="draft-option"] button').length : 0,
      options: root ? root.querySelectorAll('[data-testid="draft-option"]').length : 0,
    };
  })()`);
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; state: string; size: string; reduced: boolean; overflow: boolean; small: number; card3d: number; errors: number; missingArt: number }[] = [];
  let n = 0;
  const run = async (s: Shot, act?: [string, string]) => {
    if (only && !only.has(s.state)) return;
    const [w, h] = SIZES[s.size];
    await t.resize(w, h);
    await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
    t.takeErrors();
    await t.goto(`${BASE}/design-system/fase39?state=${s.state}`, 1800);
    if (act) { await t.js(act[1]); await sleep(500); }
    await sleep(s.reduced ? 250 : 700);
    const m = await metrics(t);
    const all = t.takeErrors().filter((e) => !/favicon|Download the React DevTools/i.test(e));
    // Las fotos de jugador/escudo no están en el repo (public/players/README.md): el renderer canónico pide
    // `/players/{id}.png` y cae a la silueta. Esos 404 de recurso se cuentan aparte; no son errores del draft.
    const missingArt = all.filter((e) => /Failed to load resource: .*404/i.test(e)).length;
    const errors = all.filter((e) => !/Failed to load resource: .*404/i.test(e));
    const file = `${String(++n).padStart(3, "0")}-${act ? `${s.name}-${act[0]}` : s.name}-${s.size}.png`;
    await t.shot(join(OUT, file));
    rows.push({ file, state: s.state, size: `${w}x${h}`, reduced: !!s.reduced, overflow: m.overflow, small: m.small, card3d: m.card3d, errors: errors.length, missingArt });
    console.log(`${file}  overflow=${m.overflow} small<44=${m.small} card3d=${m.card3d} errores=${errors.length} arte404=${missingArt}`);
  };
  try {
    for (const s of shots) await run(s);
    for (const act of ACTS.slice(0, 4)) await run({ state: act[0] === "cancel" ? "preview" : "pick-5", name: "interaction", size: "desktop" }, act);
    for (const act of ACTS.slice(4)) await run({ state: "pick-5", name: "interaction", size: "mobile" }, act);
    await run({ state: "preview", name: "interaction", size: "mobile" }, ACTS[2]);
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflow || r.errors > 0 || r.card3d > 3);
  console.log(`\n${rows.length} capturas · desbordamiento ${rows.filter((r) => r.overflow).length} · con errores ${rows.filter((r) => r.errors > 0).length} · >3 cartas 3D ${rows.filter((r) => r.card3d > 3).length} · controles <44px (máx) ${Math.max(0, ...rows.map((r) => r.small))} · 404 de fotos ausentes (fallback canónico) ${rows.reduce((a, r) => a + r.missingArt, 0)}`);
  process.exit(bad.length ? 1 : 0);
}

void main();
