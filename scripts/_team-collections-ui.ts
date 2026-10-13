/**
 * COLECCIONES POR EQUIPO · API Y PANTALLAS REALES (instrumento; SOLO stack de QA aislado, cuentas sintéticas).
 *
 *   BASE_URL=http://127.0.0.1:3027 COLL_PW=… QA_ANON_KEY=… TC_EXPECT=tc-expect.json npx tsx scripts/_team-collections-ui.ts [idiomas] [fase]
 *
 * fase = main (por defecto), con las cuentas recién reiniciadas y una temporada activa:
 *   1) API: progreso y estado contra lo que calcula el dominio (tc-expect.json); recompensa de la primera compleción
 *      (300 XP, una vez, también con peticiones simultáneas), insignias regionales, sesión, parámetros, cuerpo cerrado y
 *      aislamiento entre cuentas.
 *   2) Navegador (390 y 1440 px, por idioma): título «Colecciones», tres equipos al entrar y seis más por pulsación,
 *      insignias regionales, liquidación automática al entrar, bloque antiguo y Prestigio ausentes, detalle de equipo,
 *      perfil (destacar una insignia regional desde el editor real y verla en el perfil propio y ajeno).
 * fase = perm, después de BORRAR de la base las cartas de China de la cuenta `tcchina`:
 *      la insignia sigue desbloqueada y destacada aunque el progreso haya bajado a cero.
 * No compra, abre ni desguaza nada desde la aplicación.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY ?? "", PW = process.env.COLL_PW ?? "";
if (!ANON || !PW) throw new Error("faltan QA_ANON_KEY / COLL_PW");
const LOCS = (process.argv[2] ?? "es,en,de,it,fr,pt-PT,pt-BR,ja").split(",");
const PHASE = process.argv[3] ?? "main";
const OUT = join(process.cwd(), process.env.UI_OUT ?? "logs/team-collections-ui");
const NAV: Record<string, string[]> = { es: ["es-ES", "es"], en: ["en-GB", "en"], de: ["de-DE", "de"], it: ["it-IT", "it"], fr: ["fr-FR", "fr"], "pt-PT": ["pt-PT", "pt"], "pt-BR": ["pt-BR", "pt"], ja: ["ja-JP", "ja"] };
const TITLE: Record<string, string> = { es: "Colecciones", en: "Collections", de: "Sammlungen", it: "Collezioni", fr: "Collections", "pt-PT": "Coleções", "pt-BR": "Coleções", ja: "コレクションセット" };
const TEAMS_H2: Record<string, string> = { es: "Equipos", en: "Teams", de: "Teams", it: "Squadre", fr: "Équipes", "pt-PT": "Equipas", "pt-BR": "Times", ja: "チーム" };
const MORE: Record<string, string> = { es: "Ver más equipos", en: "Show more teams", de: "Mehr Teams anzeigen", it: "Mostra altre squadre", fr: "Voir plus d'équipes", "pt-PT": "Ver mais equipas", "pt-BR": "Ver mais times", ja: "チームをもっと見る" };
const REGIONAL: Record<string, string> = { es: "Insignias regionales", en: "Regional badges", de: "Regionale Abzeichen", it: "Distintivi regionali", fr: "Badges régionaux", "pt-PT": "Emblemas regionais", "pt-BR": "Emblemas regionais", ja: "地域バッジ" };
interface Tile { id: string; title: string; total: number; owned: number; missing: number; state: string; region: string | null; complete: boolean; firstCompletedAt: string | null; xpAwarded: number | null }
interface Badge { region: string; teams: number; teamsCompleted: number; total: number; owned: number; unlocked: boolean; configured: boolean; permanent: boolean; completeNow: boolean; unlockedAt: string | null }
interface View { teams: Tile[]; regions: Badge[]; pending: boolean; totals: { teams: number; teamsCompleted: number; cards: number; owned: number; badges: number; badgesUnlocked: number } }
interface Settle { teams: { id: string; title: string; xp: number; first: boolean }[]; regions: string[]; xpGained: number; view: View }
const EXPECT = JSON.parse(readFileSync(process.env.TC_EXPECT ?? "tc-expect.json", "utf8")) as { catalog: number; teams: number; g2: { total: number; five: number; copiesEach: number }; accounts: Record<string, { copies: number; distinct: number; view: View }> };
const XP = 300;

const rows: { scope: string; id: string; ok: boolean; detail: string }[] = [];
const check = (scope: string, id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ scope, id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} · ${scope} · ${id} — ${d.slice(0, 240)}`); };
const emailOf = (label: string) => `coll-${label}@example.invalid`;
const tokens = new Map<string, { token: string; id: string }>();
async function session(label: string): Promise<{ token: string; id: string }> {
  if (!tokens.has(label)) {
    const j = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: emailOf(label), password: PW }) })).json() as { access_token?: string; user?: { id: string } };
    if (!j.access_token || !j.user) throw new Error(`no entra ${label}`);
    tokens.set(label, { token: j.access_token, id: j.user.id });
  }
  return tokens.get(label)!;
}
async function api(path: string, label?: string, init: RequestInit = {}): Promise<{ status: number; json: any; ms: number; bytes: number }> {
  const t0 = Date.now();
  const headers: Record<string, string> = { ...((init.headers ?? {}) as Record<string, string>) };
  if (label) headers.authorization = `Bearer ${label.startsWith("raw:") ? label.slice(4) : (await session(label)).token}`;
  const r = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await r.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: r.status, json, ms: Date.now() - t0, bytes: text.length };
}
const post = (path: string, label: string | undefined, body: unknown) => api(path, label, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const settle = (label: string) => post("/api/game/team-collections", label, { action: "settle" });
/** Progreso y estado (lo que depende solo del inventario): igual en el servidor que en el dominio. */
const slim = (v: View) => ({ teams: v.teams.map((t) => [t.id, t.owned, t.total, t.state, t.region]), regions: v.regions.map((r) => [r.region, r.owned, r.total, r.teams, r.teamsCompleted, r.completeNow ?? r.unlocked, r.configured]), cards: [v.totals.teams, v.totals.teamsCompleted, v.totals.cards, v.totals.owned] });
const slimExpected = (v: View) => ({ teams: v.teams.map((t) => [t.id, t.owned, t.total, t.state, t.region]), regions: v.regions.map((r) => [r.region, r.owned, r.total, r.teams, r.teamsCompleted, r.unlocked, r.configured]), cards: [v.totals.teams, v.totals.teamsCompleted, v.totals.cards, v.totals.owned] });

