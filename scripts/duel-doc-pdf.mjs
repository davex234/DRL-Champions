/**
 * EXPORTA EL DOCUMENTO DE PRODUCTO A PDF (y a PNG de contacto para revisarlo).
 *
 *   node scripts/duel-doc-pdf.mjs           → PDF
 *   node scripts/duel-doc-pdf.mjs --png     → PDF + un PNG por diapositiva en docs/product/preview/
 *
 * Usa Chrome headless por el protocolo de DevTools, con `printBackground` explícito: el documento
 * es oscuro y sin fondos no se vería nada.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "product");
const PAGE_URL = pathToFileURL(join(OUT_DIR, "duel-gameplay.html")).href;
const PDF_PATH = join(OUT_DIR, "NEXUS-Duel-Gameplay-Product-Preview.pdf");
const WANT_PNG = process.argv.includes("--png");

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!CHROME) { console.error("No se encontró Chrome ni Edge."); process.exit(1); }

const PROFILE = mkdtempSync(join(tmpdir(), "duel-doc-"));
const PORT = 9500 + Math.floor(Math.random() * 300);
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
    } catch { /* arrancando */ }
    await sleep(250);
  }
  throw new Error("Chrome no abrió el puerto de depuración");
}

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

const root = connect(await endpoint());
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
await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
await sleep(1500);

// ── PDF ──────────────────────────────────────────────────────────────────
// 1280×720 px a 96 ppp = 13,333 × 7,5 pulgadas. Exactamente 16:9 apaisado.
//
// Se pide como FLUJO y se lee por bloques: devolver el PDF entero en un único mensaje del
// protocolo bloquea el socket con un documento de este tamaño.
const { stream } = await send("Page.printToPDF", {
  paperWidth: 1280 / 96,
  paperHeight: 720 / 96,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
  transferMode: "ReturnAsStream",
});

const chunks = [];
for (;;) {
  const r = await send("IO.read", { handle: stream, size: 512 * 1024 });
  if (r.data) chunks.push(Buffer.from(r.data, r.base64Encoded ? "base64" : "utf8"));
  if (r.eof) break;
}
await send("IO.close", { handle: stream });

const pdf = Buffer.concat(chunks);
writeFileSync(PDF_PATH, pdf);
console.log(`[pdf] ${PDF_PATH.replace(ROOT + "\\", "")} · ${(pdf.length / 1024).toFixed(0)} KB`);

// ── PNG de contacto ──────────────────────────────────────────────────────
if (WANT_PNG) {
  const dir = join(OUT_DIR, "preview");
  mkdirSync(dir, { recursive: true });
  const { result } = await send("Runtime.evaluate", {
    expression: "document.querySelectorAll('.slide').length", returnByValue: true,
  });
  const total = result.value;
  for (let i = 0; i < total; i++) {
    await send("Runtime.evaluate", {
      expression: `document.querySelectorAll('.slide')[${i}].scrollIntoView({block:'start'})`,
    });
    await sleep(120);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`), Buffer.from(shot.data, "base64"));
  }
  console.log(`[png] ${total} imágenes → docs/product/preview/`);
}

root.close();
chrome.kill();
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
