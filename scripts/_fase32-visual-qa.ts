/**
 * FASE 32 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase32-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase32?scene=…` (QA SYNTHETIC; cartas reales) a 1440 / 1024 / 390, más la ruta real
 * `/duelos/mazos` y el alias `/equipo`. Guarda en docs/product/qa/fase32/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase32");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

interface Shot { n: number; scene: string; name: string; sizes: Size[]; settle?: number; reduced?: boolean; path?: string; keyboard?: boolean }

/** Numeración = los 60 escenarios mínimos del brief. */
const SHOTS: Shot[] = [
  { n: 1, scene: "hub", name: "01-deck-hub", sizes: ["desktop", "tablet"] },
  { n: 2, scene: "no-decks", name: "02-no-decks", sizes: ["desktop"] },
  { n: 3, scene: "multiple", name: "03-multiple-decks", sizes: ["desktop"] },
  { n: 4, scene: "active", name: "04-active-deck", sizes: ["desktop"] },
  { n: 5, scene: "builder-empty", name: "05-builder-empty", sizes: ["desktop"] },
  { n: 6, scene: "builder-partial", name: "06-builder-partial", sizes: ["desktop"] },
  { n: 7, scene: "builder-nine", name: "07-builder-9-of-10", sizes: ["desktop"] },
  { n: 8, scene: "builder-complete", name: "08-builder-complete", sizes: ["desktop"] },
  { n: 9, scene: "builder-invalid", name: "09-builder-invalid", sizes: ["desktop"] },
  { n: 10, scene: "slots-duelista", name: "10-duelista-slots", sizes: ["desktop"] },
  { n: 11, scene: "slots-controlador", name: "11-controlador-slots", sizes: ["desktop"] },
  { n: 12, scene: "slots-iniciador", name: "12-iniciador-slots", sizes: ["desktop"] },
  { n: 13, scene: "slots-centinela", name: "13-centinela-slots", sizes: ["desktop"] },
  { n: 14, scene: "slots-flex", name: "14-flex-slots", sizes: ["desktop"] },
  { n: 15, scene: "collection", name: "15-collection-panel", sizes: ["desktop"] },
  { n: 16, scene: "search", name: "16-search", sizes: ["desktop"] },
  { n: 17, scene: "role-filter", name: "17-role-filter", sizes: ["desktop"] },
  { n: 18, scene: "team-filter", name: "18-team-filter", sizes: ["desktop"] },
  { n: 19, scene: "rarity-filter", name: "19-rarity-filter", sizes: ["desktop"] },
  { n: 20, scene: "ovr-sort", name: "20-ovr-sort", sizes: ["desktop"] },
  { n: 21, scene: "add-card", name: "21-add-card", sizes: ["desktop"] },
  { n: 22, scene: "remove-card", name: "22-remove-card", sizes: ["desktop"] },
  { n: 23, scene: "replace-card", name: "23-replace-card", sizes: ["desktop"] },
  { n: 24, scene: "compatible", name: "24-compatible-slots", sizes: ["desktop"] },
  { n: 25, scene: "illegal-slot", name: "25-illegal-slot", sizes: ["desktop"] },
  { n: 26, scene: "duplicate-player", name: "26-duplicate-player", sizes: ["desktop"] },
  { n: 27, scene: "compare", name: "27-card-comparison", sizes: ["desktop"] },
  { n: 28, scene: "deltas", name: "28-positive-negative-deltas", sizes: ["tablet"] },
  { n: 29, scene: "team-stats", name: "29-team-stats", sizes: ["desktop"] },
  { n: 30, scene: "strength", name: "30-strength-lowest-stat", sizes: ["desktop"] },
  { n: 31, scene: "suggest", name: "31-suggest-card", sizes: ["desktop"] },
  { n: 32, scene: "auto-ok", name: "32-autocomplete-success", sizes: ["desktop"] },
  { n: 33, scene: "auto-fail", name: "33-autocomplete-impossible", sizes: ["desktop"] },
  { n: 34, scene: "rename", name: "34-rename-deck", sizes: ["desktop"] },
  { n: 35, scene: "duplicate", name: "35-duplicate-deck", sizes: ["desktop"] },
  { n: 36, scene: "delete", name: "36-delete-confirmation", sizes: ["desktop"] },
  { n: 37, scene: "set-active", name: "37-set-active", sizes: ["desktop"] },
  { n: 38, scene: "cannot-activate", name: "38-cannot-activate-incomplete", sizes: ["desktop"] },
  { n: 39, scene: "unsaved", name: "39-unsaved-changes", sizes: ["desktop"] },
  { n: 40, scene: "save-error", name: "40-save-error", sizes: ["desktop"] },
  { n: 41, scene: "stale", name: "41-stale-version", sizes: ["desktop"] },
  { n: 42, scene: "lost", name: "42-lost-ownership", sizes: ["desktop"] },
  { n: 43, scene: "prematch", name: "43-prematch-deck-select", sizes: ["desktop"] },
  { n: 44, scene: "collection-to-builder", name: "44-collection-to-builder", sizes: ["desktop"] },
  { n: 45, scene: "profile-to-builder", name: "45-profile-to-builder", sizes: ["desktop"] },
  { n: 46, scene: "challenge", name: "46-social-challenge", sizes: ["desktop"] },
  { n: 47, scene: "ftue", name: "47-first-deck-ftue", sizes: ["desktop"] },
  { n: 48, scene: "backend-error", name: "48-backend-error", sizes: ["desktop"] },
  { n: 49, scene: "hub", name: "49-mobile-hub", sizes: ["mobile"] },
  { n: 50, scene: "builder-empty", name: "50-mobile-empty-builder", sizes: ["mobile"] },
  { n: 51, scene: "builder-partial", name: "51-mobile-partial-builder", sizes: ["mobile"] },
  { n: 52, scene: "builder-complete", name: "52-mobile-complete-builder", sizes: ["mobile"] },
  { n: 53, scene: "collection-sheet", name: "53-mobile-add-card-sheet", sizes: ["mobile"] },
  { n: 54, scene: "compare", name: "54-mobile-compare", sizes: ["mobile"] },
  { n: 55, scene: "team-stats", name: "55-mobile-analysis", sizes: ["mobile"] },
  { n: 56, scene: "builder-partial", name: "56-tablet", sizes: ["tablet"] },
  { n: 57, scene: "reduced-motion", name: "57-reduced-motion", sizes: ["desktop"], reduced: true },
  { n: 58, scene: "keyboard", name: "58-keyboard-flow", sizes: ["desktop"], keyboard: true },
  { n: 59, scene: "no-session", name: "59-no-session", sizes: ["desktop", "mobile"] },
  { n: 60, scene: "route", name: "60-route-real", sizes: ["desktop", "mobile"], path: "/duelos/mazos" },
  { n: 60, scene: "route-alias", name: "60b-route-alias-equipo", sizes: ["desktop"], path: "/equipo" },
];