async function apiChecks() {
  const S = "API";
  for (const [label, e] of Object.entries(EXPECT.accounts)) {
    const r = await api("/api/game/team-collections", label);
    check(S, `${label} · progreso = dominio (equipos, estado, región e insignias)`, r.status === 200 && JSON.stringify(slim(r.json)) === JSON.stringify(slimExpected(e.view)), { status: r.status, totals: r.json?.totals, pendiente: r.json?.pending, ms: r.ms, bytes: r.bytes });
    const st = await api("/api/game/state", label);
    check(S, `${label} · mismo inventario que /api/game/state (copias y cartas distintas)`, st.json?.ownedTotal === e.copies && Object.keys(st.json?.ownedCounts ?? {}).length === e.distinct, { copias: st.json?.ownedTotal, distintas: Object.keys(st.json?.ownedCounts ?? {}).length });
  }
  const five = (await api("/api/game/team-collections", "tcfive")).json as View;
  const g2 = five.teams.find((t) => t.id === "g2")!;
  check(S, "1 · equipo con una carta por jugador: NO completo", g2.owned === EXPECT.g2.five && g2.total === EXPECT.g2.total && g2.state === "IN_PROGRESS" && !g2.complete, g2);
  const d = (await api("/api/game/team-collections?team=g2", "tcfive")).json as { cards: { id: string; playerId: string; owned: boolean; copies: number }[]; owned: number; total: number };
  const perPlayer = new Map<string, number>(); for (const c of d.cards) perPlayer.set(c.playerId, (perPlayer.get(c.playerId) ?? 0) + 1);
  check(S, "2 · varias ediciones de un jugador: cada una es una carta de la colección", [...perPlayer.values()].some((n) => n >= 3) && d.cards.length === EXPECT.g2.total && new Set(d.cards.map((c) => c.id)).size === d.cards.length, { cartas: d.cards.length, porJugador: [...perPlayer.values()] });
  check(S, "3 · copias repetidas no completan otras ediciones", d.owned === EXPECT.g2.five && d.cards.filter((c) => c.owned).every((c) => c.copies === EXPECT.g2.copiesEach) && d.cards.filter((c) => !c.owned).every((c) => c.copies === 0), { tienes: d.owned });

  // ── Recompensa de la primera compleción: 300 XP de temporada, desde el servidor, una vez ──
  const R = "API · XP";
  check(R, "leer no concede nada: avisa de que hay algo que guardar", five.pending === true && five.teams.every((t) => t.firstCompletedAt === null), { pendiente: five.pending });
  const s1 = await settle("tcfive");
  const r1 = s1.json as Settle;
  check(R, "primera compleción de NAVI: +300 XP, registrada", s1.status === 200 && JSON.stringify(r1.teams) === JSON.stringify([{ id: "navi", title: "NAVI", xp: XP, first: true }]) && r1.xpGained === XP && r1.regions.length === 0 && r1.view.pending === false, { equipos: r1.teams, xp: r1.xpGained });
  check(R, "G2 incompleto (una carta por jugador, con copias): sin XP ni compleción", !r1.teams.some((t) => t.id === "g2") && r1.view.teams.find((t) => t.id === "g2")!.firstCompletedAt === null);
  const navi = r1.view.teams.find((t) => t.id === "navi")!;
  check(R, "la compleción queda guardada con su fecha y sus XP", !!navi.firstCompletedAt && navi.xpAwarded === XP, { desde: navi.firstCompletedAt, xp: navi.xpAwarded });
  const again = await Promise.all(Array.from({ length: 12 }, () => settle("tcfive")));
  check(R, "12 peticiones simultáneas después: ninguna concede nada", again.every((x) => x.status === 200 || x.status === 429) && again.filter((x) => x.status === 200).every((x) => (x.json as Settle).xpGained === 0 && (x.json as Settle).teams.length === 0), again.map((x) => x.status));
  // Varias liquidaciones a la vez de una cuenta con mucho que cobrar. tcchina: sus equipos completos y la insignia de China.
  const expChina = EXPECT.accounts.tcchina.view;
  const burst = await Promise.all(Array.from({ length: 8 }, () => settle("tcchina")));
  const okBurst = burst.filter((x) => x.status === 200).map((x) => x.json as Settle);
  check(R, "tcchina · 8 liquidaciones simultáneas: XP = equipos completos × 300, una sola vez", okBurst.length > 0 && okBurst.reduce((n, x) => n + x.xpGained, 0) === expChina.totals.teamsCompleted * XP && okBurst.reduce((n, x) => n + x.teams.filter((t) => t.first).length, 0) === expChina.totals.teamsCompleted, { xp: okBurst.reduce((n, x) => n + x.xpGained, 0), esperado: expChina.totals.teamsCompleted * XP, estados: burst.map((x) => x.status) });
  const lastChina = (await api("/api/game/team-collections", "tcchina")).json as View;
  check("API · insignias", "8 · EMEA a falta de UNA carta: bloqueada y sin guardar", okBurst.every((x) => !x.regions.includes("EMEA")) && (() => { const b = lastChina.regions.find((r) => r.region === "EMEA")!; return !b.unlocked && !b.permanent && b.total - b.owned === 1; })());
  check("API · insignias", "9 · China completa: desbloqueada una vez y guardada", okBurst.reduce((n, x) => n + x.regions.filter((r) => r === "China").length, 0) === 1 && (() => { const b = lastChina.regions.find((r) => r.region === "China")!; return b.unlocked && b.permanent && !!b.unlockedAt; })());
  const empty = await settle("tcempty");
  check(R, "cuenta sin cartas: nada que liquidar, nada concedido", empty.status === 200 && (empty.json as Settle).xpGained === 0 && (empty.json as Settle).teams.length === 0 && (empty.json as Settle).regions.length === 0 && (empty.json as Settle).view.teams.every((t) => t.firstCompletedAt === null));
  check(R, "una cuenta no ve las compleciones de otra", ((await api("/api/game/team-collections?team=navi", "tcempty")).json as Tile).firstCompletedAt === null && ((await api("/api/game/team-collections?team=navi", "tcchina")).json as Tile).firstCompletedAt === null);

  // ── Sesión, parámetros y cuerpo ──
  const X = "API · seguridad";
  check(X, "sin sesión → 401 (leer, detalle y liquidar)", (await api("/api/game/team-collections")).status === 401 && (await api("/api/game/team-collections?team=g2")).status === 401 && (await post("/api/game/team-collections", undefined, { action: "settle" })).status === 401);
  check(X, "token falso → 401", (await api("/api/game/team-collections", "raw:eyJhbGciOiJIUzI1NiJ9.e30.falso")).status === 401 && (await post("/api/game/team-collections", "raw:eyJhbGciOiJIUzI1NiJ9.e30.falso", { action: "settle" })).status === 401);
  check(X, "parámetro desconocido → 400", (await api("/api/game/team-collections?user=x", "tcfive")).status === 400 && (await post("/api/game/team-collections?team=navi", "tcfive", { action: "settle" })).status === 400);
  check(X, "equipo repetido, inexistente o no válido", (await api("/api/game/team-collections?team=g2&team=navi", "tcfive")).status === 400 && (await api("/api/game/team-collections?team=no-existe", "tcfive")).status === 404 && (await api("/api/game/team-collections?team=..%2Fx", "tcfive")).status === 400);
  // El cliente no puede decir QUÉ ha completado ni PARA QUIÉN: cualquier campo de más se rechaza.
  const others: [string, unknown][] = [["otro usuario", { action: "settle", userId: (await session("tcall")).id }], ["equipo elegido por el cliente", { action: "settle", team: "g2" }], ["XP elegidos por el cliente", { action: "settle", xp: 99999 }], ["otra acción", { action: "grant" }], ["sin acción", {}], ["lista", [{ action: "settle" }]], ["no JSON", "settle"], ["cuerpo enorme", { action: "settle", x: "y".repeat(500) }]];
  for (const [name, body] of others) {
    const r = await post("/api/game/team-collections", "tcfive", body);
    check(X, `cuerpo rechazado · ${name}`, r.status === 400, r.status);
  }
  for (const method of ["PUT", "PATCH", "DELETE"]) { const r = await api("/api/game/team-collections", "tcfive", { method, body: method === "DELETE" ? undefined : "{}", headers: { "content-type": "application/json" } }); check(X, `${method} no existe`, r.status === 405, r.status); }
  const after = (await api("/api/game/team-collections", "tcfive")).json as View;
  check(X, "tras todo lo anterior: mismo progreso, una sola compleción cobrada, nada pendiente", JSON.stringify(slim(after)) === JSON.stringify(slim(five)) && after.pending === false && after.teams.filter((t) => t.xpAwarded !== null).length === 1);
  const stFive = await api("/api/game/state", "tcfive");
  check(X, "el inventario no ha cambiado", stFive.json?.ownedTotal === EXPECT.accounts.tcfive.copies, { copias: stFive.json?.ownedTotal, créditos: stFive.json?.credits });
  // Destacar en el perfil: solo insignias desbloqueadas.
  const prof = (await api("/api/game/player?me=1", "tcchina")).json as { self?: { version: number; ownedBadges: { id: string; kind: string }[] } };
  check("API · perfil", "la insignia de China aparece entre las que se pueden destacar; las bloqueadas no", !!prof.self && prof.self.ownedBadges.some((b) => b.id === "insignia:regional:china" && b.kind === "REGION") && !prof.self.ownedBadges.some((b) => b.id === "insignia:regional:emea"), prof.self?.ownedBadges.map((b) => b.id));
  const locked = await post("/api/game/player", "tcchina", { action: "set_featured_badges", badgeIds: ["insignia:regional:emea"], expectedVersion: prof.self?.version ?? null });
  check("API · perfil", "destacar una insignia BLOQUEADA se rechaza en el servidor", locked.status >= 400 && locked.status < 500, { status: locked.status, code: locked.json?.code });
  const foreign = await post("/api/game/player", "tcempty", { action: "set_featured_badges", badgeIds: ["insignia:regional:china"], expectedVersion: null });
  check("API · perfil", "destacar la insignia de OTRA cuenta se rechaza", foreign.status >= 400 && foreign.status < 500, { status: foreign.status, code: foreign.json?.code });

  for (const big of ["50000", "60000"]) {
    try {
      const times: number[] = []; let last: Awaited<ReturnType<typeof api>> | null = null;
      for (let i = 0; i < 5; i++) { last = await api("/api/game/team-collections", big); times.push(last.ms); }
      const t0 = Date.now(); const s = await settle(big); const took = Date.now() - t0;
      check(S, `cuenta de ${big} cartas · lectura ligera y liquidación rápida`, last!.status === 200 && last!.bytes < 25_000 && Math.min(...times) < 1500 && s.status === 200 && took < 3000, { ms: times, bytes: last!.bytes, liquidar: `${took} ms`, xp: (s.json as Settle)?.xpGained, equipos: last!.json?.totals });
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
  const clipped = [...document.querySelectorAll('[data-testid="region-badge"] h3, [data-testid="region-status"], [data-testid="region-since"], [data-testid="more-teams"], [data-testid^="stat-"] p, #sets-title, #regions-title')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.slice(0, 40));
  return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, clipped,
    keys: lines.filter((l) => /^[a-z]+(\\.[a-zA-Z0-9_]+){1,}$/.test(l) || /\\{[a-zA-Z_]+\\}/.test(l) || /\\{n, plural/.test(l)).slice(0, 6) };
})()`;
const ROOM = `(() => ({
  h1: document.querySelector('[data-testid="trophy-room"] h1')?.textContent ?? '',
  tiles: [...document.querySelectorAll('[data-testid="set-tile"]')].map((a) => ({ id: a.getAttribute('data-set'), state: a.getAttribute('data-state'), progress: a.querySelector('[data-testid="set-progress"]')?.textContent ?? '' })),
  more: document.querySelector('[data-testid="more-teams"]')?.textContent ?? null,
  count: document.querySelector('[data-testid="teams-count"]')?.textContent ?? null,
  badges: [...document.querySelectorAll('[data-testid="region-badge"]')].map((li) => ({ region: li.getAttribute('data-region'), unlocked: li.getAttribute('data-unlocked') === '1', permanent: li.getAttribute('data-permanent') === '1', progress: li.querySelector('[data-testid="region-progress"]')?.textContent ?? '', since: !!li.querySelector('[data-testid="region-since"]') })),
  h2: [...document.querySelectorAll('[data-testid="trophy-room"] h2')].map((h) => h.textContent),
  old: ['badges-unlocked', 'badges-locked', 'badges-empty', 'recent-completions', 'claimable-banner', 'claim-badge'].filter((t) => document.querySelector('[data-testid="' + t + '"]')),
  sections: document.querySelectorAll('[data-testid="trophy-room"] > section').length,
  feature: !!document.querySelector('[data-testid="feature-badges-link"]'),
  api: performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname + new URL(r.name).search).filter((p) => p.startsWith('/api/game/')),
}))()`;
type Room = { h1: string; tiles: { id: string; state: string; progress: string }[]; more: string | null; count: string | null; badges: { region: string; unlocked: boolean; permanent: boolean; progress: string; since: boolean }[]; h2: string[]; old: string[]; sections: number; feature: boolean; api: string[] };
const typeInto = (sel: string, value: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;

async function open(locale: string, width: number, label: string) {
  const b = await launch({ args });
  const tab = b.tab;
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(NAV[locale])} }); Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(NAV[locale][0])} });` });
  await tab.resize(width, width < 600 ? 844 : 900, 1);
  await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, `!!document.querySelector('input[type="password"]')`, 30000);
  await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), ${JSON.stringify(emailOf(label))}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(PW)}); document.querySelector('form button[type="submit"]').click(); })()`);
  const inside = await waitFor(tab, `!document.querySelector('input[type="password"]')`, 30000);
  await sleep(2000); tab.takeErrors();
  return { b, tab, inside };
}

async function browser(locale: string, width: number, label: string, deep: boolean) {
  const S = `${locale} · ${width} · ${label}`;
  const { b, tab, inside } = await open(locale, width, label);
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  try {
    check(S, "inicio de sesión", inside);
    const clean = async (name: string) => {
      const p = await tab.js<{ lang: string; overflow: number; keys: string[]; clipped: string[] }>(PROBE);
      const errors = tab.takeErrors().filter(noise);
      await tab.shot(join(dir, `${label}-${name}.png`)).catch(() => null);
      check(S, `${name} · idioma, sin desborde, sin textos cortados, sin claves, sin errores`, p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && p.clipped.length === 0 && errors.length === 0, { ...p, errors: errors.slice(0, 2) });
    };

    await tab.goto(`${BASE}/coleccion/trofeos`, 1200);
    check(S, "Colecciones carga", await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]') || !!document.querySelector('[data-testid="trophy-empty"]')`, 40000));
    await sleep(2500); // deja terminar la liquidación automática, si la hay
    const truth = (await api("/api/game/team-collections", label)).json as View;
    let room = await tab.js<Room>(ROOM);
    check(S, "8 · título «Colecciones» y apartado «Equipos»", room.h1 === TITLE[locale] && room.h2[0] === TEAMS_H2[locale], { h1: room.h1, h2: room.h2 });
    check(S, "5 · carga inicial: exactamente 3 equipos", room.tiles.length === 3 && room.count !== null && room.count.includes("3") && room.count.includes(String(truth.teams.length)), { equipos: room.tiles.map((t) => t.id), recuento: room.count });
    check(S, "botón «Ver más equipos» traducido", room.more === MORE[locale], room.more);
    check(S, "11 · sin bloque antiguo: solo Equipos e Insignias regionales", room.old.length === 0 && room.h2.length === 2 && room.h2[1] === REGIONAL[locale] && room.sections === 3, { h2: room.h2, antiguos: room.old });
    check(S, "insignias regionales: las cuatro, en orden, con estado, permanencia y progreso del servidor", room.badges.length === 4 && room.badges.every((x, i) => x.region === truth.regions[i].region && x.unlocked === truth.regions[i].unlocked && x.permanent === truth.regions[i].permanent && x.since === truth.regions[i].permanent && x.progress === `${truth.regions[i].owned}/${truth.regions[i].total}`), room.badges);
    check(S, "enlace para destacarlas en el perfil solo si hay alguna guardada", room.feature === truth.regions.some((r) => r.permanent), room.feature);
    check(S, "nada pendiente tras entrar: lo que había que guardar se ha guardado", truth.pending === false, { pendiente: truth.pending });
    const reads = room.api.filter((p) => p === "/api/game/team-collections").length;
    check(S, "carga eficiente: sin lecturas del inventario, la Maestría, el Prestigio ni los sets", reads >= 1 && reads <= 3 && !room.api.some((p) => /\/api\/game\/(cards|mastery|prestige|collection-sets)/.test(p)), { lecturas: reads });
    for (const t of room.tiles) { const s = truth.teams.find((x) => x.id === t.id); if (!s || t.progress !== `${s.owned}/${s.total}` || t.state !== s.state) check(S, `tarjeta ${t.id} = servidor`, false, { pantalla: t, servidor: s }); }
    await clean("colecciones");
    await tab.js(`document.querySelector('#regions-title').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90)`); await sleep(500);
    await tab.shot(join(dir, `${label}-insignias.png`)).catch(() => null);
    await tab.js(`window.scrollTo(0, 0)`);

    const steps = [room.tiles.length];
    for (let i = 0; i < 20 && room.more !== null; i++) {
      await tab.js(`document.querySelector('[data-testid="more-teams"]').click()`); await sleep(350);
      room = await tab.js<Room>(ROOM); steps.push(room.tiles.length);
    }
    const total = truth.teams.length;
    const expected: number[] = []; for (let n = Math.min(3, total); ; n = Math.min(total, n + 6)) { expected.push(n); if (n === total) break; }
    check(S, "6 · «Ver más equipos» añade seis cada vez", JSON.stringify(steps) === JSON.stringify(expected), { pasos: steps });
    check(S, "7 · acaban saliendo todos, sin repetir, y el botón desaparece", room.tiles.length === total && new Set(room.tiles.map((t) => t.id)).size === total && room.more === null && truth.teams.every((t) => room.tiles.some((x) => x.id === t.id && x.progress === `${t.owned}/${t.total}` && x.state === t.state)), { equipos: room.tiles.length, total });
    check(S, "sin más lecturas al pulsar", room.api.filter((p) => p === "/api/game/team-collections").length === reads);
    await clean("colecciones-todas");

    if (deep) {
      await tab.js(typeInto('[data-testid="trophy-search"]', "navi")); await sleep(400);
      room = await tab.js<Room>(ROOM);
      check(S, "buscar un equipo", room.tiles.length === 1 && room.tiles[0].id === "navi" && room.more === null, room.tiles);
      await tab.js(typeInto('[data-testid="trophy-search"]', "")); await sleep(400);
      check(S, "al cambiar la búsqueda se vuelve a empezar por tres", (await tab.js<Room>(ROOM)).tiles.length === Math.min(3, total));

      await tab.goto(`${BASE}/coleccion/trofeos/g2`, 1200);
      check(S, "detalle de G2 carga", await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 40000));
      await sleep(1500);
      const det = await tab.js<{ reqs: number; ok: number; progress: string; copies: number; state: string; claim: boolean; reward: boolean }>(`(() => ({ reqs: document.querySelectorAll('[data-testid="requirement"]').length, ok: document.querySelectorAll('[data-testid="requirement"][data-satisfied="1"]').length, progress: document.querySelector('[data-testid="set-progress"]')?.textContent ?? '', copies: document.querySelectorAll('[data-testid="copies"]').length, state: document.querySelector('[data-testid="set-detail"]').getAttribute('data-state'), claim: !!document.querySelector('[data-testid="claim-badge"]'), reward: !!document.querySelector('[data-testid="first-completion-reward"]') }))()`);
      const g2 = truth.teams.find((t) => t.id === "g2")!;
      check(S, "detalle: todas las cartas, las tuyas marcadas, copias anotadas, recompensa anunciada y nada que reclamar", det.reqs === g2.total && det.ok === g2.owned && det.progress === `${g2.owned}/${g2.total}` && det.state === g2.state && !det.claim && det.reward && det.copies === g2.owned, det);
      await clean("detalle-g2");
      await tab.goto(`${BASE}/coleccion/trofeos/navi`, 1200); await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 30000); await sleep(1200);
      check(S, "detalle de un equipo ya completado: primera compleción y sus 300 XP", (await tab.js<string>(`document.querySelector('[data-testid="first-completion"]')?.getAttribute('data-xp') ?? ''`)) === String(XP));
      await clean("detalle-navi-completado");
      await tab.goto(`${BASE}/coleccion/trofeos/team-g2-v1`, 1200);
      check(S, "un enlace antiguo de set lleva al mismo equipo", await waitFor(tab, `document.querySelector('[data-testid="set-detail"]')?.getAttribute('data-set') === 'g2'`, 30000));
      await tab.goto(`${BASE}/coleccion/trofeos/no-existe`, 1200);
      check(S, "equipo inexistente: mensaje, no pantalla rota", await waitFor(tab, `!document.querySelector('[data-testid="set-detail"]') && document.body.innerText.length > 20 && !/Application error/i.test(document.body.innerText)`, 30000));
      tab.takeErrors();
      await tab.goto(`${BASE}/coleccion/trofeos/paper-rex`, 1200); await waitFor(tab, `!!document.querySelector('[data-testid="set-detail"]')`, 30000); await sleep(1200);
      await clean("detalle-sin-logo");
      // Prestigio retirado: /cuenta sin vitrina ni controles, y sin pedir nada a su ruta.
      await tab.goto(`${BASE}/cuenta`, 1200); await waitFor(tab, SETTLED, 40000); await sleep(2200);
      const acct = await tab.js<{ text: boolean; api: boolean }>(`(() => ({ text: /prestigio|prestige|prestígio|プレステージ/i.test(document.body.innerText), api: performance.getEntriesByType('resource').some((r) => /\\/api\\/game\\/(prestige|mastery)/.test(r.name)) }))()`);
      check(S, "2 · Prestigio retirado de la cuenta: ni texto, ni controles, ni llamadas", !acct.text && !acct.api, acct);
      await clean("cuenta");
      for (const [path, name] of [["/coleccion", "album"], ["/", "portada"]] as const) { await tab.goto(`${BASE}${path}`, 1200); await waitFor(tab, SETTLED, 40000); await sleep(1800); await clean(name); }
    }
  } catch (e) {
    check(S, "EJECUCIÓN", false, String(e));
  } finally { await b.close(); }
}

