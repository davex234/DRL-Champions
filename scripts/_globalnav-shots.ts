/**
 * QA EN NAVEGADOR · NAVEGACIÓN GLOBAL LIMPIA (instrumento, fuera de CI y de la release) — 2026-10-07.
 *
 *   BASE_URL=http://127.0.0.1:3011 QA_TAG=local npx tsx scripts/_globalnav-shots.ts
 *   BASE_URL=https://valorosters.com QA_TAG=prod npx tsx scripts/_globalnav-shots.ts
 *
 * Inventario y comprobación de TODOS los menús de navegación: desplegables del armazón (Colección, Tienda, Temporada,
 * Mundo y «Más» = Jugar; Equipos es un enlace directo de una sola opción), hoja «Menú» móvil, «Más» de la portada y
 * «Administración». Administración se enseña con una sesión SIMULADA solo en el navegador (respuestas de /api/game/me y
 * /api/admin/session retocadas por CDP; nada llega al servidor como admin). 1440 / 1024 / 390.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, type Client } from "./_fase68-lib";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3011";
const OUT = join(process.cwd(), "docs/product/qa/global-nav", process.env.QA_TAG ?? "local");
mkdirSync(OUT, { recursive: true });
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ id, w, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};
const EXPECT: Record<string, string[]> = {
  coleccion: ["MIS CARTAS", "COLECCIONES", "INVENTARIO"],
  tienda: ["CATÁLOGO DE SOBRES", "TIENDA", "DRL CREDITS", "CENTRO DE EVENTOS"],
  progreso: ["TEMPORADA", "MI PERFIL", "CUENTA", "DAR FEEDBACK", "PROGRESIÓN", "CLASIFICACIÓN", "LOGROS Y PASE", "MISIONES Y CRAFTEO", "RECOMPENSAS"],
  mundo: ["EL MUNDO", "NOTICIAS"],
  jugar: ["MODOS DE JUEGO", "DUELOS", "COMPETITIVO", "SOCIAL", "EVENTOS", "TORNEOS", "ENTRENADOR"],
};
const SECTION_HREF: Record<string, string> = { coleccion: "/coleccion", tienda: "/tienda", progreso: "/temporada", mundo: "/mundo" };

/** Mide el panel abierto: cada opción (texto visible, centrado, alto, recorte) y el panel (ancho, dentro del viewport). */
const PANEL = (sel: string) => `(() => {
  const panel = document.querySelector(${JSON.stringify(sel)});
  if (!panel) return null;
  const pr = panel.getBoundingClientRect();
  const items = [...panel.querySelectorAll('a')].filter((a) => a.querySelector('b')).map((a) => {
    const r = a.getBoundingClientRect(); const b = a.querySelector('b'); const br = b.getBoundingClientRect();
    const group = [...a.children].filter((n) => n.tagName !== 'svg' || true);
    const gl = Math.min(...group.map((n) => n.getBoundingClientRect().left)), gr = Math.max(...group.map((n) => n.getBoundingClientRect().right));
    const extra = [...a.querySelectorAll('*')].filter((n) => n !== b && !b.contains(n) && n.tagName !== 'svg' && !n.closest('svg') && n.children.length === 0 && n.textContent.trim() && !/^\\d+$/.test(n.textContent.trim())).map((n) => n.textContent.trim());
    return { href: a.getAttribute('href'), label: getComputedStyle(b).textTransform === 'uppercase' ? b.textContent.toUpperCase() : b.textContent,
      badge: [...a.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^\\d+$/.test(t)) || null, extra,
      h: Math.round(r.height), dx: Math.round((gl + gr) / 2 - (r.left + r.width / 2)), dy: Math.round((br.top + br.height / 2) - (r.top + r.height / 2)),
      clipped: b.scrollWidth > b.clientWidth + 1 || br.right > r.right + 0.5 || br.left < r.left - 0.5, current: a.getAttribute('aria-current') };
  });
  return { w: Math.round(pr.width), left: Math.round(pr.left), right: Math.round(pr.right), vw: innerWidth, items, overflow: document.documentElement.scrollWidth - innerWidth };
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
function judge(id: string, w: number, m: any, expect: string[], rowMin: number, rowMax: number, opts: { admin?: boolean } = {}) {
  check(id, w, "abre", !!m, m);
  if (!m) return;
  const labels = m.items.map((i: any) => i.label);
  const want = opts.admin ? [...expect, "ADMINISTRACIÓN"] : expect;
  check(id, w, `opciones = ${want.join(" · ")}`, JSON.stringify(labels) === JSON.stringify(want), labels);
  check(id, w, "0 subtítulos visibles (solo nombre e insignia)", m.items.every((i: any) => i.extra.length === 0), m.items.filter((i: any) => i.extra.length).map((i: any) => [i.label, i.extra]));
  check(id, w, "centradas en horizontal y vertical (±2 px)", m.items.every((i: any) => Math.abs(i.dx) <= 2 && Math.abs(i.dy) <= 2), m.items.map((i: any) => [i.label, i.dx, i.dy]));
  check(id, w, `filas compactas ${rowMin}–${rowMax} px`, m.items.every((i: any) => i.h >= rowMin && i.h <= rowMax), m.items.map((i: any) => i.h));
  check(id, w, "sin recortes ni desbordamiento (panel dentro del viewport)", m.items.every((i: any) => !i.clipped) && m.left >= 0 && m.right <= m.vw && m.overflow <= 0, { w: m.w, l: m.left, r: m.right, vw: m.vw, clip: m.items.filter((i: any) => i.clipped).map((i: any) => i.label) });
}

async function desktop(w: number, admin: boolean) {
  const c = await openBrowser("QA", w, { label: `gn-${w}${admin ? "-admin" : ""}` });
  try {
    if (admin) await simulateAdmin(c);
    for (const [id, href] of admin ? [["progreso", "/temporada"]] : Object.entries(SECTION_HREF)) {
      await settle(c, `${BASE}${href}`, `!!document.querySelector('a.nx-gamebar-link[href="${href}"]')`, 900);
      await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="${href}"]').focus()`);
      await key(c, "ArrowDown", "ArrowDown", 40);
      if (admin && id === "progreso") { for (let i = 0; i < 30; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-menu-style] [data-testid="admin-entry"]')`)) break; await sleep(200); } }
      await sleep(450);
      const m = await c.tab.js<any>(PANEL("[data-menu-style]"));
      judge(admin ? `admin:${id}` : id, w, m, EXPECT[id], 44, 52, { admin: admin && id === "progreso" });
      if (m) {
        check(id, w, "foco de teclado en la primera opción (↓)", await c.tab.js<boolean>(`document.activeElement === document.querySelector('[data-menu-style] a')`));
        check(id, w, "activa marcada con aria-current", m.items.filter((i: any) => i.current === "page").length === 1, m.items.map((i: any) => i.current));
        if (id === "tienda") check(id, w, "CENTRO DE EVENTOS conserva su insignia si la hay (sin texto extra)", m.items.find((i: any) => i.href === "/eventos")?.extra.length === 0, m.items.find((i: any) => i.href === "/eventos"));
      }
      if (!admin || id === "progreso") await c.tab.shot(join(OUT, `${admin ? "admin-" : ""}${id}-${w}.png`));
      await key(c, "Escape", "Escape", 27); await sleep(250);
      const back = await c.tab.js<any>(`({ open: !!document.querySelector('[data-menu-style]'), focus: document.activeElement?.getAttribute('href') })`);
      check(id, w, "Escape cierra y devuelve el foco", !back.open && back.focus === href, back);
    }
    if (admin) return;
    // «Más» (Jugar): botón con desplegable, alineado a la derecha.
    await settle(c, `${BASE}/coleccion`, `!!document.querySelector('[data-testid="shell-play-menu"]')`, 700);
    await c.tab.js(`document.querySelector('[data-testid="shell-play-menu"]').click()`); await sleep(500);
    const m = await c.tab.js<any>(PANEL("[data-menu-style]"));
    judge("mas", w, m, EXPECT.jugar, 44, 52);
    const exp = await c.tab.js<string | null>(`document.querySelector('[data-testid="shell-play-menu"]').getAttribute('aria-expanded')`);
    check("mas", w, "aria-expanded=true", exp === "true", exp);
    await c.tab.shot(join(OUT, `mas-${w}.png`));
    // Navegación real desde un desplegable (Tienda → DRL Credits).
    await settle(c, `${BASE}/tienda`, `!!document.querySelector('a.nx-gamebar-link[href="/tienda"]')`, 700);
    await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="/tienda"]').focus()`);
    await key(c, "ArrowDown", "ArrowDown", 40); await sleep(400);
    await c.tab.js(`document.querySelector('[data-menu-style] a[href="/tienda/creditos"]').focus()`);
    await key(c, "Enter", "Enter", 13);
    let path = ""; for (let i = 0; i < 40; i++) { path = await c.tab.js<string>("location.pathname"); if (path === "/tienda/creditos") break; await sleep(200); }
    check("tienda", w, "Enter en DRL CREDITS navega a /tienda/creditos", path === "/tienda/creditos", path);
    // Equipos: una sola opción → enlace directo, sin desplegable.
    await c.tab.js(`document.querySelector('a.nx-gamebar-link[href="/duelos/mazos"]').focus()`);
    await key(c, "ArrowDown", "ArrowDown", 40); await sleep(300);
    check("equipos", w, "EQUIPOS es enlace directo (sin desplegable ni aria-expanded)", !(await c.tab.js<boolean>(`!!document.querySelector('[data-menu-style]')`)) && (await c.tab.js<string | null>(`document.querySelector('a.nx-gamebar-link[href="/duelos/mazos"]').getAttribute('aria-expanded')`)) === null);
  } finally { await c.browser.close().catch(() => null); }
}

