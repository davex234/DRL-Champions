/**
 * 0068 · TAG PÚBLICO — QA EN PRODUCCIÓN (instrumento, fuera de CI). SOLO cuentas QA: A (f45) actúa de admin TEMPORAL
 * (operador → se retira él mismo al final), B (qa352) y C (f64). La cuenta personal no se abre ni se toca.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_tag-prod-qa.mts   (cwd = prodqa)
 *
 * 1 · tag en la foto del perfil (propio y ajeno), sin privados · 2 · búsqueda F85 por #TAG exacto/minúsculas/inválido/vacío
 * 3 · ataques: REST directo al tag y al registro, inyección en la edición del perfil, alta eligiendo tag (cuenta QA
 *     desechable que luego se BORRA: su tag queda en el registro y no se reutiliza) · 4 · admin: búsqueda por #TAG en
 *     /admin/admins y /admin/users, confirmación por TAG (el nombre ya no vale), auditoría con tag, usuario normal 401
 * 5 · navegador 1440/1024/390: tag bajo el nombre, copiar → «Tag copiado», perfil ajeno con tag, búsqueda por #TAG en
 *     /social, /admin/admins buscando #TAG y diálogo con Cuenta + Tag · 6 · cambio de cuenta A → B sin el tag de A
 * 7 · límite de búsqueda (anti-enumeración) · limpieza: A sin admin, B sin admin, sin restos.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { login, api, sleep, QA_FILES } = qa;
const { openBrowser, loginUi, waitFor, PERSONA_FILES } = lib;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/account-tag/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_B = QA_FILES.B; PERSONA_FILES.QA_C = QA_FILES.C;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const raw = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${BASE}${path}`, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: r.status, json: j, text: t }; };
const RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/;
const S = "/api/game/social", P = "/api/admin/admins";
const PERSONAL = "2f86cbe8";
const personalRow = () => sql(`select md5((to_jsonb(p) - 'last_seen_at')::text)||'|'||public_tag||'|'||is_admin from profiles p where left(id::text,8)='${PERSONAL}';`);
const personalBefore = personalRow();

const A = await login("A"), B = await login("B"), C = await login("C");
const tagOf = (id: string) => sql(`select public_tag from profiles where id='${id}';`);
const TA = tagOf(A.userId), TB = tagOf(B.userId), TC = tagOf(C.userId);
const nameA = sql(`select username from profiles where id='${A.userId}';`), nameB = sql(`select username from profiles where id='${B.userId}';`);

// ── 1 · foto del perfil ──
const ownSnap = (await api(A, `/api/game/player?id=${A.userId}`)).json;
const pubSnap = (await api(B, `/api/game/player?id=${A.userId}`)).json;
check("perfil PROPIO: player.tag = el tag canónico de la cuenta (7 símbolos válidos)", ownSnap?.player?.tag === TA && RE.test(TA), { tag: ownSnap?.player?.tag });
check("perfil PÚBLICO (visto por otra cuenta): el MISMO tag, sin correo ni privados", pubSnap?.player?.tag === TA && pubSnap?.view === "PUBLIC" && !/@[a-z0-9-]+\.[a-z]{2,}|"email"|"credits"|"is_admin"|account_tag_registry|assigned_at/i.test(JSON.stringify(pubSnap)));

// ── 2 · búsqueda F85 ──
const sb = await api(B, `${S}?q=${encodeURIComponent("#" + TA)}`);
check("F85 #TAG exacto → EXACTAMENTE esa cuenta, con tag y sin correo", sb.status === 200 && sb.json?.players?.length === 1 && sb.json.players[0].username === nameA && sb.json.players[0].tag === TA && !/@[a-z0-9-]+\.[a-z]{2,}|"email"/.test(sb.text), { n: sb.json?.players?.length, q: sb.json?.query });
const low = await api(B, `${S}?q=${encodeURIComponent("#" + TA.toLowerCase())}`);
check("F85 #tag en minúsculas → normalizado, misma cuenta", low.json?.players?.[0]?.tag === TA && low.json?.query === `#${TA}`);
check("F85 #TAG sin cuenta → vacío", (await api(B, `${S}?q=${encodeURIComponent("#ZZZZZZZ")}`)).json?.players?.length === 0);
check("F85 #TAG inválido (corto / ambiguo / trozo) → 400, sin difuso", (await api(B, `${S}?q=${encodeURIComponent("#" + TA.slice(0, 4))}`)).status === 400 && (await api(B, `${S}?q=${encodeURIComponent("#0OIL012")}`)).status === 400);
check("F85 el propio tag no se encuentra a sí mismo", (await api(A, `${S}?q=${encodeURIComponent("#" + TA)}`)).json?.players?.length === 0);
const byName = await api(B, `${S}?q=${encodeURIComponent(nameA.slice(0, 6))}`);
check("F85 búsqueda por NOMBRE intacta (y trae el tag)", byName.json?.players?.some((p: any) => p.username === nameA && p.tag === TA));

// ── 3 · ataques ──
const patchTag = await raw(`/rest/v1/profiles?id=eq.${A.userId}`, { method: "PATCH", headers: { apikey: ANON, authorization: `Bearer ${A.token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify({ public_tag: "AAAAAAA" }) });
check("REST directo: la propia cuenta intenta cambiar su tag → rechazado y sin cambio", patchTag.status >= 400 && tagOf(A.userId) === TA, { status: patchTag.status, body: patchTag.text.slice(0, 100) });
const anonPatch = await raw(`/rest/v1/profiles?id=eq.${A.userId}`, { method: "PATCH", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ public_tag: "AAAAAAA" }) });
check("REST anónimo → rechazado y sin cambio", anonPatch.status >= 400 && tagOf(A.userId) === TA, anonPatch.status);
const readTag = await raw(`/rest/v1/profiles?select=public_tag&limit=5`, { headers: { apikey: ANON, authorization: `Bearer ${B.token}` } });
const readReg = await raw(`/rest/v1/account_tag_registry?select=*&limit=5`, { headers: { apikey: ANON, authorization: `Bearer ${B.token}` } });
const insReg = await raw(`/rest/v1/account_tag_registry`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${B.token}`, "content-type": "application/json" }, body: JSON.stringify({ tag: "AAAAAAA", user_id: B.userId }) });
check("REST: ni leer tags en masa, ni leer/insertar en el registro (anti-enumeración por la BD)", readTag.status >= 400 && readReg.status >= 400 && insReg.status >= 400, { tag: readTag.status, reg: readReg.status, ins: insReg.status });
const team0 = (await api(A, `/api/game/player?id=${A.userId}`)).json;
const inj = await api(A, "/api/game/player", { action: "set_favorite_team", teamId: team0?.favoriteTeam?.id ?? null, expectedVersion: team0?.self?.version ?? null, public_tag: "AAAAAAA" });
check("edición del perfil con un campo extra public_tag → 400 y el tag no cambia", inj.status === 400 && tagOf(A.userId) === TA, inj.status);
// alta que intenta elegir su tag (cuenta QA desechable) → la BD lo ignora; luego se borra y su tag NO se libera
const email = `qa-tag-${Date.now()}@example.invalid`;
const su = await raw(`/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: `Qa!${Date.now()}x`, data: { username: "qa_tag_throwaway", public_tag: "AAAAAAA" } }) });
const nid = sql(`select id from auth.users where email='${email}';`);
const ntag = nid ? tagOf(nid) : "";
check("alta eligiendo public_tag=AAAAAAA → la BD le da OTRO tag válido", su.status < 300 && !!nid && RE.test(ntag) && ntag !== "AAAAAAA", { status: su.status, tag: ntag });
if (nid) sql(`delete from auth.users where id='${nid}';`);
check("borrar esa cuenta QA: el perfil desaparece, el registro CONSERVA su tag (nunca se reutiliza)", !!nid && sql(`select (select count(*) from profiles where id='${nid}')||'|'||(select count(*) from account_tag_registry where tag='${ntag}' and user_id='${nid}');`) === "0|1");

// ── 4 · admin (A admin TEMPORAL por operador) ──
sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"QA tag público (cuenta QA temporal)"}'); commit;`);
try {
  const as = await api(A, `${P}?q=${encodeURIComponent("#" + TB.toLowerCase())}`);
  check("/admin/admins #tag (minúsculas) → EXACTAMENTE B, con tag, sin correo", as.status === 200 && as.json?.accounts?.length === 1 && as.json.accounts[0].username === nameB && as.json.accounts[0].tag === TB && !/@[a-z0-9-]+\.[a-z]{2,}|"email"/.test(JSON.stringify(as.json)), as.json?.accounts);
  const us = await api(A, `/api/admin/users?q=${encodeURIComponent("#" + TB)}`);
  check("/admin/users #TAG (entrada a sanciones) → EXACTAMENTE B con su tag", us.status === 200 && us.json?.rows?.length === 1 && us.json.rows[0].id === B.userId && us.json.rows[0].tag === TB, { n: us.json?.rows?.length });
  check("usuario NORMAL buscando #TAG en el panel → 401", (await api(C, `${P}?q=${encodeURIComponent("#" + TB)}`)).status === 401 && (await api(C, `/api/admin/users?q=${encodeURIComponent("#" + TB)}`)).status === 401);
  check("confirmar con el NOMBRE ya no vale (400) y no cambia nada", (await api(A, P, { action: "grant", userId: B.userId, confirm: nameB })).status === 400 && sql(`select is_admin from profiles where id='${B.userId}';`) === "f");
  check("confirmar con el tag de OTRA cuenta → 400", (await api(A, P, { action: "grant", userId: B.userId, confirm: `#${TC}` })).status === 400);
  const g = await api(A, P, { action: "grant", userId: B.userId, confirm: `#${TB.toLowerCase()}`, reason: "QA tag público" });
  check("confirmar con el #TAG (minúsculas) → GRANTED; la respuesta lleva el tag", g.json?.code === "GRANTED" && g.json?.tag === TB, g.json);
  check("auditoría GRANT_ADMIN: entity_id = id interno, detail.target_tag = tag, nombre", sql(`select (entity_id='${B.userId}')::text||'|'||(detail->>'target_tag')||'|'||(detail->>'target_username') from content_audit_log where action='GRANT_ADMIN' order by id desc limit 1;`) === `true|${TB}|${nameB}`);
  const rv = await api(A, P, { action: "revoke", userId: B.userId, confirm: `#${TB}` });
  check("quitar con el #TAG → REVOKED; B vuelve a no-admin", rv.json?.code === "REVOKED" && sql(`select is_admin from profiles where id='${B.userId}';`) === "f");

  // ── 5 · navegador ──
  for (const w of [1440, 1024, 390]) {
    const c = await openBrowser("QA_A", w, { label: `tag-${w}` });
    try {
      await loginUi(c, "QA_A");
      await c.tab.goto(`${BASE}/jugador/me`, 2500);
      await waitFor(c.tab, `!!document.querySelector('[data-testid="account-tag"]')`, 25000);
      const t = await c.tab.js<any>(`(() => { const t = document.querySelector('[data-testid="account-tag"]'); const n = document.querySelector('[data-field="player-name"]'); const a = t.getBoundingClientRect(), b = n.getBoundingClientRect(); return { tag: t.dataset.tag, text: t.textContent, label: t.getAttribute('aria-label'), below: a.top >= b.bottom - 1, inside: a.left >= 0 && a.right <= innerWidth, overflow: document.documentElement.scrollWidth - innerWidth }; })()`);
      check(`${w} · perfil propio: #TAG bajo el nombre, dentro de pantalla, accesible`, t.tag === TA && t.text.includes(`#${TA}`) && t.below && t.inside && t.overflow <= 0 && t.label === `Identificador de cuenta #${TA}. Pulsa para copiarlo`, t);
      // copiar: se captura lo que la app escribe en el portapapeles (headless no tiene portapapeles real)
      await c.tab.js(`(() => { window.__clip = null; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (s) => { window.__clip = s; return Promise.resolve(); } } }); } catch (e) {} document.querySelector('[data-testid="account-tag"]').focus(); document.querySelector('[data-testid="account-tag"]').click(); })()`);
      const copied = await waitFor(c.tab, `/Tag copiado/i.test(document.querySelector('[data-testid="account-tag-status"]').textContent)`, 5000);
      const clip = await c.tab.js<string>("window.__clip");
      check(`${w} · copiar → escribe «#${TA}» y avisa «Tag copiado» (role=status)`, copied && clip === `#${TA}`, { clip });
      await c.tab.shot(`${OUT}/shots/own-${w}.png`).catch(() => null);
      await c.tab.goto(`${BASE}/jugador/${B.userId}`, 2500);
      await waitFor(c.tab, `document.querySelector('[data-testid="account-tag"]')?.dataset.tag === ${JSON.stringify(TB)}`, 20000);
      check(`${w} · perfil PÚBLICO de B con su #TAG`, (await c.tab.js<string>(`document.querySelector('[data-testid="account-tag"]').dataset.tag`)) === TB);
      await c.tab.shot(`${OUT}/shots/public-B-${w}.png`).catch(() => null);
      if (w !== 1024) {
        await c.tab.goto(`${BASE}/social?tab=buscar`, 2500);
        await waitFor(c.tab, `!!document.querySelector('#social-search')`, 15000);
        await c.tab.js(`(() => { const i = document.querySelector('#social-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify("#" + TB.toLowerCase())}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        const hit = await waitFor(c.tab, `!!document.querySelector('[data-hit="${B.userId}"] [data-field="hit-tag"]')`, 15000);
        const n = await c.tab.js<number>(`document.querySelectorAll('[data-testid="search-results"] [data-hit]').length`);
        check(`${w} · /social: buscar #tag → una sola fila, la de B, con su tag`, hit && n === 1);
        await c.tab.shot(`${OUT}/shots/social-search-${w}.png`).catch(() => null);
        await c.tab.goto(`${BASE}/admin/admins`, 3500);
        await waitFor(c.tab, `/Administradores actuales/.test(document.body.textContent)`, 25000);
        await c.tab.js(`(() => { const i = document.querySelector('input[type="search"], input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify("#" + TB)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        const row = await waitFor(c.tab, `[...document.querySelectorAll('tr')].some((t) => t.textContent.includes(${JSON.stringify("#" + TB)}) && t.querySelector('[data-action="grant"]'))`, 15000);
        await c.tab.js(`[...document.querySelectorAll('tr')].find((t) => t.textContent.includes(${JSON.stringify("#" + TB)}) && t.querySelector('[data-action="grant"]')).querySelector('[data-action="grant"]').click()`);
        const dlg = await waitFor(c.tab, `!!document.querySelector('[data-testid="confirm-account"]')`, 8000);
        const d = await c.tab.js<any>(`(() => { const box = document.querySelector('[data-testid="confirm-account"]'); const btn = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Hacer admin/i.test(x.textContent)); return { text: box.textContent, disabled: btn.disabled, hint: [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.textContent).find((t) => /para confirmar/.test(t)) ?? '' }; })()`);
        // escribir el NOMBRE no habilita; el #TAG sí
        await c.tab.js(`(() => { const i = document.querySelector('[role="dialog"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(nameB)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(200);
        const byName = await c.tab.js<boolean>(`[...document.querySelectorAll('[role="dialog"] button')].find((x) => /Hacer admin/i.test(x.textContent)).disabled`);
        await c.tab.js(`(() => { const i = document.querySelector('[role="dialog"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify("#" + TB)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(200);
        const byTag = await c.tab.js<boolean>(`![...document.querySelectorAll('[role="dialog"] button')].find((x) => /Hacer admin/i.test(x.textContent)).disabled`);
        check(`${w} · /admin/admins: #TAG encuentra a B; el diálogo enseña Cuenta + Tag y solo se habilita escribiendo el #TAG (no el nombre)`, row && dlg && d.text.includes(nameB) && d.text.includes(`#${TB}`) && d.disabled && byName && byTag && d.hint.includes(`#${TB}`), { d, byName, byTag });
        await c.tab.shot(`${OUT}/shots/admin-confirm-${w}.png`).catch(() => null);
        await c.tab.js(`[...document.querySelectorAll('[role="dialog"] button')].find((x) => /Cancelar|Volver/i.test(x.textContent))?.click()`);
      }
      if (w === 390) {
        // ── 6 · cambio de cuenta A → B: nunca el tag de A ──
        await c.tab.goto(`${BASE}/jugador/me`, 2500);
        await waitFor(c.tab, `!!document.querySelector('[data-action="sign-out"]')`, 20000);
        await c.tab.js(`document.querySelector('[data-action="sign-out"]').click()`);
        await waitFor(c.tab, `location.pathname === '/cuenta' && !!document.querySelector('input[type="password"]')`, 20000);
        await loginUi(c, "QA_B");
        await c.tab.goto(`${BASE}/jugador/me`, 200);
        await c.tab.js(`(() => { window.__seen = []; window.__t = setInterval(() => { window.__seen.push(document.body.textContent.includes(${JSON.stringify("#" + TA)}) ? 'A' : (document.body.textContent.includes(${JSON.stringify("#" + TB)}) ? 'B' : '-')); }, 40); })()`);
        await waitFor(c.tab, `document.querySelector('[data-testid="account-tag"]')?.dataset.tag === ${JSON.stringify(TB)}`, 25000);
        await sleep(1200);
        const seen = await c.tab.js<string[]>(`(() => { clearInterval(window.__t); return window.__seen; })()`);
        check("A sale → B entra → «mi perfil»: aparece #TAG de B y NUNCA el de A", !seen.includes("A") && seen.includes("B"), { seen: [...new Set(seen)] });
        await c.tab.shot(`${OUT}/shots/switch-B-390.png`).catch(() => null);
      }
    } finally { await c.browser.close().catch(() => null); }
  }
} finally {
  // limpieza: A deja de ser admin (por la API si su sesión sigue; si no, por operador). B nunca queda admin.
  const A2 = await login("A");
  const self = await api(A2, P, { action: "revoke", userId: A.userId, confirm: `#${TA}` });
  if (self.json?.code !== "REVOKED" && sql(`select is_admin from profiles where id='${A.userId}';`) === "t") {
    sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${A.userId}'; insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"fin QA tag público"}'); commit;`);
  }
  check("limpieza: el ÚNICO admin vuelve a ser la cuenta personal; QA A/B/C sin admin", sql("select string_agg(left(id::text,8), ',') from profiles where is_admin;") === PERSONAL);
}

// ── 7 · límite de búsqueda (al final: deja la cubeta de C llena un minuto) ──
let firstLimited = -1;
for (let i = 0; i < 40; i++) { const r = await api(C, `${S}?q=${encodeURIComponent("#ZZZZZZ" + "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[i % 31])}`, undefined, { noRetry: true }); if (r.status === 429) { firstLimited = i; break; } }
check("anti-enumeración: ≥ 25 búsquedas por #TAG pasan y después 429", firstLimited >= 25, { firstLimited });
check("cuenta personal: perfil idéntico (solo tiene su tag) y sigue siendo admin", personalRow() === personalBefore && personalBefore.endsWith("|true")); // psql -At concatena booleanos como «true»

const failed = rows.filter((r) => !r.ok);
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), release: "drl-0.1.1-1-c2ccec7f", tags: { A: TA, B: TB, C: TC }, total: rows.length, passed: rows.length - failed.length, failed: failed.length, rows }, null, 1));
console.log(`\nTAG PROD: ${rows.length - failed.length}/${rows.length}`);