/** La primera visita de una cuenta que ya lo tiene todo: se liquida sola, una vez, y se avisa. */
async function autoSettle(locale: string, width: number) {
  const S = `${locale} · ${width} · tcall · primera visita`;
  const first = (await api("/api/game/team-collections", "tcall")).json as View;
  const { b, tab } = await open(locale, width, "tcall");
  try {
    check(S, "antes de entrar: todo pendiente de guardar", first.pending === true && first.regions.every((r) => r.unlocked && !r.permanent) && first.teams.every((t) => t.firstCompletedAt === null));
    await tab.goto(`${BASE}/coleccion/trofeos`, 600);
    const xp = EXPECT.teams * XP;
    const toast = await waitFor(tab, `[...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].some((el) => (el.textContent ?? '').replace(/[^0-9]/g, '').includes('${xp}'))`, 30000);
    await tab.shot(join(OUT, `${locale}-${width}-tcall-aviso.png`)).catch(() => null);
    check(S, "aviso de la recompensa con los XP ganados", toast, { xp });
    await sleep(1500);
    const room = await tab.js<Room>(ROOM);
    check(S, "las cuatro insignias quedan guardadas (permanentes) sin tocar nada", room.badges.length === 4 && room.badges.every((x) => x.unlocked && x.permanent && x.since) && room.feature, room.badges);
    const after = (await api("/api/game/team-collections", "tcall")).json as View;
    check(S, "servidor: todas las compleciones con sus XP y nada pendiente", after.pending === false && after.teams.every((t) => t.firstCompletedAt !== null && t.xpAwarded === XP), { pendiente: after.pending, conXp: after.teams.filter((t) => t.xpAwarded === XP).length });
    for (let i = 0; i < 3; i++) { await tab.goto(`${BASE}/coleccion/trofeos`, 800); await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]')`, 30000); await sleep(1200); }
    const again = await settle("tcall");
    check(S, "recargar no vuelve a conceder", (again.json as Settle).xpGained === 0 && (again.json as Settle).teams.length === 0 && (again.json as Settle).regions.length === 0);
    const errors = tab.takeErrors().filter(noise);
    check(S, "sin errores de consola", errors.length === 0, errors.slice(0, 2));
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close(); }
}

