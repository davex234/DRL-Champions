/**
 * FASE 45 · DIAGNÓSTICO DE «REVANCHA» (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-revancha-diag.ts <credsFile> [baseUrl]
 *
 * Al pulsar «Revancha» en el resultado, la pantalla se quedó en blanco. Esto averigua POR QUÉ antes de decidir si
 * es un fallo del producto o del instrumento: lee el texto de la página, los errores de consola y las peticiones de
 * red que salen al pulsar, y va fotografiando cada segundo durante diez segundos.
 *
 * No arregla nada y no toca datos: mira.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-revancha-diag.ts <credsFile> [baseUrl]"); process.exit(1); }
const OUT = join(process.cwd(), "docs/product/qa/fase45/playtest");
mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string };

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); }
  return false;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  const browser = await launch({ width: 1440, height: 900, args: ["--in-process-gpu", "--mute-audio"] });
  const tab = browser.tab;
  try {
    await tab.resize(1440, 900, 1);
    // Registrar TODA petición al API de duelo y su respuesta: lo que pide «Revancha» y qué le contestan.
    await tab.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      (() => {
        window.__nxNet = [];
        const of = window.fetch;
        window.fetch = async function (...a) {
          const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
          const metodo = (a[1] && a[1].method) || 'GET';
          try {
            const r = await of.apply(this, a);
            if (/\\/api\\/game\\//.test(url)) {
              const copia = r.clone();
              let cuerpo = '';
              try { cuerpo = (await copia.text()).slice(0, 300); } catch {}
              window.__nxNet.push({ url, metodo, estado: r.status, cuerpo });
            }
            return r;
          } catch (e) {
            if (/\\/api\\/game\\//.test(url)) window.__nxNet.push({ url, metodo, error: String(e) });
            throw e;
          }
        };
        window.__nxErr = [];
        window.addEventListener('error', (e) => window.__nxErr.push(String(e.message)));
        window.addEventListener('unhandledrejection', (e) => window.__nxErr.push('rejection: ' + String(e.reason)));
      })();`,
    });

    await tab.goto(`${BASE}/cuenta`, 5000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    if (!(await waitFor(tab, SIGNED_IN, 45000))) throw new Error("no se pudo iniciar sesión");

    await tab.goto(`${BASE}/duelos/jugar`, 9000);
    await sleep(2500);

    const estado = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      return {
        texto: t.slice(0, 400),
        hayRevancha: [...document.querySelectorAll('button, a')].some((x) => /^revancha$/i.test((x.textContent || '').trim())),
        hayMesa: [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())),
      };
    })()`);
    console.log("· estado al entrar:", JSON.stringify(estado, null, 1));

    if (!estado.hayRevancha) {
      console.log("no hay resultado con Revancha en pantalla; nada que diagnosticar aquí");
      return;
    }

    await tab.js(`window.__nxNet = []; window.__nxErr = [];`);
    await tab.js(`(() => { const b = [...document.querySelectorAll('button, a')].find((x) => /^revancha$/i.test((x.textContent || '').trim())); b.click(); })()`);

    for (let s = 1; s <= 10; s++) {
      await sleep(1000);
      const v = await tab.js<any>(`(() => {
        const t = document.body.innerText;
        return { seg: ${s}, largoTexto: t.length, primeros: t.slice(0, 200).replace(/\\n+/g, ' | '),
                 hayMesa: [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())),
                 url: location.pathname + location.search };
      })()`);
      console.log(`  t+${s}s`, JSON.stringify(v));
      if (s === 3 || s === 10) await tab.shot(join(OUT, `diag-revancha-t${s}.png`));
      if (v.hayMesa) break;
    }

    const red = await tab.js<any>(`window.__nxNet`);
    const errs = await tab.js<any>(`window.__nxErr`);
    console.log("\n· peticiones al API tras pulsar Revancha:");
    for (const r of red) console.log("   ", r.metodo, r.url, "→", r.estado, (r.cuerpo || r.error || "").slice(0, 220));
    console.log("· errores de página:", JSON.stringify(errs));
    console.log("· errores de consola:", JSON.stringify(tab.takeErrors().slice(0, 6)));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
