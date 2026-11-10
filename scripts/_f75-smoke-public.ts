/**
 * F67 · `npm run smoke:production` — humo reproducible de una release. SOLO LECTURA salvo intentos que DEBEN fallar
 * (escalada de privilegios) y, con `--xss`, un cambio de nombre de la cuenta QA que se restaura al final.
 *
 *   npm run smoke:production                 app en BASE_URL (o :3005) + cuentas QA C (actor) y B (víctima)
 *   npm run smoke:production -- --xss        + prueba de XSS renderizando el perfil público en Chrome
 *
 * Nunca usa la cuenta del usuario. Escribe docs/product/qa/f75-vps-migration/smoke.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BASE, api, login, sleep, type Who } from "./multiplayer/_f75-qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const SB = process.env.QA_SB || process.env.F75_SB || env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.QA_ANON || env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // F87 · QA_SB/QA_ANON
const rows: { group: string; id: string; ok: boolean; detail: string }[] = [];
const check = (group: string, id: string, ok: boolean, detail: string) => { rows.push({ group, id, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${group.padEnd(12)} ${id.padEnd(34)} ${detail}`); };
const LEAK = /at [\w.<>]+ \(|node_modules|\.tsx?:\d+|relation "|column "|syntax error|PGRST|violates|stack/i;
const rest = (who: Who | null, path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${who?.token ?? ANON}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });

async function main() {
  // A · Páginas (anónimo) y arneses.
  for (const p of ["/", "/jugar", "/coleccion", "/duelos/mazos", "/inventario", "/progresion", "/duelos/jugar", "/duelos/pvp", "/competitivo", "/cuenta", "/como-jugar", "/tienda", "/temporada"]) {
    const r = await fetch(BASE + p); check("pages", p, r.status === 200, String(r.status)); await sleep(150);
  }
  const ds = await fetch(`${BASE}/design-system/fase62`);
  check("pages", "/design-system (producción)", ds.status === 404, `${ds.status} (404 salvo NEXUS_QA_HARNESS=1)`);
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check("pages", "/robots.txt", /Disallow: \/\s*$/m.test(robots) || /Disallow: \//.test(robots), robots.replace(/\s+/g, " ").slice(0, 60));

  // B · Cabeceras.
  const home = await fetch(`${BASE}/`);
  const h = (k: string) => home.headers.get(k);
  check("headers", "CSP", !!h("content-security-policy")?.includes("frame-ancestors 'none'"), (h("content-security-policy") ?? "—").slice(0, 60));
  check("headers", "X-Frame-Options", h("x-frame-options") === "DENY", String(h("x-frame-options")));
  check("headers", "nosniff", h("x-content-type-options") === "nosniff", String(h("x-content-type-options")));
  check("headers", "Referrer-Policy", !!h("referrer-policy"), String(h("referrer-policy")));
  check("headers", "COOP", h("cross-origin-opener-policy") === "same-origin", String(h("cross-origin-opener-policy")));
  check("headers", "sin X-Powered-By", !h("x-powered-by"), String(h("x-powered-by")));
  check("headers", "noindex (beta cerrada)", /noindex/.test(await home.text()), "meta robots");

  // C · API anónima y salud.
  const hl = await fetch(`${BASE}/api/health`); check("api", "/api/health", hl.status === 200, String(hl.status));
  const rd = await fetch(`${BASE}/api/ready`); const rj = await rd.json(); check("api", "/api/ready", rj.status === "ready", `${rd.status} ${rj.status}`);
  check("api", "x-request-id", !!hl.headers.get("x-request-id"), String(hl.headers.get("x-request-id")));
  for (const p of ["/api/game/state", "/api/game/duels", "/api/admin/system", "/api/admin/users"]) { const r = await fetch(BASE + p); check("api", `anónimo ${p}`, r.status === 401, String(r.status)); }
  const big = await fetch(`${BASE}/api/game/packs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "a".repeat(300 * 1024) }) });
  check("api", "cuerpo de 300 KB → 413", big.status === 413, String(big.status));
  const junk = await fetch(`${BASE}/api/game/duel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{no-json" });
  const junkTxt = await junk.text(); check("api", "JSON roto sin fugas", !LEAK.test(junkTxt) && junk.status < 500, `${junk.status} ${junkTxt.slice(0, 60)}`);

  // D · Lecturas autenticadas (cuenta QA C).
  const C = await login("C"), B = await login("B");
  for (const p of ["/api/game/state", "/api/game/duels", "/api/game/collection", "/api/game/competitive", "/api/game/play-status", "/api/game/daily-loop", "/api/game/season", "/api/game/onboarding"]) {
    const r = await api(C, p); check("qa-read", p, r.status === 200 && !LEAK.test(JSON.stringify(r.json)), `${r.status} ${r.ms}ms`); await sleep(120);
  }
  const adm = await api(C, "/api/admin/system"); check("admin", "usuario normal → /api/admin/system", adm.status === 401 || adm.status === 403, String(adm.status));
  const admU = await api(C, "/api/admin/users", { action: "adjust_credits", userId: C.userId, direction: "add", amount: 99999, reason: "intento de escalada", ref: "x" });
  check("admin", "usuario normal → ajustar créditos", admU.status === 401 || admU.status === 403, String(admU.status));

  // E · Aislamiento entre usuarios directamente contra PostgREST (C intenta leer lo privado de B).
  for (const t of ["user_cards", "user_game", "user_pass", "user_packs", "credit_transactions", "economy_ops", "duel_decks", "duel_matches", "user_achievements", "game_state", "duel_pvp_queue", "duel_active_deck", "user_sanctions", "payments"]) {
    const col = t === "duel_matches" ? "user_id" : "user_id";
    const r = await rest(C, `${t}?${col}=eq.${B.userId}&select=*&limit=5`);
    const body = await r.json().catch(() => null);
    const n = Array.isArray(body) ? body.length : 0;
    check("cross-user", `C lee ${t} de B`, n === 0, `${r.status} filas=${n}`);
  }
  const prof = await rest(C, `profiles?id=eq.${B.userId}&select=*`);
  const pj = (await prof.json())?.[0] ?? {};
  check("cross-user", "perfil público de B (columnas)", !("email" in pj), `visibles: ${Object.keys(pj).join(",")}`);
  // F69 · contrato de exposición. PRE-F70 · 0058 APLICADA: ya no es informativo, es el contrato (profileExposure.ts).
  const rowsOf = async (r: Response) => { const b = await r.json().catch(() => null); return Array.isArray(b) ? b : []; };
  const priv = await rest(C, `profiles?id=eq.${B.userId}&select=credits,is_admin,last_seen_at`);
  const privRows = await rowsOf(priv);
  check("cross-user", "columnas privadas de B (credits/is_admin/last_seen_at)", !priv.ok && privRows.length === 0, `${priv.status} filas=${privRows.length}`);
  for (const col of ["xp", "equipped", "tokens"]) {
    const r = await rest(C, `profiles?id=eq.${B.userId}&select=${col}`);
    check("cross-user", `columna privada ${col} de B`, !r.ok && (await rowsOf(r)).length === 0, String(r.status));
  }
  const pub = await rest(C, `profiles?id=eq.${B.userId}&select=id,username,avatar,level,points,region`);
  const pubRow = (await rowsOf(pub))[0] ?? {};
  check("cross-user", "columnas públicas de B (contrato)", pub.ok && Object.keys(pubRow).sort().join(",") === "avatar,id,level,points,region,username", `${pub.status} ${Object.keys(pubRow).sort().join(",")}`);
  const anon = await fetch(`${SB}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: ANON } });
  const anonRows = await rowsOf(anon);
  check("cross-user", "anónimo no lee profiles", (anon.status === 401 || anon.status === 403) && anonRows.length === 0, `${anon.status} filas=${anonRows.length}`);
  const legacy = await fetch(`${SB}/rest/v1/ranking_collection?select=id&limit=1`, { headers: { apikey: ANON } });
  check("cross-user", "anónimo no lee vistas heredadas (ranking_collection)", !legacy.ok, String(legacy.status));

  // F · Asignación masiva / escalada (todas DEBEN fallar).
  const esc = async (id: string, path: string, body: object, method = "PATCH") => {
    const r = await rest(C, path, { method, body: JSON.stringify(body) });
    const txt = await r.text(); const affected = (() => { try { const j = JSON.parse(txt); return Array.isArray(j) ? j.length : 0; } catch { return 0; } })();
    check("escalation", id, !r.ok || affected === 0, `${r.status} filas=${affected}`);
  };
  await esc("C se da créditos", `profiles?id=eq.${C.userId}`, { credits: 999999 });
  await esc("C se hace admin", `profiles?id=eq.${C.userId}`, { is_admin: true });
  await esc("C sube su nivel/xp", `profiles?id=eq.${C.userId}`, { xp: 999999, level: 99 });
  await esc("C renombra a B", `profiles?id=eq.${B.userId}`, { username: "hacked" });
  await esc("C se inserta cartas", "user_cards", { uid: crypto.randomUUID(), user_id: C.userId, card_id: "asuna__base" }, "POST");
  await esc("C se da un ledger", "credit_transactions", { user_id: C.userId, delta: 1000, reason: "x", ref: "x" }, "POST");
  await esc("C gana una partida", `duel_matches?user_id=eq.${C.userId}`, { winner: "A", status: "COMPLETED" });
  await esc("C borra el perfil de B", `profiles?id=eq.${B.userId}`, {}, "DELETE");
  const cr = await api(C, "/api/game/credits", { action: "sandboxPurchase", credits: 999999, balance: 999999 });
  check("escalation", "API créditos con campos extra", cr.status >= 400 && cr.status < 500, `${cr.status} ${JSON.stringify(cr.json).slice(0, 80)}`);
  const rpc = await rest(C, "rpc/app_grant_reward", { method: "POST", body: JSON.stringify({ p_user: C.userId, p_ref: "x", p_reason: "x", p_reward: { credits: 999 } }) });
  check("escalation", "RPC app_grant_reward como usuario", !rpc.ok, String(rpc.status));
  const rpc2 = await rest(C, "rpc/app_admin_adjust_credits", { method: "POST", body: JSON.stringify({ p_actor: C.userId, p_user: C.userId, p_delta: 999, p_reason: "intento", p_ref: "admin:credits:x" }) });
  check("escalation", "RPC admin como usuario", !rpc2.ok, String(rpc2.status));

  // G · XSS (opcional): nombre con carga útil → se ve como TEXTO en el perfil público; luego se restaura.
  if (process.argv.includes("--xss")) {
    const { launch } = await import("./lib/cdp");
    const before = (await (await rest(C, `profiles?id=eq.${C.userId}&select=username`)).json())?.[0]?.username;
    const payload = `<img src=x onerror=window.__xss=1>`;
    const up = await rest(C, `profiles?id=eq.${C.userId}`, { method: "PATCH", body: JSON.stringify({ username: payload }) });
    const stored = up.ok;
    let executed = false, shownAsText = false;
    if (stored) {
      const b = await launch({ args: ["--mute-audio"] });
      try {
        await b.tab.goto(`${BASE}/jugador/${C.userId}`, 5000);
        executed = await b.tab.js<boolean>("!!window.__xss");
        shownAsText = await b.tab.js<boolean>(`document.body.innerText.includes(${JSON.stringify(payload)}) || !document.querySelector('img[src="x"]')`);
      } finally { await b.close(); }
      await rest(C, `profiles?id=eq.${C.userId}`, { method: "PATCH", body: JSON.stringify({ username: before }) });
    }
    const after = (await (await rest(C, `profiles?id=eq.${C.userId}&select=username`)).json())?.[0]?.username;
    check("xss", "nombre de usuario con <img onerror>", !executed && (shownAsText || !stored), `guardado=${stored} ejecutado=${executed} texto=${shownAsText}`);
    check("xss", "nombre restaurado", after === before, `${after === before}`);
  }

  const failed = rows.filter((r) => !r.ok);
  writeFileSync("docs/product/qa/f75-vps-migration/smoke.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, actor: C.userId.slice(0, 8), victim: B.userId.slice(0, 8), total: rows.length, failed: failed.length, rows }, null, 2) + "\n");
  console.log(`\n${rows.length - failed.length}/${rows.length} OK`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
