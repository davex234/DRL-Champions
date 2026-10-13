/**
 * F86.2 · CLOSED ALPHA READINESS — E2E MECÁNICO EN PRODUCCIÓN (instrumento, fuera de CI). NO es feedback humano: prueba
 * que el recorrido que harán 4–8 personas reales funciona, con cuentas QA NUEVAS registradas por el formulario real
 * (@example.invalid) y cuentas QA conocidas (A–G). La cuenta personal no se abre nunca (solo se comprueba al final).
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f862-alpha-e2e.mts   (cwd = prodqa)
 *
 * Recorrido: portada sin sesión → crear cuenta (validación) → #TAG → guía (sobres, colección, equipo, primera partida)
 * → partida rápida + resultado mínimo + «Seguir jugando» (doble clic) → ranked (cola y salida) → social por #TAG (sin
 * «#») → amistad → torneo QA no listado de 4 (inscripción por la UI, cuadro, espera, partida, avance, final, campeón,
 * trofeo, Sala de Trofeos) → feedback (borrador con F5, sin red, doble clic) → panel admin (feedback + embudo) →
 * logout / cambio de cuenta → cuadros representativos de 5 y 8 → seguridad → aislamiento → torneo de la alpha en
 * BORRADOR → capturas 1440/1024/390 × normal/reducido. Admin TEMPORAL en QA A (revocado al final, auditado).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { randomUUID } = await import("node:crypto");
const { openBrowser, loginUi, logoutUi, registerUi, token, api, waitFor, sleep, q, clickTid, clickText, goto, reload, playOneUi, PERSONA_FILES, creds, snapshot } = lib;
const { login, QA_FILES } = qa;
type Client = any;

const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/alpha";
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });
const RUN = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const SP = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/fcf17e93-8a34-40b9-8c19-cd7a585fa60c/scratchpad";
PERSONA_FILES.N1 = `${SP}/f862-n1-${RUN}.json`;
PERSONA_FILES.N2 = `${SP}/f862-n2-${RUN}.json`;
for (const k of ["A", "B", "C", "D", "E", "F", "G"]) PERSONA_FILES[`QA_${k}`] = QA_FILES[k];
// F87.1 · la cuenta personal 2f86cbe8 (#9KZAWPC) se BORRÓ el 2026-10-05: ya no se usa como referencia. Las cuentas
// reales son davex (#NB2Z9BM) y ValoRosters (#H5ND8K7), ambas admin: se LEEN (huella por SQL), nunca se abren ni se usan.
const REAL_ACCOUNTS = [["3befce61", "NB2Z9BM"], ["b7ccff02", "H5ND8K7"]] as const;
const PERSONAL = "2f86cbe8"; // guardia histórica: ningún actor puede ser la cuenta borrada
const REAL_ADMINS = REAL_ACCOUNTS.map(([p]) => p).join(",");
const isRealActor = (id: string) => id.startsWith(PERSONAL) || REAL_ACCOUNTS.some(([p]) => id.startsWith(p));
const realIntact = (s: string) => s.split("#").length === REAL_ACCOUNTS.length && s.split("#").every((x, i) => x.startsWith(`${REAL_ACCOUNTS[i][1]}|true|0|0|0|`));
const rows: { id: string; ok: boolean; detail: string }[] = [];
const times: Record<string, unknown> = {};
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const sql = (s: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: s, encoding: "utf8" }).trim();
const iso = (ms: number) => new Date(ms).toISOString();
const raw = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${BASE}${path}`, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: r.status, json: j, text: t }; };
const shot = async (c: Client, name: string) => { await c.tab.shot(`${SHOTS}/${name}.png`).catch(() => null); };
const overflow = async (c: Client) => c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth").catch(() => 99);
const text = async (c: Client) => c.tab.js<string>("document.body.innerText").catch(() => "");
const TECH = /(postgres|supabase|pgrst|sql\b|violates|constraint|duplicate key|stack trace|typeerror|undefined|internal server error|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)/i;
const anonKey = readFileSync(".env.local", "utf8").match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=("?)([^\r\n"]+)/)![2];

const personalOf = (PERSONAL: string) => sql(`select p.public_tag||'|'||p.is_admin||'|'||(select count(*) from cup_registrations r where left(r.user_id::text,8)='${PERSONAL}')||'|'||(select count(*) from cup_matches m where left(m.player_a::text,8)='${PERSONAL}' or left(m.player_b::text,8)='${PERSONAL}')||'|'||(select count(*) from user_cosmetics u where left(u.user_id::text,8)='${PERSONAL}' and u.cosmetic_id like 'insignia:torneo:%')||'|'||coalesce((select md5(to_jsonb(r)::text) from duel_pvp_ratings r where left(r.user_id::text,8)='${PERSONAL}'),'-')||'|'||coalesce((select credits||':'||xp from profiles where id=p.id),'-')||'|'||(select count(*) from alpha_feedback f where left(f.user_id::text,8)='${PERSONAL}') from profiles p where left(p.id::text,8)='${PERSONAL}';`);
const personal = () => REAL_ACCOUNTS.map(([p]) => personalOf(p)).join("#");
const personalBefore = personal();
const evBefore = sql("select count(*) from duel_pvp_rating_events;");
const runStart = sql("select now();");

/* ───────────── utilidades de la UI (copiadas de _fase68-beta: abrir sobre, jugar, seguir la guía) ───────────── */
async function openPackUi(c: Client): Promise<{ ok: boolean; cards: string[]; ms: number }> {
  const t0 = Date.now();
  if (!(await waitFor(c.tab, q("pack-open"), 20000))) return { ok: false, cards: [], ms: Date.now() - t0 };
  await sleep(400);
  await clickTid(c, "pack-open");
  for (let i = 0; i < 70; i++) {
    if (await c.tab.js<boolean>(q("pack-summary"))) break;
    const clicked = await clickTid(c, "pack-reveal-all") || await clickTid(c, "pack-skip");
    if (!clicked) await c.tab.js(`document.querySelector('[data-testid="ceremony-pack"]')?.click()`);
    await sleep(600);
  }
  const ok = await waitFor(c.tab, q("pack-summary"), 15000);
  const cards = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-testid="summary-card"]')].map(e => e.getAttribute('data-card-id'))`).catch(() => []);
  return { ok, cards: cards ?? [], ms: Date.now() - t0 };
}
async function playMatchUi(c: Client, t: string, reduced: boolean) {
  const t0 = Date.now();
  let turns = 0, stuck = 0, matchId: string | null = null;
  const RESULT = `!!document.querySelector('[data-scene="result"]')`;
  for (let guard = 0; guard < 40; guard++) {
    const v = (await api(t, "/api/game/duel", { action: "active" })).json?.view;
    if (v?.matchId) matchId = v.matchId;
    if (!v || v.status !== "IN_PROGRESS") break;
    if (await c.tab.js<boolean>(q("first-match-hint"))) { await clickTid(c, "first-match-hint-ok"); await sleep(300); }
    const r = await playOneUi(c);
    if (r !== "played") { stuck++; if (stuck > 4) break; await sleep(1000); continue; }
    stuck = 0;
    await waitFor(c.tab, `!!document.querySelector('[data-f61="moment"]')`, 12000);
    await sleep(reduced ? 900 : 1500);
    await c.tab.js(`document.querySelector('[data-f61="moment"]')?.click()`);
    turns++;
  }
  for (let i = 0; i < 60; i++) {
    if (await c.tab.js<boolean>(RESULT)) break;
    await c.tab.js(`document.querySelector('[data-scene="match-complete"], [data-scene="tiebreak"], [data-f61="moment"]')?.click()`);
    await sleep(500);
  }
  const shown = await waitFor(c.tab, RESULT, 20000);
  return { matchId, shown, turns, ms: Date.now() - t0 };
}
async function followGuide(c: Client, t: string, reduced: boolean, limit = 60) {
  const path: string[] = [];
  let lastKey = "", same = 0, quickExit = 0;
  for (let step = 0; step < limit; step++) {
    await sleep(900);
    const where = await c.tab.js<string>("location.pathname");
    const s = await c.tab.js<any>(`(() => { const has = (t) => !!document.querySelector('[data-testid="' + t + '"]'); return {
      welcome: has('onboarding-welcome'), starter: has('onboarding-starter'), openFirst: has('onboarding-open-first'), packOpen: has('pack-open'),
      summary: has('pack-summary'), firstCard: has('onboarding-first-card'), toCollection: has('onboarding-to-collection'), packNext: has('onboarding-pack-next'),
      collection: has('onboarding-collection'), cont: has('onboarding-continue'), team: has('onboarding-team'), cta: has('onboarding-cta'),
      start: /Comenzar duelo/i.test(document.body.innerText) && !!document.querySelector('section[aria-label="Elegir dificultad"]'),
      afterMatch: has('onboarding-after-match'), finishBtn: has('onboarding-finish'), mainActions: has('main-actions'),
      error: has('onboarding-error'), hand: document.querySelectorAll('[aria-label="Tu mano"] button').length, result: !!document.querySelector('[data-scene="result"]') } })()`);
    const key = where + JSON.stringify(s);
    same = key === lastKey ? same + 1 : 0; lastKey = key;
    if (same >= 4) { path.push(`ATASCO en ${where}`); break; }
    let did = "";
    if (s.error) did = "ERROR visible";
    if (s.welcome) { await clickTid(c, "onboarding-start"); did = "EMPEZAR"; }
    else if (where.startsWith("/abrir/") && s.packOpen && !s.summary) { const r = await openPackUi(c); did = `abrir sobre (${r.cards.length})`; }
    else if (s.firstCard && s.toCollection) { await clickTid(c, "onboarding-to-collection"); did = "ver mi colección"; }
    else if (where === "/duelos/jugar" && s.start) { await clickText(c, "^Comenzar duelo$"); did = "Comenzar duelo"; await sleep(2500); }
    else if (where === "/duelos/jugar" && s.hand > 0) { const m = await playMatchUi(c, t, reduced); did = `partida (${m.turns} turnos, resultado ${m.shown})`; }
    else if (s.afterMatch) { await clickTid(c, "onboarding-see-progress"); did = "ver mi progreso"; }
    else if (where === "/duelos/jugar" && s.result && s.hand === 0) {
      // F86.2 · el resultado de la primera partida es el MÍNIMO de la rápida (sin el paso de la guía). Lo que haría una
      // persona: «Volver al menú principal»; la portada retoma la guía («Continúa tu inicio»).
      const ok = await clickText(c, "^Volver al menú principal$"); did = ok ? "resultado mínimo → Volver al menú principal" : "resultado sin salida"; quickExit++;
    }
    else if (s.finishBtn) { await clickTid(c, "onboarding-finish"); path.push("SEGUIR JUGANDO (fin guía)"); await sleep(2500); break; }
    else if (s.starter && s.openFirst) { await clickTid(c, "onboarding-open-first"); did = "abrir primer sobre"; }
    else if (s.packNext || s.collection || s.cont || s.team || s.cta) { const ok = await clickTid(c, "onboarding-cta") || await clickTid(c, "onboarding-open-next"); did = ok ? "cta" : "cta no clicable"; }
    else if (where === "/" && s.mainActions && !s.cta && !s.cont) { path.push("portada sin guía"); break; }
    else did = `sin acción visible en ${where}`;
    path.push(`${where} → ${did}`);
    await sleep(1200);
  }
  return { path, quickExit, final: await snapshot(t) };
}

