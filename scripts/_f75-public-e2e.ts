// F75 · copia de _vr-public-e2e.ts con salida propia (instrumento, fuera de CI).
/**
 * valorosters.com · E2E PÚBLICO REAL (fuera de CI): Chrome real → https://valorosters.com (Cloudflare → túnel → Next).
 * Cuenta QA NUEVA registrada por el formulario (nunca la del usuario). Sin intercepción: la red solo se OBSERVA.
 *   BASE_URL=https://valorosters.com npx tsx scripts/_vr-public-e2e.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PERSONA_FILES, openBrowser, registerUi, loginUi, logoutUi, goto, sleep, type Client } from "./_fase68-lib";
import { dbRead } from "./_f73c-lib";

const BASE = process.env.BASE_URL ?? "";
if (!/^https:\/\/valorosters\.com$/.test(BASE)) { console.error("BASE_URL=https://valorosters.com obligatorio"); process.exit(2); }
PERSONA_FILES.V = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/4acbcb97-c0e3-47d2-977a-bc609c8c7c45/scratchpad/f75-qa-V.json";
const OUT = join(process.cwd(), "docs/product/qa/f75-vps-migration");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const results: { id: string; ok: boolean; detail: string }[] = [];
const extra: Record<string, unknown> = {};
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: String(detail).slice(0, 900) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 260)}`); return ok; };
const js = <T = any>(c: Client, e: string) => c.tab.js<T>(e);
const J = JSON.stringify;

/** Observa TODA la red del navegador: host de cada petición, fallos y respuestas ≥ 400. */
function watch(c: Client) {
  const net = { hosts: {} as Record<string, number>, localhost: [] as string[], failed: [] as string[], bad: [] as string[], mixed: [] as string[] };
  c.tab.on("Network.requestWillBeSent", (p: any) => {
    const u = String(p.request?.url ?? ""); if (!/^https?:/.test(u)) return;
    const h = new URL(u).host; net.hosts[h] = (net.hosts[h] ?? 0) + 1;
    if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(h)) net.localhost.push(u.slice(0, 120));
    if (u.startsWith("http://")) net.mixed.push(u.slice(0, 120));
  });
  const urls = new Map<string, string>();
  c.tab.on("Network.requestWillBeSent", (p: any) => urls.set(p.requestId, String(p.request?.url ?? "")));
  c.tab.on("Network.loadingFailed", (p: any) => { if (!p.canceled && !/ERR_ABORTED/.test(p.errorText ?? "")) net.failed.push(`${p.errorText} ${(urls.get(p.requestId) ?? "").slice(0, 110)}`); });
  c.tab.on("Network.responseReceived", (p: any) => { const s = p.response?.status ?? 0; const u = String(p.response?.url ?? ""); if (s >= 400 && !/\/api\/admin\//.test(u)) net.bad.push(`${s} ${u.slice(0, 110)}`); });
  return net;
}
const PAGES = ["/", "/coleccion", "/duelos/mazos", "/tienda", "/temporada", "/mundo", "/jugar", "/duelos", "/misiones", "/misiones/crafting", "/progresion", "/cuenta"];

async function main() {
  const defaults = dbRead<any>(`select json_build_object('credits', (select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='credits'), 'xp', (select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='xp'))::text`);
  extra.officialDefaults = defaults;

  // ── Registro REAL por /cuenta en el dominio público.
  const c = await openBrowser("V", 1440, { label: "vr" });
  await c.tab.send("Network.enable", {});
  const net = watch(c);
  let userId = "";
  try {
    const cr = await registerUi(c, "V");
    userId = cr.userId;
    check("REGISTRO público por el formulario → sesión con usuario nuevo", !!userId, `user=${userId.slice(0, 8)} username=${cr.username}`);
    const storageKey = await js<string | null>(c, `Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)) ?? null`);
    check("SESIÓN · supabase-js guarda la sesión con la clave del dominio público", storageKey === "sb-valorosters-auth-token", String(storageKey));
    const me = await js<any>(c, `(async () => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); const t = JSON.parse(localStorage.getItem(k)).access_token; const r = await fetch('/api/game/me', { headers: { authorization: 'Bearer ' + t } }); return { status: r.status, body: await r.json() }; })()`);
    check("API /api/game/me con la sesión pública → 200", me.status === 200, J(me.body).slice(0, 200));
    // Estado inicial OFICIAL (nada especial).
    const st = dbRead<any>(`select json_build_object('is_admin', p.is_admin, 'credits', p.credits, 'xp', p.xp, 'points', p.points, 'level', p.level, 'cards', (select count(*) from public.user_cards where user_id = p.id), 'packs', (select coalesce(json_object_agg(pack_id, qty), '{}'::json) from public.user_packs where user_id = p.id and qty > 0), 'ops', (select coalesce(json_agg(kind), '[]'::json) from public.economy_ops where user_id = p.id), 'missions', (select count(*) from public.user_mission_progress where user_id = p.id), 'app_meta', (select raw_app_meta_data from auth.users where id = p.id)) from public.profiles p where p.id = '${userId}'`);
    extra.newUser = st;
    check("USUARIO NUEVO · is_admin = false", st?.is_admin === false, J({ is_admin: st?.is_admin }));
    check("USUARIO NUEVO · saldo = el valor por defecto oficial de la BD, 0 cartas, 0 misiones, sin operaciones previas", String(st?.credits) === String(defaults.credits).replace(/[^0-9]/g, "") && st?.cards === 0 && st?.missions === 0 && (st?.ops ?? []).length === 0, J(st));
    const appMeta = st?.app_meta ?? {};
    check("USUARIO NUEVO · sin flags de rol/QA en app_metadata", !("is_admin" in appMeta) && !("role" in appMeta && appMeta.role !== "authenticated") && !Object.keys(appMeta).some((k) => /qa|admin/i.test(k)), J(appMeta));
    // Admin denegado.
    await goto(c, "/admin", 3500); await sleep(1500);
    const adminDenied = await js<boolean>(c, `/Acceso restringido|solo para administradores/i.test(document.body.innerText) && !document.querySelector('[role="tablist"]')`);
    await c.tab.shot(join(SHOTS, "admin-usuario-normal-1440.png")).catch(() => null);
    check("USUARIO NUEVO · /admin → acceso restringido", adminDenied);
    const adminApis = await js<any>(c, `(async () => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); const t = JSON.parse(localStorage.getItem(k)).access_token; const out = {}; for (const p of ['/api/admin/users', '/api/admin/dashboard', '/api/admin/cms/crafting', '/api/admin/system']) { const r = await fetch(p, { headers: { authorization: 'Bearer ' + t } }); out[p] = r.status; } const w = await fetch('/api/admin/cms/crafting', { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'saveRecipe', id: 'pack-estandar-premium', patch: { inputQty: 2 }, expectedVersion: 1 }) }); out['POST saveRecipe'] = w.status; return out; })()`);
    check("USUARIO NUEVO · APIs admin → 401 (sin oráculo)", Object.values(adminApis).every((s) => s === 401), J(adminApis));
    // F5 mantiene la sesión.
    await goto(c, "/coleccion", 2500);
    await c.tab.send("Page.reload", {}); await sleep(3000);
    const after = await js<any>(c, `(async () => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); if (!k) return null; const t = JSON.parse(localStorage.getItem(k)).access_token; const r = await fetch('/api/game/me', { headers: { authorization: 'Bearer ' + t } }); return r.status; })()`);
    check("F5 · la sesión sigue (me → 200)", after === 200, String(after));
    // Logout → sin sesión → login de nuevo.
    const lo = await logoutUi(c);
    const gone = await js<boolean>(c, `!Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))`);
    check("LOGOUT · sesión cerrada de verdad (sin token, con formulario)", lo && gone);
    const li = await loginUi(c, "V");
    const back = await js<boolean>(c, `!!Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))`);
    check("LOGIN de nuevo por el formulario público", li && back);
    const errs = c.tab.takeErrors();
    extra.authNet = net; extra.authConsole = errs.slice(0, 10);
  } finally { await c.browser.close(); }

  // ── Recorrido responsive público con la cuenta nueva.
  for (const width of [1440, 1024, 390]) {
    const b = await openBrowser("V", width, { label: "vr", reduced: width === 390 });
    await b.tab.send("Network.enable", {});
    const n = watch(b);
    const local: { page: string; ok: boolean; detail: string }[] = [];
    try {
      await loginUi(b, "V");
      for (const p of PAGES) {
        await goto(b, p, 2500); await sleep(1200);
        const info = await js<any>(b, `({ path: location.pathname, noScroll: document.scrollingElement.scrollWidth <= innerWidth + 1, broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src).map(i => i.currentSrc || i.src).slice(0, 5), imgs: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length, offline: /sin conexión|offline/i.test(document.title), text: (document.querySelector('main') || document.body).innerText.length })`);
        const ok = info.path === p && info.noScroll && info.broken.length === 0 && !info.offline && info.text > 40;
        local.push({ page: p, ok, detail: J(info) });
        if (["/", "/coleccion", "/tienda", "/jugar", "/misiones/crafting"].includes(p)) await b.tab.shot(join(SHOTS, `${p === "/" ? "inicio" : p.slice(1).replace(/\//g, "-")}-${width}.png`)).catch(() => null);
      }
      const errs = b.tab.takeErrors();
      const failedOk = n.failed.filter((f) => !/telemetry/.test(f));
      check(`[${width}] ${PAGES.length} páginas cargan en el dominio público (ruta correcta, sin scroll horizontal, 0 imágenes rotas)`, local.every((x) => x.ok), J(local.filter((x) => !x.ok)));
      check(`[${width}] 0 peticiones del navegador a localhost / 127.0.0.1`, n.localhost.length === 0, J(n.localhost.slice(0, 5)));
      check(`[${width}] 0 contenido mixto (http://)`, n.mixed.length === 0, J(n.mixed.slice(0, 5)));
      check(`[${width}] 0 Failed to fetch / peticiones fallidas`, failedOk.length === 0, J(failedOk.slice(0, 5)));
      check(`[${width}] 0 errores de consola`, errs.length === 0, J(errs.slice(0, 5)));
      check(`[${width}] 0 respuestas ≥ 400 inesperadas`, n.bad.length === 0, J(n.bad.slice(0, 6)));
      writeFileSync(join(OUT, `responsive-${width}.json`), JSON.stringify({ at: new Date().toISOString(), url: BASE, width, reducedMotion: width === 390, account: "QA nueva (registrada en el dominio)", pages: local, hosts: n.hosts, localhost: n.localhost, mixed: n.mixed, failed: n.failed, bad: n.bad, console: errs.slice(0, 10) }, null, 2));
    } finally { await b.browser.close(); }
  }
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, "public-url.json"), JSON.stringify({ at: new Date().toISOString(), url: BASE, qaAccount: { userId: userId.slice(0, 8), note: "cuenta QA nueva registrada por el formulario público; credenciales solo en el scratchpad local" }, pass, fail: results.length - pass, results, ...extra }, null, 2));
  console.log(`→ public-url.json ${pass}/${results.length}`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(3); });
