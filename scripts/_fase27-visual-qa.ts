/**
 * FASE 27 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase27-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase27?scene=…` (QA SYNTHETIC sobre contenido real). Movimiento activado salvo
 * en las escenas de movimiento reducido. Guarda en docs/product/qa/fase27/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase27");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

const SCENES: { scene: string; name: string; sizes: Size[]; settle?: number }[] = [
  { scene: "hub-progress",         name: "01-progression-hub",    sizes: ["desktop", "tablet", "mobile"], settle: 2600 },
  { scene: "level-hero",           name: "02-level-hero",         sizes: ["desktop", "mobile"] },
  { scene: "near-levelup",         name: "03-near-levelup",       sizes: ["desktop"] },
  { scene: "levelup",              name: "04-levelup",            sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "today",                name: "05-today",              sizes: ["desktop", "mobile"] },
  { scene: "objectives",           name: "06-objectives",         sizes: ["desktop", "mobile"] },
  { scene: "objective-partial",    name: "07-objective-partial",  sizes: ["desktop"] },
  { scene: "objective-complete",   name: "08-objective-complete", sizes: ["desktop"] },
  { scene: "reward",               name: "09-reward-history",     sizes: ["desktop", "mobile"] },
  { scene: "achievements",         name: "10-achievements",       sizes: ["desktop", "mobile"] },
  { scene: "achievement-detail",   name: "11-achievement-detail", sizes: ["desktop"] },
  { scene: "free-track",           name: "12-free-track",         sizes: ["desktop", "mobile"] },
  { scene: "season",               name: "13-season",             sizes: ["desktop", "mobile"] },
  { scene: "post-match",           name: "14-post-match-progress", sizes: ["desktop", "mobile"] },
  { scene: "pack-objective",       name: "15-pack-objective",     sizes: ["desktop"] },
  { scene: "collection-objective", name: "16-collection-objective", sizes: ["desktop"] },
  { scene: "pickem-cta",           name: "17-pickem-cta",         sizes: ["desktop"] },
  { scene: "competitive",          name: "18-competitive",        sizes: ["desktop"] },
  { scene: "home-loop",            name: "19-home-meta-loop",     sizes: ["desktop", "mobile"] },
  { scene: "hub-new",              name: "20-new-player",         sizes: ["desktop", "mobile"], settle: 2600 },
  { scene: "returning",            name: "21-returning-player",   sizes: ["desktop"] },
  { scene: "no-rewards",           name: "22-no-rewards",         sizes: ["desktop"] },
  { scene: "backend-unavailable",  name: "23-backend-unavailable", sizes: ["desktop"] },
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
        await t.goto(`${BASE}/design-system/fase27?scene=${s.scene}`, s.settle ?? 2200);
        await shot(s.name, size, s.scene);
      }
    }
    // Movimiento reducido: hub y subida de nivel en reposo, a 390.
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase27?scene=hub-progress`, 2400); await shot("24-reduced-motion-hub", "mobile", "hub-progress (prefers-reduced-motion)");
    await t.goto(`${BASE}/design-system/fase27?scene=levelup`, 2400); await shot("25-reduced-motion-levelup", "mobile", "levelup (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    // La ruta real sin sesión: hero del nivel + NeedsAccount.
    await t.resize(1440, 900);
    await t.goto(`${BASE}/progresion`, 2400); await shot("26-progresion-needs-account", "desktop", "/progresion sin sesión");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404|ERR_CONNECTION_REFUSED/.test(e));
    const readme = [
      "# QA visual · Fase 27 (QA SYNTHETIC: temporada, pool y logros reales; cifras inventadas; sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase27-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase27?scene=…` (`fixtures.ts`).",
      "Movimiento activado salvo en `24-*` y `25-*` (prefers-reduced-motion). `26-*` es la ruta real `/progresion` sin sesión.",
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
