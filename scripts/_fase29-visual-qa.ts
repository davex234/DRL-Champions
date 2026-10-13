/**
 * FASE 29 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase29-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase29?scene=…` (QA SYNTHETIC; la partida privada usa el motor real).
 * Guarda en docs/product/qa/fase29/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase29");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

const SCENES: { scene: string; name: string; sizes: Size[]; settle?: number }[] = [
  { scene: "hub",                    name: "01-social-hub",              sizes: ["desktop", "tablet", "mobile"], settle: 2600 },
  { scene: "hub-empty",              name: "02-social-empty-ftue",       sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "friends",                name: "03-friends-list",            sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "requests",               name: "04-requests",                sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "search",                 name: "05-player-search",           sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "search-empty",           name: "06-player-search-empty",     sizes: ["desktop"], settle: 2400 },
  { scene: "challenges",             name: "07-challenges",              sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "challenges-empty",       name: "08-challenges-empty",        sizes: ["desktop"], settle: 2400 },
  { scene: "hub-after-duel",         name: "09-recent-opponents",        sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "activity",               name: "10-activity",                sizes: ["desktop"], settle: 2400 },
  { scene: "challenge-sheet",        name: "11-challenge-sheet",         sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "challenge-accept-sheet", name: "12-challenge-accept-sheet",  sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "confirm-unfriend",       name: "13-confirm-unfriend",        sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "confirm-block",          name: "14-confirm-block",           sizes: ["desktop"], settle: 2600 },
  { scene: "profile-friend",         name: "15-profile-friend-actions",  sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "profile-stranger",       name: "16-profile-stranger",        sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "profile-sent",           name: "17-profile-request-sent",    sizes: ["desktop"], settle: 2400 },
  { scene: "private-arena",          name: "18-private-arena",           sizes: ["desktop", "tablet", "mobile"], settle: 2800 },
  { scene: "private-outcome-win",    name: "19-private-outcome-win",     sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "private-outcome-loss",   name: "20-private-outcome-loss",    sizes: ["desktop"], settle: 2800 },
  { scene: "private-outcome-abandon", name: "21-private-outcome-abandon", sizes: ["desktop"], settle: 2800 },
  { scene: "summary",                name: "22-account-social-summary",  sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "backend-error",          name: "23-backend-error",           sizes: ["desktop"], settle: 2400 },
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
        await t.goto(`${BASE}/design-system/fase29?scene=${s.scene}`, s.settle ?? 2400);
        await shot(s.name, size, s.scene);
      }
    }
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase29?scene=hub`, 2600); await shot("24-reduced-motion-hub", "mobile", "hub (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await t.resize(1440, 900);
    await t.goto(`${BASE}/social`, 2400); await shot("25-social-needs-account", "desktop", "/social sin sesión");
    await t.goto(`${BASE}/duelos/competitivo`, 2400); await shot("26-nav-social-entry", "desktop", "/duelos/competitivo sin sesión (la entrada Social vive en el desplegable Jugar; sin sesión no hay badge)");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404|ERR_CONNECTION_REFUSED/.test(e));
    const readme = [
      "# QA visual · Fase 29 (QA SYNTHETIC: jugadores, amistades, retos y presencias inventados; motor real en la partida privada; sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase29-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase29?scene=…` (`fixtures.ts`).",
      "Movimiento activado salvo en `24-*` (prefers-reduced-motion). `25-*` y `26-*` son rutas reales sin sesión.",
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
