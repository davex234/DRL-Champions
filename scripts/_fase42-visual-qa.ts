/**
 * FASE 42 · CAPTURAS QA SINTÉTICAS (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase42-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Escenas del arnés `/design-system/fase42?scene=…` (QA SYNTHETIC).
 * Mide en cada captura: desbordamiento horizontal, controles < 44 px dentro del vestíbulo / «Qué sigue», errores de
 * consola propios, hechos del banner de vuelta, caducidades con texto, chip de plazo del héroe y si el foco es visible.
 * `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase42/synthetic/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { FASE42_SCENES } from "../src/app/design-system/fase42/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase42", "synthetic");
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof SIZES;
interface Shot { scene: string; name: string; size: Size; reduced?: boolean; act?: string }

const shots: Shot[] = [];
for (const scene of FASE42_SCENES) for (const size of ["desktop", "tablet", "mobile"] as Size[]) shots.push({ scene, name: scene, size });
for (const scene of ["normal-today", "return-7d", "pickem-soon", "reset-imminent", "after-match", "daily-claimable", "season-ending", "active-pvp"]) for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene, name: `${scene}-reduced`, size, reduced: true });
// Teclado REAL: pulsaciones de Tab (CDP) hasta que el foco entra en el héroe; el anillo es el de `:focus-visible`.
for (const size of ["desktop", "tablet", "mobile"] as Size[]) shots.push({ scene: "normal-today", name: "act-tab-focus", size, act: "TAB:hero" });
for (const size of ["desktop", "mobile"] as Size[]) shots.push({ scene: "return-7d", name: "act-tab-focus-today", size, act: "TAB:today" });
shots.push({ scene: "normal-today", name: "act-scroll-today", size: "mobile", act: `document.querySelector('[data-testid="daily-today-daily"]')?.scrollIntoView({ block: "center" })` });
shots.push({ scene: "return-14d", name: "act-scroll-returning", size: "mobile", act: `document.querySelector('[data-testid="daily-returning"]')?.scrollIntoView({ block: "center" })` });

async function metrics(t: Tab) {
  return t.js<{ overflow: boolean; small: number; returningFacts: number; expiring: number; expiringText: boolean; heroDeadline: string | null; heroReason: boolean; nextUp: boolean; lobbyLink: boolean; focusVisible: boolean; focusIn: string | null }>(`(() => {
    const vw = window.innerWidth;
    const scope = [...document.querySelectorAll('[data-testid="daily-today-daily"], [data-testid="daily-today-weekly"], [data-testid="daily-expiring"], [data-testid="next-up-after"], [data-testid="daily-hero"]')];
    const small = scope.flatMap((s) => [...s.querySelectorAll('a[href], button')]).filter((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44; }).length;
    const ret = document.querySelector('[data-testid="daily-returning"] ul');
    const exp = [...document.querySelectorAll('[data-testid="daily-expiring"] li')];
    const dl = document.querySelector('[data-testid="daily-hero-deadline"]');
    const f = document.activeElement;
    return {
      overflow: document.documentElement.scrollWidth > vw + 1, small,
      returningFacts: ret ? ret.children.length : 0, expiring: exp.length, expiringText: exp.every((li) => /\\d/.test(li.textContent || "")),
      heroDeadline: dl ? dl.textContent : null, heroReason: !!document.querySelector('[data-testid="daily-hero-reason"]'),
      nextUp: !!document.querySelector('[data-testid="next-up-after"]'), lobbyLink: !!document.querySelector('[data-testid="next-up-lobby"]'),
      focusVisible: !!f && f !== document.body && f.matches(':focus-visible') && (getComputedStyle(f).outlineStyle !== "none" || getComputedStyle(f).boxShadow !== "none"),
      focusIn: f && f !== document.body ? (f.closest('[data-testid]')?.getAttribute('data-testid') ?? f.tagName) : null,
    };
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
      await t.goto(`${BASE}/design-system/fase42?scene=${s.scene}`, 2200);
      await sleep(500);
      if (s.act?.startsWith("TAB:")) {
        const target = s.act === "TAB:hero" ? '[data-testid="daily-hero"]' : '[data-testid="daily-today-daily"]';
        for (let i = 0; i < 60; i++) {
          await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          if (await t.js<boolean>(`!!document.activeElement?.closest('${target}')`)) break;
        }
        await t.js(`document.activeElement?.scrollIntoView({ block: "center" })`);
        await sleep(500);
      } else if (s.act) { await t.js(s.act); await sleep(700); }
      await sleep(s.reduced ? 300 : 900);
      const m = await metrics(t);
      const all = t.takeErrors().filter((e) => !/favicon|Download the React DevTools/i.test(e));
      const missingArt = all.filter((e) => /Failed to load resource: .*404/i.test(e)).length;
      const errors = all.filter((e) => !/Failed to load resource: .*404/i.test(e));
      const file = `${String(++n).padStart(3, "0")}-${s.name}-${s.size}.png`;
      await t.shot(join(OUT, file));
      rows.push({ file, scene: s.scene, size: `${w}x${h}`, reduced: !!s.reduced, synthetic: true, ...m, errors: errors.length, missingArt, errorText: errors.slice(0, 2) });
      console.log(`${file}  overflow=${m.overflow} small<44=${m.small} vuelta=${m.returningFacts} caduca=${m.expiring} plazo=${m.heroDeadline ?? "-"} errores=${errors.length}`);
    }
  } finally {
    await b.close();
  }
  writeFileSync(join(OUT, "index.json"), JSON.stringify(rows, null, 2));
  const bad = rows.filter((r) => r.overflow || (r.errors as number) > 0 || (r.returningFacts as number) > 3);
  console.log(`\n${rows.length} capturas · desbordamiento ${rows.filter((r) => r.overflow).length} · con errores ${rows.filter((r) => (r.errors as number) > 0).length} · controles <44px (máx) ${Math.max(0, ...rows.map((r) => r.small as number))} · vuelta >3 hechos ${rows.filter((r) => (r.returningFacts as number) > 3).length}`);
  process.exit(bad.length ? 1 : 0);
}

void main();