async function main(): Promise<void> {
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { n: number; file: string; width: number; scene: string; errors: number }[] = [];
  try {
    for (const s of SHOTS) {
      await t.setMedia([{ name: "prefers-reduced-motion", value: s.reduced ? "reduce" : "no-preference" }]);
      for (const size of s.sizes) {
        const [w, h] = WIDTHS[size];
        await t.resize(w, h);
        const url = s.path ? `${BASE}${s.path}` : `${BASE}/design-system/fase32?scene=${s.scene}`;
        await t.goto(url, s.settle ?? 3000);
        if (s.keyboard) {
          await t.js("document.querySelector('[data-slot=\"Controlador-2\"] button')?.focus()");
          await sleep(300);
        }
        await sleep(300);
        const file = `${s.name}-${w}.png`;
        await t.shot(join(OUT, file));
        const errs = typeof (t as { takeErrors?: () => string[] }).takeErrors === "function" ? (t as { takeErrors: () => string[] }).takeErrors() : [];
        if (errs.length) console.log(`  ! ${file}: ${errs.slice(0, 3).join(" | ")}`);
        rows.push({ n: s.n, file, width: w, scene: s.path ?? s.scene, errors: errs.length });
        console.log(`  ✓ ${file}`);
      }
    }
  } finally {
    await b.close();
  }
  const total = rows.reduce((n, r) => n + r.errors, 0);
  const md = [
    "# QA visual · Fase 32 — Deck Builder 2.0 + Team Management",
    "",
    "Capturas del arnés `/design-system/fase32` (**QA SYNTHETIC**: ejemplares y equipos inventados sobre cartas y estadísticas reales del catálogo, validados con el validador canónico) y de la ruta real `/duelos/mazos` (sin sesión) y su alias `/equipo`.",
    "",
    `Generado por \`scripts/_fase32-visual-qa.ts\` contra ${BASE}. Capturas: ${rows.length}. Errores de consola: ${total}.`,
    "",
    "| Nº | Archivo | Ancho | Escena |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.n} | ${r.file} | ${r.width} | ${r.scene} |`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "README.md"), md);
  console.log(`\n${rows.length} capturas · ${total} errores de consola · ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
