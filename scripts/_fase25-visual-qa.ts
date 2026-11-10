/**
 * FASE 25 · CAPTURAS QA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase25-visual-qa.ts`
 *
 * Requiere la app servida (`npx next start -p 3005`) y NADA más: no hay Supabase ni cuenta. El
 * estado es el del arnés `/design-system/fase25?seed=1` (QA SYNTHETIC sobre el catálogo real), que
 * queda persistido en `localStorage` del perfil de Chrome que abre este script. La ceremonia se
 * fotografía con el movimiento ACTIVADO (Chrome sin cabeza declara reduced-motion) y se recorre
 * de verdad: abrir → señal de rareza → revelar → varias → resumen.
 *
 * Guarda en docs/product/qa/fase25/<escena>-<ancho>.png.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.E2E_BASE_URL ?? process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase25");
mkdirSync(OUT, { recursive: true });

const WIDTHS = { desktop: [1440, 900], tablet: [1024, 800], mobile: [390, 844] } as const;
type Size = keyof typeof WIDTHS;

async function main(): Promise<void> {
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const results: string[] = [];
  const shot = async (name: string, size: Size) => {
    const [w, h] = WIDTHS[size];
    await t.resize(w, h);
    await sleep(350);
    const file = join(OUT, `${name}-${w}.png`);
    await t.shot(file);
    results.push(`${name}-${w}.png`);
  };
  const click = async (selectorOrText: string) => t.js<boolean>(`(() => {
    const byText = (txt) => [...document.querySelectorAll("button, a")].find((el) => (el.textContent || "").trim().toUpperCase().startsWith(txt.toUpperCase()));
    const el = document.querySelector(${JSON.stringify(selectorOrText)}) || byText(${JSON.stringify(selectorOrText)});
    if (!el) return false; el.click(); return true; })()`);
  const key = async (k: string) => t.js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);

  try {
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    // 0 · sembrar estado QA (queda en localStorage del perfil)
    await t.goto(`${BASE}/design-system/fase25?seed=1`, 2500);
    await shot("00-arnes-qa", "desktop");

    // 1 · PACK HUB
    for (const s of ["desktop", "tablet", "mobile"] as Size[]) { await t.goto(`${BASE}/packs`, 2000); await shot("01-pack-hub", s); }
    // 2 · PACK DETAIL (equipo: probabilidad aumentada)
    for (const s of ["desktop", "mobile"] as Size[]) { await t.goto(`${BASE}/packs/team-heretics`, 2000); await shot("02-pack-detail", s); }

    // 3–7 · CEREMONIA (desktop y móvil, recorrida de verdad)
    for (const s of ["desktop", "mobile"] as Size[]) {
      await t.resize(WIDTHS[s][0], WIDTHS[s][1]);
      await t.goto(`${BASE}/packs`, 800);
      // La recuperación de la ceremonia anterior (sessionStorage) llevaría directo al resumen: se limpia.
      await t.js("sessionStorage.clear()");
      await t.goto(`${BASE}/abrir/estandar`, 2200);
      await shot("03-opening-start", s);
      const opened = await click("Abrir sobre");
      if (!opened) { results.push(`(no se encontró «Abrir sobre» en ${s})`); continue; }
      await sleep(1500); // rotura → cartas boca abajo con la señal de rareza
      await shot("04-rarity-buildup", s);
      await click("Revelar");
      await sleep(1300);
      await shot("05-card-reveal", s);
      await key("ArrowRight"); await sleep(1400); await key("ArrowRight"); await sleep(900);
      await shot("06-multi-reveal", s);
      await key("s"); await sleep(900);
      await shot("07-summary", s);
    }

    // 8 · COLECCIÓN
    for (const s of ["desktop", "tablet", "mobile"] as Size[]) { await t.goto(`${BASE}/coleccion`, 2500); await shot("08-collection", s); }
    // 9 · EQUIPOS
    for (const s of ["desktop", "mobile"] as Size[]) { await t.goto(`${BASE}/coleccion/equipos`, 2200); await shot("09-team-collection", s); }
    // 10 · CARD DETAIL (primera casilla del álbum)
    for (const s of ["desktop", "mobile"] as Size[]) {
      await t.resize(WIDTHS[s][0], WIDTHS[s][1]);
      await t.goto(`${BASE}/coleccion`, 2500);
      const ok = await t.js<boolean>(`(() => { const el = document.querySelector('[aria-label^="Ver "]') || document.querySelector("main button[aria-label]"); if (!el) return false; el.click(); return true; })()`);
      await sleep(900);
      await shot(ok ? "10-card-detail" : "10-card-detail-NOT-FOUND", s);
    }
    // 11 · AÑADIR AL EQUIPO / COMPARAR (arnés con mazo de mentira)
    for (const s of ["desktop", "mobile"] as Size[]) { await t.goto(`${BASE}/design-system/fase25?scene=deck`, 2200); await shot("11-deck-add-compare", s); }
    // 12 · HOME con la tira del bucle
    for (const s of ["desktop", "mobile"] as Size[]) { await t.goto(`${BASE}/`, 2500); await shot("12-home-loop", s); }
    // 13 · reduced motion: ceremonia en reposo
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.goto(`${BASE}/abrir/estandar`, 1800); await shot("13-opening-reduced-motion", "mobile");

    // Recursos rotos (imágenes) en la última pantalla, para distinguir un 404 de assets de un fallo de la fase.
    await t.goto(`${BASE}/packs`, 2000);
    const broken = await t.js<string[]>("[...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 8)");
    console.log("imágenes rotas en /packs:", JSON.stringify(broken));
    const errors = t.takeErrors();
    console.log(results.join("\n"));
    console.log(`\ncapturas: ${results.length} · errores de consola: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log("  ✗", e);
  } finally {
    await b.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
