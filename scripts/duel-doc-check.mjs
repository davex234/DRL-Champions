/**
 * COMPROBACIÓN DE CALIDAD del documento de producto (§29).
 *
 *   node scripts/duel-doc-check.mjs
 *
 * Abre `docs/product/duel-gameplay.html` en Chrome headless por el protocolo de DevTools y mide,
 * diapositiva a diapositiva: desbordamiento vertical y horizontal, elementos que se salen del
 * lienzo 1280×720, diapositivas vacías, texto por debajo del tamaño legible y tipografías que no
 * hayan cargado. Sale con código != 0 si algo falla.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_URL = pathToFileURL(join(ROOT, "docs", "product", "duel-gameplay.html")).href;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!CHROME) { console.error("No se encontró Chrome ni Edge."); process.exit(1); }

const PROFILE = mkdtempSync(join(tmpdir(), "duel-doc-"));
const PORT = 9223 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, "--window-size=1280,720",
  "--user-data-dir=" + PROFILE,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* aún arrancando */ }
    await sleep(250);
  }
  throw new Error("Chrome no abrió el puerto de depuración");
}

/** Cliente mínimo del protocolo de DevTools sobre el WebSocket nativo de Node. */
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method).forEach((fn) => fn(msg.params));
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      return new Promise((res, rej) => {
        const n = ++id;
        pending.set(n, { res, rej });
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    },
    on(method, fn) { events.set(method, [...(events.get(method) ?? []), fn]); },
    close() { ws.close(); },
  };
}

const wsUrl = await endpoint();
const root = connect(wsUrl);
await root.ready;

const { targetId } = await root.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await root.send("Target.attachToTarget", { targetId, flatten: true });
const send = (m, p) => root.send(m, p, sessionId);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

const loaded = new Promise((res) => root.on("Page.loadEventFired", res));
await send("Page.navigate", { url: PAGE_URL });
await loaded;
// Margen para que carguen las tipografías remotas.
await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
await sleep(1200);

const expr = `(() => {
  const W = 1280, H = 720, TOL = 2;
  const out = [];
  document.querySelectorAll(".slide").forEach((s, i) => {
    const n = i + 1;
    const r = s.getBoundingClientRect();
    const problems = [];
    if (Math.abs(r.width - W) > TOL) problems.push("ancho " + Math.round(r.width));
    if (Math.abs(r.height - H) > TOL) problems.push("alto " + Math.round(r.height));
    if (s.scrollHeight > H + TOL) problems.push("desborde vertical +" + (s.scrollHeight - H) + "px");
    if (s.scrollWidth > W + TOL) problems.push("desborde horizontal +" + (s.scrollWidth - W) + "px");

    // Elementos que se salen del lienzo de la diapositiva.
    let clipped = 0, worst = "";
    s.querySelectorAll("*").forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.position === "absolute" && (cs.inset === "0px" || el.className === "cover-glow")) return;
      const overBottom = b.bottom - (r.bottom - 0);
      const overRight = b.right - (r.right - 0);
      const overLeft = r.left - b.left;
      if (overBottom > 3 || overRight > 3 || overLeft > 3) {
        clipped++;
        const tag = el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "");
        if (!worst) worst = tag + " (+" + Math.round(Math.max(overBottom, overRight, overLeft)) + "px)";
      }
    });
    if (clipped) problems.push(clipped + " elemento(s) fuera del lienzo · p.ej. " + worst);

    // Diapositiva vacía.
    const text = (s.innerText || "").trim();
    if (text.length < 12) problems.push("diapositiva casi vacía (" + text.length + " car.)");

    // Contenido recortado DENTRO de un contenedor con overflow oculto (marcos de móvil, listas).
    s.querySelectorAll(".phone-body, .phone-screen, .p-field, .deck-cards, .ten").forEach((box) => {
      const overY = box.scrollHeight - box.clientHeight;
      const overX = box.scrollWidth - box.clientWidth;
      if (overY > 2 || overX > 2) {
        problems.push("contenido recortado en ." + String(box.className).split(" ")[0] +
          (overY > 2 ? " (+" + overY + "px alto)" : "") + (overX > 2 ? " (+" + overX + "px ancho)" : ""));
      }
    });

    // Texto ilegible.
    let tiny = 0;
    s.querySelectorAll("*").forEach((el) => {
      if (!el.childNodes.length) return;
      const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!hasText) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 6) tiny++;
    });
    if (tiny) problems.push(tiny + " elemento(s) con texto < 6px");

    out.push({ n, problems, chars: text.length });
  });

  // Tipografías: comprobar que las dos familias del documento cargaron de verdad.
  const fonts = { rajdhani: document.fonts.check("700 40px Rajdhani"), body: document.fonts.check("400 14px Barlow") };
  return JSON.stringify({ slides: out, fonts, total: document.querySelectorAll(".slide").length });
})()`;

const { result } = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
const report = JSON.parse(result.value);

console.log(`# Comprobación del documento — ${report.total} diapositivas\n`);
console.log(`Tipografías cargadas: Rajdhani ${report.fonts.rajdhani ? "✓" : "✕"} · Barlow ${report.fonts.body ? "✓" : "✕"}\n`);

let bad = 0;
for (const s of report.slides) {
  if (s.problems.length === 0) { console.log(`  ✓ ${String(s.n).padStart(2)} — ok (${s.chars} car.)`); continue; }
  bad++;
  console.log(`  ✕ ${String(s.n).padStart(2)} — ${s.problems.join(" · ")}`);
}
if (!report.fonts.rajdhani || !report.fonts.body) bad++;

console.log(`\n${bad === 0 ? "✅ TODAS LAS DIAPOSITIVAS PASAN" : `❌ ${bad} DIAPOSITIVA(S) CON PROBLEMAS`}`);

root.close();
chrome.kill();
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
process.exit(bad === 0 ? 0 : 1);
