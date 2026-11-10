/**
 * FASE 28 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase28-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase28?scene=…` (QA SYNTHETIC; el detalle de partida usa el motor real).
 * Guarda en docs/product/qa/fase28/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase28");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

const SCENES: { scene: string; name: string; sizes: Size[]; settle?: number }[] = [
  { scene: "hub",                  name: "01-competitive-hub",     sizes: ["desktop", "tablet", "mobile"], settle: 2600 },
  { scene: "hub-provisional",      name: "02-provisional",         sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "hub-new",              name: "03-unranked",            sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "hero",                 name: "04-ranked-hero",         sizes: ["desktop", "mobile"] },
  { scene: "leaderboard",          name: "05-top-leaderboard",     sizes: ["desktop", "mobile"] },
  { scene: "around-me",            name: "06-around-me",           sizes: ["desktop", "mobile"] },
  { scene: "hub-same-rating",      name: "07-same-rating-tie",     sizes: ["desktop"] },
  { scene: "history",              name: "08-match-history",       sizes: ["desktop", "mobile"] },
  { scene: "history-empty",        name: "09-history-empty",       sizes: ["desktop"] },
  { scene: "match-detail",         name: "10-match-detail",        sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "match-detail-timeout", name: "11-match-detail-timeout", sizes: ["desktop"], settle: 2600 },
  { scene: "player-profile",       name: "12-player-profile",      sizes: ["desktop", "mobile"] },
  { scene: "rating-up",            name: "13-rating-up",           sizes: ["desktop"] },
  { scene: "rating-down",          name: "14-rating-down",         sizes: ["desktop"] },
  { scene: "post-match",           name: "15-post-match",          sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "post-match-unranked",  name: "16-post-match-timeout",  sizes: ["desktop"], settle: 2600 },
  { scene: "rewards",              name: "17-rewards",             sizes: ["desktop", "mobile"] },
  { scene: "rewards-locked",       name: "18-rewards-locked",      sizes: ["desktop"] },
  { scene: "matchmaking",          name: "19-matchmaking",         sizes: ["desktop", "mobile"] },
  { scene: "hub-small",            name: "20-small-population",    sizes: ["desktop"], settle: 2400 },
  { scene: "hub-solo",             name: "21-solo-player",         sizes: ["desktop"], settle: 2400 },
  { scene: "backend-error",        name: "22-backend-error",       sizes: ["desktop"] },
  { scene: "hub-top10",            name: "23-top10-hub",           sizes: ["desktop"], settle: 2400 },
  { scene: "summary",              name: "24-profile-summary",     sizes: ["desktop", "mobile"] },
];

async function main(): Promise<void> {
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const rows: { file: string; width: number; scene: string }[] = [];
  const shot = async (name: string, size: Size, scene: string) => {
    const [w, h] = WIDTHS[size];
    await t.resize(w, h);
    await sleep(350);
    const file = `${name}-${w}.png`;
    await t.shot(join(OUT, file));
    rows.push({ file, width: w, scene });
  };
  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const s of SCENES) {
      for (const size of s.sizes) {
        await t.resize(WIDTHS[size][0], WIDTHS[size][1]);
        await t.goto(`${BASE}/design-system/fase28?scene=${s.scene}`, s.settle ?? 2200);
        await shot(s.name, size, s.scene);
      }
    }
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase28?scene=hub`, 2600); await shot("25-reduced-motion-hub", "mobile", "hub (prefers-reduced-motion)");
    await t.goto(`${BASE}/design-system/fase28?scene=post-match`, 2600); await shot("26-reduced-motion-post-match", "mobile", "post-match (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await t.resize(1440, 900);
    await t.goto(`${BASE}/duelos/competitivo`, 2400); await shot("27-competitivo-needs-account", "desktop", "/duelos/competitivo sin sesión");
    await t.goto(`${BASE}/duelos`, 2400); await shot("28-duelos-hub-door", "desktop", "/duelos (puerta al competitivo)");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404|ERR_CONNECTION_REFUSED/.test(e));
    const readme = [
      "# QA visual · Fase 28 (QA SYNTHETIC: jugadores, ratings y partidas inventados; motor real en el detalle; sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase28-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase28?scene=…` (`fixtures.ts`).",
      "Movimiento activado salvo en `25-*` y `26-*` (prefers-reduced-motion). `27-*` y `28-*` son rutas reales sin sesión.",
      "",
      "| captura | ancho | escena |",
      "|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.scene} |`),
      "",
      `Errores de consola propios (sin 404 de fotos ni Supabase ausente): ${errors.length}.`,
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