/** Destacar una insignia regional con el editor REAL y verla en el perfil propio y en el ajeno. */
async function profileFlow(locale: string, width: number) {
  const S = `${locale} · ${width} · perfil`;
  const owner = await session("tcchina");
  const dir = join(OUT, `${locale}-${width}`); mkdirSync(dir, { recursive: true });
  const { b, tab } = await open(locale, width, "tcchina");
  try {
    await tab.goto(`${BASE}/jugador/me?editar=insignias`, 1200);
    check(S, "el editor se abre en la pestaña de insignias", await waitFor(tab, `!!document.querySelector('[data-testid="editor-badges"]')`, 40000));
    await sleep(800);
    const options = await tab.js<string[]>(`[...document.querySelectorAll('[data-badge-option]')].map((x) => x.getAttribute('data-badge-option'))`);
    check(S, "ofrece la insignia de China y no ofrece ninguna bloqueada", options.includes("insignia:regional:china") && !options.some((o) => /regional:(americas|emea|pacific)/.test(o)), options);
    await tab.shot(join(dir, "perfil-editor-insignias.png")).catch(() => null);
    const already = await tab.js<boolean>(`document.querySelector('[data-badge-option="insignia:regional:china"]')?.getAttribute('aria-pressed') === 'true'`);
    if (!already) {
      await tab.js(`document.querySelector('[data-badge-option="insignia:regional:china"]').click()`); await sleep(300);
      await tab.js(`document.querySelector('[data-testid="save-badges"]').click()`);
      await sleep(2500);
    }
    await tab.goto(`${BASE}/jugador/me`, 1200);
    check(S, "5 · la insignia de China destacada se ve en el perfil propio", await waitFor(tab, `!!document.querySelector('[data-testid="profile-badges"] [data-badge="insignia:regional:china"]')`, 30000));
    await sleep(800);
    const p = await tab.js<{ lang: string; overflow: number; keys: string[]; clipped: string[] }>(PROBE);
    const errors = tab.takeErrors().filter(noise);
    await tab.shot(join(dir, "perfil-propio.png")).catch(() => null);
    check(S, "perfil propio · idioma, sin desborde, sin claves, sin errores", p.lang === locale && p.overflow <= 1 && p.keys.length === 0 && errors.length === 0, { ...p, errors: errors.slice(0, 2) });
    check(S, "el acceso del perfil se llama «Colecciones»", (await tab.js<string>(`document.querySelector('[data-action="trophy-room"]')?.textContent ?? ''`)) === TITLE[locale]);
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close(); }
  const other = await open(locale, width, "tcempty");
  try {
    await other.tab.goto(`${BASE}/jugador/${owner.id}`, 1200);
    const seen = await waitFor(other.tab, `!!document.querySelector('[data-testid="profile-card"][data-view="PUBLIC"] [data-testid="profile-badges"] [data-badge="insignia:regional:china"]')`, 30000);
    await sleep(600); await other.tab.shot(join(dir, "perfil-ajeno.png")).catch(() => null);
    check(S, "y la ve otro jugador en el perfil público", seen);
    check(S, "el perfil público solo enseña lo destacado y no ofrece editar", (await other.tab.js<number>(`document.querySelectorAll('[data-testid="profile-badges"] [data-badge]').length`)) === 1 && !(await other.tab.js<boolean>(`!!document.querySelector('[data-action="edit"]')`)));
  } catch (e) { check(S, "EJECUCIÓN (ajeno)", false, String(e)); } finally { await other.b.close(); }
}

