/**
 * VERIFICACIÓN DEL SERVICE WORKER — en un navegador de verdad.
 *
 *   npm run sw:verify
 *
 * QUÉ COMPRUEBA, Y POR QUÉ
 *
 *   La versión original de `public/sw.js` decía «estáticos: stale-while-revalidate» pero
 *   NO filtraba nada: cacheaba todo GET del mismo origen que no fuera una navegación. En
 *   una sesión real eso eran 107 cargas RSC (`?_rsc=`) guardadas y servidas con
 *   `cached || network`, es decir, sin comprobar nada.
 *
 *   Una carga RSC es el flujo Flight de UNA compilación concreta. Servírsela al cliente de
 *   otra rompe el protocolo con `chunk.reason.enqueueModel is not a function`.
 *
 *   Esta verificación levanta una compilación de producción de verdad, deja que el service
 *   worker se instale con un perfil PERSISTENTE —en uno temporal no se instala nunca, que
 *   es por lo que el fallo no se veía— y comprueba QUÉ ha guardado.
 *
 * MÉTODO
 *   1. `next build` + `next start` (el SW solo se registra en producción).
 *   2. Perfil de Chrome persistente. Visita: el SW se instala y cachea.
 *   3. Navegación de cliente, que es la que genera peticiones `?_rsc=`.
 *   4. Se inspecciona el contenido de `caches`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnServer, waitForServer } from "./lib/server";
import { launch, sleep } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/** Puerto propio: no se pisa con el servidor de desarrollo del usuario. */
const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  console.log("# Reproducción — service worker y cargas RSC obsoletas\n");

  console.log("## 1 · Build de producción");
  await new Promise<void>((res, rej) => {
    const b = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore", shell: true });
    b.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build salió con ${c}`))));
  });
  console.log("  · listo");

  console.log(`\n## 2 · next start en :${PORT}`);
  const server = spawnServer("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "production" },
  });
  if (!(await waitForServer(`${BASE}/`, 60_000))) {
    server.stop();
    throw new Error("el servidor de producción no arrancó");
  }
  console.log("  · en marcha");

  const profile = mkdtempSync(join(tmpdir(), "nexus-sw-"));
  let browser = await launch({ width: 1280, height: 860, userDataDir: profile });

  try {
    console.log("\n## 3 · Primera visita (el SW se instala)");
    await browser.tab.goto(`${BASE}/`, 4000);

    const swState = await browser.tab.js<{ controlled: boolean; scope: string | null }>(`(async () => {
      if (!('serviceWorker' in navigator)) return { controlled: false, scope: null };
      const reg = await navigator.serviceWorker.getRegistration();
      return { controlled: !!navigator.serviceWorker.controller, scope: reg ? reg.scope : null };
    })()`);
    console.log(`  · registrado: ${swState.scope ?? "no"} · controla la página: ${swState.controlled}`);

    if (!swState.scope) {
      console.log("\n  ⚪ El service worker no se registró: la hipótesis no se puede probar así.");
      return;
    }

    // Navegación de cliente: aquí es donde el router pide las cargas RSC.
    console.log("\n## 4 · Navegación de cliente (genera peticiones ?_rsc=)");
    for (const href of ["/duelos", "/entrenador", "/coleccion", "/tienda", "/cuenta", "/"]) {
      await browser.tab.js(`(() => {
        let a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === ${JSON.stringify(href)});
        if (!a) { a = document.createElement('a'); a.href = ${JSON.stringify(href)}; document.body.appendChild(a); }
        a.click();
      })()`);
      await sleep(1400);
    }
    // Recarga para que el SW ya instalado controle desde el primer byte.
    await browser.tab.goto(`${BASE}/`, 3000);
    for (const href of ["/duelos", "/entrenador", "/coleccion", "/"]) {
      await browser.tab.js(`(() => {
        let a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === ${JSON.stringify(href)});
        if (!a) { a = document.createElement('a'); a.href = ${JSON.stringify(href)}; document.body.appendChild(a); }
        a.click();
      })()`);
      await sleep(1400);
    }

    console.log("\n## 5 · Qué ha guardado el service worker");
    const cached = await browser.tab.js<string[]>(`(async () => {
      const names = await caches.keys();
      const out = [];
      for (const n of names) {
        const c = await caches.open(n);
        for (const req of await c.keys()) out.push(req.url);
      }
      return out;
    })()`);

    const rsc = cached.filter((u) => u.includes("_rsc="));
    const api = cached.filter((u) => new URL(u).pathname.startsWith("/api/"));
    const otros = cached.filter((u) => !u.includes("_rsc=") && !new URL(u).pathname.startsWith("/api/"));

    console.log(`  · entradas totales      ${cached.length}`);
    console.log(`  · cargas RSC (?_rsc=)   ${rsc.length}`);
    console.log(`  · respuestas de /api/   ${api.length}`);
    console.log(`  · estáticos y páginas   ${otros.length}`);
    for (const u of rsc.slice(0, 5)) console.log(`      RSC  ${u.replace(BASE, "").slice(0, 110)}`);
    for (const u of api.slice(0, 5)) console.log(`      API  ${u.replace(BASE, "")}`);

    console.log("\n# Veredicto\n");
    let fallos = 0;

    if (rsc.length > 0) {
      fallos++;
      console.log(`  ✕ ${rsc.length} carga(s) RSC en caché`);
      console.log("    Se sirven al cliente de OTRA compilación y rompen el protocolo");
      console.log("    Flight: `chunk.reason.enqueueModel is not a function`.");
    } else {
      console.log("  ✓ ninguna carga RSC en caché");
    }

    if (api.length > 0) {
      fallos++;
      console.log(`  ✕ ${api.length} respuesta(s) de /api/ en caché`);
      console.log("    Sirve datos obsoletos y, como `caches` es por ORIGEN, la respuesta");
      console.log("    de un usuario puede acabar sirviéndose a otro que entre después en");
      console.log("    el mismo navegador.");
    } else {
      console.log("  ✓ ninguna respuesta de /api/ en caché");
    }

    if (otros.length === 0) {
      fallos++;
      console.log("  ✕ no se cacheó nada: el modo sin conexión no funcionaría");
    } else {
      console.log(`  ✓ ${otros.length} estático(s) en caché para el modo sin conexión`);
    }

    console.log(fallos === 0 ? "\n✅ PASA" : `\n❌ ${fallos} comprobación(es) fallidas`);
    process.exitCode = fallos === 0 ? 0 : 1;
  } finally {
    await browser.close();
    server.stop();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows */ }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
