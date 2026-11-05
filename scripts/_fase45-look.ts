/**
 * FASE 45 · MIRAR LA ARENA (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase45-look.ts <escena[,escena…]> [ancho] [--reduced]
 *
 * Un Chrome, un lote corto, una captura por escena en el arnés `/design-system/fase45`. Existe para el bucle de
 * iteración visual de la fase —cambiar una capa, mirarla, volver a cambiarla— sin arrancar la matriz completa de
 * `_fase45-shots.ts`. No escribe en la base de datos, no toca la cuenta QA y no navega a rutas reales.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const ESCENAS = (process.argv[2] ?? "arena-idle").split(",");
const ANCHO = Number(process.argv[3] ?? 1440);
const ALTO = ANCHO <= 430 ? 844 : ANCHO >= 2560 ? 1440 : 900;
const REDUCED = process.argv.includes("--reduced");
const BASE = process.env.F45_BASE ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase45/look");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await launch({ width: ANCHO, height: ALTO, args: ["--in-process-gpu", "--mute-audio"] });
  try {
    await browser.tab.resize(ANCHO, ALTO, 1);
    // Chrome sin cabeza declara `reduce`: para ver el recinto en movimiento hay que pedirlo.
    await browser.tab.setMedia([
      { name: "prefers-reduced-motion", value: REDUCED ? "reduce" : "no-preference" },
    ]);
    for (const escena of ESCENAS) {
      await browser.tab.goto(`${BASE}/design-system/fase45?scene=${escena}`, 900);
      await sleep(700);
      const file = join(OUT, `${escena}-${ANCHO}${REDUCED ? "-reduced" : ""}.png`);
      await browser.tab.shot(file);
      const errores = browser.tab.takeErrors();
      console.log(`· ${escena} @${ANCHO}${errores.length ? `  ⚠ ${errores.length} error(es): ${errores[0]}` : ""}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
