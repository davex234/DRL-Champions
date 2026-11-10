/**
 * FASE 44.1 · QA EN NAVEGADOR REAL (instrumento `_`, fuera de CI, SOLO LECTURA: no compra, no abre sobres, no juega)
 *
 *   npx tsx scripts/_fase44-1-qa.ts <credsFile> [baseUrl] <wheel|cycles|env|audio|perf|all>
 *
 *   wheel   rueda real (CDP mouseWheel), rueda fina de trackpad, teclado y gesto táctil en las pantallas core
 *   cycles  100 × hoja+diálogo anidados (arnés) y 100 × menú móvil real: el scroll vuelve siempre
 *   env     ambiente por ruta: lugar, sin puntero, detrás del contenido, tinte al apuntar modos, parallax, atenuado
 *   audio   motor de música en el arnés: nada antes del gesto, contextos, fundidos, duck, override, pestaña oculta
 *   perf    fotogramas y tareas largas en reposo con y sin ambiente (home, colección, tienda, equipos)
 *
 * Escribe JSON en docs/product/qa/fase44-1/. Chrome sin cabeza declara `reduce`: se pide `no-preference` salvo donde
 * se mide justo el modo reducido.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const MODE = process.argv.slice(3).find((a) => !a.startsWith("http") && !a.startsWith("--")) ?? "all";
const OUT = process.env.F441_OUT ?? join(process.cwd(), "docs/product/qa/fase44-1");
mkdirSync(OUT, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, ...data as object }, null, 2) + "\n");
const CORE = ["/", "/coleccion", "/tienda", "/inventario", "/duelos/mazos", "/jugar/road-to-champions", "/jugar/draft-gauntlet", "/duelos/competitivo", "/temporada", "/jugador/me", "/jugar", "/logros"];

async function login(tab: Tab) {
  const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) : null;
  if (!creds) return;
  await tab.goto(`${BASE}/cuenta`, 4000);
  if (!(await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`))) return;
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  for (let i = 0; i < 60; i++) { if (await tab.js<boolean>(`/cerrar sesión/i.test(document.body.innerText)`).catch(() => false)) break; await sleep(500); }
}

const Y = `Math.round(window.scrollY)`;
const OVERFLOW = `({ html: getComputedStyle(document.documentElement).overflowY, inline: document.documentElement.style.overflow || '', body: document.body.style.overflow || '' })`;

async function wheelBy(tab: Tab, dy: number, steps = 3, x = 700, y = 480) {
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (let i = 0; i < steps; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy }); await sleep(60); }
  await sleep(500);
}
async function key(tab: Tab, k: string, code: number) {
  await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code });
  await sleep(450);
}

/** Deslizamiento táctil real (eventos touch de CDP con emulación táctil activada). */
async function touchSwipe(tab: Tab) {
  await tab.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => null);
  const pts = (y: number) => [{ x: 195, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await tab.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(700) });
  for (let y = 680; y >= 260; y -= 30) { await tab.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(y) }); await sleep(16); }
  await tab.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await tab.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => null);
}

/* ───────────── rueda ───────────── */

