// F77-S1 · instrumento (fuera de CI). Rotación del secreto JWT: sesión existente, alta/login/logout, RLS entre
// usuarios y humo de producto, SIEMPRE contra https://valorosters.com como cliente de Internet y SOLO con cuentas QA
// (@example.invalid). La clave anon se lee del bundle PÚBLICO en cada ejecución (es pública por diseño); nunca se
// escribe a disco ni se imprime. Tokens y contraseñas: solo en el scratchpad de la sesión, nunca en la salida.
//   npx tsx scripts/_f77s1-qa.ts pre     → crea la cuenta QA S y guarda su sesión (antes de rotar)
//   npx tsx scripts/_f77s1-qa.ts post    → todo lo demás (después de rotar)
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dbRead } from "./_f73c-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://valorosters.com";
const SP = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/bdae3aa0-518a-4d6b-b822-f373dd9ab292/scratchpad";
const QA_DIR = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards";
const QA = { A: `${QA_DIR}/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json`, B: `${QA_DIR}/738eeaef-6ef7-4f65-abd1-2ca435caa596/scratchpad/qa352-creds.json`, C: `${QA_DIR}/bf089a0a-88d0-408c-a67f-d51d19745e4d/scratchpad/f64-regress-creds.json` };
const USER_PREFIX = "2f86cbe8";
const OUT = join(process.cwd(), "docs/product/qa/f77s1");
mkdirSync(OUT, { recursive: true });
const mode = process.argv[2];
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); results.push({ id, ok, detail: d.slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`); return ok; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const h8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);
const b64json = (seg: string) => JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
const header = (jwt: string) => { const h = b64json(jwt.split(".")[0]); return { alg: h.alg, kidPresent: !!h.kid }; };
const guard = (id: string) => { if (id.startsWith(USER_PREFIX)) throw new Error("CUENTA DEL USUARIO: prohibido"); };

/** La clave anon tal como la sirve el bundle público (role=anon). */
async function publicAnon(): Promise<string> {
  const html = await (await fetch(`${BASE}/`)).text();
  const srcs = [...new Set([...html.matchAll(/\/_next\/static\/[^"' ]+?\.js/g)].map((m) => m[0]))];
  for (const s of srcs) {
    const js = await (await fetch(BASE + s)).text();
    for (const m of js.matchAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)) {
      try { if (b64json(m[0].split(".")[1]).role === "anon") return m[0]; } catch { /* no es un JWT */ }
    }
  }
  throw new Error("anon no encontrada en el bundle público");
}

const auth = (anon: string, path: string, init: RequestInit & { bearer?: string } = {}) =>
  fetch(`${BASE}/auth/v1/${path}`, { ...init, headers: { apikey: anon, "content-type": "application/json", ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}), ...(init.headers ?? {}) } });
const rest = (anon: string, bearer: string | null, path: string, init: RequestInit = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: anon, authorization: `Bearer ${bearer ?? anon}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } });
async function api(token: string | null, path: string, body?: unknown) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 429) { await sleep(Math.max(1, Number(r.headers.get("retry-after") ?? 3)) * 1000); continue; }
    const t = await r.text(); let json: any = null; try { json = JSON.parse(t); } catch { json = t; }
    return { status: r.status, json };
  }
  return { status: 429, json: null };
}
const body = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function signup(anon: string, tag: string) {
  const email = `qa-f77s1-${tag}-${randomBytes(3).toString("hex")}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const username = `qaf77s1${tag}${randomBytes(2).toString("hex")}`;
  const r = await auth(anon, "signup", { method: "POST", body: JSON.stringify({ email, password, data: { username } }) });
  const j: any = await body(r);
  const s = j.session ?? j;
  return { status: r.status, email, password, username, userId: s.user?.id ?? j.user?.id ?? j.id, access: s.access_token as string | undefined, refresh: s.refresh_token as string | undefined };
}
async function passwordLogin(anon: string, email: string, password: string) {
  const r = await auth(anon, "token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  const j: any = await body(r);
  return { status: r.status, access: j.access_token as string | undefined, refresh: j.refresh_token as string | undefined, userId: j.user?.id as string | undefined };
}

async function pre() {
  const anon = await publicAnon();
  const S = await signup(anon, "s");
  check("PRE · alta QA S por la API pública (autoconfirm) → sesión", S.status === 200 && !!S.access && !!S.userId, { status: S.status, user: S.userId?.slice(0, 8) });
  guard(S.userId);
  const hdr = header(S.access!);
  check("PRE · la sesión de usuario se firma con clave asimétrica (no HS256)", hdr.alg !== "HS256", hdr);
  const me = await api(S.access!, "/api/game/me");
  check("PRE · /api/game/me con la sesión de S → 200", me.status === 200, String(me.status));
  writeFileSync(join(SP, "f77s1-S.json"), JSON.stringify({ ...S, anonHash: h8(anon), at: new Date().toISOString() }));
  writeFileSync(join(OUT, "pre.json"), JSON.stringify({ at: new Date().toISOString(), qaUser: S.userId.slice(0, 8), accessTokenHeader: hdr, publicAnonHash8: h8(anon), results }, null, 2));
}

async function post() {
  const anon = await publicAnon();
  const S = JSON.parse(readFileSync(join(SP, "f77s1-S.json"), "utf8"));
  guard(S.userId);
  check("BUNDLE · la anon que sirve valorosters.com CAMBIÓ tras la rotación", h8(anon) !== S.anonHash, { before: S.anonHash, after: h8(anon) });

  // ── Sesión EXISTENTE (emitida antes de rotar).
  const hdr = header(S.access);
  check("SESIÓN EXISTENTE · token previo es ES256/asimétrico con kid", hdr.alg !== "HS256" && hdr.kidPresent, hdr);
  const u = await auth(anon, "user", { bearer: S.access });
  check("SESIÓN EXISTENTE · /auth/v1/user con el token PREVIO → 200 (sobrevive)", u.status === 200, String(u.status));
  const me0 = await api(S.access, "/api/game/me");
  check("SESIÓN EXISTENTE · /api/game/me con el token PREVIO → 200", me0.status === 200, String(me0.status));
  const own = await rest(anon, S.access, `profiles?id=eq.${S.userId}&select=id`);
  const ownJ = await body(own);
  check("SESIÓN EXISTENTE · REST con el token PREVIO (perfil propio) → 200 y 1 fila", own.status === 200 && Array.isArray(ownJ) && ownJ.length === 1, { status: own.status, rows: Array.isArray(ownJ) ? ownJ.length : ownJ });
  const rf = await auth(anon, "token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: S.refresh }) });
  const rfJ: any = await body(rf);
  check("SESIÓN EXISTENTE · refresh con el refresh_token PREVIO (lo que hace el navegador al F5) → token nuevo", rf.status === 200 && !!rfJ.access_token, String(rf.status));
  const me1 = rfJ.access_token ? await api(rfJ.access_token, "/api/game/me") : { status: 0 };
  check("SESIÓN EXISTENTE · operación autenticada con el token refrescado → 200", me1.status === 200, String(me1.status));
  const sTok: string = rfJ.access_token ?? S.access;

  // ── Alta / login / logout después de rotar.
  const T = await signup(anon, "t");
  check("ALTA · signup QA T después de rotar → sesión", T.status === 200 && !!T.access, { status: T.status, user: T.userId?.slice(0, 8) });
  guard(T.userId);
  writeFileSync(join(SP, "f77s1-T.json"), JSON.stringify(T));
  const lt = await passwordLogin(anon, T.email, T.password);
  check("LOGIN · contraseña de T → 200", lt.status === 200 && !!lt.access, String(lt.status));
  const lo = await auth(anon, "logout", { method: "POST", bearer: lt.access });
  check("LOGOUT · /auth/v1/logout → 204", lo.status === 204, String(lo.status));
  const rAfter = await auth(anon, "token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: lt.refresh }) });
  check("LOGOUT · el refresh_token de esa sesión ya no sirve", rAfter.status >= 400, String(rAfter.status));
  const lt2 = await passwordLogin(anon, T.email, T.password);
  check("LOGIN de nuevo tras logout → 200", lt2.status === 200 && !!lt2.access, String(lt2.status));
  const tTok = lt2.access!;
  const wrong = await passwordLogin(anon, T.email, T.password + "x");
  check("LOGIN · contraseña incorrecta → 400 sin sesión", wrong.status === 400 && !wrong.access, String(wrong.status));

  // ── RLS entre usuarios y anónimo.
  const cross = await rest(anon, sTok, `user_cards?user_id=eq.${T.userId}&select=user_id`);
  const crossJ = await body(cross);
  check("RLS · S NO lee las cartas de T (0 filas)", cross.status === 200 && Array.isArray(crossJ) && crossJ.length === 0, { status: cross.status, rows: Array.isArray(crossJ) ? crossJ.length : crossJ });
  const crossPriv = await rest(anon, sTok, `profiles?id=eq.${T.userId}&select=credits`);
  check("RLS · S NO lee columnas privadas del perfil de T", crossPriv.status >= 400 || ((await body(crossPriv)) as any[]).length === 0, String(crossPriv.status));
  const patchT = await rest(anon, sTok, `profiles?id=eq.${T.userId}`, { method: "PATCH", body: JSON.stringify({ username: "qaf77s1hack" }) });
  const patchTJ = await body(patchT);
  check("RLS · S NO modifica el perfil de T", patchT.status >= 400 || (Array.isArray(patchTJ) && patchTJ.length === 0), { status: patchT.status, rows: Array.isArray(patchTJ) ? patchTJ.length : "-" });
  const selfAdmin = await rest(anon, sTok, `profiles?id=eq.${S.userId}`, { method: "PATCH", body: JSON.stringify({ is_admin: true }) });
  const adminNow = dbRead<any>(`select json_build_object('s', (select is_admin from public.profiles where id = '${S.userId}'), 't', (select is_admin from public.profiles where id = '${T.userId}'), 'tname', (select username from public.profiles where id = '${T.userId}'), 'admins', (select count(*) from public.profiles where is_admin))::text`);
  check("ADMIN · un usuario normal NO puede hacerse admin (PATCH is_admin rechazado y BD = false)", selfAdmin.status >= 400 && adminNow.s === false, { status: selfAdmin.status, isAdmin: adminNow.s });
  check("RLS · el nombre de T sigue intacto en BD (el trigger añade _<id4>)", String(adminNow.tname).startsWith(`${T.username}_`) && adminNow.tname !== "qaf77s1hack", "");
  check("ADMIN · admins en BD = 1", Number(adminNow.admins) === 1, String(adminNow.admins));
  for (const t of ["user_cards", "economy_ops", "profiles", "user_packs"]) {
    const r = await rest(anon, null, `${t}?select=*&limit=1`);
    const j = await body(r);
    check(`ANON · ${t} sin filas privadas`, r.status >= 400 || (Array.isArray(j) && j.length === 0), { status: r.status, rows: Array.isArray(j) ? j.length : "-" });
  }
  const pub = await rest(anon, null, "agents?select=id&limit=1");
  const pubJ = await body(pub);
  check("ANON NUEVA · lectura pública permitida (agents) → 200", pub.status === 200 && Array.isArray(pubJ) && pubJ.length === 1, String(pub.status));

  // ── Humo de producto con cuentas QA existentes.
  const who: Record<string, string> = {};
  for (const k of ["A", "B", "C"] as const) {
    const c = JSON.parse(readFileSync(QA[k], "utf8"));
    guard(String(c.userId));
    const l = await passwordLogin(anon, c.email, c.password);
    if (check(`LOGIN QA ${k} (${String(c.userId).slice(0, 8)})`, l.status === 200 && !!l.access, String(l.status))) who[k] = l.access!;
  }
  const t = who.A ?? who.B;
  for (const p of ["/api/game/me", "/api/game/collection", "/api/game/state", "/api/game/missions", "/api/game/crafting", "/api/game/competitive", "/api/game/duels", "/api/game/daily-loop"]) {
    const r = await api(t, p);
    check(`PRODUCTO · GET ${p} → 200`, r.status === 200, String(r.status));
  }
  // Ranked F76: entrar en cola y salir.
  const tb = who.B ?? t;
  const decks = (await api(tb, "/api/game/duels")).json;
  const deck = (decks?.decks ?? []).find((x: any) => x.valid && x.id === decks.activeDeckId) ?? (decks?.decks ?? []).find((x: any) => x.valid);
  if (check("RANKED · la cuenta QA tiene un equipo válido", !!deck, deck?.id?.slice(0, 8) ?? "ninguno")) {
    const en = await api(tb, "/api/game/duel/matchmaking", { action: "enqueue", deckId: deck.id });
    check("RANKED F76 · enqueue → 200", en.status === 200, { status: en.status, state: en.json?.state ?? en.json?.status ?? en.json?.lifecycle });
    await sleep(1500);
    const ca = await api(tb, "/api/game/duel/matchmaking", { action: "cancel" });
    check("RANKED F76 · cancel → 200", ca.status === 200, { status: ca.status, state: ca.json?.state ?? ca.json?.status ?? ca.json?.lifecycle });
  }
  // PvE + reloj F72.8: empezar, una jugada legal, abandonar.
  const ta = who.A ?? t;
  const duel = (b: any) => api(ta, "/api/game/duel", b);
  const stale = (await duel({ action: "active" })).json?.view?.matchId;
  if (stale) await duel({ action: "abandon", matchId: stale });
  const da = (await api(ta, "/api/game/duels")).json;
  const dA = (da?.decks ?? []).find((x: any) => x.valid && x.id === da.activeDeckId) ?? (da?.decks ?? []).find((x: any) => x.valid);
  if (check("PVE · la cuenta QA A tiene un equipo válido", !!dA)) {
    const st = await duel({ action: "start", deckId: dA.id, difficulty: "EASY" });
    const v = st.json?.view;
    check("PVE · start → 200 con partida", st.status === 200 && !!v?.matchId, { status: st.status });
    check("F72.8 · la decisión nace con plazo del servidor (turnDeadlineAt futuro)", !!v && Number(v.turnDeadlineAt) > Date.now(), { inMs: v ? Number(v.turnDeadlineAt) - Date.now() : null });
    if (v?.matchId) {
      const card = v.yourHand?.[0];
      const move: any = { action: "play", matchId: v.matchId, cardUid: card?.uid };
      if (v.youAreAttacker) move.stat = "entryfrag";
      const pl = await duel(move);
      check("PVE · una jugada legal → 200 y la versión avanza", pl.status === 200 && Number(pl.json?.view?.stateVersion) > Number(v.stateVersion), { status: pl.status, v: [v.stateVersion, pl.json?.view?.stateVersion] });
      const ab = await duel({ action: "abandon", matchId: v.matchId });
      check("PVE · abandon → 200 (partida QA cerrada)", ab.status === 200, String(ab.status));
    }
  }
  const pass = results.filter((r) => r.ok).length;
  writeFileSync(join(OUT, "post.json"), JSON.stringify({ at: new Date().toISOString(), qa: { S: S.userId.slice(0, 8), T: T.userId?.slice(0, 8) }, pass, fail: results.length - pass, results }, null, 2));
  console.log(`→ ${pass}/${results.length}`);
}

(mode === "pre" ? pre() : mode === "post" ? post() : Promise.reject(new Error("uso: pre | post")))
  .then(() => process.exit(results.some((r) => !r.ok) ? 1 : 0))
  .catch((e) => { console.error(String(e?.message ?? e)); process.exit(3); });
