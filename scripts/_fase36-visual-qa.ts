/**
 * FASE 36 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase36-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Escenas del arnés `/design-system/fase36?scene=…` (QA SYNTHETIC:
 * decisión del dominio real, hechos inventados) + la ruta real `/` sin backend alcanzable (vestíbulo degradado).
 * Mide en cada captura: desbordamiento horizontal, número de h1, acción principal, insignia de directo y
 * controles interactivos del vestíbulo por debajo de 44 px. `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase36/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase36");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];
const D: Size[] = ["desktop"];
const SCROLL = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;

interface Scene { n: string; scene?: string; path?: string; name: string; sizes: Size[]; act?: string; reduced?: boolean; settle?: number; full?: boolean; note?: string }

const S: Scene[] = [
  { n: "01", scene: "normal", name: "active-player-campaign-primary", sizes: ALL },
  { n: "02", scene: "normal", name: "full-lobby", sizes: ALL, full: true },
  { n: "03", scene: "fresh", name: "fresh-account", sizes: ALL },
  { n: "04", scene: "no-deck", name: "no-deck", sizes: ALL },
  { n: "05", scene: "invalid-deck", name: "invalid-deck", sizes: ALL },
  { n: "06", scene: "match-pve", name: "active-match-pve", sizes: ALL },
  { n: "07", scene: "match-ranked", name: "active-match-ranked", sizes: ALL },
  { n: "08", scene: "match-private", name: "active-match-private", sizes: D },
  { n: "09", scene: "match-campaign", name: "active-match-campaign", sizes: D },
  { n: "10", scene: "challenge", name: "incoming-challenge", sizes: ALL },
  { n: "11", scene: "claim", name: "claimable-pass-objective", sizes: ALL },
  { n: "12", scene: "claim-achievement", name: "claimable-achievement", sizes: D },
  { n: "13", scene: "pickem", name: "pickem-pending", sizes: ALL },
  { n: "14", scene: "near-objective", name: "objective-near-completion", sizes: ALL },
  { n: "15", scene: "packs", name: "packs-available", sizes: ALL },
  { n: "16", scene: "no-packs", name: "no-packs-collection", sizes: D, act: SCROLL('[data-testid="daily-stash"]') },
  { n: "17", scene: "campaign-start", name: "campaign-not-started", sizes: D },
  { n: "18", scene: "campaign-complete", name: "campaign-completed-ranked-primary", sizes: ALL },
  { n: "19", scene: "ranked-provisional", name: "ranked-provisional", sizes: ALL, act: SCROLL('[data-testid="daily-play"]') },
  { n: "20", scene: "ranked-established", name: "ranked-established", sizes: ALL, act: SCROLL('[data-testid="daily-play"]') },
  { n: "21", scene: "live-event", name: "live-event-real-live", sizes: ALL, act: SCROLL('[data-testid="daily-live"]') },
  { n: "22", scene: "next-event", name: "next-event-upcoming", sizes: D, act: SCROLL('[data-testid="daily-live"]') },
  { n: "23", scene: "no-live", name: "no-live-events", sizes: D, act: SCROLL('[data-testid="daily-live"]') },
  { n: "24", scene: "season-ending", name: "season-ending-soon", sizes: D, act: SCROLL('[data-testid="daily-season"]') },
  { n: "25", scene: "season-ended", name: "season-ended-no-next", sizes: D, act: SCROLL('[data-testid="daily-today"]') },
  { n: "26", scene: "offline", name: "offline-last-snapshot", sizes: ALL },
  { n: "27", scene: "error-stale", name: "server-error-last-snapshot", sizes: D },
  { n: "28", scene: "loading", name: "loading-skeleton", sizes: DM },
  { n: "29", scene: "partial", name: "partial-subsystem-failure", sizes: ALL, act: SCROLL('[data-testid="daily-play"]') },
  { n: "30", scene: "all-down", name: "all-subsystems-down", sizes: D },
  { n: "31", scene: "anonymous", name: "anonymous", sizes: ALL },
  { n: "32", scene: "anonymous-live", name: "anonymous-live", sizes: ["mobile"] },
  { n: "33", scene: "reduced-motion", name: "reduced-motion", sizes: D, reduced: true },
  { n: "34", scene: "long-labels", name: "long-labels", sizes: ALL },
  { n: "35", scene: "normal", name: "today-section", sizes: ALL, act: SCROLL('[data-testid="daily-today"]') },
  { n: "36", scene: "normal", name: "season-and-xp-bars", sizes: DM, act: SCROLL('[data-testid="daily-season"]') },
  { n: "37", scene: "normal", name: "play-block", sizes: ALL, act: SCROLL('[data-testid="daily-play"]') },
  { n: "38", scene: "packs", name: "stash-block", sizes: ALL, act: SCROLL('[data-testid="daily-stash"]') },
  { n: "39", scene: "normal", name: "keyboard-focus", sizes: D, act: "__KEYBOARD__" },
  { n: "40", scene: "local", name: "local-mode", sizes: D },
  { n: "41", path: "/", name: "real-route-home-no-backend", sizes: DM, settle: 11000, note: "ruta real `/` con el túnel CERRADO: vestíbulo degradado en ≤ 8 s (sin los ~20 s de reintentos)" },
];

async function keyboard(t: Tab): Promise<string> {
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await t.js(`(() => { const h = document.querySelector('[data-testid="daily-hero"]'); h?.setAttribute("tabindex", "-1"); h?.focus(); })()`);
  await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await sleep(250);
  return t.js<string>(`(document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent ?? "?").slice(0, 40)`);
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; what: string; checks: string }[] = [];
  const errors: string[] = [];
  let overflowTotal = 0; let smallTotal = 0;
  try {
    for (const s of S) {
      if (only && !only.has(s.n) && !only.has(s.name) && !(s.scene && only.has(s.scene))) continue;
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w, h] = WIDTHS[size];
        await t.resize(w, s.full ? 3400 : h);
        const started = Date.now();
        await t.goto(s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase36?scene=${s.scene}`, s.settle ?? 3000);
        const checks: string[] = [];
        if (s.act === "__KEYBOARD__") checks.push(`foco en ${await keyboard(t)}`);
        else if (s.act) { if (!(await t.js<boolean>(s.act))) checks.push("⚠ selector no encontrado"); await sleep(450); }
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        if (overflow > 0) { checks.push(`⚠ desborde ${overflow}px`); overflowTotal++; }
        const facts = await t.js<{ h1: number; action: string | null; live: string[]; small: string[]; network: string | null; skeleton: boolean }>(`(() => {
          const lobby = document.querySelector('[data-testid="daily-lobby"]');
          const small = lobby ? [...lobby.querySelectorAll("a, button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).map((e) => (e.textContent || e.tagName).trim().slice(0, 24)) : [];
          return {
            h1: lobby ? lobby.querySelectorAll("h1").length : 0,
            action: document.querySelector('[data-testid="daily-hero"]')?.getAttribute("data-action") ?? null,
            live: [...document.querySelectorAll("[data-badge]")].map((e) => e.getAttribute("data-badge")),
            small,
            network: lobby?.getAttribute("data-network") ?? null,
            skeleton: !!document.querySelector('[data-testid="daily-skeleton"]'),
          };
        })()`);
        if (facts.skeleton) checks.push("esqueleto");
        if (facts.action) checks.push(`acción ${facts.action}`);
        if (facts.action && facts.h1 !== 1) checks.push(`⚠ h1=${facts.h1}`);
        if (facts.live.length) checks.push(`circuito ${facts.live.join("/")}`);
        if (facts.network && facts.network !== "online") checks.push(`red ${facts.network}`);
        if (facts.small.length) { checks.push(`⚠ <44px: ${facts.small.join(", ")}`); smallTotal++; }
        if (s.path) checks.push(`listo en ${Math.round((Date.now() - started) / 100) / 10} s`);
        const file = `${s.n}-${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}${s.full ? " · página completa" : ""}`, checks: checks.join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|ERR_CONNECTION_REFUSED|supabase|54521|Failed to load resource|Failed to fetch/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 36 — Daily Game Loop 2.0 (vestíbulo)",
      "",
      "**QA SYNTHETIC**: cada escena del arnés `/design-system/fase36` renderiza el vestíbulo REAL (`DailyLobby`) con la acción decidida por el dominio REAL (`buildDailyLoop` → `orderToday`) sobre hechos INVENTADOS (`src/app/design-system/fase36/fixtures.ts`). Nada de estas capturas es un dato de un jugador. La evidencia con datos reales está en el informe de la fase (smoke local contra la BD del VPS con la cuenta QA).",
      "Generadas con `npx tsx scripts/_fase36-visual-qa.ts` contra `next start` en :3005, sin túnel (la home real `41-*` enseña la degradación sin backend).",
      "Comprobaciones por captura: desbordamiento horizontal, un solo `h1`, acción principal (`data-action`), insignias del circuito, controles del vestíbulo por debajo de 44 px.",
      "",
      "| captura | ancho | escena | comprobaciones |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.what} | ${r.checks} |`),
      "",
      `Capturas: ${rows.length}. Con desbordamiento horizontal: ${overflowTotal}. Con controles < 44 px: ${smallTotal}. Errores de consola propios (sin 404 de fotos ni backend ausente): ${errors.length}.`,
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      "",
    ].join("\n");
    if (!only) writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => `${r.file}  ${r.checks}`).join("\n"));
    console.log(`\ncapturas: ${rows.length} · desborde: ${overflowTotal} · <44px: ${smallTotal} · errores propios: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