async function wheel(tab: Tab) {
  const rows: any[] = [];
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  for (const p of CORE) {
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}${p}`, 6500);
    const max = await tab.js<number>(`Math.round(document.scrollingElement.scrollHeight - innerHeight)`);
    const y0 = await tab.js<number>(Y);
    await wheelBy(tab, 300); const yDown = await tab.js<number>(Y);
    await wheelBy(tab, -300); const yUp = await tab.js<number>(Y);
    // trackpad: muchos deltas pequeños
    await wheelBy(tab, 12, 20); const yPad = await tab.js<number>(Y);
    await key(tab, "Home", 36);
    await key(tab, "PageDown", 34); const yPg = await tab.js<number>(Y);
    await key(tab, "Home", 36);
    await key(tab, "ArrowDown", 40); const yArrow = await tab.js<number>(Y);
    await key(tab, "Home", 36);
    // táctil (móvil)
    await tab.resize(390, 844, 2);
    await tab.goto(`${BASE}${p}`, 5000);
    const maxM = await tab.js<number>(`Math.round(document.scrollingElement.scrollHeight - innerHeight)`);
    await touchSwipe(tab);
    await sleep(700);
    const yTouch = await tab.js<number>(Y);
    // Pantalla que cabe entera a 1440×900: se repite la rueda en una ventana baja para que haya algo que desplazar.
    let short: any = null;
    if (max <= 20) {
      await tab.resize(1440, 560);
      await tab.goto(`${BASE}${p}`, 5000);
      const maxS = await tab.js<number>(`Math.round(document.scrollingElement.scrollHeight - innerHeight)`);
      await wheelBy(tab, 300); const d = await tab.js<number>(Y);
      await wheelBy(tab, -300); const u = await tab.js<number>(Y);
      short = { viewport: "1440x560", max: maxS, wheelDown: d, wheelUp: u - d };
    }
    const row = { path: p, max, wheelDown: yDown - y0, wheelUp: yUp - yDown, trackpad: yPad - yUp, pageDown: yPg, arrowDown: yArrow, mobileMax: maxM, touch: yTouch, short, overflow: await tab.js<any>(OVERFLOW) };
    const scrollable = max > 20;
    (row as any).ok = !scrollable || (row.wheelDown > 0 && row.wheelUp < 0 && row.trackpad > 0 && row.pageDown > 0 && row.arrowDown > 0);
    (row as any).touchOk = maxM <= 20 || yTouch > 0;
    rows.push(row);
    console.log(`${p}: max ${max} · rueda ↓${row.wheelDown} ↑${row.wheelUp} · trackpad ${row.trackpad} · PgDn ${yPg} · ↓ ${yArrow} · táctil ${yTouch}/${maxM} · ${(row as any).ok && (row as any).touchOk ? "OK" : "FALLO"}`);
    await tab.resize(1440, 900);
  }
  // Rueda vertical con el cursor ENCIMA de un carril horizontal de cartas: debe seguir bajando la página.
  await tab.resize(1440, 900);
  await tab.goto(`${BASE}/coleccion`, 6500);
  const rail = await tab.js<any>(`(() => { const el = document.querySelector('[data-testid="discovery-top"] ul'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, scrollW: el.scrollWidth, w: el.clientWidth }; })()`);
  let nested: any = { found: false };
  if (rail) {
    await sleep(400);
    const before = await tab.js<number>(Y);
    const railLeft0 = await tab.js<number>(`document.querySelector('[data-testid="discovery-top"] ul').scrollLeft`);
    await wheelBy(tab, 240, 3, Math.round(rail.x), Math.round(rail.y));
    nested = { found: true, pageDelta: (await tab.js<number>(Y)) - before, railLeftDelta: (await tab.js<number>(`document.querySelector('[data-testid="discovery-top"] ul').scrollLeft`)) - railLeft0, rail };
  }
  console.log(`carril horizontal: ${JSON.stringify(nested)}`);
  save("wheel-after.json", { rows, nested });
}

/* ───────────── ciclos ───────────── */

async function cycles(tab: Tab) {
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]); // ciclos rápidos sin animaciones de entrada
  await tab.resize(1440, 900);
  await tab.goto(`${BASE}/design-system/fase44-1?scene=scroll`, 6000);
  const harness: any[] = [];
  for (let i = 0; i < 100; i++) {
    await tab.js(`document.querySelector('[data-testid="scroll-open-sheet"]').click()`); await sleep(60);
    const lockedSheet = await tab.js<any>(OVERFLOW);
    await tab.js(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => /diálogo encima/i.test(b.textContent)).click()`); await sleep(60);
    const lockedBoth = await tab.js<any>(OVERFLOW);
    await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(60);
    const afterModal = await tab.js<any>(OVERFLOW);
    await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(80);
    const free = await tab.js<any>(OVERFLOW);
    harness.push({ i, lockedSheet: lockedSheet.inline, lockedBoth: lockedBoth.inline, afterModal: afterModal.inline, free: free.inline });
  }
  await tab.js(`window.scrollTo(0, 0)`); await sleep(200);
  await wheelBy(tab, 300);
  const wheelAfter = await tab.js<number>(Y);
  const harnessOk = harness.every((c) => c.lockedSheet === "hidden" && c.lockedBoth === "hidden" && c.free === "");
  console.log(`arnés: 100 ciclos hoja+diálogo · ${harnessOk ? "OK" : "FALLO"} · rueda después ${wheelAfter}`);

  // menú móvil real (hoja del armazón)
  await tab.resize(390, 844, 2);
  await tab.goto(`${BASE}/`, 6000);
  const menu: any[] = [];
  for (let i = 0; i < 100; i++) {
    const opened = await tab.js<boolean>(`(() => { const b = document.querySelector('[data-testid="shell-menu"]'); if (!b) return false; b.click(); return true; })()`);
    await sleep(80);
    const locked = await tab.js<any>(OVERFLOW);
    await tab.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(120);
    const free = await tab.js<any>(OVERFLOW);
    menu.push({ i, opened, locked: locked.inline, free: free.inline });
  }
  await touchSwipe(tab);
  await sleep(700);
  const touchAfter = await tab.js<number>(Y);
  const menuOk = menu.every((c) => c.opened && c.locked === "hidden" && c.free === "");
  console.log(`menú móvil: 100 ciclos · ${menuOk ? "OK" : "FALLO"} · táctil después ${touchAfter}`);
  save("scroll-lock-cycles.json", { harness: { cycles: harness.length, ok: harnessOk, wheelAfter }, mobileMenu: { cycles: menu.length, ok: menuOk, touchAfter }, sample: { harness: harness.slice(0, 3), menu: menu.slice(0, 3) } });
}

