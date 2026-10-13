/**
 * FASE 38 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase38-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Escenas del arnés `/design-system/fase38?scene=…` (QA SYNTHETIC:
 * catálogo y dominio de presentación reales, resultados inventados) + la ruta real `/abrir/estandar` sin backend.
 * Mide en cada captura: desbordamiento horizontal, controles < 44 px dentro de la apertura, errores de consola propios,
 * nodos DOM y partículas vivas. `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase38/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { SCENES } from "../src/app/design-system/fase38/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase38");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];

/** Tamaños por escena: lo crítico a los tres anchos, variantes a escritorio + móvil. */
const SIZES: Record<string, Size[]> = {};
for (const name of Object.keys(SCENES)) SIZES[name] = ALL;
for (const name of ["stage-ready-premium", "stage-ready-team", "stage-hand-low", "stage-reduced-ready", "reveal-uncommon", "reveal-serial-top100", "reveal-artwork-fallback", "summary-same-twice", "summary-inventory", "summary-repeated", "status-unavailable", "status-not-found", "status-offline"]) SIZES[name] = DM;

interface Shot { n: string; scene?: string; path?: string; name: string; sizes: Size[]; act?: string; reduced?: boolean; settle?: number; full?: boolean; landscape?: boolean; note?: string }

const shots: Shot[] = Object.keys(SCENES).map((scene, i) => ({
  n: String(i + 1).padStart(2, "0"), scene, name: scene, sizes: SIZES[scene],
  reduced: scene.includes("reduced"),
  full: scene.startsWith("summary-mixed") || scene === "summary-set-complete",
}));
let k = shots.length;
const extra = (s: Omit<Shot, "n">) => shots.push({ n: String(++k).padStart(2, "0"), ...s });
extra({ scene: "summary-mixed", name: "summary-keyboard-focus", sizes: ["desktop"], act: "__KEYBOARD__" });
extra({ scene: "reveal-legendary", name: "reveal-landscape-mobile", sizes: ["mobile"], landscape: true });
extra({ scene: "summary-mixed", name: "summary-landscape-mobile", sizes: ["mobile"], landscape: true });
extra({ path: "/abrir/estandar", name: "real-route-open-no-backend", sizes: DM, settle: 9000, note: "ruta real `/abrir/estandar` sin túnel (sin sesión: inventario local)" });
extra({ path: "/abrir/no-existe", name: "real-route-pack-not-found", sizes: ["desktop"], settle: 5000, note: "ruta real con un sobre inexistente" });