async function admin() {
  const email = process.env.QA_ADMIN_EMAIL, pw = process.env.QA_ADMIN_PASSWORD, S = "admin · 1440";
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
    check(S, "7 · /admin/teams: colecciones del catálogo y equipos del registro sin cartas, identificados", ok && text.includes(String(EXPECT.teams)) && text.includes(String(EXPECT.catalog)) && ["Americas", "EMEA", "Pacific", "China"].every((r) => text.includes(r)) && ["BLG", "JDG", "KRX"].every((t) => text.includes(t)) && errors.length === 0, { texto: text.replace(/\s+/g, " ").slice(0, 300), errors: errors.slice(0, 2) });
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close(); }
}

/** Tras borrar de la base las cartas de China de `tcchina`: la insignia no depende del inventario. */
async function permanence() {
  const S = "PERMANENCIA";
  const v = (await api("/api/game/team-collections", "tcchina")).json as View;
  const china = v.regions.find((r) => r.region === "China")!;
  check(S, "4 · sin una sola carta de China: progreso 0, insignia desbloqueada y permanente", china.owned === 0 && !china.completeNow && china.unlocked && china.permanent && !!china.unlockedAt && v.pending === false, china);
  check(S, "los equipos de China vuelven a «sin empezar», pero conservan su primera compleción y sus XP", v.teams.filter((t) => t.region === "China").every((t) => t.state === "LOCKED" && t.firstCompletedAt !== null && t.xpAwarded === XP));
  const s = await settle("tcchina");
  check(S, "liquidar otra vez no quita ni concede nada", s.status === 200 && (s.json as Settle).xpGained === 0 && (s.json as Settle).regions.length === 0 && (s.json as Settle).view.regions.find((r) => r.region === "China")!.permanent);
  const prof = (await api("/api/game/player?me=1", "tcchina")).json as { self?: { ownedBadges: { id: string }[] }; badges?: { id: string }[] };
  check(S, "sigue siendo destacable y destacada en el perfil", !!prof.self?.ownedBadges.some((x) => x.id === "insignia:regional:china") && !!prof.badges?.some((x) => x.id === "insignia:regional:china"), { destacadas: prof.badges?.map((x) => x.id) });
  const { b, tab } = await open("es", 1440, "tcchina");
  try {
    await tab.goto(`${BASE}/coleccion/trofeos`, 1200); await waitFor(tab, `!!document.querySelector('[data-testid="set-grid"]')`, 40000); await sleep(2000);
    const room = await tab.js<Room>(ROOM);
    const badge = room.badges.find((x) => x.region === "China")!;
    await tab.js(`document.querySelector('#regions-title').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90)`); await sleep(500);
    await tab.shot(join(OUT, "permanencia-china-sin-cartas.png")).catch(() => null);
    check(S, "pantalla: China desbloqueada con 0 cartas y su fecha", badge.unlocked && badge.permanent && badge.since && badge.progress.startsWith("0/"), badge);
    await tab.goto(`${BASE}/jugador/me`, 1200);
    check(S, "perfil: la insignia sigue destacada", await waitFor(tab, `!!document.querySelector('[data-testid="profile-badges"] [data-badge="insignia:regional:china"]')`, 30000));
    await sleep(600); await tab.shot(join(OUT, "permanencia-perfil.png")).catch(() => null);
  } catch (e) { check(S, "EJECUCIÓN", false, String(e)); } finally { await b.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (PHASE === "perm") await permanence();
  else {
    await apiChecks();
    await autoSettle(LOCS[0], 1440);
    await admin();
    for (const l of LOCS) for (const w of [390, 1440]) {
      await browser(l, w, "tcfive", true);
      await profileFlow(l, w);
      if (l === "es" || l === "ja" || l === "de") { await browser(l, w, "tcchina", false); await browser(l, w, "tcall", false); await browser(l, w, "tcempty", false); }
    }
  }
  writeFileSync(join(OUT, `team-collections-ui-${PHASE}.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), fase: PHASE, rows }, null, 1));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`RESULTADO · ${BASE} · ${PHASE} · ${rows.length - bad} PASS · ${bad} FAIL`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