/* ───────────── ambiente ───────────── */

async function env(tab: Tab) {
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await tab.resize(1440, 900);
  const rows: any[] = [];
  for (const p of CORE) {
    await tab.goto(`${BASE}${p}`, 6500);
    const info = await tab.js<any>(`(() => {
      const envs = [...document.querySelectorAll('[data-environment]')];
      const e = envs[0];
      const cs = e ? getComputedStyle(e) : null;
      const hit = document.elementFromPoint(720, 450);
      const canvas = e ? e.querySelector('canvas') : null;
      return { count: envs.length, variant: e?.getAttribute('data-environment') ?? null, pointer: cs?.pointerEvents, position: cs?.position, z: cs?.zIndex, ariaHidden: e?.getAttribute('aria-hidden'), hitIsEnv: !!(hit && e && e.contains(hit)), motion: e?.getAttribute('data-motion'), particles: canvas ? Number(canvas.getAttribute('data-count') || 0) : 0, bodyBg: getComputedStyle(document.body).backgroundColor };
    })()`);
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 100 }); await sleep(120);
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1340, y: 800 }); await sleep(300);
    const px = await tab.js<string>(`(document.querySelector('[data-environment]')?.style.getPropertyValue('--env-px') || '')`);
    rows.push({ path: p, ...info, parallaxVar: px });
    console.log(`${p}: ${info.variant} · capas ${info.count} · pointer ${info.pointer} · z ${info.z} · tapa contenido ${info.hitIsEnv} · partículas ${info.particles} · parallax ${px}`);
  }
  // tinte del lobby al apuntar modos
  await tab.goto(`${BASE}/`, 6500);
  const tints: any[] = [];
  for (const m of ["quick", "campaign", "ranked", "draft"]) {
    const box = await tab.js<any>(`(() => { const r = document.querySelector('[data-mode="${m}"]')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (!box) { tints.push({ mode: m, found: false }); continue; }
    await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y }); await sleep(450);
    const focus = await tab.js<string>(`document.querySelector('[data-environment]')?.getAttribute('data-focus')`);
    const opacity = await tab.js<string>(`getComputedStyle(document.querySelector('[data-tint="${m}"]')).opacity`);
    tints.push({ mode: m, found: true, focus, opacity: Number(opacity) });
  }
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 880 }); await sleep(450);
  const released = await tab.js<string>(`document.querySelector('[data-environment]')?.getAttribute('data-focus')`);
  console.log(`tintes: ${JSON.stringify(tints)} · al salir ${released}`);
  // reducido
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await tab.goto(`${BASE}/`, 6000);
  const reduced = await tab.js<any>(`(() => { const e = document.querySelector('[data-environment]'); const a = [...e.querySelectorAll('*')].map((n) => getComputedStyle(n).animationName).filter((n) => n && n !== 'none'); return { motion: e.getAttribute('data-motion'), animations: a, sweep: !!e.querySelector('.nx-env-sweep') }; })()`);
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1300, y: 800 }); await sleep(300);
  reduced.parallaxVar = await tab.js<string>(`(document.querySelector('[data-environment]')?.style.getPropertyValue('--env-px') || '')`);
  console.log(`reducido: ${JSON.stringify(reduced)}`);
  // atenuado de la cámara (arnés)
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await tab.goto(`${BASE}/design-system/fase44-1?scene=chamber-dim`, 6000);
  const dim = await tab.js<number>(`(() => { const d = [...document.querySelectorAll('[data-environment="packs"] .nx-env-dim')].pop(); return d ? Number(getComputedStyle(d).opacity) : -1; })()`);
  await tab.goto(`${BASE}/design-system/fase44-1?scene=chamber`, 6000);
  const rest = await tab.js<number>(`(() => { const d = [...document.querySelectorAll('[data-environment="packs"] .nx-env-dim')].pop(); return d ? Number(getComputedStyle(d).opacity) : -1; })()`);
  console.log(`cámara: reposo ${rest} · apagada ${dim}`);
  save("environment-qa.json", { rows, tints, released, reduced, chamber: { rest, dim } });
}

/* ───────────── audio ───────────── */

async function audio(tab: Tab) {
  await tab.resize(1440, 900);
  await tab.goto(`${BASE}/design-system/fase44-1?scene=music`, 6000);
  tab.takeErrors(); // solo cuentan los errores de ESTA escena (no los de modos anteriores)
  const debug = `(window.__nexusMusic ? window.__nexusMusic() : null)`;
  const before = await tab.js<any>(debug);
  const ctxBefore = await tab.js<boolean>(`!!(window.__nexusMusic && window.__nexusMusic().ticking)`);
  const steps: any[] = [];
  const click = async (sel: string) => {
    const box = await tab.js<any>(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (!box) return false;
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    return true;
  };
  for (const c of ["LOBBY", "COLLECTION", "PACKS", "MATCH", "RANKED", "LOBBY"]) {
    await click(`[data-music-context="${c}"]`);
    await sleep(250);
    const d = await tab.js<any>(debug);
    steps.push({ context: c, plan: d?.plan, layers: d?.layers, voices: d?.voices });
    await sleep(1400);
  }
  const rapid: number[] = [];
  for (const c of ["PACKS", "DECKS", "DRAFT", "CAMPAIGN", "RESULT", "LOBBY", "COLLECTION", "RANKED"]) { await click(`[data-music-context="${c}"]`); await sleep(40); rapid.push((await tab.js<any>(debug))?.layers?.length ?? -1); }
  await click(`[data-testid="music-duck"]`); await sleep(200);
  const ducked = await tab.js<any>(debug);
  await click(`[data-testid="music-duck"]`); await sleep(200);
  const unducked = await tab.js<any>(debug);
  await click(`[data-testid="music-override"]`); await sleep(200);
  const overridden = await tab.js<any>(debug);
  await click(`[data-testid="music-override"]`); await sleep(200);
  // pestaña oculta (se simula el evento con el estado forzado)
  await tab.js(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(300);
  const hidden = await tab.js<any>(debug);
  await tab.js(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(300);
  const visible = await tab.js<any>(debug);
  const audioState = await tab.js<string>(`(() => { try { return (window.__nexusMusic && window.__nexusMusic().state.unlocked) ? 'unlocked' : 'locked'; } catch { return 'error'; } })()`);
  const errors = tab.takeErrors();
  const result = {
    beforeGesture: { plan: before?.plan, layers: before?.layers, ticking: ctxBefore },
    steps, rapidMaxLayers: Math.max(...rapid), ducked: ducked?.plan, unducked: unducked?.plan, overridden: overridden?.plan, hidden: hidden?.plan, visible: visible?.plan, audioState,
    consoleErrors: errors.filter((e) => !/favicon|DevTools/i.test(e)),
  };
  console.log(JSON.stringify(result, null, 1).slice(0, 2500));
  // efectos: todos los botones sin errores
  await tab.goto(`${BASE}/design-system/fase44-1?scene=sfx`, 6000);
  tab.takeErrors();
  const n = await tab.js<number>(`document.querySelectorAll('[data-sfx]').length`);
  for (let i = 0; i < n; i++) {
    const box = await tab.js<any>(`(() => { const r = document.querySelectorAll('[data-sfx]')[${i}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await sleep(150);
  }
  const sfxErrors = tab.takeErrors().filter((e) => !/favicon|DevTools/i.test(e));
  // ruta real: el director cambia de contexto al navegar (tras un gesto)
  await tab.goto(`${BASE}/`, 6000);
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 10, y: 890, button: "left", clickCount: 1 });
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 10, y: 890, button: "left", clickCount: 1 });
  await sleep(400);
  const homeCtx = (await tab.js<any>(debug))?.plan?.context ?? null;
  save("audio-qa.json", { ...result, sfx: { buttons: n, errors: sfxErrors }, route: { home: homeCtx } });
}