async function keyboard(t: Tab): Promise<string> {
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await t.js(`document.querySelector('[data-testid="pack-summary"] h2')?.focus()`);
  for (let i = 0; i < 2; i++) {
    await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(80);
  }
  await sleep(250);
  return t.js<string>(`(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "?").trim().slice(0, 40)`);
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; what: string; checks: string }[] = [];
  const errors: string[] = [];
  let overflowTotal = 0; let smallTotal = 0; let maxParticles = 0; let maxNodes = 0;
  try {
    for (const s of shots) {
      if (only && !only.has(s.n) && !only.has(s.name) && !(s.scene && only.has(s.scene))) continue;
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w0, h0] = WIDTHS[size];
        const [w, h] = s.landscape ? [h0, w0] : [w0, h0];
        await t.resize(w, s.full ? 2600 : h);
        await t.goto(s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase38?scene=${s.scene}`, s.settle ?? 2600);
        const checks: string[] = [];
        if (s.act === "__KEYBOARD__") checks.push(`foco en «${await keyboard(t)}»`);
        await sleep(s.scene?.startsWith("stage-opening") ? 350 : 500);
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        if (overflow > 0) { checks.push(`⚠ desborde ${overflow}px`); overflowTotal++; }
        const facts = await t.js<{ small: string[]; phase: string | null; status: string | null; cards: number; particles: number; nodes: number; synthetic: boolean }>(`(() => {
          const roots = [...document.querySelectorAll('[data-testid="pack-opening"], [data-testid="pack-summary"], [data-testid="pack-status"]')];
          const small = roots.flatMap((r) => [...r.querySelectorAll("a, button")]).filter((e) => {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            return r.width > 1 && r.height > 1 && r.height < 43.5 && cs.visibility !== "hidden" && cs.pointerEvents !== "none";
          }).map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 24));
          return {
            small: [...new Set(small)],
            phase: document.querySelector('[data-testid="pack-opening"]')?.getAttribute("data-phase") ?? null,
            status: document.querySelector('[data-testid="pack-status"]')?.getAttribute("data-kind") ?? null,
            cards: document.querySelectorAll('[data-testid="summary-card"]').length,
            particles: document.querySelectorAll('[aria-hidden="true"] span, span[aria-hidden="true"]').length,
            nodes: document.querySelectorAll("*").length,
            synthetic: !!document.querySelector('[data-synthetic="true"]'),
          };
        })()`);
        if (facts.phase) checks.push(`fase ${facts.phase}`);
        if (facts.status) checks.push(`estado ${facts.status}`);
        if (facts.cards) checks.push(`${facts.cards} cartas en el resumen`);
        if (facts.small.length) { checks.push(`⚠ <44px: ${facts.small.slice(0, 5).join(", ")}`); smallTotal++; }
        checks.push(`${facts.nodes} nodos`);
        maxParticles = Math.max(maxParticles, facts.particles); maxNodes = Math.max(maxNodes, facts.nodes);
        if (!s.path && !facts.synthetic) checks.push("⚠ sin marca SYNTHETIC");
        // La marca QA SYNTHETIC por encima de la escena a pantalla completa (también con builds anteriores al ajuste del arnés).
        await t.js(`(() => { const m = document.querySelector('[data-synthetic="true"]'); if (m) { m.style.zIndex = "2147483000"; m.style.pointerEvents = "none"; } })()`);
        const file = `${s.n}-${s.name}-${w}${s.landscape ? "x" + h : ""}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}${s.landscape ? " · apaisado" : ""}`, checks: checks.join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|teams\/.*\.(png|webp)|flagcdn|404|ERR_CONNECTION_REFUSED|supabase|54521|Failed to load resource|Failed to fetch/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 38 — Pack Opening Experience 3.0 (The Reveal)",
      "",
      "**QA SYNTHETIC**: cada escena del arnés `/design-system/fase38` renderiza las piezas REALES de la apertura (`PackStage`, `CardReveal`, `PackSummary`, `PackStatus`) con planes del dominio REAL (`buildRevealPlan`) sobre RESULTADOS INVENTADOS (`src/app/design-system/fase38/fixtures.ts`). Ninguna captura de esta carpeta es una apertura real ni decide nada del sorteo; cada una lleva la marca «QA SYNTHETIC» abajo a la izquierda.",
      "Las capturas `real-route-*` son la ruta real sin backend. La evidencia contra la BD del VPS con la cuenta QA está en `real/` y en el informe de la fase.",
      "Generadas con `npx tsx scripts/_fase38-visual-qa.ts` contra `next start` en :3005.",
      "Comprobaciones por captura: desbordamiento horizontal, controles < 44 px dentro de la apertura, fase/estado, cartas del resumen, nodos DOM, marca SYNTHETIC.",
      "",
      "| captura | ancho | escena | comprobaciones |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.what} | ${r.checks} |`),
      "",
      `Capturas: ${rows.length}. Con desbordamiento horizontal: ${overflowTotal}. Con controles < 44 px: ${smallTotal}. Máximo de nodos DOM: ${maxNodes}. Errores de consola propios (sin 404 de fotos ni backend ausente): ${errors.length}.`,
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      "",
    ].join("\n");
    if (!only) writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => `${r.file}  ${r.checks}`).join("\n"));
    console.log(`\ncapturas: ${rows.length} · desborde: ${overflowTotal} · <44px: ${smallTotal} · nodos máx: ${maxNodes} · errores propios: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
