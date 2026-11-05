/**
 * FASE 26 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase26-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y NADA más: ni Supabase ni cuenta. Las
 * escenas salen del arnés `/design-system/fase26?scene=…` (QA SYNTHETIC: motor real en el
 * navegador sobre cartas reales, sin servidor). La selección de carta y eje se hace DE VERDAD
 * sobre el tablero (clic en una carta de la mano y en un eje), y el movimiento se fotografía
 * activado (Chrome sin cabeza declara reduced-motion) salvo en la escena de movimiento reducido.
 *
 * Guarda en docs/product/qa/fase26/<escena>-<ancho>.png y escribe el README de la carpeta.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase26");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

/** Escena del arnés → nombre de captura → anchos. */
const SCENES: { scene: string; name: string; sizes: Size[]; select?: boolean; settle?: number }[] = [
  { scene: "prematch",         name: "01-prematch",            sizes: ["desktop", "tablet", "mobile"] },
  { scene: "prematch-invalid", name: "02-prematch-invalid",    sizes: ["desktop", "mobile"] },
  // 2,4 s: menos y se fotografía la pantalla de arranque del armazón (HydrationGate), no la intro.
  { scene: "intro",            name: "03-match-intro",         sizes: ["desktop", "mobile"], settle: 2400 },
  { scene: "arena",            name: "04-arena",               sizes: ["desktop", "tablet", "mobile"] },
  { scene: "arena",            name: "05-card-selected",       sizes: ["desktop", "mobile"], select: true },
  { scene: "defending",        name: "06-defending-required",  sizes: ["desktop", "mobile"] },
  { scene: "reveal",           name: "07-stat-reveal",         sizes: ["desktop", "mobile"], settle: 1400 },
  { scene: "round-win",        name: "08-round-win",           sizes: ["desktop", "mobile"], settle: 1400 },
  { scene: "round-loss",       name: "09-round-loss",          sizes: ["desktop", "mobile"], settle: 1400 },
  { scene: "round-draw",       name: "10-round-draw",          sizes: ["desktop", "mobile"], settle: 1400 },
  { scene: "history",          name: "11-history",             sizes: ["desktop", "mobile"] },
  { scene: "pvp-lobby",        name: "12-pvp-searching",       sizes: ["desktop", "mobile"] },
  { scene: "pvp-waiting",      name: "13-pvp-waiting",         sizes: ["desktop", "mobile"] },
  { scene: "reconnect",        name: "14-reconnect",           sizes: ["desktop", "mobile"] },
  { scene: "win",              name: "15-match-win",           sizes: ["desktop", "mobile"], settle: 1600 },
  { scene: "loss",             name: "16-match-loss",          sizes: ["desktop", "mobile"], settle: 1600 },
  { scene: "win",              name: "17-post-match",          sizes: ["tablet"], settle: 1600 },
  { scene: "pvp-outcome",      name: "18-pvp-outcome",         sizes: ["desktop", "mobile"] },
  { scene: "help",             name: "19-help-sheet",          sizes: ["desktop", "mobile"] },
  { scene: "arena",            name: "20-mobile-arena",        sizes: ["mobile"], select: true },
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
  const selectCardAndStat = async () => t.js<boolean>(`(() => {
    const card = [...document.querySelectorAll('button[aria-label]')].find((el) => /OVR \\d+$/.test(el.getAttribute('aria-label') || ''));
    if (!card) return false; card.click();
    return true; })()`);
  const selectStat = async () => t.js<boolean>(`(() => {
    const st = [...document.querySelectorAll('button[aria-pressed]')].find((el) => /^(SH|GS|EF)/.test((el.textContent || '').trim()));
    if (!st) return false; st.click(); return true; })()`);

  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const s of SCENES) {
      for (const size of s.sizes) {
        await t.resize(WIDTHS[size][0], WIDTHS[size][1]);
        await t.goto(`${BASE}/design-system/fase26?scene=${s.scene}`, s.settle ?? 1800);
        if (s.select) {
          const ok = await selectCardAndStat();
          await sleep(500);
          if (ok) await selectStat();
          await sleep(600);
        }
        await shot(s.name, size, s.scene + (s.select ? " (carta y eje elegidos)" : ""));
      }
    }

    // Movimiento reducido: la arena y la revelación en reposo, a 390.
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.resize(390, 844);
    await t.goto(`${BASE}/design-system/fase26?scene=arena`, 1500);
    await shot("21-reduced-motion-arena", "mobile", "arena (prefers-reduced-motion)");
    await t.goto(`${BASE}/design-system/fase26?scene=round-win`, 1500);
    await shot("22-reduced-motion-reveal", "mobile", "round-win (prefers-reduced-motion)");
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    // Pantallas reales sin sesión: la puerta del modo y la home con el CTA.
    await t.goto(`${BASE}/duelos`, 2000); await shot("23-duel-hub-needs-account", "desktop", "/duelos sin sesión");
    await t.goto(`${BASE}/`, 2500); await shot("24-home-cta", "desktop", "/ (CTA)");
    await t.resize(390, 844); await t.goto(`${BASE}/`, 2500); await shot("24-home-cta", "mobile", "/ (CTA)");

    const errors = t.takeErrors().filter((e) => !/players\/.*\.png|404/.test(e));
    const readme = [
      "# QA visual · Fase 26 (QA SYNTHETIC: motor real en el navegador, cartas reales, sin servidor)",
      "",
      "Generadas con `npx tsx scripts/_fase26-visual-qa.ts` contra `next start -p 3005`, escenas del arnés `/design-system/fase26?scene=…`.",
      "La partida se simula con el motor puro de `domain/cardgame` (dos bots) y se proyecta con `buildMatchView`, la misma función del servidor.",
      "Movimiento activado salvo en `21-*` y `22-*` (prefers-reduced-motion). La selección de carta y eje de `05-*` y `20-*` es un clic real sobre la mano.",
      "",
      "| captura | ancho | escena |",
      "|---|---|---|",
      ...rows.map((r) => `| \`${r.file}\` | ${r.width} | ${r.scene} |`),
      "",
      `Errores de consola no relacionados con fotos ausentes (\`/players/<nick>.png\`, preexistente): ${errors.length}.`,
      ...errors.slice(0, 10).map((e) => `- ${e}`),
      "",
    ].join("\n");
    writeFileSync(join(OUT, "README.md"), readme);
    console.log(rows.map((r) => r.file).join("\n"));
    console.log(`\ncapturas: ${rows.length} · errores de consola (sin 404 de fotos): ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
