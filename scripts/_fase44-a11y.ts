/**
 * FASE 44 · MATRIZ DE ACCESIBILIDAD CON TECLADO REAL (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-a11y.ts <credsFile> [baseUrl]
 *
 * Teclas reales por CDP (Tab, Shift+Tab, Enter, Escape). Recorrido Home → Jugar → PvE (hasta el botón de empezar, SIN
 * pulsarlo: no se crea partida) → Sobres → Colección → Equipos, más la hoja «Menú» móvil y un diálogo del arnés (foco
 * atrapado, Escape, foco devuelto). En cada paso: foco visible (outline o anillo). Lectores de pantalla: CTA con nombre,
 * marcador, barras de progreso con valor, rareza anunciada, resultado, diálogo modal. Escribe accessibility-matrix.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3005";
const flows: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail = "") => { flows.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function key(tab: Tab, k: "Tab" | "Enter" | "Escape", shift = false) {
  const code = { Tab: 9, Enter: 13, Escape: 27 }[k];
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  if (k === "Enter") await tab.send("Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  await sleep(120);
}
const FOCUS = `(() => { const f = document.activeElement; if (!f || f === document.body) return null; const cs = getComputedStyle(f); const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'); return { tag: f.tagName, text: (f.getAttribute('aria-label') || f.innerText || '').trim().slice(0, 40), href: f.getAttribute('href'), testid: f.getAttribute('data-testid'), visible, inDialog: !!f.closest('[role="dialog"]') }; })()`;

async function tabUntil(tab: Tab, pred: (f: any) => boolean, max = 80): Promise<{ found: any; steps: number; allVisible: boolean }> {
  let allVisible = true;
  for (let i = 1; i <= max; i++) {
    await key(tab, "Tab");
    const f = await tab.js<any>(FOCUS);
    if (f && !f.visible) allVisible = false;
    if (f && pred(f)) return { found: f, steps: i, allVisible };
  }
  return { found: null, steps: max, allVisible };
}

async function main() {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  const b = await launch({ width: 1440, height: 900, userDataDir: CREDS ? join(CREDS, "..", "f44-a11y-profile") : undefined });
  const tab = b.tab;
  try {
    if (creds) {
      await tab.goto(`${BASE}/cuenta`, 4000);
      if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
        await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
        for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break; await sleep(500); }
      }
    }

    // 1 · Home: saltar al contenido y JUGAR por teclado.
    await tab.goto(`${BASE}/`, 6000);
    await key(tab, "Tab");
    const first = await tab.js<any>(FOCUS);
    record("Home · el primer Tab es «Saltar al contenido»", !!first && /saltar al contenido/i.test(first.text), first?.text ?? "");
    await tab.goto(`${BASE}/`, 6000);
    const toPlay = await tabUntil(tab, (f) => f.testid === "shell-play");
    record("Home · JUGAR alcanzable con Tab y con foco visible", !!toPlay.found && toPlay.found.visible, `${toPlay.steps} tabs`);
    await key(tab, "Enter"); await sleep(3500);
    record("JUGAR · Enter abre el selector de modos", (await tab.js<string>("location.pathname")) === "/jugar");

    // 2 · Selector → PvE (sin empezar partida).
    const toQuick = await tabUntil(tab, (f) => f.testid === "mode-cta-QUICK");
    record("Modos · «Partida rápida» alcanzable con Tab", !!toQuick.found, `${toQuick.steps} tabs`);
    if (toQuick.found) { await key(tab, "Enter"); await sleep(5000); }
    record("PvE · Enter entra en la preparación", /\/duelos\/jugar/.test(await tab.js<string>("location.pathname")));
    const toStart = await tabUntil(tab, (f) => /comenzar duelo/i.test(f.text), 60);
    record("PvE · «Comenzar duelo» alcanzable con foco visible (no se pulsa)", !!toStart.found && toStart.found.visible, `${toStart.steps} tabs`);

    // 3 · Sobres, colección, equipos.
    for (const [path, pred, label] of [
      ["/inventario", (f: any) => /abrir sobre|conseguir sobres/i.test(f.text), "Sobres · abrir/conseguir alcanzable"],
      ["/coleccion", (f: any) => /\/coleccion\/carta\//.test(f.href ?? ""), "Colección · una carta alcanzable"],
      ["/duelos/mazos", (f: any) => /editar|jugar|crear/i.test(f.text), "Equipos · acción de equipo alcanzable"],
    ] as const) {
      await tab.goto(`${BASE}${path}`, 6000);
      const r = await tabUntil(tab, pred, 120);
      record(label, !!r.found && r.found.visible, `${r.steps} tabs`);
    }

    // 4 · Móvil: hoja «Menú» con foco atrapado, Escape y foco devuelto.
    await tab.resize(390, 844);
    await tab.goto(`${BASE}/temporada`, 5000);
    const toMenu = await tabUntil(tab, (f) => f.testid === "shell-menu", 40);
    record("Móvil · botón «Menú» alcanzable", !!toMenu.found);
    if (toMenu.found) {
      await key(tab, "Enter"); await sleep(700);
      let trapped = true;
      for (let i = 0; i < 40; i++) { await key(tab, "Tab"); const f = await tab.js<any>(FOCUS); if (!f || !f.inDialog) { trapped = false; break; } }
      record("Móvil · el foco no escapa de la hoja (40 tabs)", trapped);
      await key(tab, "Escape"); await sleep(600);
      const back = await tab.js<any>(FOCUS);
      const open = await tab.js<boolean>(`!!document.querySelector('[data-testid="shell-menu-sheet"]')`);
      record("Móvil · Escape cierra y el foco vuelve a «Menú»", !open && back?.testid === "shell-menu", back?.testid ?? "");
    }

    // 5 · Diálogo del arnés.
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/design-system/fase44?scene=overlays`, 3500);
    await sleep(600);
    const inDialog = await tab.js<any>(FOCUS);
    record("Diálogo · el foco entra al abrir", !!inDialog?.inDialog, inDialog?.text ?? "");
    await key(tab, "Escape"); await sleep(500);
    record("Diálogo · Escape cierra sin dejar capa", !(await tab.js<boolean>(`!!document.querySelector('[role="dialog"]')`)));

    // 6 · Lectores de pantalla (lo mínimo del encargo).
    await tab.goto(`${BASE}/design-system/fase44?scene=result-victory`, 4000);
    const sr = await tab.js<any>(`(() => ({ h1: document.querySelector('h1')?.innerText ?? '', bars: [...document.querySelectorAll('[role="progressbar"]')].every((b) => b.hasAttribute('aria-valuenow') && (b.getAttribute('aria-label') || '').length > 0), actions: [...document.querySelectorAll('[data-testid="result-actions"] button, [data-testid="result-actions"] a')].every((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().length > 0) }))()`);
    record("Lector · resultado con encabezado, barras con valor y acciones con nombre", /victoria/i.test(sr.h1) && sr.bars && sr.actions, JSON.stringify(sr));
    await tab.goto(`${BASE}/design-system/fase38?scene=reveal-legendary`, 4000);
    const ann = await tab.js<string>(`document.querySelector('[data-testid="reveal-announcement"]')?.textContent ?? ''`);
    record("Lector · la rareza de la carta revelada se anuncia en texto", /legendaria/i.test(ann), ann.slice(0, 60));
    await tab.goto(`${BASE}/design-system/fase44?scene=play-cta`, 3500);
    const cta = await tab.js<boolean>(`[...document.querySelectorAll('[data-game-cta]')].every((a) => (a.getAttribute('aria-label') || '').length > 3)`);
    record("Lector · JUGAR/CONTINUAR con nombre accesible", cta);
    await tab.goto(`${BASE}/design-system/fase44?scene=reduced`, 3500);
    const reduced = await tab.js<boolean>(`document.querySelector('[data-testid="motion-lab"]')?.getAttribute('data-reduced') === 'true'`);
    record("Movimiento reducido · el laboratorio lo detecta y lo aplica", reduced);
  } finally {
    await b.close();
  }
  const blockers = flows.filter((f) => !f.ok).length;
  writeFileSync(join(process.cwd(), "docs/product/qa/fase44/accessibility-matrix.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, flows, blockers }, null, 2) + "\n");
  console.log(`\n${flows.length} comprobaciones · ${blockers} bloqueos`);
}
void main();