/* ───────────── rendimiento ───────────── */

async function perf(tab: Tab) {
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await tab.resize(1440, 900);
  const rows: any[] = [];
  const measure = `new Promise((res) => { let frames = 0; let long = 0; let worst = 0; let last = performance.now(); const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) { long++; worst = Math.max(worst, e.duration); } }); try { obs.observe({ entryTypes: ['longtask'] }); } catch {} const t0 = performance.now(); let maxGap = 0; const loop = (t) => { frames++; maxGap = Math.max(maxGap, t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(loop); else { obs.disconnect(); res({ fps: Math.round(frames / ((t - t0) / 1000)), maxFrameGap: Math.round(maxGap), longTasks: long, worstLongTask: Math.round(worst) }); } }; requestAnimationFrame(loop); })`;
  for (const p of ["/", "/coleccion", "/tienda", "/duelos/mazos"]) {
    await tab.goto(`${BASE}${p}`, 6500);
    const withEnv = await tab.js<any>(measure);
    await tab.js(`(() => { const s = document.createElement('style'); s.textContent = '[data-environment]{display:none!important}'; document.head.appendChild(s); })()`);
    await sleep(300);
    const withoutEnv = await tab.js<any>(measure);
    // scroll continuo con rueda
    await tab.js(`(() => { const s = [...document.querySelectorAll('style')].pop(); s.remove(); window.scrollTo(0,0); })()`);
    const scrollP = tab.js<any>(measure);
    for (let i = 0; i < 20; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 700, y: 480, deltaX: 0, deltaY: 120 }); await sleep(120); }
    const scrolling = await scrollP;
    rows.push({ path: p, withEnv, withoutEnv, scrolling });
    console.log(`${p}: con ambiente ${JSON.stringify(withEnv)} · sin ${JSON.stringify(withoutEnv)} · scroll ${JSON.stringify(scrolling)}`);
  }
  save("perf.json", { note: "Chrome sin cabeza con --disable-gpu (peor caso: todo en CPU). 3 s por medida.", rows });
}

