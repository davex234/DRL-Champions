/**
 * QA EN NAVEGADOR · LIMPIEZA DE /COLECCION (instrumento, fuera de CI y de la release) — 2026-10-07.
 *
 *   BASE_URL=http://127.0.0.1:3011 npx tsx scripts/_collection-cleanup-shots.ts
 *   (BASE_URL=https://valorosters.com y QA_SESSION=<json de sesión supabase> para la pasada en producción con cuenta)
 *
 * A · /coleccion limpia (arnés fase37 veterano = la MISMA pantalla)   B · parte superior   C · final sin sets/objetivos
 * D · desplegable Colección abierto con teclado (↓) y con ratón        E/F · destinos canónicos (con QA_SESSION)
 * 1440 / 1024 / 390. Escribe docs/product/qa/collection-cleanup/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const TAG = process.env.QA_TAG ?? "local";
const OUT = join(process.cwd(), "docs/product/qa/collection-cleanup", TAG);
mkdirSync(OUT, { recursive: true });
const SESSION = process.env.QA_SESSION ?? null;
const SESSION_KEY = process.env.QA_SESSION_KEY ?? null;
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ id, w, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const FORBIDDEN = /Completa tus sets|Libro de la colecci[oó]n|Casi completos|Maestr[ií]a|conjuntos sobre las cartas|Ver m[aá]s conjuntos|Objetivos de colecci[oó]n|Pendiente de recoger|Reúne 50 cartas distintas/i;
const HINTS = ["Todo el catálogo y lo que posees", "Sets completos y su", "Tus sobres sin abrir y tus duplicadas"];

const PAGE = `(() => {
  const q = (s) => document.querySelector(s);
  const album = q('[data-testid="collection-album"]');
  const main = q('main') || document.body;
  const ab = album ? album.getBoundingClientRect() : null;
  const docH = document.documentElement.scrollHeight;
  const text = main.innerText;
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    room: !!q('[data-testid="collection-room"]'), access: q('[data-testid="collection-room"]')?.dataset.access ?? null,
    top: !!q('[data-testid="discovery-top"]'), topCards: document.querySelectorAll('[data-testid="discovery-top"] li').length,
    cards: document.querySelectorAll('[data-testid="collection-album"] [data-card]').length,
    book: !!q('[data-testid="collection-book"]'), near: !!q('[data-testid="discovery-near"]'), objectives: !!q('[data-collection-objectives]'),
    mastery: !!q('[aria-label="Maestría de colección"]'), forbidden: (text.match(${FORBIDDEN}) || [null])[0],
    trophyLink: !!q('[data-testid="trophy-room-link"]'),
    albumBottomToDocEnd: ab ? Math.round(docH - (ab.bottom + scrollY)) : null, docH,
  };
})()`;

const MENU = `(() => {
  const panel = document.querySelector('[data-menu-style]');
  if (!panel) return null;
  const items = [...panel.querySelectorAll('a')].map((a) => {
    const r = a.getBoundingClientRect(); const b = a.querySelector('b'); const br = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    return { href: a.getAttribute('href'), text: a.innerText.trim(), shown: cs.textTransform === 'uppercase' ? b.textContent.toUpperCase() : b.textContent,
      h: Math.round(r.height), dx: Math.round((br.left + br.width / 2) - (r.left + r.width / 2)), dy: Math.round((br.top + br.height / 2) - (r.top + r.height / 2)),
      spans: a.querySelectorAll(':scope > span').length, current: a.getAttribute('aria-current'), focused: document.activeElement === a,
      outline: getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).boxShadow.slice(0, 40) };
  });
  return { style: panel.dataset.menuStyle, w: Math.round(panel.getBoundingClientRect().width), items, text: panel.innerText };
})()`;

async function settle(c: Client, url: string, ready: string, ms = 600) {
  await c.tab.goto(url, 1200);
  for (let i = 0; i < 120; i++) { if (await c.tab.js<boolean>(ready).catch(() => false)) break; await sleep(200); }
  await sleep(ms);
}
const key = async (c: Client, k: string, code: string, vk: number) => {
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await c.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};

async function withSession(c: Client) {
  if (!SESSION || !SESSION_KEY) return;
  await c.tab.goto(`${BASE}/robots.txt`, 300);
  await c.tab.setStorage(SESSION_KEY, SESSION);
}

async function pagePass(w: number) {
  const c = await openBrowser("QA", w, { label: `cc-${w}` });
  try {
    await withSession(c);
    const url = SESSION ? `${BASE}/coleccion` : `${BASE}/design-system/fase37?scene=hub-veteran`;
    const ready = SESSION ? `!!document.querySelector('[data-testid="collection-room"][data-access="server"] [data-testid="collection-album"] [data-card]') && !!document.querySelector('[data-testid="discovery-top"]')` : `!!document.querySelector('[data-testid="collection-album"] [data-card]')`;
    c.tab.takeErrors();
    await settle(c, url, ready, 1500);
    const f = await c.tab.js<any>(PAGE);
    check("A", w, "la sala carga (con sesión: foto del servidor)", f.room && (!SESSION || f.access === "server"), f);
    check("A", w, "TUS CARTAS DE MAYOR OVR con cartas reales", f.top && f.topCards > 0, f.topCards);
    check("A", w, "el álbum enseña cartas", f.cards > 0, f.cards);
    check("A", w, "sin libro de sets, «Casi completos», Maestría ni objetivos", !f.book && !f.near && !f.objectives && !f.mastery && f.forbidden === null, f);
    check("A", w, "sin desbordamiento horizontal", f.overflow <= 0, f.overflow);
    check("A", w, "enlace a la Sala de Trofeos presente", f.trophyLink, f.trophyLink);
    await c.tab.shot(join(OUT, `B-coleccion-top-${w}.png`));
    // C · final de la página: el álbum es lo último (sin bloques ni huecos detrás).
    await c.tab.js(`window.scrollTo(0, document.documentElement.scrollHeight)`); await sleep(700);
    const g = await c.tab.js<any>(PAGE);
    check("C", w, "el álbum cierra la página (hueco hasta el final: solo pie/barra inferior del armazón; ≤ 260 px, ≤ 320 en móvil)", g.albumBottomToDocEnd !== null && g.albumBottomToDocEnd <= (w < 600 ? 320 : 260), g.albumBottomToDocEnd);
    await c.tab.shot(join(OUT, `C-coleccion-end-${w}.png`));
    const errs = c.tab.takeErrors().filter((e) => !/status of (401|503)/.test(e) && !/api\/content\//.test(e) && !/54521|ERR_CONNECTION_REFUSED/.test(e));
    check("A", w, "consola sin errores", errs.length === 0, errs.slice(0, 3));
  } finally { await c.browser.close().catch(() => null); }
}

async function menuPass(w: number) {
  const c = await openBrowser("QA", w, { label: `cc-menu-${w}` });
  try {
    await withSession(c);
    await settle(c, `${BASE}/coleccion`, `!!document.querySelector('a.nx-gamebar-link[href="/coleccion"]')`, 800);
    // D · teclado: foco en «Colección» y ↓ abre el menú y enfoca la primera opción.
    await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="/coleccion"]').focus()`);
    await key(c, "ArrowDown", "ArrowDown", 40); await sleep(400);
    const m = await c.tab.js<any>(MENU);
    check("D", w, "el desplegable abre con ↓", !!m, m);
    if (m) {
      check("D", w, "MIS CARTAS · COLECCIONES · INVENTARIO", m.items.map((i: any) => i.shown).join("|") === "MIS CARTAS|COLECCIONES|INVENTARIO", m.items.map((i: any) => i.shown));
      check("D", w, "destinos: /coleccion · /coleccion/trofeos · /inventario", m.items.map((i: any) => i.href).join("|") === "/coleccion|/coleccion/trofeos|/inventario", m.items.map((i: any) => i.href));
      check("D", w, "sin subtítulos (ni texto ni nodo)", HINTS.every((h) => !m.text.includes(h)) && m.items.every((i: any) => i.spans === 1), m.items.map((i: any) => i.spans));
      check("D", w, "estilo de navegación compacto (≥44 y ≤ 52 px por opción)", m.style === "nav" && m.items.every((i: any) => i.h >= 44 && i.h <= 52), m.items.map((i: any) => i.h));
      check("D", w, "texto centrado horizontal y verticalmente (±2 px)", m.items.every((i: any) => Math.abs(i.dx) <= 2 && Math.abs(i.dy) <= 2), m.items.map((i: any) => [i.dx, i.dy]));
      check("D", w, "foco de teclado en la primera opción", m.items[0].focused, m.items.map((i: any) => i.focused));
      check("D", w, "estado activo: MIS CARTAS con aria-current=page en /coleccion", m.items[0].current === "page" && !m.items[1].current && !m.items[2].current, m.items.map((i: any) => i.current));
      await c.tab.shot(join(OUT, `D-dropdown-keyboard-${w}.png`));
      // ↓ por las opciones con Tab y Escape cierra devolviendo el foco a la sección.
      await key(c, "Tab", "Tab", 9); await sleep(200);
      const m2 = await c.tab.js<any>(MENU);
      check("D", w, "Tab pasa a COLECCIONES", !!m2 && m2.items[1].focused, m2?.items.map((i: any) => i.focused));
      await key(c, "Escape", "Escape", 27); await sleep(300);
      const closed = await c.tab.js<any>(`({ menu: !!document.querySelector('[data-menu-style]'), focus: document.activeElement?.getAttribute('href') })`);
      check("D", w, "Escape cierra y devuelve el foco a «Colección»", !closed.menu && closed.focus === "/coleccion", closed);
    }
    // Ratón: hover sobre la sección.
    const r = await c.tab.js<any>(`(() => { const b = document.querySelector('a.nx-gamebar-link[href="/coleccion"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y }); await sleep(500);
    const mh = await c.tab.js<any>(MENU);
    check("D", w, "abre con el ratón (hover)", !!mh && mh.items.length === 3, mh?.items.length);
    if (mh) {
      const it = await c.tab.js<any>(`(() => { const a = document.querySelectorAll('[data-menu-style] a')[1].getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2 }; })()`);
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y + 20 }); await sleep(80);
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: it.x, y: it.y }); await sleep(300);
      const bg = await c.tab.js<string>(`getComputedStyle(document.querySelectorAll('[data-menu-style] a')[1]).backgroundColor`);
      check("D", w, "hover visible en COLECCIONES", bg !== "rgba(0, 0, 0, 0)", bg);
      await c.tab.shot(join(OUT, `D-dropdown-hover-${w}.png`));
      // Navegación: clic en COLECCIONES → /coleccion/trofeos.
      await c.tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: it.x, y: it.y, button: "left", clickCount: 1 });
      await c.tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: it.x, y: it.y, button: "left", clickCount: 1 });
      let path = "";
      for (let i = 0; i < 40; i++) { path = await c.tab.js<string>(`location.pathname`); if (path === "/coleccion/trofeos") break; await sleep(200); }
      check("D", w, "COLECCIONES navega a /coleccion/trofeos", path === "/coleccion/trofeos", path);
      await sleep(800);
      await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="/coleccion"]').focus()`);
      await key(c, "ArrowDown", "ArrowDown", 40); await sleep(400);
      const m3 = await c.tab.js<any>(MENU);
      check("D", w, "en la Sala de Trofeos la activa es COLECCIONES", !!m3 && m3.items[1].current === "page" && !m3.items[0].current, m3?.items.map((i: any) => i.current));
      await key(c, "Escape", "Escape", 27);
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function mobileMenuPass() {
  const c = await openBrowser("QA", 390, { label: "cc-sheet-390" });
  try {
    await withSession(c);
    await settle(c, `${BASE}/coleccion`, `!!document.querySelector('[data-testid="shell-menu"]')`, 800);
    await c.tab.js(`document.querySelector('[data-testid="shell-menu"]').click()`); await sleep(700);
    const s = await c.tab.js<any>(`(() => { const sh = document.querySelector('[data-testid="shell-menu-sheet"]'); if (!sh) return null;
      const sec = [...sh.querySelectorAll('section')].find((x) => /Colección/i.test(x.querySelector('p')?.textContent || ''));
      return { items: sec ? [...sec.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), text: a.innerText.trim(), spans: a.querySelectorAll('span span').length })) : null, text: sh.innerText,
        overflow: document.documentElement.scrollWidth - innerWidth }; })()`);
    check("D", 390, "menú móvil: Colección = Mis cartas · Colecciones · Inventario", !!s?.items && s.items.map((i: any) => i.href).join("|") === "/coleccion|/coleccion/trofeos|/inventario", s?.items);
    check("D", 390, "menú móvil: sin subtítulos de Colección", !!s && HINTS.every((h) => !s.text.includes(h)), s?.items);
    check("D", 390, "menú móvil sin desbordamiento", !!s && s.overflow <= 0, s?.overflow);
    await c.tab.js(`(() => { const sh = document.querySelector('[data-testid="shell-menu-sheet"]'); const sec = [...sh.querySelectorAll('section')].find((x) => /Colección/i.test(x.querySelector('p')?.textContent || '')); sec?.scrollIntoView({ block: 'center' }); })()`);
    await sleep(400);
    await c.tab.shot(join(OUT, `D-mobile-menu-390.png`));
  } finally { await c.browser.close().catch(() => null); }
}

async function canonicalPass(w: number) {
  if (!SESSION) return;
  const c = await openBrowser("QA", w, { label: `cc-canon-${w}` });
  try {
    await withSession(c);
    await settle(c, `${BASE}/coleccion/trofeos`, `!!document.querySelector('[data-testid="trophy-room"]') && !!document.querySelector('[aria-label="Maestría de colección"]')`, 1500);
    const t = await c.tab.js<any>(`(() => ({ room: !!document.querySelector('[data-testid="trophy-room"]'), sets: document.querySelectorAll('[data-testid="set-grid"] [data-set], [data-testid="set-grid"] a').length,
      mastery: !!document.querySelector('[aria-label="Maestría de colección"]'), masteryText: (document.querySelector('[aria-label="Maestría de colección"]')?.innerText || '').slice(0, 160),
      overflow: document.documentElement.scrollWidth - innerWidth }))()`);
    check("E", w, "Sala de Trofeos: sets F82 con progreso", t.room && t.sets > 0, t);
    check("E", w, "Sala de Trofeos: Maestría (conjuntos que pagan insignias) presente", t.mastery, t.masteryText);
    check("E", w, "sin desbordamiento", t.overflow <= 0, t.overflow);
    await c.tab.shot(join(OUT, `E-trofeos-top-${w}.png`));
    await c.tab.js(`document.querySelector('[aria-label="Maestría de colección"]').scrollIntoView({ block: 'start' })`); await sleep(600);
    await c.tab.shot(join(OUT, `E-trofeos-maestria-${w}.png`));
    await settle(c, `${BASE}/progresion`, `/Reúne 50 cartas distintas|Coleccionista/.test(document.body.innerText)`, 1200);
    const p = await c.tab.js<any>(`(() => ({ obj: /Reúne 50 cartas distintas/.test(document.body.innerText), ach: /Coleccionista|Consigue una leyenda|Champions S/.test(document.body.innerText), overflow: document.documentElement.scrollWidth - innerWidth }))()`);
    check("F", w, "Progresión: objetivo «Reúne 50 cartas distintas» presente", p.obj, p);
    await c.tab.shot(join(OUT, `F-progresion-${w}.png`));
    await settle(c, `${BASE}/logros`, `/Coleccionista|Consigue una leyenda|Champions S/.test(document.body.innerText)`, 1200);
    const l = await c.tab.js<any>(`(() => ({ ach: /Coleccionista|Consigue una leyenda|Consigue una Champions S/.test(document.body.innerText), overflow: document.documentElement.scrollWidth - innerWidth }))()`);
    check("F", w, "Logros: logros de colección presentes (Coleccionista / leyenda / Champions S)", l.ach, l);
    await c.tab.js(`(() => { const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /Coleccionista|Consigue una leyenda/.test(n.textContent || '')); el?.scrollIntoView({ block: 'center' }); })()`); await sleep(500);
    await c.tab.shot(join(OUT, `F-logros-${w}.png`));
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 1024, 390]) await pagePass(w);
  for (const w of [1440, 1024]) await menuPass(w);
  await mobileMenuPass();
  for (const w of [1440, 390]) await canonicalPass(w);
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
