/**
 * FASE 37 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase37-visual-qa.ts`
 *
 * Requiere la app servida en :3005 (`next start`). Escenas del arnés `/design-system/fase37?scene=…` (QA SYNTHETIC:
 * catálogo y dominio reales, copias inventadas) + rutas reales sin backend (carta inexistente, id con rutas, sala sin
 * túnel). Mide en cada captura: desbordamiento horizontal, número de h1, controles < 44 px dentro de la sala/ficha/
 * comparador, cartas montadas en la rejilla (≤ 48 por tanda) y estado de girar/favorito. `ONLY=a,b` limita escenas.
 * Guarda en docs/product/qa/fase37/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";
import { LEGEND_CARD } from "../src/app/design-system/fase37/fixtures";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase37");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;
const ALL: Size[] = ["desktop", "tablet", "mobile"];
const DM: Size[] = ["desktop", "mobile"];
const D: Size[] = ["desktop"];
const SCROLL = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "start" }); window.scrollBy(0, -12); return !!e; })()`;
const CLICK = (sel: string) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.scrollIntoView({ block: "center" }); e?.click(); return !!e; })()`;
const MORE = `(() => { const b = [...document.querySelectorAll("button")].find((x) => /cartas más/.test(x.textContent || "")); b?.click(); return !!b; })()`;
const AFTER_MORE = `(() => { const cards = document.querySelectorAll("[data-card]"); cards[cards.length - 1]?.scrollIntoView({ block: "end" }); return cards.length > 0; })()`;

interface Scene { n: string; scene?: string; path?: string; name: string; sizes: Size[]; act?: string; then?: string; reduced?: boolean; settle?: number; full?: boolean; note?: string }

const S: Scene[] = [
  { n: "01", scene: "hub-veteran", name: "hub-collection-hero", sizes: ALL },
  { n: "02", scene: "hub-veteran", name: "hub-full-room", sizes: D, full: true },
  { n: "03", scene: "hub-fresh", name: "hub-empty-account", sizes: ALL },
  { n: "04", scene: "hub-starter", name: "hub-starter-collection", sizes: ALL },
  { n: "05", scene: "hub-complete", name: "hub-complete-catalog-100", sizes: DM },
  { n: "06", scene: "hub-anon", name: "hub-anonymous-public-catalog", sizes: ALL },
  { n: "07", scene: "hub-local", name: "hub-local-mode", sizes: DM },
  { n: "08", scene: "hub-loading", name: "hub-loading", sizes: DM },
  { n: "09", scene: "hub-offline", name: "hub-offline-last-snapshot", sizes: ALL },
  { n: "10", scene: "hub-error-stale", name: "hub-server-error-last-snapshot", sizes: D },
  { n: "11", scene: "hub-favorites-unavailable", name: "hub-favorites-unavailable", sizes: D, act: SCROLL('[data-testid="collection-discovery"]') },
  { n: "12", scene: "hub-veteran", name: "discovery-favorites-top-near", sizes: ALL, act: SCROLL('[data-testid="collection-discovery"]') },
  { n: "13", scene: "book-team", name: "book-teams", sizes: ALL, act: SCROLL('[data-testid="collection-book"]') },
  { n: "14", scene: "book-region", name: "book-regions", sizes: D, act: SCROLL('[data-testid="collection-book"]') },
  { n: "15", scene: "book-role", name: "book-roles-flex", sizes: D, act: SCROLL('[data-testid="collection-book"]') },
  { n: "16", scene: "book-rarity", name: "book-rarities", sizes: DM, act: SCROLL('[data-testid="collection-book"]') },
  { n: "17", scene: "book-edition", name: "book-editions", sizes: D, act: SCROLL('[data-testid="collection-book"]') },
  { n: "18", scene: "hub-veteran", name: "album-grid-all", sizes: ALL, act: SCROLL('[data-testid="collection-album"]') },
  { n: "19", scene: "album-owned", name: "album-owned-only", sizes: DM, act: SCROLL('[data-testid="collection-album"]') },
  { n: "20", scene: "album-missing", name: "album-missing-only", sizes: DM, act: SCROLL('[data-testid="collection-album"]') },
  { n: "21", scene: "album-search", name: "search-player", sizes: ALL, act: SCROLL('[data-testid="collection-album"]') },
  { n: "22", scene: "album-search-diacritics", name: "search-no-diacritics", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "23", scene: "album-search-team", name: "search-team", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "24", scene: "album-no-results", name: "search-no-results", sizes: ALL, act: SCROLL('[data-testid="collection-album"]') },
  { n: "25", scene: "album-rarity", name: "filter-legendary", sizes: DM, act: SCROLL('[data-testid="collection-album"]') },
  { n: "26", scene: "album-role", name: "filter-role-flex", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "27", scene: "album-region", name: "filter-region-pacific", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "28", scene: "album-team", name: "filter-team", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "29", scene: "album-ovr", name: "filter-ovr-range", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "30", scene: "album-duplicates", name: "filter-duplicates", sizes: DM, act: SCROLL('[data-testid="collection-album"]') },
  { n: "31", scene: "album-favorites", name: "filter-favorites", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "32", scene: "album-sort-ovr-asc", name: "sort-ovr-asc", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "33", scene: "album-sort-copies", name: "sort-copies", sizes: D, act: SCROLL('[data-testid="collection-album"]') },
  { n: "35", scene: "hub-veteran", name: "filters-panel-open", sizes: ["desktop", "tablet"], act: CLICK('[data-testid="collection-filters-toggle"]'), then: SCROLL('[data-testid="collection-album"]') },
  { n: "36", scene: "hub-veteran", name: "filters-sheet-mobile", sizes: ["mobile"], act: CLICK('[data-testid="collection-filters-toggle"]') },
  { n: "37", scene: "album-combined", name: "filters-combined-chips", sizes: DM, act: SCROLL('[data-testid="collection-album"]') },
  { n: "38", scene: "hub-veteran", name: "album-load-more", sizes: D, act: MORE, then: AFTER_MORE },
  { n: "39", scene: "detail-owned", name: "detail-owned-serialized", sizes: ALL },
  { n: "40", scene: "detail-owned", name: "detail-owned-full", sizes: D, full: true },
  { n: "41", scene: "detail-owned", name: "detail-flip-back", sizes: ALL, act: CLICK('[data-testid="card-flip"]') },
  { n: "42", scene: "detail-unowned", name: "detail-unowned", sizes: ALL },
  { n: "43", scene: "detail-anon", name: "detail-anonymous-public", sizes: ALL },
  { n: "44", scene: "detail-local", name: "detail-local-mode", sizes: D },
  { n: "45", scene: "detail-duplicates", name: "detail-duplicates-no-serial", sizes: DM, act: SCROLL('[data-testid="card-copies"]') },
  { n: "46", scene: "detail-owned", name: "detail-copies-serial-1", sizes: ALL, act: SCROLL('[data-testid="card-copies"]') },
  { n: "47", scene: "detail-top10", name: "detail-serial-top10", sizes: D, act: SCROLL('[data-testid="card-copies"]') },
  { n: "48", scene: "detail-top100", name: "detail-serial-top100", sizes: D, act: SCROLL('[data-testid="card-copies"]') },
  { n: "49", scene: "detail-serial-plain", name: "detail-serial-no-prestige", sizes: D, act: SCROLL('[data-testid="card-copies"]') },
  { n: "50", scene: "detail-favorite-on", name: "detail-favorite-active", sizes: DM },
  { n: "51", scene: "detail-favorites-unavailable", name: "detail-favorites-unavailable", sizes: D },
  { n: "52", scene: "detail-showcase-full", name: "detail-showcase-full", sizes: D, act: SCROLL('[data-testid="card-copies"]') },
  { n: "53", scene: "detail-offline", name: "detail-offline-actions-disabled", sizes: DM },
  { n: "54", scene: "detail-legendary", name: "detail-legendary", sizes: DM },
  { n: "55", scene: "detail-flex", name: "detail-role-flex", sizes: D },
  { n: "56", scene: "detail-many-variants", name: "detail-player-variants", sizes: DM, act: SCROLL('[data-testid="card-variants"]') },
  { n: "57", scene: "detail-owned", name: "detail-sets-and-availability", sizes: DM, act: SCROLL('[data-testid="card-sets"]') },
  { n: "58", scene: "detail-availability-error", name: "detail-availability-isolated", sizes: D, act: SCROLL('[data-testid="card-sets"]') },
  { n: "59", scene: "detail-decks-error", name: "detail-decks-isolated", sizes: D, act: SCROLL('[data-testid="card-copies"]') },
  { n: "60", scene: "detail-message", name: "detail-showcase-added-message", sizes: D },
  { n: "61", scene: "detail-loading", name: "detail-loading", sizes: D },
  { n: "62", scene: "detail-owned", name: "detail-reduced-motion-flip", sizes: D, reduced: true, act: CLICK('[data-testid="card-flip"]') },
  { n: "63", scene: "detail-owned", name: "detail-keyboard-focus", sizes: D, act: "__KEYBOARD_DETAIL__" },
  { n: "64", scene: "detail-long-labels", name: "detail-long-labels", sizes: DM },
  { n: "65", scene: "compare-picker", name: "compare-picker-owned-first", sizes: ALL },
  { n: "66", scene: "compare-two", name: "compare-two-cards", sizes: ALL, act: SCROLL('[data-testid="compare-table"]') },
  { n: "67", scene: "compare-variants", name: "compare-player-variants", sizes: DM, act: SCROLL('[data-testid="compare-table"]') },
  { n: "68", scene: "compare-same", name: "compare-same-card", sizes: D, act: SCROLL('[data-testid="compare-table"]') },
  { n: "69", scene: "compare-unowned", name: "compare-unowned", sizes: D },
  { n: "70", scene: "hub-veteran", name: "hub-reduced-motion", sizes: D, reduced: true },
  { n: "71", scene: "hub-veteran", name: "hub-keyboard-focus", sizes: D, act: "__KEYBOARD_HUB__" },
  { n: "72", path: "/coleccion/carta/nadie__gold", name: "real-route-card-not-found", sizes: DM, settle: 4000, note: "ruta real: id con formato válido que no existe" },
  { n: "73", path: "/coleccion/carta/..%2F..%2Fetc%2Fpasswd", name: "real-route-path-traversal", sizes: D, settle: 4000, note: "ruta real: id con rutas → carta no encontrada" },
  { n: "74", path: "/coleccion/comparar?a=%3Cscript%3E", name: "real-route-compare-invalid", sizes: D, settle: 4000, note: "ruta real: comparador con id no válido" },
  { n: "75", path: `/coleccion/carta/${encodeURIComponent(LEGEND_CARD.id)}`, name: "real-route-card-public-no-backend", sizes: DM, settle: 9000, note: "ruta real: ficha pública sin túnel" },
  { n: "76", path: "/coleccion", name: "real-route-collection-no-backend", sizes: DM, settle: 11000, note: "ruta real `/coleccion` con el túnel CERRADO" },
];

async function tab(t: Tab, n: number) {
  for (let i = 0; i < n; i++) {
    await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(60);
  }
  await sleep(250);
  return t.js<string>(`(() => { const a = document.activeElement; return (a?.getAttribute("aria-label") ?? a?.getAttribute("data-testid") ?? a?.textContent ?? "?").trim().slice(0, 48); })()`);
}

async function keyboard(t: Tab, start: string, n: number): Promise<string> {
  await t.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await t.js(`(() => { const h = document.querySelector(${JSON.stringify(start)}); h?.setAttribute("tabindex", "-1"); h?.focus(); })()`);
  return tab(t, n);
}

async function main(): Promise<void> {
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; what: string; checks: string }[] = [];
  const errors: string[] = [];
  let overflowTotal = 0; let smallTotal = 0; let maxCards = 0;
  try {
    for (const s of S) {
      if (only && !only.has(s.n) && !only.has(s.name) && !(s.scene && only.has(s.scene))) continue;
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w, h] = WIDTHS[size];
        await t.resize(w, s.full ? 4200 : h);
        const started = Date.now();
        await t.goto(s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase37?scene=${s.scene}`, s.settle ?? 3000);
        const checks: string[] = [];
        if (s.act === "__KEYBOARD_HUB__") checks.push(`foco en «${await keyboard(t, '[data-testid="collection-hero"]', 3)}»`);
        else if (s.act === "__KEYBOARD_DETAIL__") checks.push(`foco en «${await keyboard(t, '[data-testid="card-detail"]', 2)}»`);
        else if (s.act) { if (!(await t.js<boolean>(s.act))) checks.push("⚠ selector no encontrado"); await sleep(700); }
        if (s.then) { await t.js<boolean>(s.then); await sleep(600); }
        const overflow = await t.js<number>(`Math.max(0, document.documentElement.scrollWidth - window.innerWidth)`);
        if (overflow > 0) { checks.push(`⚠ desborde ${overflow}px`); overflowTotal++; }
        const facts = await t.js<{ h1: number; small: string[]; cards: number; flip: string | null; fav: string | null; notFound: boolean; synthetic: boolean }>(`(() => {
          const roots = [...document.querySelectorAll('[data-testid="collection-room"], [data-testid="card-detail"], [data-testid="card-compare"], [data-testid="card-not-found"]')];
          const small = roots.flatMap((root) => [...root.querySelectorAll("a, button, select, input")]).filter((e) => {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            return r.width > 1 && r.height > 1 && r.height < 43.5 && cs.visibility !== "hidden" && !e.closest("label") && !e.closest("[data-card]");
          }).map((e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 24));
          return {
            h1: document.querySelectorAll("main h1, [data-scene] h1").length,
            small: [...new Set(small)],
            cards: document.querySelectorAll("[data-card]").length,
            flip: document.querySelector('[data-testid="card-flip"]')?.getAttribute("aria-pressed") ?? null,
            fav: document.querySelector('[data-testid="card-favorite"]')?.getAttribute("aria-pressed") ?? null,
            notFound: !!document.querySelector('[data-testid="card-not-found"]'),
            synthetic: !!document.querySelector('[data-synthetic="true"]'),
          };
        })()`);
        if (facts.h1 !== 1) checks.push(`${facts.h1 === 0 ? "" : "⚠ "}h1=${facts.h1}`);
        if (facts.cards) { checks.push(`${facts.cards} cartas montadas`); maxCards = Math.max(maxCards, facts.cards); }
        if (facts.flip) checks.push(`girada=${facts.flip}`);
        if (facts.fav) checks.push(`favorita=${facts.fav}`);
        if (facts.notFound) checks.push("carta no encontrada");
        if (facts.small.length) { checks.push(`⚠ <44px: ${facts.small.slice(0, 6).join(", ")}`); smallTotal++; }
        if (s.path) checks.push(`listo en ${Math.round((Date.now() - started) / 100) / 10} s`);
        const file = `${s.n}-${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        rows.push({ file, width: w, what: s.note ?? `scene=${s.scene}${s.reduced ? " · reduced-motion" : ""}${s.full ? " · página completa" : ""}`, checks: checks.join(" · ") });
        errors.push(...t.takeErrors().filter((e) => !/players\/.*\.(png|webp)|404|ERR_CONNECTION_REFUSED|supabase|54521|Failed to load resource|Failed to fetch/i.test(e)).map((e) => `${file}: ${e}`));
      }
    }
    const readme = [
      "# QA visual · Fase 37 — Collection & Card Experience 3.0",
      "",
      "**QA SYNTHETIC**: cada escena del arnés `/design-system/fase37` renderiza la sala REAL (`CollectionRoomScreen`), la ficha REAL (`CardDetailView`) y el comparador REAL (`CardCompareView`) con el catálogo REAL (772 definiciones, stats, equipos, sobres) y COPIAS INVENTADAS (`src/app/design-system/fase37/fixtures.ts`: instancias, seriales, favoritas, vitrina y equipos). Nada de estas capturas es un dato de un jugador.",
      "Las capturas `72-*`…`76-*` son rutas reales de la app sin backend (sin túnel). La evidencia con la cuenta QA contra la BD del VPS está en `real/` y en el informe de la fase.",
      "Generadas con `npx tsx scripts/_fase37-visual-qa.ts` contra `next start` en :3005.",
      "Comprobaciones por captura: desbordamiento horizontal, número de `h1`, controles < 44 px dentro de sala/ficha/comparador (fuera de las cartas), cartas montadas en la rejilla, estado de girar y favorito.",
      "",
      "| captura | ancho | escena | comprobaciones |",
      "|---|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.what} | ${r.checks} |`),
      "",
      `Capturas: ${rows.length}. Con desbordamiento horizontal: ${overflowTotal}. Con controles < 44 px: ${smallTotal}. Máximo de cartas montadas a la vez: ${maxCards}. Errores de consola propios (sin 404 de fotos ni backend ausente): ${errors.length}.`,
      ...errors.slice(0, 20).map((e) => `- ${e}`),
      "",
    ].join("\n");
    if (!only) writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => `${r.file}  ${r.checks}`).join("\n"));
    console.log(`\ncapturas: ${rows.length} · desborde: ${overflowTotal} · <44px: ${smallTotal} · máx cartas: ${maxCards} · errores propios: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