async function main() {
  const b = await launch({ width: 1440, height: 900, userDataDir: CREDS ? join(CREDS, "..", "f441-qa-profile") : undefined });
  try {
    await login(b.tab);
    if (MODE === "wheel" || MODE === "all") await wheel(b.tab);
    if (MODE === "cycles" || MODE === "all") await cycles(b.tab);
    if (MODE === "env" || MODE === "all") await env(b.tab);
    if (MODE === "audio" || MODE === "all") await audio(b.tab);
    if (MODE === "perf" || MODE === "all") await perf(b.tab);
    if (MODE === "p0" || MODE === "all") await p0(b.tab);
  } finally {
    await b.close();
  }
}
void main();

/* ───────────── P0 en navegador real: teclas, flujos que montan/desmontan cerrojos, audio en rutas reales ───────────── */

async function click(tab: Tab, sel: string): Promise<boolean> {
  const box = await tab.js<any>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) return false;
  await sleep(250);
  const b2 = await tab.js<any>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b2.x, y: b2.y });
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b2.x, y: b2.y, button: "left", clickCount: 1 });
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b2.x, y: b2.y, button: "left", clickCount: 1 });
  return true;
}
async function gesture(tab: Tab) {
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 6, y: 300, button: "left", clickCount: 1 });
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 6, y: 300, button: "left", clickCount: 1 });
}

/** Espera a que la pantalla esté montada de verdad (sin «Cargando NEXUS», con ambiente y altura estable). */
async function ready(tab: Tab) {
  for (let i = 0; i < 60; i++) {
    const ok = await tab.js<boolean>(`document.readyState === 'complete' && !/cargando nexus/i.test(document.body.innerText) && !!document.querySelector('[data-environment]') && !document.querySelector('[data-testid="daily-skeleton"]')`).catch(() => false);
    if (ok) break;
    await sleep(500);
  }
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const h = await tab.js<number>(`document.scrollingElement.scrollHeight`).catch(() => 0);
    if (h === last) break;
    last = h;
    await sleep(700);
  }
}

