/**
 * FASE 35 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase35-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next dev` o `next start`). Sin Supabase ni Docker. Escenas del arnés
 * `/design-system/fase35?scene=…` (QA SYNTHETIC: definición y rivales reales, progreso inventado) + rutas
 * reales. Mide desbordamiento horizontal en cada captura. `ONLY=a,b` limita escenas. Guarda en
 * docs/product/qa/fase35/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase35");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];
const SCROLL = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;
const SELECT_INVALID = `(() => { const b = [...document.querySelectorAll('[aria-label="Elegir equipo"] button')].find((x) => x.textContent?.includes("A medias")); b?.click(); return !!b; })()`;

interface Scene { n: string; scene?: string; path?: string; name: string; sizes: Size[]; act?: string; reduced?: boolean; settle?: number; note?: string }

const S: Scene[] = [
  { n: "01", scene: "hub-full", name: "game-modes-hub", sizes: ALL },
  { n: "02", scene: "hub-new-player", name: "hub-new-player", sizes: DM },
  { n: "03", scene: "hub-no-deck", name: "hub-no-valid-deck", sizes: DM },
  { n: "04", scene: "hub-in-match", name: "hub-in-match", sizes: ["desktop"] },
  { n: "05", scene: "hub-provisional", name: "hub-ranked-provisional", sizes: ["desktop"] },
  { n: "06", scene: "hub-signed-out", name: "hub-signed-out", sizes: DM },
  { n: "07", scene: "hub-campaign-unavailable", name: "hub-campaign-unavailable", sizes: ["desktop"] },
  { n: "08", scene: "hub-offline", name: "hub-offline", sizes: ["mobile"] },
  { n: "09", scene: "hub-campaign-complete", name: "hub-campaign-complete", sizes: ["desktop"] },
  { n: "10", scene: "map-fresh", name: "campaign-map-new-player", sizes: ALL },
  { n: "11", scene: "map-mid", name: "campaign-map-in-progress", sizes: ALL },
  { n: "12", scene: "map-chapter1-complete", name: "chapter-complete", sizes: ["desktop"] },
  { n: "13", scene: "map-near-end", name: "final-boss-available", sizes: ["desktop"], act: SCROLL('[data-chapter="c3"]') },
  { n: "14", scene: "map-complete", name: "campaign-complete", sizes: DM },
  { n: "15", scene: "map-unavailable", name: "migration-not-applied", sizes: DM },
  { n: "16", scene: "map-signed-out", name: "map-signed-out", sizes: ["desktop"] },
  { n: "17", scene: "map-offline", name: "map-offline", sizes: DM },
  { n: "18", scene: "map-backend-error", name: "backend-error", sizes: ["desktop"] },
  { n: "19", scene: "map-stale-error", name: "backend-error-with-last-snapshot", sizes: ["desktop"] },
  { n: "20", scene: "map-active-attempt", name: "node-in-progress", sizes: ["desktop"] },
  { n: "21", scene: "map-no-deck", name: "no-deck", sizes: ["desktop"] },
  { n: "22", scene: "map-first-loss", name: "first-node-lost", sizes: ["mobile"] },
  { n: "23", scene: "chapter-locked", name: "chapter-locked", sizes: ["desktop"], act: SCROLL('[data-chapter="c3"]') },
  { n: "24", scene: "node-locked", name: "node-locked", sizes: DM },
  { n: "25", scene: "node-available", name: "node-available", sizes: ["desktop"] },
  { n: "26", scene: "node-completed", name: "node-completed-replay", sizes: ["desktop"] },
  { n: "27", scene: "node-elite", name: "node-elite", sizes: ["desktop"] },
  { n: "28", scene: "node-boss", name: "node-boss", sizes: DM },
  { n: "29", scene: "node-invalid-deck", name: "node-invalid-deck-edit-team", sizes: ["desktop"] },
  { n: "30", scene: "node-no-deck", name: "node-no-deck", sizes: ["desktop"] },
  { n: "31", scene: "node-unavailable", name: "node-unavailable", sizes: ["desktop"] },
  { n: "32", scene: "node-offline", name: "node-offline", sizes: ["mobile"] },
  { n: "33", scene: "node-resume", name: "node-resume", sizes: ["desktop"] },
  { n: "34", scene: "node-busy-elsewhere", name: "other-node-in-progress", sizes: ["desktop"] },
  { n: "35", scene: "node-signed-out", name: "node-signed-out", sizes: ["desktop"] },
  { n: "36", scene: "node-mobile-sheet", name: "node-bottom-sheet", sizes: ["mobile"] },
  { n: "37", scene: "prematch-available", name: "campaign-prematch", sizes: ALL },
  { n: "38", scene: "prematch-replay", name: "prematch-replay", sizes: ["desktop"] },
  { n: "39", scene: "prematch-boss", name: "prematch-boss", sizes: DM },
  { n: "40", scene: "prematch-invalid-deck", name: "prematch-invalid-deck", sizes: ["desktop"], act: SELECT_INVALID },
  { n: "41", scene: "prematch-no-decks", name: "prematch-no-decks", sizes: ["desktop"] },
  { n: "42", scene: "prematch-locked", name: "prematch-locked", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-start"]') },
  { n: "43", scene: "prematch-error", name: "prematch-active-match-error", sizes: ["desktop"], act: SCROLL('[role="alert"]') },
  { n: "44", scene: "match-intro", name: "match-intro-campaign", sizes: DM, settle: 3400 },
  { n: "45", scene: "match-board", name: "match-board-campaign-rival", sizes: DM },
  { n: "46", scene: "result-first-clear", name: "result-node-completed", sizes: ALL, act: SCROLL('[data-testid="campaign-result"]') },
  { n: "47", scene: "result-loss", name: "result-try-again", sizes: DM, act: SCROLL('[data-testid="campaign-result"]') },
  { n: "48", scene: "result-draw", name: "result-draw", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-result"]') },
  { n: "49", scene: "result-replay-win", name: "result-replay-win", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-result"]') },
  { n: "50", scene: "result-chapter-complete", name: "result-chapter-complete", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-result"]') },
  { n: "51", scene: "result-campaign-complete", name: "result-campaign-complete", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-result"]') },
  { n: "52", scene: "result-pending-sync", name: "result-pending-sync", sizes: ["mobile"], act: SCROLL('[data-testid="campaign-result"]') },
  { n: "53", scene: "hero-progress", name: "progress-x-of-y", sizes: DM },
  { n: "54", scene: "economy", name: "first-clear-economy", sizes: ["desktop"] },
  { n: "55", scene: "notices", name: "empty-and-error-states", sizes: DM },
  { n: "56", scene: "profile-badge", name: "own-profile-integration", sizes: DM },
  { n: "57", scene: "home-nextup", name: "home-nextup-secondary", sizes: DM },
  { n: "58", scene: "navigation", name: "navigation", sizes: ["desktop"] },
  { n: "59", scene: "rival-composition", name: "rival-real-team-composition", sizes: ["desktop"], act: SCROLL('[data-testid="campaign-rival"]') },
  { n: "60", scene: "boss-node", name: "boss-node-visual", sizes: ["desktop"], act: SCROLL('[data-node="c2-n5"]') },
  { n: "61", scene: "energy-lines", name: "energy-lines", sizes: ["tablet"] },
  { n: "62", scene: "keyboard", name: "keyboard-focus-node", sizes: ["desktop"], act: "__KEYBOARD__" },
  { n: "63", scene: "reduced-motion", name: "reduced-motion", sizes: DM, reduced: true },
  { n: "64", path: "/jugar", name: "real-route-jugar", sizes: DM, settle: 6000, note: "ruta real /jugar sin Supabase local" },
  { n: "64b", path: "/jugar/road-to-champions", name: "real-route-road-to-champions", sizes: DM, settle: 6000, note: "ruta real del mapa sin Supabase local" },
  { n: "65", scene: "daily-challenges", name: "daily-pve-challenges", sizes: DM, act: SCROLL("#daily-pve") },
  { n: "66", scene: "daily-none", name: "daily-pve-none", sizes: ["desktop"], act: SCROLL("#daily-pve") },
  { n: "67", scene: "daily-error", name: "daily-pve-unavailable", sizes: ["desktop"], act: SCROLL("#daily-pve") },
];

async function keyboard(t: Tab): Promise<string> {
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await t.js(`(() => { const h = document.querySelector('[data-testid="campaign-map"]'); h?.setAttribute("tabindex", "-1"); h?.focus(); })()`);
  await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await sleep(200);
  await t.js(`document.activeElement?.scrollIntoView({ block: "center" })`);
  return t.js<string>(`document.activeElement?.getAttribute("data-node") ?? document.activeElement?.tagName ?? "?"`);
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; what: string; checks: string }[] = [];
  const errors: string[] = [];
  let overflowTotal = 0;
  try {
    for (const s of S) {
      if (only && !only.has(s.n) && !only.has(s.name) && !(s.scene && only.has(s.scene))) continue;
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w, h] = WIDTHS[size];
        await t.resize(w, h);
        await t.goto(s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase35?scene=${s.scene}`, s.settle ?? 2800);
        const checks: string[] = [];
        if (s.act === "__KEYBOARD__") checks.push(`foco en ${await keyboard(t)}`);
        else if (s.act) { if (!(await t.js<boolean>(s.act))) checks.push("⚠ selector no encontrado"); await sleep(450); }
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        if (overflow > 0) { checks.push(`⚠ desborde ${overflow}px`); overflowTotal++; }
        const nodes = await t.js<string>(`(() => { const n = [...document.querySelectorAll("[data-node][data-status]")].filter((e) => e.offsetParent !== null); const c = (s) => n.filter((e) => e.getAttribute("data-status") === s).length; return n.length ? "nodos " + c("COMPLETED") + "✓ " + c("AVAILABLE") + "◉ " + c("LOCKED") + "🔒" : ""; })()`);
        if (nodes) checks.push(nodes);
        const sheet = await t.js<string | null>(`document.querySelector('[data-testid="node-cta"]')?.getAttribute("data-cta") ?? null`);
        if (sheet) checks.push(`CTA ${sheet}`);
        const tone = await t.js<string | null>(`document.querySelector('[data-testid="campaign-result"]')?.getAttribute("data-tone") ?? null`);
        if (tone) checks.push(`resultado ${tone}`);
        const file = `${s.n}-${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}`, checks: checks.join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|ERR_CONNECTION_REFUSED|supabase|Failed to load resource/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 35 — Card Game Modes 2.0 · Road to Champions",
      "",
      "QA SYNTHETIC: definición REAL (`rtc-1`, 3 capítulos, 15 nodos), rivales REALES (equipos verificados y mazos del catálogo calculados con `buildOpponentPlan`, el mismo del servidor) y partidas del motor canónico (`qaSimulate`). Inventado: el progreso de cada escena, los equipos del jugador y los objetivos. Sin servidor, sin Supabase, sin Docker.",
      "Generadas con `npx tsx scripts/_fase35-visual-qa.ts` contra la app en :3005. `63-*` con prefers-reduced-motion; `64*` rutas reales; `65–67` desafíos del día (objetivos diarios existentes).",
      "Leyenda de nodos visibles: ✓ completado · ◉ disponible · 🔒 bloqueado.",
      "",
      "| captura | ancho | escena | comprobaciones |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.what} | ${r.checks} |`),
      "",
      `Capturas con desbordamiento horizontal: ${overflowTotal}. Errores de consola propios (sin 404 de fotos ni Supabase ausente): ${errors.length}.`,
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      "",
    ].join("\n");
    if (!only) writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => `${r.file}  ${r.checks}`).join("\n"));
    console.log(`\ncapturas: ${rows.length} · con desborde: ${overflowTotal} · errores de consola propios: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
