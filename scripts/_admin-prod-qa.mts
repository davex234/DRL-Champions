/**
 * GESTIÓN DE ADMINS · QA EN PRODUCCIÓN (instrumento, fuera de CI). SOLO cuentas QA: A (f45) actúa de admin TEMPORAL,
 * B (qa352) es la cuenta a la que se concede y quita, C (f64) es la cuenta normal atacante. La personal NO se toca
 * (los ayudantes abortan si la ven) y se comprueba antes y después.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_admin-prod-qa.mts   (cwd = prodqa)
 *
 * 0 · arranque por OPERADOR de A como admin (bandera de 0067 + auditoría actor NULO, propósito QA)
 * 1 · cuenta NORMAL contra TODAS las rutas /api/admin/* (GET y POST), sesión manipulada, PostgREST directo y RPC directa
 * 2 · A (admin): lista, búsqueda sin correo, confirmación, inexistente, campos extra, 10 concesiones a la vez → 1
 * 3 · B entra al panel; A le quita admin → B fuera al instante; auditoría GRANT/REVOKE en BD; UPDATE suelto en BD choca
 * 4 · navegador: /admin/admins con A (1440 y 390), conceder y quitar POR LA UI escribiendo el nombre; B normal no entra
 * 5 · limpieza: A se quita a sí mismo por la API (autorretirada con otro admin presente) → QA como estaban
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync, readdirSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { login, api, sleep, QA_FILES } = qa;
const { openBrowser, loginUi, waitFor, PERSONA_FILES } = lib;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/admin-management/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_B = QA_FILES.B;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 240)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const sqlLoose = (q: string): string => { try { return sql(q); } catch (e: any) { return String(e.stderr ?? e.message ?? e); } };
const PERSONAL = "2f86cbe8";
const personalRow = () => sql(`select id||'|'||username||'|'||is_admin||'|'||credits||'|'||xp||'|'||level from profiles where left(id::text,8)='${PERSONAL}';`);
const A = await login("A"), B = await login("B"), C = await login("C");
const isAdmin = (id: string) => sql(`select is_admin from profiles where id='${id}';`) === "t";
const nameOf = (id: string) => sql(`select username from profiles where id='${id}';`);
const A_NAME = nameOf(A.userId), B_NAME = nameOf(B.userId);
const raw = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${BASE}${path}`, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: r.status, json: j, text: t }; };
const P = "/api/admin/admins";

const personalBefore = personalRow();
check("estado inicial: QA A, B y C NO son admin; la personal sí", !isAdmin(A.userId) && !isAdmin(B.userId) && !isAdmin(C.userId) && personalBefore.split("|")[2] === "true",{ personal: personalBefore.split("|").slice(0, 3) });

// ── 0 · arranque por operador ──
sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"QA gestión de admins (cuenta QA temporal)"}'); commit;`);
check("operador: QA A admin temporal (con la bandera y auditado)", isAdmin(A.userId));
check("BD: un UPDATE suelto de is_admin (postgres, sin bandera) choca y no cambia nada", /ADMIN_WRITE_FORBIDDEN/.test(sqlLoose(`begin; update public.profiles set is_admin = true where id = '${C.userId}'; rollback;`)) && !isAdmin(C.userId));

// ── 1 · cuenta normal contra TODAS las rutas admin ──
const routes: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "route.ts") routes.push(p.replace(/\\/g, "/").replace(/^.*\/src\/app/, "").replace(/\/route\.ts$/, "")); } };
walk("C:/NEXUS-CENTRAL/DRLCards/src/app/api/admin");
const sweep: Record<string, string> = {};
let leaks = 0;
for (const r of routes.sort()) {
  const g = await raw(r, { headers: { authorization: `Bearer ${C.token}` } });
  const p = await raw(r, { method: "POST", headers: { authorization: `Bearer ${C.token}`, "content-type": "application/json" }, body: "{}" });
  const n = await raw(r, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  sweep[r] = `${g.status}/${p.status}/${n.status}`;
  const sessionOk = r.endsWith("/session") ? g.json?.admin !== true : true;
  const deny = (s: number) => [401, 403, 404, 405].includes(s);
  if (!(r.endsWith("/session") ? sessionOk && deny(p.status) && deny(n.status) : deny(g.status) && deny(p.status) && deny(n.status))) leaks++;
}
check(`cuenta NORMAL y anónimo contra las ${routes.length} rutas /api/admin/* (GET y POST): ninguna pasa`, leaks === 0, sweep);
const self = await raw(P, { method: "POST", headers: { authorization: `Bearer ${C.token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "grant", userId: C.userId, confirm: nameOf(C.userId) }) });
check("cuenta normal se intenta hacer admin por la API → 401 y sigue sin admin", self.status === 401 && !isAdmin(C.userId), self.status);
const forged = [
  { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIyZjg2Y2JlOCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ." },
  { authorization: `Bearer ${C.token}x` },
  { authorization: `Bearer ${C.token}`, "x-user-id": A.userId, "x-is-admin": "true", "x-supabase-role": "service_role" },
  { authorization: "Bearer " },
];
const forgedSt = [] as number[];
for (const h of forged) forgedSt.push((await raw(P, { method: "POST", headers: { ...h, "content-type": "application/json" } as any, body: JSON.stringify({ action: "grant", userId: C.userId, confirm: nameOf(C.userId) }) })).status);
check("sesión manipulada (JWT sin firma con rol service_role, token alterado, cabeceras de identidad, Bearer vacío) → 401", forgedSt.every((s) => s === 401) && !isAdmin(C.userId), forgedSt);
const env = Object.fromEntries((await import("node:fs")).readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const rest = await raw(`/rest/v1/profiles?id=eq.${C.userId}`, { method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${C.token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ is_admin: true }) });
check("PostgREST directo: PATCH profiles {is_admin:true} con su propio token → rechazado y sin cambio", rest.status >= 400 && !isAdmin(C.userId), { status: rest.status, body: rest.text.slice(0, 120) });
const rpc = await raw(`/rest/v1/rpc/app_admin_set_admin`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${C.token}`, "content-type": "application/json" }, body: JSON.stringify({ p_actor: C.userId, p_target: C.userId, p_grant: true, p_reason: null }) });
check("RPC app_admin_set_admin directa con token de jugador → denegada", rpc.status >= 400 && !isAdmin(C.userId), { status: rpc.status, body: rpc.text.slice(0, 120) });
const rpcAnon = await raw(`/rest/v1/rpc/app_admin_set_admin`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ p_actor: A.userId, p_target: C.userId, p_grant: true, p_reason: null }) });
check("RPC directa como anónimo suplantando a un admin (p_actor) → denegada", rpcAnon.status >= 400 && !isAdmin(C.userId), rpcAnon.status);

// ── 2 · A (admin) por la API ──
const list = await api(A, P);
check("A: lista de administradores (la personal + A), sin correos", list.status === 200 && list.json?.count === 2 && !/@|email/i.test(JSON.stringify(list.json)), { count: list.json?.count });
const search = await api(A, `${P}?q=${encodeURIComponent(B_NAME.slice(0, 5))}`);
check("A: búsqueda por nombre encuentra a B (Jugador), sin correo", search.status === 200 && search.json?.accounts?.some((a: any) => a.userId === B.userId && !a.isAdmin) && !/@|email/i.test(JSON.stringify(search.json)), search.json?.accounts?.length);
check("A: búsqueda por correo → 400", (await api(A, `${P}?q=${encodeURIComponent("qa@example.invalid")}`)).status === 400);
check("A: confirmación con el nombre equivocado → 400 sin cambio", (await api(A, P, { action: "grant", userId: B.userId, confirm: B_NAME.toUpperCase() + "x" })).status === 400 && !isAdmin(B.userId));
check("A: usuario inexistente → 404", (await api(A, P, { action: "grant", userId: "00000000-0000-4000-8000-00000000dead", confirm: "nadie" })).status === 404);
check("A: campo extra (is_admin / actor) → 400 sin cambio", (await api(A, P, { action: "grant", userId: B.userId, confirm: B_NAME, is_admin: true })).status === 400 && (await api(A, P, { action: "grant", userId: B.userId, confirm: B_NAME, actor: A.userId })).status === 400 && !isAdmin(B.userId));
const t0 = sql("select now();");
const many = await Promise.all(Array.from({ length: 10 }, () => api(A, P, { action: "grant", userId: B.userId, confirm: B_NAME, reason: "QA gestión de admins" }, { noRetry: true })));
const codes = many.map((r: any) => r.json?.code ?? r.status);
check("A concede a B ×10 a la vez (doble clic/pestañas) → 1 GRANTED + 9 ALREADY_ADMIN", codes.filter((c: any) => c === "GRANTED").length === 1 && codes.filter((c: any) => c === "ALREADY_ADMIN").length === 9, codes);
const g = sql(`select count(*)||'|'||string_agg(distinct (actor = '${A.userId}')::text, ',') from content_audit_log where action='GRANT_ADMIN' and entity_id='${B.userId}' and at >= '${t0}';`);
check("auditoría: UNA fila GRANT_ADMIN (actor A, afectado B, hora)", g === "1|true", g);

// ── 3 · B entra; A se lo quita ──
check("B (nuevo admin) entra en el panel: /api/admin/dashboard 200", (await api(B, "/api/admin/dashboard")).status === 200);
const rv = await api(A, P, { action: "revoke", userId: B.userId, confirm: B_NAME, reason: "QA gestión de admins: fin" });
check("A quita admin a B → REVOKED", rv.json?.code === "REVOKED" && !isAdmin(B.userId), rv.json);
check("B queda fuera AL INSTANTE: dashboard 401 y no puede volver a dárselo", (await api(B, "/api/admin/dashboard")).status === 401 && (await api(B, P, { action: "grant", userId: B.userId, confirm: B_NAME })).status === 401 && !isAdmin(B.userId));
check("repetir la revocación → ALREADY_NOT_ADMIN (sin escribir)", (await api(A, P, { action: "revoke", userId: B.userId, confirm: B_NAME })).json?.code === "ALREADY_NOT_ADMIN");
const rr = sql(`select count(*) from content_audit_log where action='REVOKE_ADMIN' and entity_id='${B.userId}' and actor='${A.userId}' and at >= '${t0}';`);
check("auditoría: UNA fila REVOKE_ADMIN (actor A, afectado B)", rr === "1", rr);

// ── 4 · navegador ──
for (const w of [1440, 390]) {
  const c = await openBrowser("QA_A", w, { label: `adm-${w}` });
  try {
    const okLogin = await loginUi(c, "QA_A");
    await c.tab.goto(`${BASE}/admin/admins`, 3500);
    const shown = await waitFor(c.tab, `/Administradores actuales/.test(document.body.textContent)`, 30000);
    check(`${w} · /admin/admins con A: sección ADMINISTRADORES visible`, okLogin && shown);
    await c.tab.js(`(() => { const i = document.querySelector('input[type="search"], input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(B_NAME.slice(0, 6))}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const found = await waitFor(c.tab, `[...document.querySelectorAll('[data-action="grant"]')].length > 0 && document.body.textContent.includes(${JSON.stringify(B_NAME)})`, 15000);
    // Solo el panel de búsqueda: la cabecera del panel admin enseña el correo de la PROPIA sesión (F58), no el de otros.
    const mailInSearch = await c.tab.js<boolean>(`(() => { const p = [...document.querySelectorAll('div')].filter((e) => /Buscar una cuenta/i.test(e.textContent) && e.querySelector('input')).pop(); return !p || /@[a-z0-9-]+\\.[a-z]{2,}/i.test(p.textContent); })()`);
    check(`${w} · búsqueda por nombre en la UI: B aparece con HACER ADMIN y sin correo en los resultados`, found && !mailInSearch, { found, mailInSearch });
    await c.tab.shot(`${OUT}/shots/admins-search-${w}.png`).catch(() => null);
    if (w === 1440) {
      // conceder POR LA UI: el diálogo exige escribir el nombre exacto
      const tUi = sql("select now();");
      await c.tab.js(`(() => { const row = [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(${JSON.stringify(B_NAME)}) && t.querySelector('[data-action="grant"]')); row.querySelector('[data-action="grant"]').click(); })()`);
      await waitFor(c.tab, `!!document.querySelector('[role="dialog"]')`, 8000);
      const disabledBefore = await c.tab.js<boolean>(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Hacer admin/i.test(x.textContent)); return !!b && b.disabled; })()`);
      await c.tab.shot(`${OUT}/shots/admins-confirm-${w}.png`).catch(() => null);
      await c.tab.js(`(() => { const i = document.querySelector('[role="dialog"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(B_NAME)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(300);
      await c.tab.js(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Hacer admin/i.test(x.textContent)); b.click(); b.click(); })()`);
      const granted = await waitFor(c.tab, `/ahora es administrador/.test(document.body.textContent)`, 15000);
      const grantRows = sql(`select count(*) from content_audit_log where action='GRANT_ADMIN' and entity_id='${B.userId}' and at >= '${tUi}';`);
      const msg = await c.tab.js<string>(`document.querySelector('[data-testid="admins-done"]')?.textContent ?? ''`);
      check("UI: HACER ADMIN deshabilitado hasta escribir el nombre; confirmar con DOBLE clic → UNA concesión y mensaje «ahora es administrador»", disabledBefore && granted && isAdmin(B.userId) && grantRows === "1" && /ahora es administrador/.test(msg), { disabledBefore, granted, grantRows, msg });
      await c.tab.shot(`${OUT}/shots/admins-granted-${w}.png`).catch(() => null);
      await c.tab.js(`(() => { const row = [...document.querySelectorAll('tr')].find((t) => t.textContent.includes(${JSON.stringify(B_NAME)}) && t.querySelector('[data-action="revoke"]')); row.querySelector('[data-action="revoke"]').click(); })()`);
      await waitFor(c.tab, `!!document.querySelector('[role="dialog"] input')`, 8000);
      await c.tab.js(`(() => { const i = document.querySelector('[role="dialog"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(B_NAME)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(300);
      await c.tab.js(`[...document.querySelectorAll('[role="dialog"] button')].find((x) => /Quitar admin/i.test(x.textContent)).click()`);
      const revoked = await waitFor(c.tab, `/ya no es administrador/.test(document.body.textContent)`, 15000);
      check("UI: QUITAR ADMIN con nombre escrito → B deja de ser admin", revoked && !isAdmin(B.userId));
    }
  } finally { await c.browser.close().catch(() => null); }
}
const bb = await openBrowser("QA_B", 1440, { label: "adm-B" });
try {
  await loginUi(bb, "QA_B");
  await bb.tab.goto(`${BASE}/admin/admins`, 4000);
  await sleep(2500);
  const t = await bb.tab.js<string>("document.body.textContent");
  check("B (ya normal) en /admin/admins: no ve la lista ni puede actuar", !/Administradores actuales/.test(t) && !(await bb.tab.js<boolean>(`!!document.querySelector('[data-action="grant"]')`)), t.slice(0, 120));
  await bb.tab.shot(`${OUT}/shots/admins-denied-B.png`).catch(() => null);
} finally { await bb.browser.close().catch(() => null); }

// ── 5 · limpieza: A se quita a sí mismo por la API ──
const selfRv = await api(A, P, { action: "revoke", userId: A.userId, confirm: A_NAME, reason: "QA gestión de admins: fin de la cuenta QA temporal" });
check("A se quita admin a sí mismo (queda la personal) → REVOKED, auditado como autorretirada", selfRv.json?.code === "REVOKED" && !isAdmin(A.userId) && sql(`select detail->>'self' from content_audit_log where action='REVOKE_ADMIN' and entity_id='${A.userId}' order by id desc limit 1;`) === "true", selfRv.json);
check("A ya no entra al panel", (await api(A, "/api/admin/dashboard")).status === 401);
const finalAdmins = sql("select string_agg(left(id::text,8), ',') from profiles where is_admin;");
check("final: el ÚNICO admin vuelve a ser la cuenta personal; QA A, B y C sin admin", finalAdmins === PERSONAL && !isAdmin(A.userId) && !isAdmin(B.userId) && !isAdmin(C.userId), finalAdmins);
const personalAfter = personalRow();
check("cuenta personal: fila de perfil IDÉNTICA (id, nombre, is_admin, créditos, XP, nivel) y ninguna auditoría sobre ella", personalAfter === personalBefore && sql(`select count(*) from content_audit_log where action in ('GRANT_ADMIN','REVOKE_ADMIN') and left(entity_id,8)='${PERSONAL}';`) === "0");
const audit = sql(`select string_agg(action||':'||left(entity_id,8)||':'||coalesce(left(actor::text,8),'operador'), ', ' order by id) from content_audit_log where action in ('GRANT_ADMIN','REVOKE_ADMIN') and at >= '${t0}'::timestamptz - interval '5 minutes';`);
const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), release: "drl-0.1.1-1-c01946b1", accounts: { A: A.userId.slice(0, 8), B: B.userId.slice(0, 8), C: C.userId.slice(0, 8) }, auditTrail: audit, total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nADMIN QA: ${rows.length - failed.length}/${rows.length}\n${audit}`);
