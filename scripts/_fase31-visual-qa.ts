/**
 * FASE 31 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase31-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase31?scene=…` (QA SYNTHETIC; cartas del catálogo real).
 * Guarda en docs/product/qa/fase31/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase31");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

const SCENES: { scene: string; name: string; sizes: Size[]; settle?: number }[] = [
  { scene: "own-full",              name: "01-own-profile-full",        sizes: ["desktop", "tablet", "mobile"], settle: 3000 },
  { scene: "public-full",           name: "02-public-profile-full",     sizes: ["desktop", "tablet", "mobile"], settle: 3000 },
  { scene: "new-player",            name: "03-new-player",              sizes: ["desktop", "mobile"] },
  { scene: "no-cards",              name: "04-no-cards",                sizes: ["desktop"] },
  { scene: "empty-showcase",        name: "05-empty-showcase",          sizes: ["desktop", "mobile"] },
  { scene: "showcase-one",          name: "06-showcase-one-card",       sizes: ["desktop"], settle: 3000 },
  { scene: "showcase-full",         name: "07-showcase-full",           sizes: ["desktop", "tablet", "mobile"], settle: 3000 },
  { scene: "low-serial",            name: "08-low-serial-featured",     sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "duplicates",            name: "09-duplicate-instances",     sizes: ["desktop"], settle: 3000 },
  { scene: "editor",                name: "10-showcase-editor",         sizes: ["desktop", "tablet", "mobile"], settle: 3000 },
  { scene: "instance-picker",       name: "11-instance-picker",         sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "save-showcase",         name: "12-save-showcase",           sizes: ["desktop"], settle: 3000 },
  { scene: "achievements",          name: "13-achievements",            sizes: ["desktop"], settle: 3000 },
  { scene: "achievement-editor",    name: "14-achievement-editor",      sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "no-achievements",       name: "15-no-achievements",         sizes: ["desktop"], settle: 3000 },
  { scene: "ranked",                name: "16-ranked-player",           sizes: ["desktop"], settle: 3000 },
  { scene: "unranked",              name: "17-unranked-player",         sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "recent-form",           name: "18-recent-form",             sizes: ["desktop"], settle: 3000 },
  { scene: "match-history",         name: "19-match-history",           sizes: ["mobile"], settle: 3000 },
  { scene: "h2h",                   name: "20-h2h",                     sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "friend",                name: "21-friend-profile",          sizes: ["desktop"], settle: 3000 },
  { scene: "unknown",               name: "22-unknown-player",          sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "pending",               name: "23-pending-friendship",      sizes: ["desktop"], settle: 3000 },
  { scene: "blocked",               name: "24-blocked-behavior",        sizes: ["desktop"], settle: 3000 },
  { scene: "social-unavailable",    name: "25-social-unavailable",      sizes: ["desktop"], settle: 3000 },
  { scene: "pickems",               name: "26-pickems-summary",         sizes: ["desktop"], settle: 3000 },
  { scene: "no-pickems",            name: "27-no-pickems",              sizes: ["desktop"], settle: 3000 },
  { scene: "collection-summary",    name: "28-collection-summary",      sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "account-preview",       name: "29-account-preview",         sizes: ["desktop", "mobile"] },
  { scene: "leaderboard",           name: "30-leaderboard-to-profile",  sizes: ["desktop"] },
  { scene: "search",                name: "31-search-to-profile",       sizes: ["desktop", "mobile"] },
  { scene: "share",                 name: "32-share-profile",           sizes: ["desktop", "mobile"], settle: 3000 },
  { scene: "backend-error",         name: "33-backend-error",           sizes: ["desktop"] },
  { scene: "not-found",             name: "34-not-found",               sizes: ["desktop"] },
  { scene: "empty-showcase-public", name: "35-empty-showcase-public",   sizes: ["mobile"], settle: 3000 },
  { scene: "unavailable-slot",      name: "36-unavailable-slot",        sizes: ["desktop"], settle: 3000 },
  { scene: "avatar-editor",         name: "37-avatar-editor",           sizes: ["mobile"], settle: 3000 },
  { scene: "no-session",            name: "38-no-session",              sizes: ["desktop", "mobile"] },
];

async function main(): Promise<void> {
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; scene: string }[] = [];
  const shot = async (name: string, size: Size, scene: string) => {
    const [w, h] = WIDTHS[size];
    await t.resize(w, h);
    await sleep(400);
    const file = `${name}-${w}.png`;
    await t.shot(join(OUT, file));
    rows.push({ file, width: w, scene });
  };
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const s of SCENES) {
      for (const size of s.sizes) {
        await t.resize(WIDTHS[size][0], WIDTHS[size][1]);
        await t.goto(`${BASE}/design-system/fase31?scene=${s.scene}`, s.settle ?? 2600);
        await shot(s.name, size, s.scene);
      }
    }
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase31?scene=own-full`, 3000); await shot("39-reduced-motion-profile", "mobile", "own-full (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await t.resize(1440, 900);
    await t.goto(`${BASE}/jugador/me`, 2600); await shot("40-jugador-me-real-route", "desktop", "/jugador/me ruta real sin sesión");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404|ERR_CONNECTION_REFUSED|Failed to fetch|api\/game\//.test(e));
    const readme = [
      "# QA visual · Fase 31 (QA SYNTHETIC: jugadores, ratings, logros y ejemplares inventados; cartas del catálogo real; sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase31-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase31?scene=…` (`fixtures.ts`).",
      "Movimiento activado salvo en `39-*` (prefers-reduced-motion). `40-*` es la ruta real sin sesión.",
      "",
      "| captura | ancho | escena |",
      "|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.scene} |`),
      "",
      `Errores de consola propios (sin 404 de fotos ni backend ausente): ${errors.length}.`,
      ...errors.slice(0, 10).map((e) => `- ${e}`),
      "",
    ].join("\n");
    writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => r.file).join("\n"));
    console.log(`\ncapturas: ${rows.length} · errores de consola propios: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
