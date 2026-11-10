/**
 * FASE 30 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase30-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y nada más. Escenas del arnés
 * `/design-system/fase30?scene=…` (QA SYNTHETIC; el cuadro usa el motor real de la Fase 24).
 * Guarda en docs/product/qa/fase30/ y escribe el README.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase30");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

const SCENES: { scene: string; name: string; sizes: Size[]; settle?: number }[] = [
  { scene: "overview",           name: "01-events-overview",        sizes: ["desktop", "tablet", "mobile"], settle: 2600 },
  { scene: "overview-multi",     name: "02-multiple-active-events", sizes: ["desktop", "mobile"] },
  { scene: "overview-upcoming",  name: "03-upcoming-event",         sizes: ["desktop"] },
  { scene: "overview-completed", name: "04-completed-event",        sizes: ["desktop"] },
  { scene: "hub",                name: "05-event-hub-active",       sizes: ["desktop", "tablet", "mobile"], settle: 2800 },
  { scene: "hub-upcoming",       name: "06-event-hub-upcoming",     sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-completed",      name: "07-event-hub-completed",    sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub",                name: "08-live-match",             sizes: ["desktop"], settle: 2800 },
  { scene: "hub-no-live",        name: "09-no-live-match",          sizes: ["desktop"], settle: 2800 },
  { scene: "hub-two-live",       name: "10-multiple-live-matches",  sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-no-live",        name: "11-next-match",             sizes: ["mobile"], settle: 2800 },
  { scene: "match",              name: "12-match-center",           sizes: ["desktop", "tablet", "mobile"], settle: 2600 },
  { scene: "match-done",         name: "13-match-completed",        sizes: ["desktop", "mobile"] },
  { scene: "match-tbd",          name: "14-match-tbd-maps",         sizes: ["desktop", "mobile"] },
  { scene: "hub",                name: "15-pickems-pending",        sizes: ["desktop"], settle: 2800 },
  { scene: "hub-pickems-done",   name: "16-pickems-complete",       sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-no-pickems",     name: "17-no-pickems",             sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "bracket",            name: "18-bracket",                sizes: ["desktop", "tablet"], settle: 2800 },
  { scene: "hub-league",         name: "19-no-bracket-league",      sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-completed",      name: "20-teams-standings",        sizes: ["desktop"], settle: 2800 },
  { scene: "hub",                name: "21-players",                sizes: ["desktop"], settle: 2800 },
  { scene: "hub",                name: "22-event-cards",            sizes: ["desktop"], settle: 2800 },
  { scene: "hub",                name: "23-collection-progress",    sizes: ["desktop"], settle: 2800 },
  { scene: "hub",                name: "24-team-pack-active",       sizes: ["desktop"], settle: 2800 },
  { scene: "hub-no-pack",        name: "25-no-pack",                sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub",                name: "26-objectives",             sizes: ["desktop"], settle: 2800 },
  { scene: "hub-no-objectives",  name: "27-no-objectives",          sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-reward",         name: "28-reward-available",       sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub-no-cards",       name: "29-no-cards-no-rewards",    sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "hub",                name: "30-event-actions",          sizes: ["desktop"], settle: 2800 },
  { scene: "hub-stale",          name: "31-sync-stale",             sizes: ["desktop", "mobile"], settle: 2800 },
  { scene: "backend-error",      name: "32-backend-error",          sizes: ["desktop"] },
  { scene: "overview-empty",     name: "33-empty-events",           sizes: ["desktop", "mobile"] },
  { scene: "overview-stale",     name: "34-overview-stale",         sizes: ["desktop"] },
  { scene: "bracket-mobile",     name: "35-mobile-bracket",         sizes: ["mobile"], settle: 2800 },
  { scene: "no-session",         name: "36-no-session",             sizes: ["desktop", "mobile"] },
  { scene: "hub-anon",           name: "37-hub-anonymous",          sizes: ["desktop"], settle: 2800 },
  { scene: "hub-demo",           name: "38-hub-demo-event",         sizes: ["desktop"], settle: 2800 },
  { scene: "home-card",          name: "39-home-live-event-card",   sizes: ["desktop", "mobile"] },
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
        await t.goto(`${BASE}/design-system/fase30?scene=${s.scene}`, s.settle ?? 2400);
        await shot(s.name, size, s.scene);
      }
    }
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase30?scene=hub`, 2800); await shot("40-reduced-motion-hub", "mobile", "hub (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await t.resize(1440, 900);
    await t.goto(`${BASE}/torneos`, 2600); await shot("41-torneos-real-route", "desktop", "/torneos ruta real (sin Supabase: cuenta requerida o error honesto)");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404|ERR_CONNECTION_REFUSED|Failed to fetch|api\/game\/live-events/.test(e));
    const readme = [
      "# QA visual · Fase 30 (QA SYNTHETIC: eventos, equipos, jugadores, partidos y cartas inventados con nombres ficticios; motor real del cuadro; sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase30-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase30?scene=…` (`fixtures.ts`).",
      "Movimiento activado salvo en `40-*` (prefers-reduced-motion). `41-*` es la ruta real sin backend.",
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
