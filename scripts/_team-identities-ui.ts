/**
 * COLECCIONES · EQUIPO NUEVO DADO DE ALTA DESDE EL PANEL (0076) — instrumento; SOLO stack de QA aislado.
 *
 *   BASE_URL=http://127.0.0.1:3027 QA_ANON_KEY=… COLL_PW=… QA_ADMIN_EMAIL=… QA_ADMIN_PASSWORD=… npx tsx scripts/_team-identities-ui.ts [idiomas]
 *
 * Precondición (la prepara `team-collections.sh identities`): catálogo servido desde la base (content_cards) con DOS
 * cartas publicadas de un equipo impreso que el código no conoce («QA Team Omega»), y esas dos cartas en el inventario
 * de la cuenta sintética `tcall`, que ya tiene completos todos los demás equipos (fase main de `_team-collections-ui.ts`).
 *
 *   1) API: el equipo sin identidad no es una colección (ni detalle, ni XP); el panel lo lista como pendiente; la ruta
 *      del panel rechaza anónimos, jugadores, campos de más, claves del código, regiones inválidas y textos que no
 *      existen; el alta funciona una vez (revisión 1), un segundo envío choca y la clave no se puede cambiar.
 *   2) Con identidad: aparece con su clave, etiqueta y región; completarla da 300 XP una sola vez aunque se liquide en
 *      paralelo; la insignia regional ya conseguida sigue desbloqueada; la meta de la región sube para quien no la tiene.
 *   3) Navegador: /admin/teams con el panel (8 idiomas, 1440 px; y 390 px en español) y el detalle del equipo nuevo.
 * No compra, abre ni desguaza nada.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY ?? "", PW = process.env.COLL_PW ?? "";
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL ?? "", ADMIN_PW = process.env.QA_ADMIN_PASSWORD ?? "";
if (!ANON || !PW || !ADMIN_EMAIL || !ADMIN_PW) throw new Error("faltan QA_ANON_KEY / COLL_PW / QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
const OUT = join(process.cwd(), process.env.UI_OUT ?? "logs/team-identities-ui");
const NAV: Record<string, string[]> = { es: ["es-ES", "es"], en: ["en-GB", "en"], de: ["de-DE", "de"], it: ["it-IT", "it"], fr: ["fr-FR", "fr"], "pt-PT": ["pt-PT", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
const PANEL: Record<string, string> = { es: "Equipos nuevos del catálogo", en: "New catalog teams", de: "Neue Katalogteams", it: "Nuove squadre del catalogo", fr: "Nouvelles équipes du catalogue", "pt-PT": "Novas equipas do catálogo", "pt-BR": "Novos times do catálogo", ja: "カタログの新チーム" };
const PRINTED = "QA Team Omega", ID = "qa-omega", XP = 300;

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ scope, id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id} — ${d.slice(0, 240)}`); };
const tokens = new Map<string, string>();
async function token(who: string): Promise<string> {
  if (!tokens.has(who)) {
    const [email, pw] = who === "admin" ? [ADMIN_EMAIL, ADMIN_PW] : [`coll-${who}@example.invalid`, PW];
    const j = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json() as { access_token?: string };
    if (!j.access_token) throw new Error(`no entra ${who}`);
    tokens.set(who, j.access_token);
  }
  return tokens.get(who)!;
}
async function api(path: string, who?: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { ...((init.headers ?? {}) as Record<string, string>) };
  if (who) headers.authorization = `Bearer ${await token(who)}`;
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: r.status, json };
}
const post = (path: string, who: string | undefined, body: unknown) => api(path, who, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const save = (who: string | undefined, b: Record<string, unknown>) => post("/api/admin/cms/teams", who, { action: "save", ...b });
const VALID = { printedTeam: PRINTED, teamId: ID, name: "QA Team Omega", tag: "QTO", region: "Pacific", expectedRev: 0 };
interface Tile { id: string; title: string; tag: string; region: string | null; total: number; owned: number; state: string; firstCompletedAt: string | null; xpAwarded: number | null; logo: string | null }
interface Badge { region: string; teams: number; total: number; owned: number; unlocked: boolean; permanent: boolean }
interface View { teams: Tile[]; regions: Badge[]; pending: boolean }

/** Lectura de Colecciones; si no es 200 se dice por qué (y se corta: sin vista no hay nada que comprobar). */
async function view(who: string): Promise<View> {
  const r = await api("/api/game/team-collections", who);
  if (r.status !== 200 || !Array.isArray(r.json?.teams)) throw new Error(`GET team-collections (${who}) → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json as View;
}

async function apiChecks() {
  const S = "API · antes del alta";
  const before = await view("tcall");
  const emptyBefore = await view("tcempty");
  check(S, "sin identidad no es una colección", !before.teams.some((t) => t.title === PRINTED || t.id === ID), before.teams.length);
  check(S, "ni su detalle por la clave en bruto", (await api(`/api/game/team-collections?team=${encodeURIComponent(`raw:${PRINTED}`)}`, "tcall")).status === 404);
  const s0 = await post("/api/game/team-collections", "tcall", { action: "settle" });
  check(S, "liquidar con sus dos cartas no da nada", s0.status === 200 && !s0.json.teams.some((t: { id: string }) => t.id.startsWith("raw:") || t.id === ID), s0.json?.teams);
  check(S, "panel: anónimo 401, jugador 401", (await api("/api/admin/cms/teams")).status === 401 && (await api("/api/admin/cms/teams", "tcall")).status === 401);
  const list = (await api("/api/admin/cms/teams", "admin")).json as { available: boolean; pending: { printedTeam: string; cards: number }[]; managed: unknown[] };
  check(S, "panel: el equipo aparece como pendiente, con sus 2 cartas", list.available && list.pending.some((p) => p.printedTeam === PRINTED && p.cards === 2), list);

  const W = "API · alta";
  check(W, "jugador → 401", (await save("tcall", VALID)).status === 401);
  check(W, "anónimo → 401", (await save(undefined, VALID)).status === 401);
  const bad: [string, Record<string, unknown>, number][] = [
    ["región inválida", { ...VALID, region: "Marte" }, 400], ["sin región", { ...VALID, region: "" }, 400], ["clave de un equipo del código", { ...VALID, teamId: "g2" }, 400],
    ["clave mal formada", { ...VALID, teamId: "QA Nuevo" }, 400], ["clave de set antiguo", { ...VALID, teamId: "team-g2-v1" }, 400], ["etiqueta larga", { ...VALID, tag: "DEMASIADO" }, 400],
    ["texto impreso que no existe", { ...VALID, printedTeam: "No Existe" }, 404], ["texto de un equipo del código", { ...VALID, printedTeam: "NAVI" }, 404],
  ];
  for (const [name, b, want] of bad) { const r = await save("admin", b); check(W, `rechazado · ${name}`, r.status === want, r.status); }
  check(W, "campo de más (actor elegido por el cliente) → 400", (await post("/api/admin/cms/teams", "admin", { action: "save", ...VALID, actor: "x" })).status === 400);
  const ok = await save("admin", VALID);
  check(W, "alta → 200, revisión 1", ok.status === 200 && ok.json?.rev === 1 && ok.json?.teamId === ID, ok.json);
  check(W, "el mismo envío otra vez → 409", (await save("admin", VALID)).status === 409);
  check(W, "cambiar la clave → 409", (await save("admin", { ...VALID, teamId: "qa-otra", expectedRev: 1 })).status === 409);

  const A = "API · con identidad";
  const withId = await view("tcall");
  const t = withId.teams.find((x) => x.id === ID);
  check(A, "aparece con su clave, nombre, etiqueta y región, sin logo inventado", !!t && t.title === PRINTED && t.tag === "QTO" && t.region === "Pacific" && t.logo === null && t.total === 2, t);
  check(A, "tcall lo tiene completo y hay algo que guardar", !!t && t.owned === 2 && t.state === "COMPLETED" && t.firstCompletedAt === null && withId.pending === true, { t, pending: withId.pending });
  const burst = await Promise.all(Array.from({ length: 6 }, () => post("/api/game/team-collections", "tcall", { action: "settle" })));
  const okb = burst.filter((r) => r.status === 200).map((r) => r.json as { teams: { id: string; first: boolean; xp: number }[]; xpGained: number; regions: string[] });
  check(A, "6 liquidaciones a la vez: 300 XP una sola vez por el equipo nuevo", okb.reduce((n, r) => n + r.xpGained, 0) === XP && okb.flatMap((r) => r.teams).filter((x) => x.id === ID && x.first).length === 1, { estados: burst.map((r) => r.status), xp: okb.map((r) => r.xpGained) });
  const after = await view("tcall");
  const pac = after.regions.find((r) => r.region === "Pacific")!, pac0 = before.regions.find((r) => r.region === "Pacific")!;
  check(A, "Pacific: un equipo y dos cartas más en la meta", pac.teams === pac0.teams + 1 && pac.total === pac0.total + 2, { antes: pac0, ahora: pac });
  check(A, "la insignia de Pacific ya conseguida sigue desbloqueada y permanente", pac0.permanent ? pac.unlocked && pac.permanent : true, { antes: pac0.permanent, ahora: [pac.unlocked, pac.permanent] });
  const det = (await api(`/api/game/team-collections?team=${ID}`, "tcall")).json as Tile;
  check(A, "detalle: primera compleción con sus 300 XP", det.xpAwarded === XP && !!det.firstCompletedAt, det);
  const emptyAfter = await view("tcempty");
  const e = emptyAfter.teams.find((x) => x.id === ID);
  check(A, "otra cuenta: el equipo bloqueado 0/2 y la meta de Pacific sube", !!e && e.owned === 0 && e.state === "LOCKED" && e.firstCompletedAt === null && emptyAfter.regions.find((r) => r.region === "Pacific")!.total === emptyBefore.regions.find((r) => r.region === "Pacific")!.total + 2);
  const fix = await save("admin", { ...VALID, name: "QA Team Omega", tag: "QTO", region: "Pacific", expectedRev: 1 });
  check(A, "corregir con la revisión buena → 200 rev 2", fix.status === 200 && fix.json?.rev === 2, fix.json);
}

const args = ["--mute-audio", "--hide-scrollbars", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])];
type Tab = Awaited<ReturnType<typeof launch>>["tab"];
async function waitFor(tab: Tab, expr: string, ms = 25000): Promise<boolean> { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; }
const noise = (e: string) => !/favicon|ERR_ABORTED|flagcdn|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);
const PROBE = `(() => { const lines = [...new Set(document.body.innerText.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2))];
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth,
    keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l)).slice(0, 6) }; })()`;

/** El idioma de la CUENTA (user_metadata, como lo guarda el selector de idioma) manda sobre el del navegador si es más reciente. */
async function setAccountLocale(who: string, locale: string) {
  await fetch(`${BASE}/auth/v1/user`, { method: "PUT", headers: { apikey: ANON, authorization: `Bearer ${await token(who)}`, "content-type": "application/json" }, body: JSON.stringify({ data: { locale, locale_at: Date.now() } }) });
}

async function open(locale: string, width: number, email: string, pw: string) {
  const b = await launch({ args });
  const tab = b.tab;
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV[locale])} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(NAV[locale][0])} });` });
  await tab.resize(width, width < 600 ? 844 : 900, 1);
  await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 30000);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), ${JSON.stringify(email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(pw)}); document.querySelector('form button[type="submit"]').click(); })()`);
  const inside = await waitFor(tab, `!document.querySelector('input[type="password"]')`, 30000);
  await sleep(2000); tab.takeErrors();
  return { b, tab, inside };
}

async function adminScreen(locale: string, width: number) {
  const S = `${locale} · ${width} · admin`;
  await setAccountLocale("admin", locale);
  const { b, tab, inside } = await open(locale, width, ADMIN_EMAIL, ADMIN_PW);
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    check(S, "inicio de sesión de admin", inside);
    await tab.goto(`${BASE}/admin/teams`, 1500);
    check(S, "/admin/teams con el panel de equipos nuevos", await waitFor(tab, `!!document.querySelector('[data-testid="team-identities"]')`, 40000));
    await sleep(1500);
    const p = await tab.js<{ title: boolean; managed: string[]; pending: number; summary: boolean; logoCol: boolean; lang: string; overflow: number; keys: string[] }>(`(() => ({
      // El título del panel va en mayúsculas por CSS y innerText lo devuelve así.
      title: document.body.innerText.toLocaleUpperCase().includes(${JSON.stringify(PANEL[locale].toLocaleUpperCase())}),
      managed: [...document.querySelectorAll('[data-testid="team-identity-managed"]')].map((d) => d.getAttribute('data-team')),
      pending: document.querySelectorAll('[data-testid="team-identity-pending"]').length,
      summary: !!document.querySelector('[data-testid="team-collections-summary"]'),
      logoCol: !!document.querySelector('[data-testid="uploader-team_logo"]'),
      ...${PROBE} }))()`);
    const errors = tab.takeErrors().filter(noise);
    check(S, "panel traducido, con el equipo dado de alta y su subida de logo; nada pendiente", p.title && p.managed.includes(ID) && p.pending === 0 && p.summary && p.logoCol, p);
    check(S, "idioma, sin desborde, sin claves, sin errores de consola", p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && errors.length === 0, { lang: p.lang, overflow: p.overflow, keys: p.keys, errors: errors.slice(0, 2) });
    await tab.js(`document.querySelector('[data-testid="team-identities"]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -80)`); await sleep(500);
    await tab.shot(join(dir, "admin-equipos-nuevos.png")).catch(() => null);
    if (locale === "es" && width >= 1000) {
      await tab.goto(`${BASE}/admin/teams/paper-rex`, 1500);
      check(S, "ficha de un equipo del código: panel de logo con subida", await waitFor(tab, `!!document.querySelector('[data-testid="team-logo-panel"] [data-testid="uploader-team_logo"]')`, 40000));
      await sleep(1200); await tab.shot(join(dir, "admin-ficha-logo.png")).catch(() => null);
    }
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close().catch(() => null); }
}