async function mobile(admin: boolean) {
  const c = await openBrowser("QA", 390, { label: `gn-390${admin ? "-admin" : ""}` });
  try {
    if (admin) await simulateAdmin(c);
    await settle(c, `${BASE}/tienda`, `!!document.querySelector('[data-testid="shell-menu"]')`, 900);
    await c.tab.js(`document.querySelector('[data-testid="shell-menu"]').click()`);
    if (admin) { for (let i = 0; i < 30; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="shell-menu-sheet"] [data-testid="admin-entry"]')`)) break; await sleep(200); } }
    await sleep(700);
    const m = await c.tab.js<any>(PANEL('[data-testid="shell-menu-sheet"] nav[data-menu-style="nav"]'));
    const all = [...EXPECT.jugar, ...EXPECT.coleccion, "MIS EQUIPOS", ...EXPECT.tienda, ...EXPECT.progreso, ...EXPECT.mundo];
    judge(admin ? "admin:movil" : "movil", 390, m, all, 48, 52);
    if (m) check("movil", 390, "activa (TIENDA) marcada", m.items.filter((i: any) => i.current === "page").map((i: any) => i.label).join() === "TIENDA", m.items.filter((i: any) => i.current).map((i: any) => i.label));
    if (admin) {
      const a = await c.tab.js<any>(PANEL('[data-testid="shell-menu-sheet"] [data-testid="admin-entry"]'));
      judge("admin:movil-entry", 390, a, [], 48, 52, { admin: true });
      await c.tab.js(`document.querySelector('[data-testid="shell-menu-sheet"] [data-testid="admin-entry"]').scrollIntoView({ block: 'center' })`); await sleep(400);
      await c.tab.shot(join(OUT, `admin-movil-390.png`));
      return;
    }
    await c.tab.shot(join(OUT, `movil-390-top.png`));
    for (const g of ["Tienda", "Temporada"]) {
      await c.tab.js(`(() => { const sec = [...document.querySelectorAll('[data-testid="shell-menu-sheet"] section')].find((x) => x.querySelector('p')?.textContent.trim().toLowerCase() === ${JSON.stringify(g.toLowerCase())}); sec?.scrollIntoView({ block: 'start' }); })()`);
      await sleep(400); await c.tab.shot(join(OUT, `movil-390-${g.toLowerCase()}.png`));
    }
  } finally { await c.browser.close().catch(() => null); }
}

async function homeMore(w: number) {
  const c = await openBrowser("QA", w, { label: `gn-home-${w}` });
  try {
    await settle(c, `${BASE}/`, `!!document.querySelector('main, [data-testid="home"]')`, 2500);
    await key(c, "Escape", "Escape", 27);
    for (let i = 0; i < 40; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="more-menu"] a')`)) break; await sleep(200); }
    await sleep(600);
    const m = await c.tab.js<any>(PANEL('[data-testid="more-menu"]'));
    const want = ["TEMPORADA", "PROGRESIÓN", "LOGROS", "COMPETITIVO", "TORNEOS", "EVENTOS", "PICK'EMS", "SOCIAL", "MI PERFIL", "CUENTA Y AJUSTES", "DAR FEEDBACK", "CÓMO JUGAR"];
    if (m) m.items = m.items.filter((i: any) => i.href !== "/cuenta" || i.label !== "INICIAR SESIÓN");
    judge("portada-mas", w, m && { ...m, items: m.items.filter((i: any) => want.includes(i.label)) }, want, 44, 52);
    await c.tab.shot(join(OUT, `portada-mas-${w}.png`));
  } finally { await c.browser.close().catch(() => null); }
}

/** Sesión simulada SOLO en el navegador para pintar «Administración»: nada sale hacia el servidor con privilegios. */
async function simulateAdmin(c: Client) {
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sub = "00000000-0000-4000-8000-0000000000aa", exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub, exp, role: "authenticated", aud: "authenticated", email: "qa-sim@example.invalid" })}.c2lt`;
  const session = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "sim", user: { id: sub, aud: "authenticated", role: "authenticated", email: "qa-sim@example.invalid", app_metadata: {}, user_metadata: { username: "qa_sim" } } });
  await c.tab.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "*/auth/v1/*" }, { urlPattern: "*/rest/v1/*" }] });
  const H = [{ name: "content-type", value: "application/json" }];
  c.tab.on("Fetch.requestPaused", (p: any) => {
    const url: string = p.request.url;
    const reply = (code: number, body: unknown) => c.tab.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: code, responseHeaders: H, body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => null);
    if (/\/api\/game\/me(\?|$)/.test(url)) return reply(200, { profile: { id: sub, username: "qa_sim", is_admin: true } });
    if (/\/api\/admin\/session/.test(url)) return reply(200, { admin: true });
    if (/\/auth\/v1\/user/.test(url)) return reply(200, JSON.parse(session).user);
    // Todo lo demás: respuesta local vacía (la sesión es falsa; ninguna petición llega al servidor).
    return reply(503, { error: "QA_SIMULATED_SESSION" });
  });
  await c.tab.goto(`${BASE}/robots.txt`, 300);
  for (const k of ["sb-valorosters-auth-token", "sb-127-auth-token", "sb-localhost-auth-token"]) await c.tab.setStorage(k, session);
}

(async () => {
  const only = process.env.QA_ONLY;
  if (!only) {
    for (const w of [1440, 1024]) await desktop(w, false);
    await desktop(1440, true);
    await mobile(false);
    await mobile(true);
  }
  for (const w of [1440, 390]) await homeMore(w);
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
