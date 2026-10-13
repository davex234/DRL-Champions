/**
 * FASE 41 · CAPTURAS QA SINTÉTICAS DE ECONOMÍA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase41-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`, sin túnel). Escenas del arnés `/design-system/fase41?scene=…` (QA
 * SYNTHETIC). Mide: desbordamiento horizontal, controles < 44 px en la CTA de sobres, errores de consola propios (404 de
 * fotos/escudos ausentes aparte) y el estado que pinta la CTA. `ONLY=a,b` limita escenas. Guarda en
 * docs/product/qa/fase41/synthetic/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { FASE41_SCENES } from "../src/app/design-system/fase41/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase41", "synthetic");
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof SIZES;
interface Shot { scene: string; name: string; size: Size; reduced?: boolean; focus?: boolean }

const shots: Shot[] = [];
for (const scene of FASE41_SCENES) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene, name: scene, size });
for (const scene of ["starter-claim", "starter-not-needed", "pack-insufficient", "credits-closed", "reward-capped", "objectives-mixed", "home-collect-starter", "economy-unavailable", "long-text"]) shots.push({ scene, name: `${scene}-1024`, size: "tablet" });
for (const scene of ["starter-claim", "starter-cap", "reward-granted", "home-collect-starter"]) shots.push({ scene, name: `${scene}-reduced`, size: "mobile", reduced: true });
shots.push({ scene: "starter-keyboard", name: "act-tab-focus", size: "desktop", focus: true });

async function metrics(t: Tab) {
  return t.js<{ overflow: boolean; small: number; ctaState: string | null; ctaText: string | null; disabled: boolean | null; focused: boolean }>(`(() => {
    const vw = window.innerWidth;
    const cta = document.querySelector('[data-testid="pack-cta"]');
    const btn = cta?.querySelector('button, a');
    const small = cta ? [...cta.querySelectorAll('a[href], button')].filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44 && el.tagName === 'BUTTON'; }).length : 0;
    return { overflow: document.documentElement.scrollWidth > vw + 1, small, ctaState: cta?.getAttribute('data-state') ?? null, ctaText: btn?.textContent?.trim() ?? null, disabled: btn ? btn.hasAttribute('disabled') : null, focused: !!btn && document.activeElement === btn };
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
      await t.goto(`${BASE}/design-system/fase41?scene=${s.scene}`, 2200);
      await sleep(s.focus ? 1200 : 700);
      const m = await metrics(t);
      const all = t.takeErrors().filter((e) => !/favicon|Download the React DevTools/i.test(e));
      const missingArt = all.filter((e) => /Failed to load resource: .*404/i.test(e)).length;
      const errors = all.filter((e) => !/Failed to load resource: .*404/i.test(e));
      const file = `${String(++n).padStart(3, "0")}-${s.name}-${s.size}.png`;
      await t.shot(join(OUT, file));
      rows.push({ file, scene: s.scene, size: `${w}x${h}`, reduced: !!s.reduced, ...m, errors: errors.length, missingArt, errorText: errors.slice(0, 2) });
      console.log(`${file}  overflow=${m.overflow} small<44=${m.small} cta=${m.ctaState ?? "-"}:${m.ctaText ?? "-"}${m.disabled ? " (desactivado)" : ""}${s.focus ? ` foco=${m.focused}` : ""} errores=${errors.length} arte404=${missingArt}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflow || (r.errors as number) > 0 || (r.small as number) > 0);
  console.log(`\n${rows.length} capturas · ${new Set(rows.map((r) => r.scene)).size} escenas · desbordamiento ${rows.filter((r) => r.overflow).length} · con errores ${rows.filter((r) => (r.errors as number) > 0).length} · botones <44px en la CTA ${rows.reduce((a, r) => a + (r.small as number), 0)} · 404 de fotos ausentes ${rows.reduce((a, r) => a + (r.missingArt as number), 0)}`);
  process.exit(bad.length ? 1 : 0);
}

void main();