async function playerScreen(locale: string, width: number) {
  const S = `${locale} · ${width} · tcall`;
  await setAccountLocale("tcall", locale);
  const { b, tab, inside } = await open(locale, width, "coll-tcall@example.invalid", PW);
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    check(S, "inicio de sesión", inside);
    await tab.goto(`${BASE}/coleccion/trofeos/${ID}`, 1500);
    check(S, "detalle del equipo nuevo", await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 40000));
    await sleep(1500);
    const d = await tab.js<{ state: string; progress: string; xp: string; mono: boolean; img: number; lang: string; overflow: number; keys: string[] }>(`(() => ({ state: document.querySelector('[data-testid="set-detail"]').getAttribute('data-state'), progress: document.querySelector('[data-testid="set-progress"]')?.textContent ?? '', xp: document.querySelector('[data-testid="first-completion"]')?.getAttribute('data-xp') ?? '', mono: document.querySelector('[data-testid="set-detail"] header').innerText.includes('QTO'), img: document.querySelectorAll('[data-testid="set-detail"] header img').length, ...${PROBE} }))()`);
    const errors = tab.takeErrors().filter(noise);
    check(S, "completo 2/2, 300 XP cobrados, escudo con su etiqueta (sin logo inventado)", d.state === "COMPLETED" && d.progress === "2/2" && d.xp === String(XP) && d.mono && d.img === 0, d);
    check(S, "idioma, sin desborde, sin claves, sin errores", d.lang === locale && d.overflow <= 1 && d.keys.length === 0 && errors.length === 0, { ...d, errors: errors.slice(0, 2) });
    await tab.shot(join(dir, "detalle-equipo-nuevo.png")).catch(() => null);
    await tab.goto(`${BASE}/coleccion/trofeos`, 1500); await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]')`, 40000); await sleep(2000);
    await tab.js(`(() => { const el = document.querySelector('[data-testid="trophy-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, 'QA Team'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(500);
    const ids = await tab.js<string[]>(`[...document.querySelectorAll('[data-testid="set-tile"]')].map((a) => a.getAttribute('data-set'))`);
    check(S, "Colecciones lo encuentra por su nombre", JSON.stringify(ids) === JSON.stringify([ID]), ids);
    await tab.shot(join(dir, "colecciones-busqueda-equipo-nuevo.png")).catch(() => null);
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close().catch(() => null); }
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  try { await apiChecks(); } catch (e) { check("API", "EJECUCIÓN", false, String(e)); }
  for (const l of LOCS) await adminScreen(l, 1440);
  await adminScreen("es", 390);
  for (const [l, w] of [["es", 1440], ["es", 390], ["en", 1440], ["ja", 390]] as const) if (LOCS.includes(l)) await playerScreen(l, w);
  // Deja el idioma de las cuentas como estaba (sin preferencia): si no, las pasadas siguientes saldrían en el último idioma.
  for (const who of ["admin", "tcall"]) await fetch(`${BASE}/auth/v1/user`, { method: "PUT", headers: { apikey: ANON, authorization: `Bearer ${await token(who)}`, "content-type": "application/json" }, body: JSON.stringify({ data: { locale: null, locale_at: null } }) }).catch(() => null);
  const fail = rows.filter((r) => !r.ok).length;
  writeFileSync(join(OUT, "results.json"), JSON.stringify(rows, null, 2));
  console.log(`RESULTADO · ${rows.length - fail} PASS · ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
