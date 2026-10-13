/**
 * COLECCIONES POR EQUIPO · API Y PANTALLAS REALES (instrumento; SOLO stack de QA aislado, cuentas sintéticas).
 *
 *   BASE_URL=http://127.0.0.1:3027 COLL_PW=… QA_ANON_KEY=… TC_EXPECT=tc-expect.json npx tsx scripts/_team-collections-ui.ts [idiomas]
 *
 * 1) API: lo que responde `/api/game/team-collections` para cuatro inventarios conocidos, contra lo que calcula el
 *    dominio (tc-expect.json); sesión, parámetros, aislamiento entre cuentas, solo lectura y tiempos.
 * 2) Navegador (390 y 1440 px, por idioma): entra por el formulario real y recorre Colección → Colecciones: tres
 *    equipos al entrar, seis más por pulsación hasta el último, insignias regionales, bloque antiguo ausente, detalle
 *    de equipo, enlaces antiguos, desbordes, claves visibles y errores de consola. No compra, abre ni desguaza nada.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY ?? "", PW = process.env.COLL_PW ?? "";
if (!ANON || !PW) throw new Error("faltan QA_ANON_KEY / COLL_PW");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
const OUT = join(process.cwd(), process.env.UI_OUT ?? "logs/team-collections-ui");
const NAV: Record<string, string[]> = { es: ["es-ES", "es"], en: ["en-GB", "en"], de: ["de-DE", "de"], it: ["it-IT", "it"], fr: ["fr-FR", "fr"], "pt-PT": ["pt-PT", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
const MORE: Record<string, string> = { es: "Ver más equipos", en: "Show more teams", de: "Mehr Teams anzeigen", it: "Mostra altre squadre", fr: "Voir plus d'équipes", "pt-PT": "Ver mais equipas", "pt-BR": "Ver mais times", ja: "チームをもっと見る" };
const REGIONAL: Record<string, string> = { es: "Insignias regionales", en: "Regional badges", de: "Regionale Abzeichen", it: "Distintivi regionali", fr: "Badges régionaux", "pt-PT": "Emblemas regionais", "pt-BR": "Emblemas regionais", ja: "地域バッジ" };
interface Tile { id: string; title: string; total: number; owned: number; missing: number; state: string; region: string | null; complete: boolean }
interface Badge { region: string; teams: number; teamsCompleted: number; total: number; owned: number; unlocked: boolean; configured: boolean }
interface View { teams: Tile[]; regions: Badge[]; totals: { teams: number; teamsCompleted: number; cards: number; owned: number; badges: number; badgesUnlocked: number } }
const EXPECT = JSON.parse(readFileSync(process.env.TC_EXPECT ?? "tc-expect.json", "utf8")) as { catalog: number; teams: number; g2: { total: number; five: number; copiesEach: number }; accounts: Record<string, { copies: number; distinct: number; view: View }> };

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ scope, id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id} — ${d.slice(0, 240)}`); };
const emailOf = (label: string) => `coll-${label}@example.invalid`;
const tokens = new Map<string, string>();
async function token(label: string): Promise<string> {
  if (!tokens.has(label)) {
    const j = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: emailOf(label), password: PW }) })).json() as { access_token?: string };
    if (!j.access_token) throw new Error(`no entra ${label}`);
    tokens.set(label, j.access_token);
  }
  return tokens.get(label)!;
}
async function api(path: string, label?: string, init: RequestInit = {}): Promise<{ status: number; json: any; ms: number; bytes: number }> {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(label ? { authorization: `Bearer ${label.startsWith("raw:") ? label.slice(4) : await token(label)}` } : {}), ...(init.headers ?? {}) } });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: r.status, json, ms: Date.now() - t0, bytes: text.length };
}
const slim = (v: View) => ({ teams: v.teams.map((t) => [t.id, t.owned, t.total, t.state, t.region]), regions: v.regions.map((r) => [r.region, r.owned, r.total, r.teams, r.teamsCompleted, r.unlocked, r.configured]), totals: v.totals });

async function apiChecks() {
  const S = "API";
  for (const [label, e] of Object.entries(EXPECT.accounts)) {
    const r = await api("/api/game/team-collections", label);
    check(S, `${label} · respuesta = dominio (equipos, progreso, estado, región e insignias)`, r.status === 200 && JSON.stringify(slim(r.json)) === JSON.stringify(slim(e.view)), { status: r.status, totals: r.json?.totals, insignias: r.json?.regions?.map((x: Badge) => `${x.region}:${x.unlocked ? "✓" : "×"} ${x.owned}/${x.total}`), ms: r.ms, bytes: r.bytes });
    const st = await api("/api/game/state", label);
    check(S, `${label} · mismo inventario que /api/game/state (copias y cartas distintas)`, st.json?.ownedTotal === e.copies && Object.keys(st.json?.ownedCounts ?? {}).length === e.distinct, { copias: st.json?.ownedTotal, distintas: Object.keys(st.json?.ownedCounts ?? {}).length });
  }
  const five = (await api("/api/game/team-collections", "tcfive")).json as View;
  const g2 = five.teams.find((t) => t.id === "g2")!;
  check(S, "1 · equipo con una carta por jugador: NO completo", g2.owned === EXPECT.g2.five && g2.total === EXPECT.g2.total && g2.state === "IN_PROGRESS" && !g2.complete, g2);
  const d = (await api("/api/game/team-collections?team=g2", "tcfive")).json as { cards: { id: string; playerId: string; owned: boolean; copies: number }[]; owned: number; total: number };
  const perPlayer = new Map<string, number>(); for (const c of d.cards) perPlayer.set(c.playerId, (perPlayer.get(c.playerId) ?? 0) + 1);
  check(S, "2 · varias ediciones de un jugador: cada una es una carta de la colección", [...perPlayer.values()].some((n) => n >= 3) && d.cards.length === EXPECT.g2.total && new Set(d.cards.map((c) => c.id)).size === d.cards.length, { cartas: d.cards.length, porJugador: [...perPlayer.values()] });
  check(S, "3 · copias repetidas no completan otras ediciones", d.owned === EXPECT.g2.five && d.cards.filter((c) => c.owned).every((c) => c.copies === EXPECT.g2.copiesEach) && d.cards.filter((c) => !c.owned).every((c) => c.copies === 0), { tienes: d.owned, copias: d.cards.filter((c) => c.owned).map((c) => c.copies) });
  check(S, "navi completo con todas sus cartas", five.teams.find((t) => t.id === "navi")!.state === "COMPLETED");
  const china = (await api("/api/game/team-collections", "tcchina")).json as View;
  const emea = china.regions.find((r) => r.region === "EMEA")!;
  check(S, "8 · región a falta de UNA carta: bloqueada", !emea.unlocked && emea.total - emea.owned === 1 && emea.teamsCompleted === emea.teams - 1, emea);
  check(S, "9 · región completa: desbloqueada (solo esa)", china.regions.filter((r) => r.unlocked).map((r) => r.region).join() === "China", china.regions.map((r) => [r.region, r.unlocked]));
  const all = (await api("/api/game/team-collections", "tcall")).json as View;
  check(S, "10 · las cuatro regiones, completas y sin solaparse", all.regions.map((r) => r.region).join() === "Americas,EMEA,Pacific,China" && all.regions.every((r) => r.unlocked && r.configured) && all.regions.reduce((n, r) => n + r.total, 0) === EXPECT.catalog && all.totals.teamsCompleted === EXPECT.teams, all.totals);
  const empty = (await api("/api/game/team-collections", "tcempty")).json as View;
  check(S, "cuenta sin cartas: todo sin empezar, ninguna insignia", empty.teams.every((t) => t.state === "LOCKED" && t.owned === 0) && empty.regions.every((r) => !r.unlocked) && empty.teams.length === EXPECT.teams, empty.totals);
  check(S, "la rejilla no lleva listas de cartas y pesa poco", !("cards" in (all.teams[0] as object)) && JSON.stringify(all).length < 20_000, { bytes: JSON.stringify(all).length });

  // Sesión, parámetros y solo lectura.
  check(S, "sin sesión → 401", (await api("/api/game/team-collections")).status === 401);
  check(S, "token falso → 401", (await api("/api/game/team-collections", "raw:eyJhbGciOiJIUzI1NiJ9.e30.falso")).status === 401);
  check(S, "detalle sin sesión → 401", (await api("/api/game/team-collections?team=g2")).status === 401);
  check(S, "parámetro desconocido → 400", (await api("/api/game/team-collections?user=x", "tcfive")).status === 400);
  check(S, "equipo repetido → 400", (await api("/api/game/team-collections?team=g2&team=navi", "tcfive")).status === 400);
  check(S, "equipo inexistente → 404", (await api("/api/game/team-collections?team=no-existe", "tcfive")).status === 404);
  check(S, "clave de equipo no válida → 400", (await api("/api/game/team-collections?team=..%2Fx", "tcfive")).status === 400 && (await api("/api/game/team-collections?team=", "tcfive")).status === 400);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) { const r = await api("/api/game/team-collections", "tcfive", { method, body: method === "DELETE" ? undefined : "{}", headers: { "content-type": "application/json" } }); check(S, `${method} no existe (solo lectura)`, r.status === 405, r.status); }
  const again = (await api("/api/game/team-collections", "tcfive")).json as View;
  check(S, "tras todo lo anterior, el inventario y la respuesta no han cambiado", JSON.stringify(slim(again)) === JSON.stringify(slim(five)));
  check(S, "una cuenta no ve el progreso de otra", empty.totals.owned === 0 && all.totals.owned === EXPECT.catalog);

  // Cuenta grande (si existe en la base de QA): la respuesta no crece con la colección.
  for (const big of ["50000", "60000"]) {
    try {
      const times: number[] = []; let last: Awaited<ReturnType<typeof api>> | null = null;
      for (let i = 0; i < 5; i++) { last = await api("/api/game/team-collections", big); times.push(last.ms); }
      const st = await api("/api/game/state", big);
      check(S, `cuenta de ${big} cartas · misma respuesta ligera`, last!.status === 200 && last!.bytes < 20_000 && Math.min(...times) < 1500, { copias: st.json?.ownedTotal, ms: times, bytes: last!.bytes, equipos: last!.json?.totals });
    } catch (e) { console.log(`(sin cuenta coll-${big}: ${String(e)})`); }
  }
}

const args = ["--mute-audio", "--hide-scrollbars", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])];
type Tab = Awaited<ReturnType<typeof launch>>["tab"];
const SETTLED = `document.readyState === 'complete' && !!document.querySelector('main, [data-testid]') && !document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;
async function waitFor(tab: Tab, expr: string, ms = 25000): Promise<boolean> { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; }
const noise = (e: string) => !/favicon|ERR_ABORTED|flagcdn|React DevTools|GPU stall|WebGL|GL Driver|swiftshader/i.test(e);
const PROBE = `(() => {
  const text = document.body.innerText;
  const lines = [...new Set(text.split('\\n').map((l) => l.trim()).filter((l) => l.length > 2))];
  const clipped = [...document.querySelectorAll('[data-testid="region-badge"] h3, [data-testid="region-status"], [data-testid="more-teams"], [data-testid^="stat-"] p, #sets-title, #regions-title')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.slice(0, 40));
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, clipped,
    keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l)).slice(0, 6) };
})()`;
const ROOM = `(() => ({
  tiles: [...document.querySelectorAll('[data-testid="set-tile"]')].map((a) => ({ id: a.getAttribute('data-set'), state: a.getAttribute('data-state'), progress: a.querySelector('[data-testid="set-progress"]')?.textContent ?? '' })),
  more: document.querySelector('[data-testid="more-teams"]')?.textContent ?? null,
  count: document.querySelector('[data-testid="teams-count"]')?.textContent ?? null,
  badges: [...document.querySelectorAll('[data-testid="region-badge"]')].map((li) => ({ region: li.getAttribute('data-region'), unlocked: li.getAttribute('data-unlocked') === '1', progress: li.querySelector('[data-testid="region-progress"]')?.textContent ?? '', status: li.querySelector('[data-testid="region-status"]')?.textContent ?? '' })),
  h2: [...document.querySelectorAll('[data-testid="trophy-room"] h2')].map((h) => h.textContent),
  old: ['badges-unlocked', 'badges-locked', 'badges-empty', 'recent-completions', 'claimable-banner', 'claim-badge'].filter((t) => document.querySelector('[data-testid="' + t + '"]')),
  sections: document.querySelectorAll('[data-testid="trophy-room"] > section').length,
  api: performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname + new URL(r.name).search).filter((p) => p.startsWith('/api/game/')),
}))()`;
type Room = { tiles: { id: string; state: string; progress: string }[]; more: string | null; count: string | null; badges: { region: string; unlocked: boolean; progress: string; status: string }[]; h2: string[]; old: string[]; sections: number; api: string[] };

async function browser(locale: string, width: number, label: string, deep: boolean) {
  const S = `${locale} · ${width} · ${label}`;
  const truth = (await api("/api/game/team-collections", label)).json as View;
  const b = await launch({ args });
  const tab = b.tab;
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV[locale])} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(NAV[locale][0])} });` });
    await tab.resize(width, width < 600 ? 844 : 900, 1);
    await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 30000);
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${JSON.stringify(emailOf(label))}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(PW)}); document.querySelector('form button[type="submit"]').click(); })()`);
    check(S, "inicio de sesión", await waitFor(tab, `!document.querySelector('input[type="password"]')`, 30000));
    await sleep(2000); tab.takeErrors();

    const clean = async (name: string) => {
      const p = await tab.js<{ lang: string; overflow: number; keys: string[]; clipped: string[] }>(PROBE);
      const errors = tab.takeErrors().filter(noise);
      await tab.shot(join(dir, `${label}-${name}.png`)).catch(() => null);
      check(S, `${name} · idioma, sin desborde, sin textos cortados, sin claves, sin errores`, p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && p.clipped.length === 0 && errors.length === 0, { ...p, errors: errors.slice(0, 2) });
    };

    await tab.goto(`${BASE}/coleccion/trofeos`, 1200);
    check(S, "Colecciones carga", await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]') || !!document.querySelector('[data-testid="trophy-empty"]')`, 40000));
    await sleep(1500);
    let room = await tab.js<Room>(ROOM);
    check(S, "5 · carga inicial: exactamente 3 equipos", room.tiles.length === 3 && room.count !== null && room.count.includes("3") && room.count.includes(String(truth.teams.length)), { equipos: room.tiles.map((t) => t.id), recuento: room.count });
    check(S, "botón «Ver más equipos» traducido", room.more === MORE[locale], room.more);
    check(S, "11 · el bloque antiguo de insignias no está: solo Colecciones e Insignias regionales", room.old.length === 0 && room.h2.length === 2 && room.h2[1] === REGIONAL[locale] && room.sections === 3, { h2: room.h2, antiguos: room.old, secciones: room.sections });
    check(S, "insignias regionales: las cuatro, en orden, con el estado y el progreso del servidor", room.badges.length === 4 && room.badges.every((x, i) => x.region === truth.regions[i].region && x.unlocked === truth.regions[i].unlocked && x.progress === `${truth.regions[i].owned}/${truth.regions[i].total}`), room.badges);
    check(S, "carga eficiente: una sola lectura de colecciones y ninguna del inventario, la Maestría, el Prestigio o los sets", room.api.filter((p) => p === "/api/game/team-collections").length === 1 && !room.api.some((p) => /\/api\/game\/(cards|mastery|prestige|collection-sets)/.test(p)), room.api);
    for (const t of room.tiles) { const s = truth.teams.find((x) => x.id === t.id); if (!s || t.progress !== `${s.owned}/${s.total}` || t.state !== s.state) check(S, `tarjeta ${t.id} = servidor`, false, { pantalla: t, servidor: s }); }
    await clean("colecciones");
    await tab.js(`document.querySelector('#regions-title').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90)`); await sleep(500);
    await tab.shot(join(dir, `${label}-insignias.png`)).catch(() => null);
    await tab.js(`window.scrollTo(0, 0)`);

    // 6 · 7 · cada pulsación añade seis, hasta que salen todos y el botón desaparece.
    const steps = [room.tiles.length];
    for (let i = 0; i < 20 && room.more !== null; i++) {
      await tab.js(`document.querySelector('[data-testid="more-teams"]').click()`); await sleep(350);
      room = await tab.js<Room>(ROOM); steps.push(room.tiles.length);
    }
    const total = truth.teams.length;
    const expected: number[] = []; for (let n = Math.min(3, total); ; n = Math.min(total, n + 6)) { expected.push(n); if (n === total) break; }
    check(S, "6 · «Ver más equipos» añade seis cada vez", JSON.stringify(steps) === JSON.stringify(expected), { pasos: steps });
    check(S, "7 · acaban saliendo todos, sin repetir, y el botón desaparece", room.tiles.length === total && new Set(room.tiles.map((t) => t.id)).size === total && room.more === null && truth.teams.every((t) => room.tiles.some((x) => x.id === t.id && x.progress === `${t.owned}/${t.total}` && x.state === t.state)), { equipos: room.tiles.length, total });
    check(S, "sin más lecturas al pulsar: los equipos ya venían en la primera", room.api.filter((p) => p.startsWith("/api/game/team-collections")).length === 1, room.api.filter((p) => p.startsWith("/api/game/team-collections")).length);
    await clean("colecciones-todas");

    if (deep) {
      // Buscar y filtrar vuelve a empezar por tres.
      await tab.js(`(() => { const el = document.querySelector('[data-testid="trophy-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, 'navi'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(400);
      room = await tab.js<Room>(ROOM);
      check(S, "buscar un equipo", room.tiles.length === 1 && room.tiles[0].id === "navi" && room.more === null, room.tiles);
      await tab.js(`(() => { const el = document.querySelector('[data-testid="trophy-search"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(400);
      room = await tab.js<Room>(ROOM);
      check(S, "al cambiar la búsqueda se vuelve a empezar por tres", room.tiles.length === Math.min(3, total), room.tiles.length);

      // Detalle de equipo.
      await tab.goto(`${BASE}/coleccion/trofeos/g2`, 1200);
      check(S, "detalle de G2 carga", await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 40000));
      await sleep(1500);
      const det = await tab.js<{ reqs: number; ok: number; progress: string; copies: number; state: string; claim: boolean }>(`(() => ({ reqs: document.querySelectorAll('[data-testid="requirement"]').length, ok: document.querySelectorAll('[data-testid="requirement"][data-satisfied="1"]').length, progress: document.querySelector('[data-testid="set-progress"]')?.textContent ?? '', copies: document.querySelectorAll('[data-testid="copies"]').length, state: document.querySelector('[data-testid="set-detail"]').getAttribute('data-state'), claim: !!document.querySelector('[data-testid="claim-badge"]') }))()`);
      const g2 = truth.teams.find((t) => t.id === "g2")!;
      check(S, "detalle: todas las cartas del equipo, las tuyas marcadas, copias anotadas, nada que reclamar", det.reqs === g2.total && det.ok === g2.owned && det.progress === `${g2.owned}/${g2.total}` && det.state === g2.state && !det.claim && (label !== "tcfive" || det.copies === g2.owned), det);
      await clean("detalle-g2");
      await tab.goto(`${BASE}/coleccion/trofeos/team-g2-v1`, 1200);
      check(S, "un enlace antiguo de set lleva al mismo equipo", await waitFor(tab, `document.querySelector('[data-testid="set-detail"]')?.getAttribute('data-set') === 'g2'`, 30000));
      await tab.goto(`${BASE}/coleccion/trofeos/no-existe`, 1200);
      check(S, "equipo inexistente: mensaje, no pantalla rota", await waitFor(tab, `!document.querySelector('[data-testid="set-detail"]') && document.body.innerText.length > 20 && !/Application error/i.test(document.body.innerText)`, 30000));
      tab.takeErrors();
      await tab.goto(`${BASE}/coleccion/trofeos/paper-rex`, 1200); await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 30000); await sleep(1200);
      await clean("detalle-sin-logo");
      // Lo demás del juego sigue en pie con esta build.
      for (const [path, name] of [["/coleccion", "album"], ["/", "portada"]] as const) { await tab.goto(`${BASE}${path}`, 1200); await waitFor(tab, SETTLED, 40000); await sleep(1800); await clean(name); }
    }
  } catch (e) {
    check(S, "EJECUCIÓN", false, String(e));
  } finally { await b.close(); }
}

/** Panel de administración: `/admin/teams` enseña el resumen de colecciones y lo que les falta a los datos. */
async function admin() {
  const email = process.env.QA_ADMIN_EMAIL, pw = process.env.QA_ADMIN_PASSWORD, S = "admin · es · 1440";
  if (!email || !pw) { console.log("(sin cuenta de administración de QA: se omite /admin/teams)"); return; }
  const b = await launch({ args });
  const tab = b.tab;
  try {
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 30000);
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${JSON.stringify(email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(pw)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await waitFor(tab, `!document.querySelector('input[type="password"]')`, 30000); await sleep(2000); tab.takeErrors();
    await tab.goto(`${BASE}/admin/teams`, 1200);
    const ok = await waitFor(tab, `!!document.querySelector('[data-testid="team-collections-summary"]')`, 40000);
    await sleep(1200);
    const text = ok ? await tab.js<string>(`document.querySelector('[data-testid="team-collections-summary"]').closest('section').innerText`) : "";
    await tab.shot(join(OUT, "admin-teams.png")).catch(() => null);
    const errors = tab.takeErrors().filter(noise);
    check(S, "/admin/teams · resumen de colecciones: equipos, cartas y regiones del catálogo", ok && text.includes(String(EXPECT.teams)) && text.includes(String(EXPECT.catalog)) && ["Americas", "EMEA", "Pacific", "China"].every((r) => text.includes(r)) && errors.length === 0, { texto: text.replace(/\s+/g, " ").slice(0, 300), errors: errors.slice(0, 2) });
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await apiChecks();
  await admin();
  for (const l of LOCS) for (const w of [390, 1440]) {
    await browser(l, w, "tcfive", true);
    if (l === "es" || l === "ja" || l === "de") { await browser(l, w, "tcchina", false); await browser(l, w, "tcall", false); await browser(l, w, "tcempty", false); }
  }
  writeFileSync(join(OUT, "team-collections-ui.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 1));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`RESULTADO · ${BASE} · ${rows.length - bad} PASS · ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
