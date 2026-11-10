/**
 * QA EN PRODUCCIÓN · PERFIL = IDENTIDAD + CERRAR SESIÓN (instrumento, fuera de CI). SOLO cuentas QA (A f45, B qa352,
 * C f64); la personal nunca se abre.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_profile-identity-prod.mts   (cwd = prodqa)
 *
 * 1 · perfil propio REAL (A) a 1440/1024/390: tarjeta de identidad, rango/equipo según la foto del servidor, sin dashboard,
 *     EDITAR · CUENTA · TROFEOS · CERRAR SESIÓN; perfil de otro (B): acciones sociales F85, ninguna de cuenta.
 * 2 · CERRAR SESIÓN desde el perfil (390): a /cuenta, sin un fotograma de A, sesión local borrada; ATRÁS y F5 sin datos
 *     privados ni acciones de cuenta; B entra y abre SU perfil sin ver nunca a A.
 * 3 · VARIAS PESTAÑAS (un Chrome, dos pestañas, C): cerrar sesión en una → la otra deja de ser «tu perfil» sola.
 * 4 · SESIÓN REVOCADA (B): otro dispositivo cierra todas las sesiones → al recargar, sin perfil propio ni acciones.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const cdp = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/lib/cdp.ts");
const { mkdirSync, writeFileSync, mkdtempSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { tmpdir } = await import("node:os");
const { spawn } = await import("node:child_process");
const { login, api, sleep, QA_FILES } = qa;
const { openBrowser, loginUi, waitFor, PERSONA_FILES, creds } = lib;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/profile-identity/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_B = QA_FILES.B; PERSONA_FILES.QA_C = QA_FILES.C;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const DASH = /Nivel de cuenta|Partidas terminadas|Victorias|Derrotas|Empates|% de victorias|Temporada actual|Historial|Expón tus cartas|Elegir cartas|Cartas destacadas|Momentos destacados/i;
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const A = await login("A"), B = await login("B"), C = await login("C");
const snapOf = async (who: any, id: string) => (await api(who, `/api/game/player?id=${id}`)).json;
const sA = await snapOf(A, A.userId);
const nameA = sA?.player?.username as string, nameB = (await snapOf(B, B.userId))?.player?.username as string;
const expectRank = sA?.competitive?.state === "RANKED" || sA?.competitive?.state === "PLACEMENT";
const expectTeam = !!sA?.favoriteTeam;
const CARD = `(() => { const c = document.querySelector('[data-testid="profile-card"]'); if (!c) return null; return { view: c.dataset.view, text: c.textContent, acts: [...c.querySelectorAll('[data-action]')].map((a) => a.dataset.action), rank: !!c.querySelector('[data-testid="profile-rank"]'), team: !!c.querySelector('[data-testid="favorite-team"]'), social: !!c.querySelector('[data-testid="profile-social"]'), overflow: document.documentElement.scrollWidth - innerWidth, h: c.getBoundingClientRect().height, vh: innerHeight }; })()`;

// ── 1 · perfil propio y ajeno ──
for (const w of [1440, 1024, 390]) {
  const c = await openBrowser("QA_A", w, { label: `pi-${w}` });
  try {
    const ok = await loginUi(c, "QA_A");
    await c.tab.goto(`${BASE}/jugador/me`, 2500);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-card"][data-view="SELF"]')`, 25000);
    const f = await c.tab.js<any>(CARD);
    const url = await c.tab.js<string>("location.pathname");
    check(`${w} · /jugador/me → /jugador/<id> con la tarjeta PROPIA de A`, ok && !!f && f.view === "SELF" && url === `/jugador/${A.userId}` && f.text.includes(nameA), { url, view: f?.view });
    check(`${w} · propio: EDITAR · CUENTA · TROFEOS · CERRAR SESIÓN; sin sociales`, !!f && ["edit", "account", "trophy-room", "sign-out"].every((a) => f.acts.includes(a)) && !f.social, f?.acts);
    check(`${w} · rango y equipo SOLO si la foto del servidor los trae (rango: ${expectRank}, equipo: ${expectTeam})`, !!f && f.rank === expectRank && f.team === expectTeam, { rank: f?.rank, team: f?.team });
    check(`${w} · sin dashboard y sin desbordamiento; tarjeta compacta`, !!f && !DASH.test(f.text) && f.overflow <= 0 && f.h <= f.vh * 1.35, { dash: f?.text.match(DASH)?.[0], o: f?.overflow, h: f?.h, vh: f?.vh });
    await c.tab.shot(`${OUT}/shots/own-${w}.png`).catch(() => null);
    await c.tab.goto(`${BASE}/jugador/${B.userId}`, 2500);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-card"][data-view="PUBLIC"]')`, 25000);
    await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-social"]')`, 15000);
    const p = await c.tab.js<any>(CARD);
    check(`${w} · perfil de B: identidad + acciones sociales F85; NINGUNA acción de cuenta`, !!p && p.view === "PUBLIC" && p.text.includes(nameB) && p.social && !["edit", "account", "sign-out", "trophy-room"].some((a) => p.acts.includes(a)) && !/Cerrar sesión|Editar perfil|Cuenta y ajustes/.test(p.text), p?.acts);
    await c.tab.shot(`${OUT}/shots/public-B-${w}.png`).catch(() => null);
    if (w === 390) {
      // ── 2 · CERRAR SESIÓN desde el perfil ──
      await c.tab.goto(`${BASE}/jugador/me`, 2500);
      await waitFor(c.tab, `!!document.querySelector('[data-action="sign-out"]')`, 20000);
      await c.tab.js(`(() => { window.__seen = []; const t = setInterval(() => { const c = document.querySelector('[data-testid="profile-card"][data-view="SELF"]'); window.__seen.push(location.pathname + '|' + (c ? 'SELF' : '-')); }, 50); window.__t = t; const b = document.querySelector('[data-action="sign-out"]'); b.click(); b.click(); })()`);
      const atCuenta = await waitFor(c.tab, `location.pathname === '/cuenta' && !!document.querySelector('input[type="password"]')`, 20000);
      const trail = await c.tab.js<string[]>(`(() => { clearInterval(window.__t); return window.__seen; })()`);
      const leftover = await c.tab.js<string[]>(`Object.keys(localStorage).filter((k) => /sb-.*auth-token/.test(k) && localStorage.getItem(k) && !/null/.test(localStorage.getItem(k)))`);
      check("CERRAR SESIÓN (doble clic) → /cuenta con el formulario de entrada; sesión local borrada", atCuenta && leftover.length === 0, { leftover });
      check("tras pulsar, ningún fotograma vuelve a pintar la tarjeta PROPIA (ni en /cuenta)", trail.filter((x) => x.startsWith("/cuenta")).every((x) => x.endsWith("|-")), trail.slice(-6));
      check("/cuenta tras salir: nada de A (nombre)", !(await c.tab.js<boolean>(`document.body.textContent.includes(${JSON.stringify(nameA)})`)));
      await c.tab.shot(`${OUT}/shots/after-logout-390.png`).catch(() => null);
      await c.tab.js("history.back()");
      await sleep(3500);
      const back = await c.tab.js<any>(CARD);
      check("ATRÁS tras salir: como mucho el perfil PÚBLICO (sin editar, cuenta ni cerrar sesión)", !back || (back.view !== "SELF" && !back.acts.includes("sign-out") && !back.acts.includes("edit")), { url: await c.tab.js<string>("location.pathname"), view: back?.view, acts: back?.acts });
      await c.tab.goto(`${BASE}/jugador/${A.userId}`, 3000);
      await sleep(2500);
      const f5 = await c.tab.js<any>(CARD);
      check("F5 en el perfil de A sin sesión: vista pública, sin acciones de cuenta", !f5 || (f5.view !== "SELF" && !f5.acts.includes("sign-out")), { view: f5?.view, acts: f5?.acts });
      // A sale → B entra: B nunca ve a A
      await loginUi(c, "QA_B");
      await c.tab.js(`(() => { window.__seen = []; window.__t = setInterval(() => { window.__seen.push(document.body.textContent.includes(${JSON.stringify(nameA)}) ? 'A' : '-'); }, 50); })()`);
      await c.tab.goto(`${BASE}/jugador/me`, 300);
      await c.tab.js(`(() => { window.__seen = []; window.__t = setInterval(() => { const c = document.querySelector('[data-testid="profile-card"][data-view="SELF"]'); window.__seen.push(c && c.textContent.includes(${JSON.stringify(nameA)}) ? 'A' : c ? 'B' : '-'); }, 50); })()`);
      const bIn = await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-card"][data-view="SELF"]')`, 25000);
      await sleep(1500);
      const seen = await c.tab.js<string[]>(`(() => { clearInterval(window.__t); return window.__seen; })()`);
      const fb = await c.tab.js<any>(CARD);
      check("A sale → B entra → «mi perfil»: es el de B y NUNCA se pinta la tarjeta propia de A", bIn && !!fb && fb.text.includes(nameB) && !fb.text.includes(nameA) && !seen.includes("A"), { seen: [...new Set(seen)] });
      await c.tab.shot(`${OUT}/shots/switch-B-390.png`).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

// ── 3 · varias pestañas en el MISMO navegador (CDP propio: dos pestañas, localStorage compartido) ──
{
  const port = 9600 + Math.floor(Math.random() * 150);
  const profile = mkdtempSync(join(tmpdir(), "pi-tabs-"));
  const proc = spawn(cdp.CHROME_PATH as string, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let ws = "";
    for (let i = 0; i < 80 && !ws; i++) { try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); } }
    const sock = new WebSocket(ws);
    await new Promise((r) => sock.addEventListener("open", r, { once: true }));
    let id = 0; const pend = new Map<number, (v: any) => void>();
    sock.addEventListener("message", (e: any) => { const m = JSON.parse(String(e.data)); if (m.id && pend.has(m.id)) { pend.get(m.id)!(m.result ?? m); pend.delete(m.id); } });
    const send = (method: string, params: any = {}, sessionId?: string) => new Promise<any>((res) => { const i = ++id; pend.set(i, res); sock.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const tab = async () => { const { targetId } = await send("Target.createTarget", { url: "about:blank" }); const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }); await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId); return sessionId as string; };
    const js = async (s: string, expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, s))?.result?.value;
    const nav = async (s: string, url: string, ms = 3500) => { await send("Page.navigate", { url }, s); await sleep(ms); };
    const until = async (s: string, expr: string, ms = 20000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await js(s, expr)) return true; await sleep(250); } return false; };
    const t1 = await tab(), t2 = await tab();
    const cr = creds("QA_C");
    await nav(t1, `${BASE}/cuenta`);
    await js(t1, `(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(cr.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(cr.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await until(t1, `!document.querySelector('input[type="password"]')`);
    await nav(t1, `${BASE}/jugador/me`); await nav(t2, `${BASE}/jugador/me`);
    const both = await until(t1, `!!document.querySelector('[data-action="sign-out"]')`) && await until(t2, `!!document.querySelector('[data-action="sign-out"]')`);
    check("dos pestañas del mismo navegador con el perfil PROPIO de C", both);
    await js(t1, `document.querySelector('[data-action="sign-out"]').click()`);
    const t2gone = await until(t2, `!document.querySelector('[data-testid="profile-card"][data-view="SELF"]') && !document.querySelector('[data-action="sign-out"]')`, 15000);
    check("cerrar sesión en la pestaña 1 → la pestaña 2 deja de ser «tu perfil» SOLA (sin recargar): sin editar ni cerrar sesión", t2gone, { t2: await js(t2, `location.pathname + ' ' + (document.querySelector('[data-testid="profile-card"]')?.dataset.view ?? '-')`) });
    sock.close();
  } finally { proc.kill(); }
}

// ── 4 · sesión revocada desde otro dispositivo (B) ──
{
  const y = await openBrowser("QA_B", 1024, { label: "pi-revoked" });
  try {
    await loginUi(y, "QA_B");
    await y.tab.goto(`${BASE}/jugador/me`, 2500);
    const own = await waitFor(y.tab, `!!document.querySelector('[data-action="sign-out"]')`, 20000);
    const other = await login("B");
    const out = await fetch(`${BASE}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${other.token}` } });
    await sleep(1500);
    await y.tab.goto(`${BASE}/jugador/${B.userId}`, 4000);
    await sleep(6000);
    const f = await y.tab.js<any>(CARD);
    check("sesión revocada en otro dispositivo → al recargar, sin perfil propio ni acciones de cuenta", own && out.status < 300 && (!f || (f.view !== "SELF" && !f.acts.includes("sign-out"))), { logout: out.status, view: f?.view, acts: f?.acts });
    await y.tab.shot(`${OUT}/shots/revoked-1024.png`).catch(() => null);
  } finally { await y.browser.close().catch(() => null); }
}

const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), accounts: { A: A.userId.slice(0, 8), B: B.userId.slice(0, 8), C: C.userId.slice(0, 8) }, total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nPROFILE PROD: ${rows.length - failed.length}/${rows.length}`);
