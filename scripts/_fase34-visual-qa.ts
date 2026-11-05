/**
 * FASE 34 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase34-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next dev` o `next start`). Sin Supabase ni Docker. Escenas del arnés
 * `/design-system/fase34?scene=…` (QA SYNTHETIC) + rutas reales. Mide desbordamiento horizontal en cada
 * captura. `ONLY=a,b` limita escenas. Guarda en docs/product/qa/fase34/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase34");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];
const SCROLL = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;

interface Scene { n: string; scene?: string; path?: string; name: string; sizes: Size[]; act?: string; reduced?: boolean; settle?: number; note?: string }

const S: Scene[] = [
  { n: "01", scene: "full", name: "season-hub-full", sizes: ALL },
  { n: "02", scene: "anonymous", name: "anonymous", sizes: DM },
  { n: "03", scene: "new-player", name: "new-player", sizes: DM },
  { n: "04", scene: "upcoming", name: "upcoming", sizes: DM },
  { n: "05", scene: "active", name: "active", sizes: DM },
  { n: "06", scene: "ending-soon", name: "ending-soon", sizes: DM },
  { n: "07", scene: "final-day", name: "under-24h", sizes: DM },
  { n: "08", scene: "final-hour", name: "final-hour", sizes: DM },
  { n: "09", scene: "ended", name: "ended", sizes: DM },
  { n: "10", scene: "off-season", name: "off-season", sizes: DM },
  { n: "11", scene: "next-known", name: "next-season-known", sizes: ["desktop"], act: SCROLL("#calendario") },
  { n: "12", scene: "next-unknown", name: "next-season-unknown", sizes: ["desktop"], act: SCROLL("#calendario") },
  { n: "13", scene: "hero", name: "hero-desktop", sizes: ["desktop"] },
  { n: "14", scene: "hero", name: "hero-mobile", sizes: ["mobile"] },
  { n: "15", scene: "countdown", name: "countdown", sizes: ["desktop"], act: SCROLL('[role="timer"]') },
  { n: "16", scene: "server-sync", name: "server-time-sync", sizes: ["desktop"] },
  { n: "17", scene: "pass", name: "pass-overview", sizes: DM, act: SCROLL("#pase") },
  { n: "18", scene: "free-track", name: "free-track", sizes: ["desktop"], act: SCROLL('[aria-label="Carril libre"]') },
  { n: "19", scene: "competitive-track", name: "competitive-track", sizes: ["desktop"], act: SCROLL('[aria-label="Carril competitivo"]') },
  { n: "20", scene: "claimable", name: "claimable-reward", sizes: ["desktop"], act: SCROLL("#pase") },
  { n: "21", scene: "claimed", name: "claimed-reward", sizes: ["desktop"], act: SCROLL('[aria-label="Carril libre"]') },
  { n: "22", scene: "locked", name: "locked-reward", sizes: ["desktop"], act: SCROLL('[aria-label="Carril competitivo"]') },
  { n: "23", scene: "pass-xp", name: "pass-xp", sizes: ["desktop"], act: SCROLL("#pase") },
  { n: "24", scene: "account-xp", name: "account-xp-distinction", sizes: ["desktop"], act: SCROLL('[data-testid="hero-pass"]') },
  { n: "25", scene: "daily", name: "daily-objectives", sizes: ["desktop"], act: SCROLL("#objetivos") },
  { n: "26", scene: "weekly", name: "weekly-objectives", sizes: ["mobile"], act: SCROLL("#objetivos") },
  { n: "27", scene: "no-objectives", name: "no-objectives", sizes: ["desktop"], act: SCROLL("#objetivos") },
  { n: "28", scene: "competitive", name: "competitive-summary", sizes: ["desktop"], act: SCROLL("#ranked") },
  { n: "29", scene: "provisional", name: "provisional", sizes: ["desktop"], act: SCROLL("#ranked") },
  { n: "30", scene: "no-ranked", name: "no-ranked-games", sizes: ["desktop"], act: SCROLL("#ranked") },
  { n: "31", scene: "recent-ranked", name: "recent-ranked", sizes: ["mobile"], act: SCROLL("#ranked") },
  { n: "32", scene: "event-live", name: "event-live", sizes: ["desktop"], act: SCROLL("#eventos") },
  { n: "33", scene: "event-upcoming", name: "event-upcoming", sizes: ["desktop"], act: SCROLL("#eventos") },
  { n: "34", scene: "no-events", name: "no-events", sizes: ["desktop"], act: SCROLL("#eventos") },
  { n: "35", scene: "pickems-pending", name: "pickems-pending", sizes: ["desktop"], act: SCROLL('[data-testid="pickems-summary"]') },
  { n: "36", scene: "pickems-scored", name: "pickems-scored", sizes: ["desktop"], act: SCROLL('[data-testid="pickems-summary"]') },
  { n: "37", scene: "no-pickems", name: "no-pickems", sizes: ["desktop"], act: SCROLL("#eventos") },
  { n: "38", scene: "collection", name: "collection-summary", sizes: ["desktop"], act: SCROLL("#coleccion") },
  { n: "39", scene: "cards-season", name: "cards-obtained-this-season", sizes: ["desktop"], act: SCROLL("#coleccion") },
  { n: "40", scene: "achievements", name: "achievements", sizes: ["desktop"], act: SCROLL("#logros") },
  { n: "41", scene: "actions", name: "action-board", sizes: DM, act: SCROLL("#acciones") },
  { n: "42", scene: "no-actions", name: "no-actions", sizes: ["desktop"], act: SCROLL("#acciones") },
  { n: "43", scene: "calendar", name: "calendar", sizes: DM, act: SCROLL("#calendario") },
  { n: "44", scene: "recap-full", name: "recap-full", sizes: ALL, act: SCROLL("#resumen") },
  { n: "45", scene: "recap-minimal", name: "recap-minimal", sizes: DM, act: SCROLL("#resumen") },
  { n: "46", scene: "ended", name: "no-reliable-collection-history", sizes: ["desktop"], act: SCROLL('[data-testid="recap-collection-omitted"]') },
  { n: "47", scene: "archive-ended", name: "archive", sizes: DM },
  { n: "48", scene: "archive-current", name: "current-season-in-archive", sizes: ["desktop"] },
  { n: "49", scene: "invalid-season", name: "invalid-archived-season", sizes: DM },
  { n: "50", scene: "home-block", name: "home-integration", sizes: DM },
  { n: "51", scene: "profile-block", name: "profile-own-integration", sizes: DM },
  { n: "52", scene: "navigation", name: "navigation", sizes: ["desktop"] },
  { n: "53", scene: "backend-error", name: "backend-error", sizes: DM },
  { n: "54", scene: "stale", name: "stale-state", sizes: DM },
  { n: "55", scene: "pass", name: "mobile-pass", sizes: ["mobile"], act: SCROLL('[aria-label="Carril libre"]') },
  { n: "56", scene: "daily", name: "mobile-objectives", sizes: ["mobile"], act: SCROLL("#objetivos") },
  { n: "57", scene: "competitive", name: "mobile-ranked", sizes: ["mobile"], act: SCROLL("#ranked") },
  { n: "58", scene: "event-live", name: "mobile-event", sizes: ["mobile"], act: SCROLL("#eventos") },
  { n: "59", scene: "recap-full", name: "mobile-recap", sizes: ["mobile"], act: SCROLL("#resumen") },
  { n: "60", scene: "tablet", name: "tablet", sizes: ["tablet"] },
  { n: "61", scene: "keyboard", name: "keyboard", sizes: ["desktop"], act: "__KEYBOARD__" },
  { n: "62", scene: "full", name: "reduced-motion", sizes: DM, reduced: true },
  { n: "63", scene: "events-down", name: "events-unavailable", sizes: ["desktop"], act: SCROLL("#eventos") },
  { n: "64", path: "/temporada", name: "real-route-temporada", sizes: DM, settle: 5000, note: "ruta real /temporada sin Supabase local" },
  { n: "64b", path: "/temporadas", name: "real-route-temporadas", sizes: ["desktop"], settle: 5000, note: "ruta real /temporadas sin Supabase local" },
  { n: "64c", path: "/", name: "real-route-home", sizes: ["desktop"], settle: 5000, note: "vestíbulo real (sin Supabase local no hay bloque de temporada)" },
  { n: "65", scene: "no-season", name: "no-season-configured", sizes: ["desktop"] },
];

async function keyboard(t: Tab): Promise<void> {
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await t.js(`document.querySelector('[data-testid="season-hero"]')?.setAttribute("tabindex","-1"); document.querySelector('[data-testid="season-hero"]')?.focus()`);
  for (let i = 0; i < 3; i++) {
    await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(150);
  }
  await t.js(`document.activeElement?.scrollIntoView({ block: "center" })`);
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
        await t.goto(s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase34?scene=${s.scene}`, s.settle ?? 2600);
        const checks: string[] = [];
        if (s.act === "__KEYBOARD__") { await keyboard(t); checks.push("teclado"); }
        else if (s.act) { if (!(await t.js<boolean>(s.act))) checks.push("⚠ selector no encontrado"); await sleep(400); }
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        if (overflow > 0) { checks.push(`⚠ desborde ${overflow}px`); overflowTotal++; }
        const status = await t.js<string | null>(`document.querySelector("[data-status]")?.getAttribute("data-status") ?? null`);
        if (status) checks.push(`estado ${status}`);
        const file = `${s.n}-${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}`, checks: checks.join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|ERR_CONNECTION_REFUSED|supabase|Failed to load resource/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 34 — Season 1 + Live Service 2.0",
      "",
      "QA SYNTHETIC: calendario canónico REAL (`SEASON_CALENDAR`, nexus-s1) y carriles/misiones/logros reales; cifras, eventos y jugadores inventados. Los relojes de servidor de cada escena son fijos (antes, durante, últimos días, último día, última hora, terminada, entre temporadas). La «Temporada 2» de `11-*` es FICTICIA y se etiqueta en pantalla. Sin servidor, sin Supabase, sin Docker.",
      "Generadas con `npx tsx scripts/_fase34-visual-qa.ts` contra la app en :3005. `62-*` con prefers-reduced-motion; `64*` rutas reales.",
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