/** Tras un flujo: ¿queda algún cerrojo y la rueda sigue moviendo la página? */
async function scrollFree(tab: Tab) {
  await tab.js(`window.scrollTo(0, 0)`); await sleep(300);
  const o = await tab.js<any>(OVERFLOW);
  const max = await tab.js<number>(`Math.round(document.scrollingElement.scrollHeight - innerHeight)`);
  await wheelBy(tab, 300); const down = await tab.js<number>(Y);
  await wheelBy(tab, -300); const up = await tab.js<number>(Y);
  return { path: await tab.js<string>(`location.pathname`), htmlInline: o.inline, bodyInline: o.body, max, wheelDown: down, wheelUp: up - down, ok: o.inline === "" && o.body === "" && (max <= 20 || (down > 0 && up - down < 0)) };
}

async function p0(tab: Tab) {
  await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await tab.resize(1440, 900);
  const debug = `(window.__nexusMusic ? window.__nexusMusic() : null)`;
  const plan = async () => (await tab.js<any>(debug))?.plan ?? null;
  const stored = async () => JSON.parse((await tab.js<string>(`localStorage.getItem('nexus:audio:v1')`)) || "{}");

  const keys: any[] = [];
  for (const p of ["/", "/coleccion", "/temporada"]) {
    await tab.goto(`${BASE}${p}`, 3000); await ready(tab);
    const max = await tab.js<number>(`Math.round(document.scrollingElement.scrollHeight - innerHeight)`);
    await key(tab, "End", 35); const end = await tab.js<number>(Y);
    await key(tab, "PageUp", 33); const pgUp = await tab.js<number>(Y);
    await key(tab, "Home", 36); const home = await tab.js<number>(Y);
    await key(tab, "PageDown", 34); const pgDown = await tab.js<number>(Y);
    keys.push({ path: p, max, end, pageUp: end - pgUp, home, pageDown: pgDown, ok: end >= max - 2 && end - pgUp > 0 && home === 0 && pgDown > 0 });
  }
  console.log(`teclas: ${JSON.stringify(keys)}`);

  const flows: any[] = [];
  // Apertura de sobre REAL (componente PackOpeningExperience) sin sobre de ese tipo en inventario: no escribe nada.
  await tab.goto(`${BASE}/coleccion`, 6000);
  await tab.js(`window.location.assign('/abrir/premium')`); await sleep(2000); await ready(tab);
  const mounted = await tab.js<any>(`({ path: location.pathname, text: document.body.innerText.slice(0, 120), overflow: document.documentElement.style.overflow || '' })`);
  await tab.js(`history.back()`); await sleep(1500); await ready(tab);
  flows.push({ flow: "apertura de sobre (/abrir/premium → atrás)", mounted, after: await scrollFree(tab) });
  // Ceremonia del arnés de Fase 38 → colección.
  await tab.goto(`${BASE}/design-system/fase38?scene=stage-hand-legendary`, 6000);
  await tab.goto(`${BASE}/coleccion`, 2000); await ready(tab);
  flows.push({ flow: "ceremonia (arnés F38) → colección", after: await scrollFree(tab) });
  // Selector de modos: ficha del vestíbulo → pantalla del modo → atrás; y /jugar → atrás.
  await tab.goto(`${BASE}/`, 2000); await ready(tab);
  const clicked = await click(tab, '[data-mode="campaign"]'); await sleep(2000); await ready(tab);
  const modePath = await tab.js<string>(`location.pathname`);
  await tab.js(`history.back()`); await sleep(1500); await ready(tab);
  flows.push({ flow: "selector de modos (campaña → atrás)", clicked, modePath, after: await scrollFree(tab) });
  await tab.goto(`${BASE}/jugar`, 2000); await ready(tab);
  await tab.js(`history.back()`); await sleep(1500); await ready(tab);
  flows.push({ flow: "/jugar → atrás", after: await scrollFree(tab) });
  console.log(`flujos: ${JSON.stringify(flows)}`);

  /* ── audio en rutas reales ── */
  const audio: any = {};
  await tab.goto(`${BASE}/`, 6500);
  await tab.js(`localStorage.removeItem('nexus:audio:v1')`);
  await tab.goto(`${BASE}/`, 2000); await ready(tab);
  audio.beforeGesture = await plan();
  await gesture(tab); await sleep(1500);
  audio.lobby = await plan();
  await click(tab, '.nx-gamebar-link[href="/coleccion"]'); await sleep(1500); await ready(tab);
  audio.collection = { path: await tab.js<string>(`location.pathname`), plan: await plan() };
  await click(tab, '.nx-gamebar-link[href="/tienda"]'); await sleep(1500); await ready(tab);
  audio.packs = { path: await tab.js<string>(`location.pathname`), plan: await plan(), layers: (await tab.js<any>(debug))?.layers };
  await tab.js(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); })()`); await sleep(400);
  audio.hidden = await plan();
  await tab.js(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); })()`); await sleep(400);
  audio.visible = await plan();
  // Panel real de ajustes en /cuenta.
  await tab.goto(`${BASE}/cuenta`, 6500);
  await gesture(tab); await sleep(1200);
  audio.cuentaStart = await plan();
  await click(tab, '[data-testid="audio-music-mute"]'); await sleep(500);
  audio.musicMuted = { plan: await plan(), stored: await stored() };
  await click(tab, '[data-testid="audio-music-mute"]'); await sleep(500);
  audio.musicUnmuted = await plan();
  const setRange = (id: string, v: number) => tab.js(`(() => { const el = document.querySelector('[data-testid="${id}"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, '${v}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setRange("audio-music", 25); await sleep(500);
  audio.musicVolume25 = { engineVolume: (await tab.js<any>(debug))?.state?.volume, stored: await stored() };
  await setRange("audio-sfx", 40); await sleep(300);
  audio.sfxVolume40 = await stored();
  await click(tab, '[data-testid="audio-sfx-mute"]'); await sleep(300);
  audio.sfxMuted = { stored: await stored(), musicPlan: await plan() };
  await click(tab, '[data-testid="audio-sfx-mute"]'); await sleep(300);
  await click(tab, '[data-testid="audio-mute"]'); await sleep(500);
  audio.globalMuted = await plan();
  await click(tab, '[data-testid="audio-mute"]'); await sleep(500);
  audio.globalUnmuted = await plan();
  await tab.goto(`${BASE}/cuenta`, 6500);
  audio.persisted = await tab.js<any>(`({ stored: JSON.parse(localStorage.getItem('nexus:audio:v1') || '{}'), music: document.querySelector('[data-testid="audio-music"]')?.value, sfx: document.querySelector('[data-testid="audio-sfx"]')?.value })`);
  // Partida: la ruta de duelo (preparación; no se empieza ninguna partida).
  await tab.goto(`${BASE}/duelos/jugar`, 2000); await ready(tab);
  await gesture(tab); await sleep(1500);
  audio.match = { path: await tab.js<string>(`location.pathname`), plan: await plan() };
  // Resultado: la pantalla REAL de resultado (montada en el arnés F44) impone RESULT y agacha bajo el stinger.
  await tab.goto(`${BASE}/design-system/fase44?scene=result-victory`, 1500);
  await gesture(tab); await sleep(4000);
  const res = await tab.js<any>(debug);
  audio.result = { plan: res?.plan, override: res?.state?.override, ducks: res?.state?.ducks };
  // Duck del sobre sobre el motor real (abrir un sobre de verdad consumiría uno de la BD real).
  await tab.goto(`${BASE}/design-system/fase44-1?scene=music`, 6000);
  await click(tab, '[data-music-context="PACKS"]'); await sleep(800);
  const full = (await plan())?.gain;
  await click(tab, '[data-testid="music-duck"]'); await sleep(400);
  const ducked = (await plan())?.gain;
  await click(tab, '[data-testid="music-duck"]'); await sleep(400);
  audio.packDuck = { full, ducked, restored: (await plan())?.gain };
  audio.jsErrors = tab.takeErrors().filter((e) => !/status of (404|429|401)|favicon|DevTools|Failed to load resource/.test(e));
  console.log(`audio: ${JSON.stringify(audio)}`);
  save("p0-qa.json", { keys, flows, audio });
}
