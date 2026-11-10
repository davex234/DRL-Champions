/**
 * FASE 45 · MIRAR EL ENFRENTAMIENTO CON LA ANIMACIÓN TERMINADA (instrumento `_`, fuera de CI).
 *
 *   npx tsx scripts/_fase45-clash-shot.ts <credsFile> [baseUrl]
 *
 * Existe por un fallo de MEDICIÓN, no de producto. El playtest captura en cuanto el turno se resuelve, y la
 * revelación tiene tiempos: cuando dispara la cámara, el veredicto («PUNTO PARA TI», el porqué y el marcador) ya
 * está en el DOM —`revelacion: true` en los diez turnos— pero todavía con opacidad 0. Las capturas salían sin él y
 * parecía que faltaba.
 *
 * Aquí se reanuda la partida que quedó abierta, se juega un turno y se espera a que la revelación ACABE antes de
 * mirar. No se fuerza nada ni se toca el resultado: sólo se espera.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
if (!CREDS) { console.error("uso: _fase45-clash-shot.ts <credsFile> [baseUrl]"); process.exit(1); }

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
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    await tab.goto(`${BASE}/cuenta`, 5000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    if (!(await waitFor(tab, SIGNED_IN, 45000))) throw new Error("no se pudo iniciar sesión");

    // La partida de la revancha quedó abierta: entrar la REANUDA, que es justo lo que hay que comprobar.
    await tab.goto(`${BASE}/duelos/jugar`, 9000);
    await sleep(2500);
    const reanudada = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      const m = t.match(/(\\d+)\\s*\\/\\s*10/);
      return { turno: m ? Number(m[1]) : null, enMesa: [...document.querySelectorAll('button')].some((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim())) };
    })()`);
    console.log("· partida reanudada:", JSON.stringify(reanudada));
    await tab.shot(join(OUT, "17-resume-partida-abierta.png"));

    if (!reanudada.enMesa) { console.log("no hay partida abierta que reanudar"); return; }

    // Un turno, y esperar a que la revelación termine de entrar.
    await tab.js(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const btns = () => [...document.querySelectorAll('button')];
      const confirmar = () => btns().find((b) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(b.textContent.trim()));
      const cartas = btns().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      cartas[0].click(); await sleep(300);
      const ejes = btns().filter((b) => !b.getAttribute('aria-label') && /^(SH|GS|EF)/.test(b.textContent.trim()));
      if (ejes.length === 3) { ejes[0].click(); await sleep(300); }
      const c = confirmar(); if (c && !c.disabled) c.click();
    })()`);

    // Esperar al VEREDICTO, no al botón: es lo que la captura anterior se perdía.
    const hubo = await waitFor(tab, `(() => /PUNTO PARA TI|PUNTO PARA EL RIVAL|EMPATE/i.test(document.body.innerText))()`, 30000);
    // Y después, a que la animación de entrada acabe de verdad.
    await sleep(2200);

    const visto = await tab.js<any>(`(() => {
      const t = document.body.innerText;
      const veredicto = (t.match(/PUNTO PARA TI|PUNTO PARA EL RIVAL|EMPATE/i) || [])[0] || null;
      const linea = (t.match(/Tu \\w+ \\d+ [^\\n]*/i) || [])[0] || null;
      const marcador = (t.match(/(\\d+)\\s*[–-]\\s*(\\d+)/) || [])[0] || null;
      return { veredicto, linea, marcador };
    })()`);
    console.log("· veredicto visible:", JSON.stringify(visto), "· aparecio:", hubo);
    await tab.shot(join(OUT, "18-clash-con-veredicto.png"));
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("ERROR", e instanceof Error ? e.message : e); process.exit(1); });
