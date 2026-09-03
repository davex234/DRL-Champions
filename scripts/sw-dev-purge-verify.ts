/**
 * VERIFICACIÓN — el service worker se RETIRA solo en desarrollo.
 *
 *   npm run dev              (en otra terminal)
 *   npm run sw:purge-verify
 *
 * POR QUÉ EXISTE
 *
 * Un service worker se instala por ORIGEN, no por modo. Basta con haber abierto una vez
 * una compilación de producción en `localhost:3001` para que siga controlando las sesiones
 * de `next dev` en ese mismo puerto, sirviendo desde su caché artefactos que no son de esa
 * compilación —y ahí es donde aparece `chunk.reason.enqueueModel is not a function`.
 *
 * La versión anterior de `RegisterSW` se limitaba a `return` en desarrollo. No registrar no
 * es lo mismo que desregistrar: el worker viejo se quedaba exactamente donde estaba.
 *
 * MÉTODO
 *   Se reproduce el estado envenenado de la forma más directa: se registra el service
 *   worker A MANO contra el servidor de desarrollo, que es justo lo que deja una visita
 *   previa en modo producción sobre ese puerto. Después se recarga y se comprueba que la
 *   aplicación se limpia sola.
 *
 *   Una versión anterior de esta prueba levantaba un SEGUNDO `next dev` en otro puerto, y
 *   eso estaba mal: dos servidores de desarrollo comparten `.next/dev` y se pisan, así que
 *   la prueba acababa hablando con un servidor que servía código viejo. Costó un buen rato
 *   descubrirlo, y por eso queda escrito aquí.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep, type Browser } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};

async function swState(browser: Browser) {
  return browser.tab.js<{ regs: number; caches: number; controlled: boolean }>(`(async () => {
    const regs = ('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistrations() : [];
    const keys = ('caches' in window) ? await caches.keys() : [];
    return {
      regs: regs.length,
      caches: keys.length,
      controlled: ('serviceWorker' in navigator) && !!navigator.serviceWorker.controller,
    };
  })()`);
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor de desarrollo en ${BASE}. Arranca 'npm run dev'.`);
    process.exit(1);
  }

  const browser = await launch({ width: 1200, height: 820 });

  try {
    console.log(`# El service worker se retira solo en desarrollo — ${BASE}\n`);

    console.log("## 1 · Se deja el origen envenenado");
    await browser.tab.goto(`${BASE}/`, 3000);

    const installed = await browser.tab.js<{ scope: string | null; controlled: boolean }>(`(async () => {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // El control llega en el ciclo siguiente: el worker hace clients.claim().
      for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
      // Se le deja algo en caché, para comprobar que también se borra.
      const c = await caches.open('nexus-prueba');
      await c.put(new Request('/manifest.webmanifest'), new Response('{}'));
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller };
    })()`);

    console.log(`  · registrado en ${installed.scope} · controlando: ${installed.controlled}`);
    check(installed.scope !== null, "el service worker queda instalado en el origen de desarrollo");
    check(installed.controlled, "y controla la página");

    console.log("\n## 2 · Se recarga: la aplicación debería limpiarse sola");
    const loadsBefore = browser.tab.loadCount();
    browser.tab.takeErrors();
    await browser.tab.goto(`${BASE}/`, 6000);
    // La limpieza desregistra, borra cachés y recarga una vez. Se le da margen.
    await sleep(5000);

    const errs = browser.tab.takeErrors().filter((e) => !/404/.test(e));
    if (errs.length > 0) {
      console.log("  · errores durante la limpieza:");
      for (const e of errs.slice(0, 4)) console.log(`      ${e.slice(0, 200)}`);
    }

    const after = await swState(browser);
    console.log(`  · registros: ${after.regs} · cachés: ${after.caches} · controlando: ${after.controlled}`);

    check(after.regs === 0, "no queda ningún service worker registrado", `quedan ${after.regs}`);
    check(after.caches === 0, "no queda ninguna caché", `quedan ${after.caches}`);
    check(!after.controlled, "la página ya no la controla ningún worker");

    /*
     * Un bucle de recargas no da ningún error: la página se reinicia para siempre y desde
     * fuera parece que va bien. Contarlas es la única forma barata de detectarlo.
     */
    const loads = browser.tab.loadCount() - loadsBefore;
    console.log(`  · cargas de página: ${loads}`);
    check(loads <= 3, "la limpieza no deja la página recargándose en bucle", `${loads} cargas`);

    const chars = await browser.tab.js<number>("(document.body.innerText || '').trim().length");
    check(chars > 200, "la aplicación sigue funcionando tras la limpieza", `${chars} caracteres`);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\n✅ PASA" : `\n❌ ${failures} comprobación(es) fallidas`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
