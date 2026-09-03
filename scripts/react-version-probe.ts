/**
 * SONDA DE VERSIÓN DE REACT — qué React corre de verdad en cada mitad.
 *
 *   npm run dev
 *   tsx scripts/react-version-probe.ts
 *
 * El protocolo Flight (RSC) exige que `react`, `react-dom` y `react-server-dom-*` sean
 * EXACTAMENTE el mismo build. Cuando no lo son, el cliente parsea con una máquina de
 * estados distinta de la que escribió el servidor y aparecen errores como
 * `chunk.reason.enqueueModel is not a function`.
 *
 * Esta sonda no adivina: pregunta al navegador qué versión está ejecutando y la compara
 * con la que Next trae compilada y con la que hay en `node_modules`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/cdp";

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

/** Versión declarada en un `package.json` de `node_modules`, o `—`. */
function installed(pkg: string): string {
  try {
    return JSON.parse(readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return "—";
  }
}

/** `exports.version = "…"` dentro de un bundle compilado de Next. */
function compiled(relPath: string): string {
  try {
    const src = readFileSync(join(ROOT, "node_modules", relPath), "utf8");
    return src.match(/exports\.version = "([^"]+)"/)?.[1]
      ?? src.match(/"(19\.\d+\.\d+[^"]*)"/)?.[1]
      ?? "—";
  } catch {
    return "—";
  }
}

async function main() {
  const rows: [string, string][] = [
    ["node_modules/react", installed("react")],
    ["node_modules/react-dom", installed("react-dom")],
    ["next (paquete)", installed("next")],
    [
      "next/compiled react-dom",
      compiled("next/dist/compiled/react-dom/cjs/react-dom.development.js"),
    ],
    [
      "next/compiled react-dom-experimental",
      compiled("next/dist/compiled/react-dom-experimental/cjs/react-dom.development.js"),
    ],
    [
      "next/compiled cliente Flight",
      compiled(
        "next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.development.js",
      ),
    ],
  ];

  console.log("# Versiones de React en disco\n");
  for (const [k, v] of rows) console.log(`  ${k.padEnd(38)} ${v}`);

  // ── Y ahora, la que de verdad corre en el navegador ──
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping) {
    console.log("\n(sin servidor en marcha: no se sondea el navegador)");
    return;
  }

  const browser = await launch({ width: 1200, height: 800 });
  try {
    await browser.tab.goto(`${BASE}/`, 3000);
    const client = await browser.tab.js<{ react: string | null; reactDom: string | null }>(`(() => {
      /*
        React no se expone en window, pero sí deja su versión en el hook de DevTools, que
        Next monta siempre en desarrollo. Es la única forma de preguntarle al navegador
        qué build está ejecutando sin instrumentar la aplicación.
      */
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      let react = null, reactDom = null;
      if (hook && hook.renderers) {
        for (const r of hook.renderers.values()) {
          if (r && r.version) { reactDom = r.version; break; }
        }
      }
      if (window.React && window.React.version) react = window.React.version;
      return { react, reactDom };
    })()`);

    console.log("\n# Versión que EJECUTA el navegador\n");
    console.log(`  renderer (react-dom)                   ${client.reactDom ?? "no detectada"}`);
    if (client.react) console.log(`  react global                           ${client.react}`);

    const disk = installed("react-dom");
    const nextDom = rows.find(([k]) => k.includes("compiled react-dom "))?.[1]
      ?? rows.find(([k]) => k.includes("compiled react-dom"))![1];
    const nextClient = rows.find(([k]) => k.includes("cliente Flight"))![1];

    console.log("\n# Veredicto\n");

    /*
     * CUIDADO CON LA CONCLUSIÓN FÁCIL.
     *
     * Que `node_modules/react-dom` sea 19.0.0 y el cliente Flight de Next sea 19.3-canary
     * NO es, por sí solo, el desajuste que rompe RSC: Next 16 aliasa `react$` y
     * `react-dom$` a SUS copias vendorizadas —`create-compiler-aliases.js`, tanto en el
     * navegador como en el servidor—, así que el App Router no ejecuta el React de la
     * aplicación. Dar esto por causa raíz sería un arreglo especulativo.
     *
     * Lo que sí rompe el protocolo es que las DOS MITADES —la que serializa y la que
     * parsea— no sean el mismo build. Eso es lo que decide el veredicto.
     */
    const norm = (v: string) => v.replace(/-(canary|experimental)-/, "-");
    const flightHalvesMatch = norm(nextDom) === norm(nextClient);

    console.log(`  Las dos mitades de Flight (las de Next): ${flightHalvesMatch ? "✅ mismo build" : "❌ builds distintos"}`);
    console.log(`     renderer        ${nextDom}`);
    console.log(`     cliente Flight  ${nextClient}`);
    console.log("");
    console.log(`  React de la aplicación (node_modules): ${disk}`);
    console.log("     Next lo aliasa fuera del App Router, así que un desfase aquí NO");
    console.log("     explica por sí solo un fallo del protocolo. Conviene alinearlo de");
    console.log("     todos modos: es el que ven los tipos, las herramientas y cualquier");
    console.log("     dependencia que no pase por el alias de Next.");

    process.exitCode = flightHalvesMatch ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