/* ───────────── admin temporal (QA A) ───────────── */
const A = await login("A"), B = await login("B");
const QAS = await Promise.all(["C", "D", "E", "F", "G"].map((k) => login(k)));
for (const w of [A, B, ...QAS]) if (isRealActor(w.userId)) throw new Error("cuenta real: prohibido");
const grantAdmin = () => sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"QA F86.2 alpha readiness (cuenta QA temporal)"}'); commit;`);
const revokeAdmin = () => sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"fin QA F86.2"}'); commit;`);
const ADM = "/api/admin/cups";
const adm = (body: unknown) => api(A.token, ADM, body, true);
async function makeCup(slug: string, name: string, size: { min: number; max: number }, closeInMs: number, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const made = await adm({ action: "create", fields: { slug, name, description: "Torneo QA de la preparación de la Closed Alpha (no listado).", rules: "Eliminación directa a partida única. Prueba QA.", registrationOpenAt: iso(now - 60_000), registrationCloseAt: iso(now + closeInMs), startsAt: iso(now + closeInMs), minParticipants: size.min, maxParticipants: size.max, roundWindowMinutes: 60, visibility: "UNLISTED", ...extra } });
  const id = made.json?.id as string;
  const pub = await adm({ action: "publish", id, version: Number(sql(`select version from cups where id='${id}';`)) });
  return { id, slug, created: made.status, published: pub.status };
}
async function closeAndGenerate(cup: { id: string; slug: string }) {
  const closeAt = Date.parse(sql(`select registration_close_at from cups where id='${cup.id}';`));
  while (Date.now() < closeAt + 1500) await sleep(1000);
  await raw(`/api/game/cups?slug=${cup.slug}`);
  sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = least(available_at, now() - interval '1 minute') where cup_id='${cup.id}' and round = 1; commit;`);
}

const deckOf = async (tok: string): Promise<string | undefined> => { const d = (await api(tok, "/api/game/duels")).json; return d?.activeDeckId ?? (d?.decks ?? []).find((x: any) => x.valid)?.id; };
grantAdmin();
const browsers: Client[] = [];
try {
  /* ═════════════ 1 · NUEVO JUGADOR EN ESCRITORIO (1440, movimiento normal) — navegador limpio ═════════════ */
  const n1 = await openBrowser("N1", 1440, { label: "f862-n1" }); browsers.push(n1);
  await n1.tab.goto(`${BASE}/`, 3000);
  const clean = await n1.tab.js<number>("(() => { try { return Object.keys(localStorage).filter(k => /auth-token|nexus/.test(k)).length } catch { return -1 } })()");
  check("navegador limpio: sin sesión ni caché previa", clean === 0, clean);
  check("portada sin sesión: «Crear cuenta» y «Entrar» a la vista", await waitFor(n1.tab, q("home-signup"), 20000) && await n1.tab.js<boolean>(q("home-login")));
  await shot(n1, "01-home-guest-1440");
  await clickTid(n1, "home-signup");
  check("«Crear cuenta» abre /cuenta en la pestaña de registro", await waitFor(n1.tab, `location.pathname === '/cuenta' && document.querySelector('[data-testid="auth-panel"]')?.dataset.mode === 'register'`, 15000));
  await shot(n1, "02-signup-1440");
  // Sin nombre: no se crea nada y el mensaje dice qué falta.
  await n1.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type="email"]'), 'qa-f862-noname-${RUN}@example.invalid'); set(document.querySelector('input[type="password"]'), 'Contrasena-larga-1');
    document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
  await sleep(1500);
  const noName = await text(n1);
  check("registro sin nombre → «Elige un nombre de jugador» y NINGUNA cuenta creada", /Elige un nombre de jugador/.test(noName) && sql(`select count(*) from auth.users where email = 'qa-f862-noname-${RUN}@example.invalid';`) === "0");
  const t0 = Date.now();
  const c1 = await registerUi(n1, "N1");
  times.signup_ms = Date.now() - t0;
  const N1 = c1.userId as string;
  check("registro real por el formulario → sesión y portada", !!N1 && (await n1.tab.js<string>("location.pathname")) === "/", { ms: times.signup_ms });
  const tag1 = sql(`select public_tag from profiles where id='${N1}';`);
  check("la cuenta nueva recibe su #TAG al nacer (7, alfabeto sin ambiguos)", /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/.test(tag1), tag1);
  check("el nombre público es el elegido (+ sufijo), nunca el correo", sql(`select username from profiles where id='${N1}';`).startsWith(c1.username) && !sql(`select username from profiles where id='${N1}';`).includes("@"));
  const tN1 = await token("N1");
  const s0 = await snapshot(tN1);
  check("sobres de bienvenida concedidos por el servidor (3 Inicial + 1 Bronce)", sql(`select string_agg(pack_id||':'||qty, ',' order by pack_id) from user_packs where user_id='${N1}';`) === "estandar:1,inicial:3", sql(`select string_agg(pack_id||':'||qty, ',' order by pack_id) from user_packs where user_id='${N1}';`));
  check("portada tras registrarse: bienvenida con UN botón principal", await waitFor(n1.tab, q("onboarding-welcome"), 25000));
  await shot(n1, "03-welcome-1440");
  // Guía F63 completa haciendo solo lo que propone la interfaz.
  const g1 = await followGuide(n1, tN1, false);
  times.guide_n1 = g1.path;
  check("guía completa por la interfaz (sobres → colección → equipo → primera partida → progreso)", g1.path.includes("SEGUIR JUGANDO (fin guía)") && !g1.path.some((p) => /ATASCO|ERROR|sin acción visible/.test(p)), g1.path.slice(-6));
  check("onboarding COMPLETED en el servidor + equipo válido y activo", g1.final.onboarding?.status === "COMPLETED" && g1.final.decks.some((d: any) => d.valid) && !!g1.final.activeDeckId, { ob: g1.final.onboarding?.status, decks: g1.final.decks?.length });
  const ops = Number(sql(`select count(*) from economy_ops where user_id='${N1}' and kind='open_pack';`));
  const cardsDb = Number(sql(`select count(*) from user_cards where user_id='${N1}';`));
  check("sobres abiertos en el SERVIDOR (economy_ops), cartas en BD y la API del jugador las ve", ops >= 1 && cardsDb > 0 && g1.final.ownedCards > 0 && g1.final.unopenedPacks !== null, { ops, cardsDb, api: g1.final.ownedCards, unopened: g1.final.unopenedPacks });
  await goto(n1, "/coleccion", 2500);
  check("colección: cartas reales de ESTA cuenta", /\b\d+\s*\/\s*331/.test(await text(n1)));
  await shot(n1, "04-collection-1440");

  /* ── partida rápida explícita + resultado mínimo + seguir jugando (doble clic) ── */
  await goto(n1, "/duelos", 2500);
  const qmLink = await n1.tab.js<boolean>(`(() => { const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '/duelos/jugar'); if (a) { a.click(); return true } return false })()`);
  check("/duelos → «Partida rápida» lleva a la preparación", qmLink && await waitFor(n1.tab, `location.pathname === '/duelos/jugar'`, 15000));
  await waitFor(n1.tab, `/Comenzar duelo/i.test(document.body.innerText)`, 20000);
  await shot(n1, "05-prematch-1440");
  await clickText(n1, "^Comenzar duelo$");
  await sleep(2500);
  const m1 = await playMatchUi(n1, tN1, false);
  // DUEL GAMEPLAY UX 2.0 · el resultado mínimo enseña «Recompensas obtenidas» (recibo del servidor); fuera de ese bloque, nada.
  const quick = await n1.tab.js<any>(`(() => { const r = document.querySelector('[data-scene="result"]'); if (!r) return null; const c = r.cloneNode(true); const rw = c.querySelector('[data-testid="quick-result-rewards"]'); const rewards = rw ? rw.textContent : ''; if (rw) rw.remove(); return { quick: r.dataset.result, text: r.innerText, outside: c.textContent, rewards } })()`);
  check("resultado de partida rápida MÍNIMO (veredicto, marcador, explicación, seguir / menú)", quick?.quick === "quick" && /Seguir jugando/i.test(quick.text) && /Volver al menú principal/i.test(quick.text), quick?.text?.slice(0, 160));
  check("…fuera de «Recompensas obtenidas»: sin puntos de rango, créditos, XP, nivel, misiones, logros ni botones de reclamar", !!quick && !/créditos|\bXP\b|nivel \d|misi[oó]n|logro|reclamar|rango|puntos de temporada/i.test(quick.outside), quick?.outside?.slice(0, 200));
  check("…y dentro, solo lo del recibo (créditos, XP de cuenta, puntos de rango): nada de nivel, misiones, logros ni reclamar", !!quick && !/nivel \d|misi[oó]n|logro|reclamar|puntos de temporada/i.test(quick.rewards ?? ""), quick?.rewards);
  await shot(n1, "06-quick-result-1440");
  const before = Number(sql(`select count(*) from duel_matches where user_id='${N1}' and mode='PVE';`));
  await n1.tab.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Seguir jugando/i.test(x.textContent || '')); b.click(); b.click(); })()`);
  await waitFor(n1.tab, `!document.querySelector('[data-scene="result"]')`, 20000);
  await sleep(2500);
  const after = Number(sql(`select count(*) from duel_matches where user_id='${N1}' and mode='PVE';`));
  const inProg = Number(sql(`select count(*) from duel_matches where user_id='${N1}' and mode='PVE' and status='IN_PROGRESS';`));
  check("«Seguir jugando» con DOBLE clic → UNA partida nueva (flujo canónico)", after === before + 1 && inProg === 1, { before, after, inProg });
  // F5 en mitad de la partida nueva: se recupera.
  await reload(n1, 3500);
  check("F5 en partida rápida → la misma partida se recupera", await waitFor(n1.tab, `!!document.querySelector('[data-hud="turno"]') || document.querySelectorAll('[aria-label="Tu mano"] button').length > 0`, 25000));
  const cur = (await api(tN1, "/api/game/duel", { action: "active" })).json?.view?.matchId;
  if (cur) await api(tN1, "/api/game/duel", { action: "abandon", matchId: cur });

  /* ── ranked ── */
  await goto(n1, "/competitivo", 3000);
  check("ranked accesible: /competitivo con colocación / sin clasificar", /Colocaci[oó]n|Sin clasificar|Competitivo/i.test(await text(n1)));
  await shot(n1, "07-ranked-1440");
  const deck1 = await deckOf(tN1);
  const enq = await api(tN1, "/api/game/duel/matchmaking", { action: "enqueue", deckId: deck1 }, true);
  const st = await api(tN1, "/api/game/duel/matchmaking");
  const cancel = await api(tN1, "/api/game/duel/matchmaking", { action: "cancel" }, true);
  const st2 = await api(tN1, "/api/game/duel/matchmaking");
  check("cola ranked: entrar → en cola → salir → fuera (sin MATCHED colgado)", enq.status === 200 && /QUEUED|SEARCHING/i.test(JSON.stringify(st.json)) && cancel.status === 200 && !/QUEUED|MATCHED/.test(String(st2.json?.state ?? st2.json?.status ?? "")), { enq: enq.status, st: st.json?.state ?? st.json?.status, st2: st2.json?.state ?? st2.json?.status });

  /* ── social: mi #TAG a la vista ── */
  await goto(n1, "/social", 3000);
  const myTag = await n1.tab.js<string | null>(`document.querySelector('[data-testid="social-self-tag"] [data-testid="account-tag"]')?.dataset.tag ?? null`);
  check("Social: MI #TAG visible y copiable, con su para qué", myTag === tag1 && /Pásaselo a un amigo/.test(await text(n1)), myTag);
  await shot(n1, "08-social-tag-1440");

  /* ═════════════ 2 · SEGUNDO JUGADOR NUEVO EN MÓVIL (390, movimiento reducido) ═════════════ */
  const n2 = await openBrowser("N2", 390, { reduced: true, label: "f862-n2" }); browsers.push(n2);
  await n2.tab.goto(`${BASE}/`, 3000);
  check("móvil 390: portada sin sesión con «Crear cuenta» a la vista y sin desbordar", await waitFor(n2.tab, q("home-signup"), 20000) && (await overflow(n2)) <= 0);
  await shot(n2, "11-home-guest-390-reduced");
  const c2 = await registerUi(n2, "N2");
  const N2 = c2.userId as string;
  const tN2 = await token("N2");
  const g2 = await followGuide(n2, tN2, true);
  check("móvil 390 reducido: guía completa por la interfaz", g2.path.includes("SEGUIR JUGANDO (fin guía)") && !g2.path.some((p) => /ATASCO|ERROR|sin acción visible/.test(p)), g2.path.slice(-6));
  check("móvil: equipo válido y activo", g2.final.decks.some((d: any) => d.valid) && !!g2.final.activeDeckId);
  // N2 busca a N1 por su tag pegado SIN «#».
  await goto(n2, "/social?tab=buscar", 3000);
  await n2.tab.js(`(() => { const i = document.querySelector('input[aria-describedby="social-search-hint"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(i, ${JSON.stringify(tag1)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const found = await waitFor(n2.tab, `document.querySelector('[data-testid="search-results"]')?.dataset.count >= 1 && /${c1.username}/i.test(document.querySelector('[data-testid="search-results"]').innerText)`, 15000);
  check("móvil: B encuentra a A pegando su tag SIN «#»", found);
  await shot(n2, "12-social-search-390-reduced");
  await n2.tab.js(`(() => { const r = document.querySelector('[data-testid="search-results"] li'); const b = [...r.querySelectorAll('button')].find(x => /^Añadir amigo$/i.test((x.textContent || '').trim())); b?.click(); return !!b })()`);
  await sleep(2500);
  const pend = sql(`select status||'|'||(requester_id='${N2}') from duel_friendships where (user_lo='${N1}' and user_hi='${N2}') or (user_lo='${N2}' and user_hi='${N1}');`);
  check("solicitud de amistad enviada por la UI", pend === "PENDING|true", pend);
  await goto(n1, "/social?tab=solicitudes", 3000);
  await n1.tab.js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Aceptar$/i.test((x.textContent || '').trim())); b?.click(); return !!b })()`);
  await sleep(2500);
  check("A acepta por la UI → amistad", sql(`select status from duel_friendships where (user_lo='${N1}' and user_hi='${N2}') or (user_lo='${N2}' and user_hi='${N1}');`) === "ACCEPTED");

  /* ═════════════ 3 · TORNEO QA NO LISTADO DE 4 (N1, N2, A, B) ═════════════ */
  const cup = await makeCup(`qa-f862-${RUN.slice(-8)}`, "QA F86.2 alpha (no listado)", { min: 4, max: 4 }, 120_000);
  check("torneo QA no listado publicado (admin temporal)", cup.created === 200 && cup.published === 200, cup);
  const hub = await raw("/api/game/cups");
  check("no listado: NO aparece en el hub público", !JSON.stringify(hub.json ?? {}).includes(cup.slug));
  for (const [c, label] of [[n1, "1440"], [n2, "390-reduced"]] as const) {
    await goto(c, `/copas/${cup.slug}`, 3000);
    const ok = await clickText(c, "^Inscribirme$");
    await sleep(2000);
    await shot(c, `13-cup-registered-${label}`);
    check(`inscripción por la UI desde el enlace (${label})`, ok && /Retirarme|Inscrito/i.test(await text(c)));
  }
  for (const w of [A, B]) await api(w.token, "/api/game/cups", { action: "register", slug: cup.slug }, true);
  check("4 inscritos", sql(`select participant_count from cups where id='${cup.id}';`) === "4");
  await closeAndGenerate(cup);
  check("cuadro de 4 generado (2 semifinales + final)", sql(`select count(*) from cup_matches where cup_id='${cup.id}';`) === "3");
  const semis = sql(`select id||'|'||player_a||'|'||player_b||'|'||slot from cup_matches where cup_id='${cup.id}' and round=1 order by slot;`).split("\n").map((l) => l.split("|"));
  const who = (id: string) => id === N1 ? { tok: tN1, c: n1, name: "N1" } : id === N2 ? { tok: tN2, c: n2, name: "N2" } : id === A.userId ? { tok: A.token, c: null, name: "A" } : { tok: B.token, c: null, name: "B" };
  for (const [mid, pa, pb, slot] of semis) {
    const a = who(pa), b = who(pb);
    // Gana la cuenta nueva (si hay dos nuevas, gana N1); pierde una QA si la hay.
    const loser = (a.name === "A" || a.name === "B") ? a : (b.name === "A" || b.name === "B") ? b : (a.name === "N2" ? a : b);
    const first = a.c ? a : b, second = first === a ? b : a;
    if (first.c) {
      await goto(first.c, `/copas/${cup.slug}`, 3000);
      await waitFor(first.c.tab, `document.querySelector('[data-testid="cup-my-match"]')?.dataset.state === 'READY'`, 20000);
      await first.c.tab.js(`document.querySelector('[data-testid="cup-play"]')?.click()`);
      check(`semifinal ${slot}: ${first.name} pulsa JUGAR → «esperando a tu rival»`, await waitFor(first.c.tab, `document.querySelector('[data-testid="cup-my-match"]')?.dataset.waiting === '1'`, 10000));
      await shot(first.c, `14-cup-waiting-${first.name}`);
    } else await api(first.tok, "/api/game/cups", { action: "ready", slug: cup.slug, round: 1, slot: Number(slot), deckId: await deckOf(first.tok) }, true);
    if (second.c) {
      await goto(second.c, `/copas/${cup.slug}`, 3000);
      await waitFor(second.c.tab, `document.querySelector('[data-testid="cup-my-match"]')?.dataset.state === 'READY'`, 20000);
      await second.c.tab.js(`document.querySelector('[data-testid="cup-play"]')?.click()`);
    } else await api(second.tok, "/api/game/cups", { action: "ready", slug: cup.slug, round: 1, slot: Number(slot), deckId: await deckOf(second.tok) }, true);
    const tGame = Date.now();
    let game = "";
    for (let i = 0; i < 40 && !game; i++) { game = sql(`select coalesce(game_match_id::text,'') from cup_matches where id='${mid}';`); if (!game) await sleep(250); }
    check(`semifinal ${slot}: UNA partida PVP_PRIVATE`, !!game && sql(`select count(*)||'|'||max(mode) from duel_matches where id='${game}';`) === "1|PVP_PRIVATE");
    for (const p of [first, second]) if (p.c) {
      const inArena = await waitFor(p.c.tab, `!!document.querySelector('[data-scene="pvp-arena"]')`, 15000);
      check(`semifinal ${slot}: ${p.name} entra en la arena (${Date.now() - tGame} ms)`, inArena);
    }
    await api(loser.tok, "/api/game/duel/pvp", { action: "abandon", matchId: game }, true);
    let done = "";
    for (let i = 0; i < 40 && done !== "COMPLETED"; i++) { done = sql(`select status from cup_matches where id='${mid}';`); if (done !== "COMPLETED") await sleep(250); }
    check(`semifinal ${slot}: resultado del motor → cruce COMPLETADO`, done === "COMPLETED");
    for (const p of [first, second]) if (p.c && p !== loser) {
      check(`semifinal ${slot}: ${p.name} ve «Has avanzado» en la arena`, await waitFor(p.c.tab, `document.querySelector('[data-testid="cup-outcome-result"]')?.dataset.outcome === 'ADVANCED'`, 20000));
      await shot(p.c, `15-cup-advanced-${p.name}`);
    }
  }
  // Final.
  const fin = sql(`select id||'|'||player_a||'|'||player_b from cup_matches where cup_id='${cup.id}' and round=2;`).split("|");
  sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = now() - interval '1 minute' where id='${fin[0]}'; commit;`);
  const fa = who(fin[1]), fb = who(fin[2]);
  const champ = fa.name === "N1" || fb.name === "N1" ? (fa.name === "N1" ? fa : fb) : (fa.c ? fa : fb);
  const runner = champ === fa ? fb : fa;
  for (const p of [fa, fb]) {
    if (p.c) { await goto(p.c, `/copas/${cup.slug}`, 3000); await waitFor(p.c.tab, `document.querySelector('[data-testid="cup-my-match"]')?.dataset.state === 'READY'`, 20000); await p.c.tab.js(`document.querySelector('[data-testid="cup-play"]')?.click()`); }
    else await api(p.tok, "/api/game/cups", { action: "ready", slug: cup.slug, round: 2, slot: 0, deckId: await deckOf(p.tok) }, true);
  }
  let fgame = "";
  for (let i = 0; i < 40 && !fgame; i++) { fgame = sql(`select coalesce(game_match_id::text,'') from cup_matches where id='${fin[0]}';`); if (!fgame) await sleep(250); }
  check("final: UNA partida", !!fgame);
  await api(runner.tok, "/api/game/duel/pvp", { action: "abandon", matchId: fgame }, true);
  let cs = "";
  for (let i = 0; i < 40 && !cs.startsWith("COMPLETED"); i++) { cs = sql(`select status||'|'||coalesce(champion_id::text,'') from cups where id='${cup.id}';`); if (!cs.startsWith("COMPLETED")) await sleep(300); }
  const champId = champ.name === "N1" ? N1 : champ.name === "N2" ? N2 : champ.name === "A" ? A.userId : B.userId;
  check(`campeón decidido por el motor (${champ.name})`, cs === `COMPLETED|${champId}`, cs);
  check("trofeo UNA vez", sql(`select count(*) from user_cosmetics where cosmetic_id='insignia:torneo:${cup.slug}';`) === "1");
  if (champ.c) {
    check("el campeón ve «¡Campeón del torneo!» en la arena", await waitFor(champ.c.tab, `document.querySelector('[data-testid="cup-outcome-result"]')?.dataset.outcome === 'CHAMPION'`, 20000));
    await goto(champ.c, `/copas/${cup.slug}`, 3500);
    check("ficha: momento de campeón + invitación al feedback", await waitFor(champ.c.tab, q("cup-champion"), 15000) && await champ.c.tab.js<boolean>(q("cup-feedback-invite")));
    await shot(champ.c, `16-cup-champion-${champ.name}`);
    await clickTid(champ.c, "cup-champion-trophies");
    check("«Sala de Trofeos» lleva a /coleccion/trofeos y el trofeo está ahí", await waitFor(champ.c.tab, `location.pathname === '/coleccion/trofeos' && /QA F86\\.2 alpha|Campe[oó]n/i.test(document.body.innerText)`, 20000));
    await shot(champ.c, `17-trophy-room-${champ.name}`);
  }
  check("las partidas del torneo son TOURNAMENT en la carrera propia", ((await api(tN1, `/api/game/player?id=${N1}&history=1`)).json?.items ?? []).some((i: any) => i.mode === "TOURNAMENT"));

  /* ═════════════ 4 · FEEDBACK (borrador + F5, sin red, doble clic) ═════════════ */
  await goto(n1, "/feedback?desde=cup", 3000);
  check("/feedback con sesión: formulario de 7 preguntas", await waitFor(n1.tab, q("feedback-form"), 15000));
  await n1.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('[data-testid="feedback-hardToUnderstand"]'), 'QA F86.2 · prueba mecánica, no es opinión humana'); })()`);
  await clickTid(n1, "feedback-return-8");
  await sleep(600);
  await reload(n1, 3000);
  const kept = await n1.tab.js<string>(`document.querySelector('[data-testid="feedback-hardToUnderstand"]')?.value ?? ''`);
  check("F5 en el formulario: el borrador sigue (esta cuenta, este navegador)", /prueba mecánica/.test(kept));
  await shot(n1, "18-feedback-1440");
  await n1.tab.send("Network.enable", {});
  await n1.tab.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickTid(n1, "feedback-submit");
  await sleep(1500);
  const offTxt = await n1.tab.js<string>(`document.querySelector('[data-testid="feedback-error"]')?.innerText ?? ''`);
  check("sin red: NO dice «enviado»; explica que no se envió", /Sin conexión/i.test(offTxt) && !(await n1.tab.js<boolean>(q("feedback-sent"))), offTxt);
  await n1.tab.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await n1.tab.js(`(() => { const b = document.querySelector('[data-testid="feedback-submit"]'); b.click(); b.click(); })()`);
  check("con red, doble clic → «¡Gracias!»", await waitFor(n1.tab, q("feedback-sent"), 15000));
  check("UNA fila de feedback (clave de envío fija)", sql(`select count(*) from alpha_feedback where user_id='${N1}';`) === "1");
  await n1.tab.send("Page.navigate", { url: `${BASE}/feedback` }); await sleep(2500);
  await n1.tab.js("history.back()"); await sleep(2500);
  check("atrás tras enviar: no se reenvía nada", sql(`select count(*) from alpha_feedback where user_id='${N1}';`) === "1");

  /* ═════════════ 5 · SEGURIDAD ═════════════ */
  check("feedback anónimo → 401", (await raw("/api/game/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "submit", id: randomUUID(), comment: "x" }) })).status === 401);
  check("feedback con userId falso → 400", (await api(tN2, "/api/game/feedback", { action: "submit", id: randomUUID(), comment: "x", userId: N1 }, true)).status === 400);
  check("feedback vacío → 400", (await api(tN2, "/api/game/feedback", { action: "submit", id: randomUUID(), comment: "  " }, true)).status === 400);
  check("feedback: no hay lectura para jugadores (GET → 405)", (await raw("/api/game/feedback", { headers: { authorization: `Bearer ${tN2}` } })).status === 405);
  const restRead = await raw("/rest/v1/alpha_feedback?select=*", { headers: { apikey: anonKey, authorization: `Bearer ${tN2}` } });
  check("REST directo: otra cuenta NO lee el feedback de nadie", restRead.status >= 400 || (Array.isArray(restRead.json) && restRead.json.length === 0), restRead.status);
  const restIns = await raw("/rest/v1/alpha_feedback", { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${tN2}`, "content-type": "application/json" }, body: JSON.stringify({ id: randomUUID(), user_id: N1, comment: "suplantado" }) });
  check("REST directo: insertar feedback (o suplantar) → rechazado", restIns.status >= 400, restIns.status);
  const rpc = await raw("/rest/v1/rpc/app_alpha_funnel", { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${tN2}`, "content-type": "application/json" }, body: JSON.stringify({ p_since: iso(Date.now() - 86_400_000) }) });
  check("REST directo: el embudo no lo ejecuta un jugador", rpc.status >= 400, rpc.status);
  check("panel alpha como usuario normal → 401", (await api(tN2, "/api/admin/alpha?view=feedback")).status === 401);
  check("panel alpha anónimo → 401", (await raw("/api/admin/alpha?view=feedback")).status === 401);
  check("inscribirse en un torneo ya cerrado → rechazado", (await api(tN2, "/api/game/cups", { action: "register", slug: cup.slug }, true)).status >= 400);
  check("«listo» con equipo ajeno / cruce ajeno → 404", (await api(tN2, "/api/game/cups", { action: "ready", slug: cup.slug, round: 2, slot: 0, deckId: await deckOf(tN1) }, true)).status === 404);

  /* ═════════════ 6 · PANEL ADMIN (feedback + embudo), con el admin temporal ═════════════ */
  const fbDef = await api(A.token, "/api/admin/alpha?view=feedback");
  check("admin: por defecto el feedback de cuentas de PRUEBA no se mezcla con el de testers reales", fbDef.status === 200 && !(fbDef.json?.items ?? []).some((i: any) => i.tag === tag1) && fbDef.json?.hiddenTest >= 1, { hidden: fbDef.json?.hiddenTest });
  const fbAdm = await api(A.token, "/api/admin/alpha?view=feedback&test=1");
  const mine = (fbAdm.json?.items ?? []).find((i: any) => i.tag === tag1);
  check("admin: el feedback aparece con nombre + #TAG, fecha y respuestas", fbAdm.status === 200 && !!mine && mine.wouldReturn === 8 && mine.source === "cup", mine);
  check("admin: sin correos en la respuesta", !/@example\.invalid|@gmail|"email"/i.test(fbAdm.text));
  const fn = await api(A.token, `/api/admin/alpha?view=funnel&since=${encodeURIComponent(runStart.replace(" ", "T").replace(/\+00$/, "Z"))}&test=1`);
  const p1 = (fn.json?.players ?? []).find((p: any) => p.tag === tag1);
  check("embudo (cuentas de prueba incluidas): N1 con sobre, equipo, rápida, ranked, social, amigo, torneo, final y feedback", fn.status === 200 && !!p1 && p1.packOpened && p1.deckSaved && p1.quickCompleted && p1.rankedTouched && p1.socialUsed && p1.friendAdded && p1.cupRegistered && p1.cupPlayed && p1.cupFinal && p1.feedbackSent, p1);
  const fnReal = await api(A.token, `/api/admin/alpha?view=funnel&since=${encodeURIComponent(runStart.replace(" ", "T").replace(/\+00$/, "Z"))}`);
  check("embudo por defecto: las cuentas de prueba NO cuentan (cohorte real vacía en esta QA)", fnReal.status === 200 && fnReal.json?.accounts === 0, fnReal.json?.accounts);
  times.funnel = fn.json?.steps;
  const ab = await openBrowser("QA_A", 1440, { label: "f862-admin" }); browsers.push(ab);
  await loginUi(ab, "QA_A");
  await goto(ab, "/admin/alpha", 3500);
  await waitFor(ab.tab, q("alpha-include-test"), 20000);
  await clickTid(ab, "alpha-include-test");
  check("panel /admin/alpha (UI): feedback visible", await waitFor(ab.tab, q("alpha-feedback-item"), 20000));
  await shot(ab, "21-admin-alpha-feedback-1440");
  await clickTid(ab, "alpha-tab-funnel");
  await sleep(500);
  await ab.tab.js(`(() => { const i = document.querySelector('[data-testid="alpha-since"]'); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); const t = new Date(Date.now() - 3 * 3600_000); const p = (n) => String(n).padStart(2, '0'); d.set.call(i, t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + 'T' + p(t.getHours()) + ':' + p(t.getMinutes())); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check("panel /admin/alpha (UI): embudo con sus 13 pasos", await waitFor(ab.tab, `document.querySelectorAll('[data-testid="alpha-funnel"] tr').length === 13`, 20000));
  await shot(ab, "22-admin-alpha-funnel-1440");

  /* ═════════════ 7 · CUADROS REPRESENTATIVOS 5 y 8 (estructura y BYES canónicos) ═════════════ */
  const c5 = await makeCup(`qa-f862-5-${RUN.slice(-8)}`, "QA F86.2 cuadro de 5 (no listado)", { min: 4, max: 8 }, 60_000);
  for (const w of [A, B, ...QAS.slice(0, 3)]) await api(w.token, "/api/game/cups", { action: "register", slug: c5.slug }, true);
  const c8 = await makeCup(`qa-f862-8-${RUN.slice(-8)}`, "QA F86.2 cuadro de 8 (no listado)", { min: 4, max: 8 }, 60_000);
  for (const w of [A, B, ...QAS]) await api(w.token, "/api/game/cups", { action: "register", slug: c8.slug }, true);
  await api(tN2, "/api/game/cups", { action: "register", slug: c8.slug }, true);
  await closeAndGenerate(c5); await closeAndGenerate(c8);
  const shape = (id: string) => sql(`select count(*) filter (where round=1)||'/'||count(*)||'/'||max(round)||'/'||count(*) filter (where round=1 and (a_empty or b_empty)) from cup_matches where cup_id='${id}';`);
  check("cuadro de 5: tamaño 8, 3 rondas, 3 BYES en la primera ronda", sql(`select participant_count from cups where id='${c5.id}';`) === "5" && shape(c5.id) === "4/7/3/3", shape(c5.id));
  check("cuadro de 8: 4 cruces en la primera ronda, 3 rondas, 0 BYES", sql(`select participant_count from cups where id='${c8.id}';`) === "8" && shape(c8.id) === "4/7/3/0", shape(c8.id));
  for (const c of [c5, c8]) await adm({ action: "cancel", id: c.id, reason: "QA F86.2: cuadro representativo comprobado", confirm: c.slug });
  check("cuadros representativos cancelados por el panel (auditado, sin campeón)", sql(`select string_agg(status, ',' order by slug) from cups where id in ('${c5.id}','${c8.id}');`) === "CANCELLED,CANCELLED");

  /* ═════════════ 8 · TORNEO DE LA ALPHA: SOLO BORRADOR ═════════════ */
  const ALPHA_SLUG = "valorosters-closed-alpha-cup";
  let alphaId = sql(`select coalesce((select id::text from cups where slug='${ALPHA_SLUG}'),'');`);
  if (!alphaId) {
    const open = Date.parse("2026-11-02T17:00:00Z");
    const r = await adm({ action: "create", fields: {
      slug: ALPHA_SLUG, name: "Valorosters Closed Alpha Cup",
      description: "Torneo de PRUEBA de la Closed Alpha de Valorosters (test cerrado, solo por invitación). Fechas provisionales: la organización las fija antes de publicarlo.",
      rules: "Eliminación directa a partida única. Cuadro sembrado por rating ranked al cerrar la inscripción. Si alguien no se presenta a tiempo o hay empate exacto, decide la organización (nunca un sorteo). Torneo de test: sin premios más allá del trofeo de campeón.",
      registrationOpenAt: iso(open), registrationCloseAt: iso(open + 60 * 60_000), startsAt: iso(open + 60 * 60_000),
      minParticipants: 4, maxParticipants: 8, roundWindowMinutes: 90, visibility: "UNLISTED" } });
    alphaId = r.json?.id ?? "";
  }
  check("«Valorosters Closed Alpha Cup» creada en BORRADOR, no listada (no publicada)", sql(`select status||'|'||visibility||'|'||participant_count from cups where slug='${ALPHA_SLUG}';`) === "DRAFT|UNLISTED|0");
  check("la Closed Alpha Cup NO es visible para jugadores (borrador = 404)", (await raw(`/api/game/cups?slug=${ALPHA_SLUG}`)).status === 404);

  /* ═════════════ 9 · LOGOUT / CAMBIO DE CUENTA ═════════════ */
  check("logout por la UI", await logoutUi(n1));
  await goto(n1, "/", 2500);
  check("tras logout: portada de invitado, sin créditos ni datos de la cuenta", await waitFor(n1.tab, q("home-signup"), 15000) && !(await n1.tab.js<boolean>(q("hud-credits"))));
  await loginUi(n1, "N2");
  await goto(n1, "/social", 3000);
  const t2 = await n1.tab.js<string | null>(`document.querySelector('[data-testid="social-self-tag"] [data-testid="account-tag"]')?.dataset.tag ?? null`);
  check("cambio de cuenta A → B: el #TAG, el social y el resto son de B (nada de A)", t2 === sql(`select public_tag from profiles where id='${N2}';`) && t2 !== tag1, t2);
  await goto(n1, "/feedback", 2500);
  check("cambio de cuenta: el borrador de feedback de A no aparece en B", (await n1.tab.js<string>(`document.querySelector('[data-testid="feedback-hardToUnderstand"]')?.value ?? ''`)) === "");
  await logoutUi(n1);
  check("volver a entrar (A) recupera su estado real (equipo activo y torneo)", await loginUi(n1, "N1") && !!(await snapshot(await token("N1"))).activeDeckId);

  /* ═════════════ 10 · CAPTURAS 1440 / 1024 / 390 × normal / reducido + desbordamiento ═════════════ */
  const PAGES = ["/", "/coleccion", "/duelos", "/competitivo", "/social", `/copas/${cup.slug}`, "/coleccion/trofeos", "/jugador/me", "/feedback"];
  for (const [w, reduced] of [[1440, false], [1440, true], [1024, false], [1024, true], [390, false], [390, true]] as const) {
    const v = await openBrowser("N1", w, { reduced, label: `f862-v-${w}-${reduced ? "r" : "n"}` });
    try {
      await loginUi(v, "N1");
      for (const p of PAGES) {
        await goto(v, p, 2800);
        const ox = await overflow(v), tx = await text(v);
        check(`visual ${w}${reduced ? " reducido" : ""} ${p}: sin desbordamiento ni texto técnico`, ox <= 0 && !TECH.test(tx), { ox, tech: (tx.match(TECH) ?? [])[0] ?? null });
        await shot(v, `v-${w}-${reduced ? "reduced" : "normal"}-${p.replace(/[/?=]/g, "_").replace(/_+$/, "") || "_home"}`);
      }
    } finally { await v.browser.close().catch(() => null); }
  }
} finally {
  for (const b of browsers) await b.browser.close().catch(() => null);
  revokeAdmin();
}

/* ═════════════ 11 · AISLAMIENTO Y CIERRE ═════════════ */
check("0 eventos de rating nuevos por el torneo (ranked intacto)", Number(sql("select count(*) from duel_pvp_rating_events;")) - Number(evBefore) === Number(sql(`select count(*) from duel_pvp_rating_events where created_at >= '${runStart}';`)) && sql(`select count(*) from duel_pvp_rating_events e join cup_matches m on m.game_match_id = e.match_id;`) === "0");
check("0 misiones contadas por partidas de torneo", sql(`select count(*) from mission_events e where exists (select 1 from cup_matches m where m.game_match_id is not null and e.event_key like '%'||m.game_match_id||'%');`) === "0");
check("0 XP de temporada por partidas de torneo", sql(`select count(*) from season_xp_ledger x where exists (select 1 from cup_matches m where m.game_match_id is not null and (x.event_key like '%'||m.game_match_id||'%' or x.meta::text like '%'||m.game_match_id||'%'));`) === "0");
check("0 créditos por partidas de torneo", sql(`select count(*) from credit_transactions where ref in (select game_match_id::text from cup_matches where game_match_id is not null) or ref like any (select '%'||game_match_id||'%' from cup_matches where game_match_id is not null);`) === "0");
check("limpieza: QA A sin admin; admins = exactamente las 2 cuentas reales", sql("select string_agg(left(id::text,8), ',' order by id) from profiles where is_admin;") === REAL_ADMINS);
check("cuentas reales INTACTAS (#NB2Z9BM y #H5ND8K7, admin, 0 torneos, 0 feedback, rating/créditos/XP iguales)", personal() === personalBefore && realIntact(personalBefore), personalBefore.split("#").map((s) => s.split("|").slice(0, 5).join("|")).join(" · "));
check("Valorosters Open #1 sigue en BORRADOR; Temporada 2 en DRAFT", sql("select status from cups where slug='valorosters-open-1';") === "DRAFT" && sql("select status from game_seasons where id='temporada-2';") === "DRAFT");

const pass = rows.filter((r) => r.ok).length;
writeFileSync(`${OUT}/alpha-e2e.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, run: RUN, times, total: rows.length, pass, fail: rows.length - pass, rows }, null, 1));
console.log(`\nF86.2 ALPHA E2E: ${pass}/${rows.length}`);
process.exit(pass === rows.length ? 0 : 1);
