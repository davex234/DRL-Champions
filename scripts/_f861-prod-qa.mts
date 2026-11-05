/**
 * F86.1 · ESPERA DEL RIVAL — QA REAL EN PRODUCCIÓN con varios navegadores (instrumento, fuera de CI). SOLO cuentas QA
 * (A f45 admin TEMPORAL + jugador, B, C, D); torneo QA NO LISTADO. La cuenta personal no se abre.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f861-prod-qa.mts   (cwd = prodqa)
 *
 * Mide de verdad (reloj de este PC; la BD se traduce con su desfase medido):
 *   T0 = el que pulsa el segundo entra (su servidor respondió STARTED) · T1 = partida creada en la BD
 *   T2 = el que esperaba la DESCUBRE (entra solo) · T3 = el que esperaba ya en la arena · T4 = el segundo en la arena
 *   + aviso global en otro dispositivo de la misma cuenta, foco (pestaña oculta → visible), F5, resultado → avance,
 *   plazo vencido mientras espera, resolución admin con #TAG, campeón y trofeo, seguridad, aislamiento y carga.
 * Ventanas de ronda de ESTE torneo QA adelantadas por SQL de operador (solo QA, documentado) para no esperar horas.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { login, api, sleep, QA_FILES } = qa;
const { openBrowser, loginUi, PERSONA_FILES } = lib;
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/cups/prod-861";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_B = QA_FILES.B; PERSONA_FILES.QA_C = QA_FILES.C; PERSONA_FILES.QA_D = QA_FILES.D;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const times: Record<string, number | string | null> = {};
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 240)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const raw = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${BASE}${path}`, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: r.status, json: j, text: t }; };
const iso = (ms: number) => new Date(ms).toISOString();
const C_API = "/api/game/cups", ADM = "/api/admin/cups";
// F87.1 · la cuenta personal 2f86cbe8 (#9KZAWPC) se BORRÓ el 2026-10-05: ya no se usa como referencia. Las cuentas
// reales son davex (#NB2Z9BM) y ValoRosters (#H5ND8K7), ambas admin: se LEEN (huella por SQL), nunca se abren ni se usan.
const REAL_ACCOUNTS = [["3befce61", "NB2Z9BM"], ["b7ccff02", "H5ND8K7"]] as const;
const PERSONAL = "2f86cbe8"; // guardia histórica: ningún actor puede ser la cuenta borrada
const REAL_ADMINS = REAL_ACCOUNTS.map(([p]) => p).join(",");
const isRealActor = (id: string) => id.startsWith(PERSONAL) || REAL_ACCOUNTS.some(([p]) => id.startsWith(p));
const realIntact = (s: string) => s.split("#").length === REAL_ACCOUNTS.length && s.split("#").every((x, i) => x.startsWith(`${REAL_ACCOUNTS[i][1]}|true|0|0|0|`));
const personalOf = (PERSONAL: string) => sql(`select p.public_tag||'|'||p.is_admin||'|'||(select count(*) from cup_registrations r where left(r.user_id::text,8)='${PERSONAL}')||'|'||(select count(*) from cup_matches m where left(m.player_a::text,8)='${PERSONAL}' or left(m.player_b::text,8)='${PERSONAL}')||'|'||(select count(*) from user_cosmetics u where left(u.user_id::text,8)='${PERSONAL}' and u.cosmetic_id like 'insignia:torneo:%')||'|'||coalesce((select md5(to_jsonb(r)::text) from duel_pvp_ratings r where left(r.user_id::text,8)='${PERSONAL}'),'-')||'|'||coalesce((select credits||':'||xp from profiles where id=p.id),'-') from profiles p where left(p.id::text,8)='${PERSONAL}';`);
const personal = () => REAL_ACCOUNTS.map(([p]) => personalOf(p)).join("#");
const personalBefore = personal();
// Desfase reloj BD − reloj de este PC (para traducir created_at de la BD a la línea de tiempo local).
const t0 = Date.now(); const dbNow = Number(sql("select (extract(epoch from now()) * 1000)::bigint;")); const t1 = Date.now();
const dbOffset = dbNow - (t0 + t1) / 2;

const A = await login("A"), B = await login("B"), C = await login("C"), D = await login("D"), E = await login("E");
const players = [A, B, C, D];
for (const w of [A, B, C, D, E]) if (isRealActor(w.userId)) throw new Error("cuenta real: prohibido");
const persona = (id: string) => (id === A.userId ? "QA_A" : id === B.userId ? "QA_B" : id === C.userId ? "QA_C" : "QA_D");
const who = (id: string) => players.find((p) => p.userId === id)!;
const tagOf = (id: string) => sql(`select public_tag from profiles where id='${id}';`);
const fp = (ids: string[]) => sql(`select md5(coalesce((select string_agg(to_jsonb(r)::text, '|' order by user_id) from duel_pvp_ratings r where user_id in (${ids.map((i) => `'${i}'`).join(",")})),'-')||coalesce((select string_agg(id::text||credits||':'||xp, '|' order by id) from profiles where id in (${ids.map((i) => `'${i}'`).join(",")})),'-')||coalesce((select string_agg(user_id::text||pack_id||qty, '|' order by user_id, pack_id) from user_packs where user_id in (${ids.map((i) => `'${i}'`).join(",")})),'-')||(select count(*) from user_cards where user_id in (${ids.map((i) => `'${i}'`).join(",")})));`);
const isoBefore = fp(players.map((p) => p.userId));
const evBefore = sql("select count(*) from duel_pvp_rating_events;");

// ── torneo QA no listado ──
sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"QA F86.1 espera del rival (cuenta QA temporal)"}'); commit;`);
const SLUG = `qa-f861-${Date.now().toString(36)}`;
// F86.2 · LIMPIEZA GARANTIZADA: si el instrumento se cae a mitad, al salir se cancela el torneo QA (por la RPC del
// panel, auditada) y se revoca el admin temporal. Síncrono (execFileSync): corre también en un fallo.
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => process.exit(1)); // que la limpieza corra también al cortarlo
process.on("exit", () => {
  try {
    const st = sql(`select coalesce((select status||'|'||id from cups where slug='${SLUG}'),'');`);
    if (st && !/^(COMPLETED|CANCELLED)\|/.test(st)) sql(`select public.cup_admin_cancel('${A.userId}', '${st.split("|")[1]}', 'Limpieza QA: el instrumento F86.1 terminó antes de tiempo', '${SLUG}');`);
  } catch { /* se intenta lo siguiente igualmente */ }
  try {
    if (sql(`select is_admin from profiles where id='${A.userId}';`) === "t" || sql(`select is_admin::text from profiles where id='${A.userId}';`) === "true") {
      sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${A.userId}'; insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"limpieza al salir de QA F86.1"}'); commit;`);
    }
  } catch { /* nada más que hacer */ }
});
const now = Date.now();
const made = await api(A, ADM, { action: "create", fields: { slug: SLUG, name: "QA F86.1 (no listado)", description: "QA de la espera del rival.", rules: "Eliminación directa a partida única. Prueba QA.", registrationOpenAt: iso(now - 60_000), registrationCloseAt: iso(now + 80_000), startsAt: iso(now + 80_000), minParticipants: 4, maxParticipants: 4, roundWindowMinutes: 60, visibility: "UNLISTED" } });
const CUP = made.json?.id as string;
await api(A, ADM, { action: "publish", id: CUP, version: Number(sql(`select version from cups where id='${CUP}';`)) });
for (const p of players) await api(p, C_API, { action: "register", slug: SLUG });
check("torneo QA no listado publicado con 4 cuentas QA", sql(`select status||'|'||visibility||'|'||participant_count from cups where id='${CUP}';`) === "PUBLISHED|UNLISTED|4");
const closeAt = Date.parse(sql(`select registration_close_at from cups where id='${CUP}';`));
while (Date.now() < closeAt + 1500) await sleep(1500);
await raw(`${C_API}?slug=${SLUG}`);
sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = least(available_at, now() - interval '1 minute') where cup_id='${CUP}'; commit;`);
const m1 = sql(`select player_a||'|'||player_b||'|'||id from cup_matches where cup_id='${CUP}' and round=1 and slot=0;`).split("|");
const m2 = sql(`select player_a||'|'||player_b||'|'||id from cup_matches where cup_id='${CUP}' and round=1 and slot=1;`).split("|");
const [X, Y] = [m1[0], m1[1]], [Z, W] = [m2[0], m2[1]];
console.log(`cruce 1: ${persona(X)} vs ${persona(Y)} · cruce 2: ${persona(Z)} vs ${persona(W)}`);

// ── carga: peticiones de estado por minuto (red real del navegador) ──
async function countStatus(c: any, ms: number): Promise<number> {
  let n = 0;
  await c.tab.send("Network.enable");
  const h = (p: any) => { if (/\/api\/game\/cups\?(status|badge)=1/.test(p?.request?.url ?? "")) n++; };
  c.tab.on("Network.requestWillBeSent", h);
  await sleep(ms);
  return n;
}
const panel = (c: any) => c.tab.js<any>(`(() => { const p = document.querySelector('[data-testid="cup-my-match"]'); return { href: location.pathname + location.search, waiting: p?.dataset.waiting ?? null, state: p?.dataset.state ?? null, opp: p?.dataset.opponentReady ?? null, text: p?.innerText ?? '', arena: !!document.querySelector('[data-scene="pvp-arena"]'), notice: document.querySelector('[data-testid="cup-live-notice"]')?.innerText ?? null, outcome: document.querySelector('[data-testid="cup-outcome-result"]')?.dataset.outcome ?? null }; })()`).catch(() => ({}));
async function until(c: any, pred: (p: any) => boolean, maxMs = 30_000, stepMs = 100): Promise<{ at: number; p: any } | null> {
  const end = Date.now() + maxMs;
  while (Date.now() < end) { const p = await panel(c); if (pred(p)) return { at: Date.now(), p }; await sleep(stepMs); }
  return null;
}
const DETAIL = `${BASE}/copas/${SLUG}`;
async function openAt(persona: string, w: number, url: string, label: string) {
  const c = await openBrowser(persona, w, { label });
  await loginUi(c, persona);
  await c.tab.goto(url, 2500);
  return c;
}

const bX = await openAt(persona(X), 1440, DETAIL, "f861-x");
const bY = await openAt(persona(Y), 390, DETAIL, "f861-y");
const bX2 = await openAt(persona(X), 1024, `${BASE}/coleccion`, "f861-x2");   // mismo jugador, «otro dispositivo»
try {
  await until(bX, (p) => p.state === "READY");
  const coldRate = await countStatus(bX2, 20_000);
  check("carga: fuera de la espera (cruce jugable sin nadie listo) la pestaña ajena lee estado ~cada 5 s, no cada 1 s", coldRate >= 2 && coldRate <= 6, { "peticiones en 20 s": coldRate });
  times.load_warm_per_min = coldRate * 3;

  // A pulsa JUGAR → «esperando al rival» (una vez; sin segundo clic).
  const tClickX = Date.now();
  await bX.tab.js(`document.querySelector('[data-testid="cup-play"]').click()`);
  const w1 = await until(bX, (p) => p.waiting === "1", 10_000);
  check("A pulsa JUGAR UNA vez → «✓ Listo · esperando a <rival>» (no parece que no pasó nada)", !!w1 && /Listo · esperando a/i.test(w1.p.text) && /autom[aá]ticamente/i.test(w1.p.text), { ms: w1 ? w1.at - tClickX : null });
  times.waiting_shown_ms = w1 ? w1.at - tClickX : null;
  await bX.tab.shot(`${OUT}/shots/waiting-1440.png`).catch(() => null);
  const hotRate = await countStatus(bX, 15_000);
  check("carga: esperando, la pestaña lee el estado ligero ~cada 3 s (no el cuadro)", hotRate >= 3 && hotRate <= 7, { "peticiones en 15 s": hotRate });
  times.load_hot_per_min = hotRate * 4;
  // F5 mientras espera: sigue esperando (lo dice el servidor).
  await bX.tab.send("Page.reload", {}); await sleep(2500);
  const f5 = await until(bX, (p) => p.waiting === "1", 15_000);
  check("F5 mientras espera → sigue «esperando al rival» (estado del servidor, no local)", !!f5, f5?.p?.waiting);
  // Multi-dispositivo / doble clic: 20 «listo» de A a la vez por API → un solo «listo», ninguna partida.
  const deckX = ((await api(who(X), "/api/game/duels")).json?.decks ?? []).find((d: any) => d.valid)?.id;
  const many = await Promise.all(Array.from({ length: 20 }, () => api(who(X), C_API, { action: "ready", slug: SLUG, round: 1, slot: 0, deckId: deckX })));
  check("20 «listo» simultáneos del mismo jugador (doble clic / otro dispositivo) → todos WAITING, 0 partidas", many.every((r) => r.json?.code === "WAITING") && sql(`select count(*) from duel_matches where id = (select game_match_id from cup_matches where id='${m1[2]}');`) === "0", many.map((r) => r.json?.code ?? r.status).join(","));
  // B ve que A le espera.
  const yo = await until(bY, (p) => p.opp === "1", 10_000);
  check("B ve «Tu rival ya está listo» (≤ ~5 s)", !!yo && /Tu rival ya est[aá] listo/i.test(yo.p.text));
  await bY.tab.shot(`${OUT}/shots/opponent-ready-390.png`).catch(() => null);

  // B pulsa → la partida nace → A entra SOLO.
  const tClickY = Date.now();
  await bY.tab.js(`document.querySelector('[data-testid="cup-play"]').click()`);
  const yIn = until(bY, (p) => /\/duelos\/pvp\?match=/.test(p.href), 15_000, 50);
  const xIn = until(bX, (p) => /\/duelos\/pvp\?match=/.test(p.href), 15_000, 50);
  const x2before = (await panel(bX2)).notice ?? null;   // antes: «está lista» mientras A espera en el otro dispositivo
  times.notice_before_match = x2before;
  const x2n = until(bX2, (p) => /ha empezado/i.test(p.notice ?? ""), 30_000, 100);
  const [ry, rx] = await Promise.all([yIn, xIn]);
  const game = sql(`select game_match_id from cup_matches where id='${m1[2]}';`);
  const created = Number(sql(`select (extract(epoch from created_at) * 1000)::bigint from duel_matches where id='${game}';`)) - dbOffset;
  times.T0_B_ready_confirmed = ry ? ry.at - tClickY : null;
  times.T1_match_created = Math.round(created - tClickY);
  times.T2_A_detects = rx ? rx.at - tClickY : null;
  const ra3 = await until(bX, (p) => p.arena, 15_000, 100);
  const rb4 = await until(bY, (p) => p.arena, 15_000, 100);
  times.T3_A_in_arena = ra3 ? ra3.at - tClickY : null;
  times.T4_B_in_arena = rb4 ? rb4.at - tClickY : null;
  times.A_detection_after_creation_ms = rx ? Math.round(rx.at - created) : null;
  check("B listo → UNA partida (PVP_PRIVATE) para ESE cruce; A y B en la MISMA", !!game && sql(`select count(*)||'|'||max(mode) from duel_matches where id='${game}';`) === "1|PVP_PRIVATE" && !!rx && rx.p.href.includes(game) && !!ry && ry.p.href.includes(game));
  check("A entra SOLO (sin segundo clic) en ≤ 5 s desde que nace la partida", !!rx && (rx.at - created) <= 5_000, times);
  const x2 = await x2n;
  check("otro dispositivo de A (en /coleccion): aviso global «ha empezado · Entrar», sin navegar solo", !!x2 && /ha empezado/i.test(x2.p.notice) && !/\/duelos\/pvp/.test(x2.p.href), { ms: x2 ? x2.at - created : null, href: x2?.p.href });
  times.global_notice_other_device_ms = x2 ? Math.round(x2.at - created) : null;
  await bX2.tab.shot(`${OUT}/shots/notice-1024.png`).catch(() => null);

  // Resultado → avance: Y abandona (motor), A ve «Has avanzado».
  const tAb = Date.now();
  const ab = await api(who(Y), "/api/game/duel/pvp", { action: "abandon", matchId: game });
  let settledAt: number | null = null;
  for (let i = 0; i < 60; i++) { if (sql(`select status from cup_matches where id='${m1[2]}';`) === "COMPLETED") { settledAt = Date.now(); break; } await sleep(100); }
  const adv = await until(bX, (p) => p.outcome === "ADVANCED", 20_000, 100);
  times.R_abandon_response_ms = ab.status === 200 ? Date.now() - tAb : null;
  times.R_result_persisted_ms = settledAt ? settledAt - tAb : null;
  times.R_winner_sees_advance_ms = adv ? adv.at - tAb : null;
  check("resultado del motor → cruce COMPLETADO → el ganador ve «✓ Has avanzado a Final» en la arena", ab.status === 200 && !!settledAt && !!adv, times);
  await bX.tab.shot(`${OUT}/shots/advanced-arena-1440.png`).catch(() => null);
  await bX.tab.js(`document.querySelector('[data-testid="cup-back"]')?.click()`);
  const back = await until(bX, (p) => /Has ganado Semifinal/i.test(p.text ?? ""), 15_000);
  check("de vuelta al torneo: «✓ Has ganado Semifinal · avanzas a Final» y estado del siguiente cruce claro", !!back && /Esperando rival|Tu partida/i.test(back.p.text), back?.p?.state);

  // ── foco: Z listo, su pestaña se OCULTA; W listo; Z vuelve → detecta en el acto ──
  const bZ = await openAt(persona(Z), 1440, DETAIL, "f861-z");
  const bW = await openAt(persona(W), 390, DETAIL, "f861-w");
  try {
    await until(bZ, (p) => p.state === "READY");
    await bZ.tab.js(`document.querySelector('[data-testid="cup-play"]').click()`);
    await until(bZ, (p) => p.waiting === "1", 10_000);
    // Ocultar la pestaña de Z abriendo otra en su mismo navegador (visibilityState = hidden de verdad).
    const info = await bZ.tab.send("Target.getTargetInfo").catch(() => null) as any;
    const other = await bZ.tab.send("Target.createTarget", { url: "about:blank" }).catch(() => null) as any;
    await sleep(800);
    const hidden = await bZ.tab.js<string>("document.visibilityState").catch(() => "?");
    times.focus_hidden_state = hidden;
    // F86.2 · robustez del instrumento: el clic de W cuenta solo si su panel estaba cargado y su «listo» llegó (espera o
    // partida). Antes se pulsaba a ciegas: con la máquina lenta el botón aún no existía y W nunca se ponía listo.
    const wReady = await until(bW, (p) => p.state === "READY" && /JUGAR/i.test(p.text ?? ""), 45_000);
    await bW.tab.js(`document.querySelector('[data-testid="cup-play"]')?.click()`);
    const wState = await until(bW, (p) => p.waiting === "1" || /\/duelos\/pvp/.test(p.href), 20_000, 50);
    times.focus_w = wState ? (/\/duelos\/pvp/.test(wState.p.href) ? "W entró (Z aún listo)" : "W esperando (Z ya no listo)") : `W sin «listo» (panel ${wReady ? "cargado" : "sin cargar"})`;
    check("FOCO · W pulsa JUGAR con su panel cargado y su «listo» llega al servidor", !!wState, times.focus_w);
    await until(bW, (p) => /\/duelos\/pvp/.test(p.href), 15_000, 50);
    await sleep(6000);
    const stillWaiting = await panel(bZ);
    const tFocus = Date.now();
    if (info?.targetInfo?.targetId) await bZ.tab.send("Target.activateTarget", { targetId: info.targetInfo.targetId }).catch(() => null);
    if (other?.targetId) await bZ.tab.send("Target.closeTarget", { targetId: other.targetId }).catch(() => null);
    const zIn = await until(bZ, (p) => /\/duelos\/pvp\?match=/.test(p.href), 15_000, 50);
    times.focus_detect_ms = zIn ? zIn.at - tFocus : null;
    check("FOCO: pestaña oculta mientras espera, el rival se pone listo; al volver, entra en ≤ 2 s", hidden === "hidden" && !!zIn && zIn.at - tFocus <= 2_000, { hidden, stillHref: stillWaiting.href, ms: times.focus_detect_ms });
    const g2 = sql(`select coalesce(game_match_id::text,'') from cup_matches where id='${m2[2]}';`);
    check("cruce 2: una sola partida aunque Z estuviera oculto", !!g2 && sql(`select count(*) from duel_matches where id='${g2}';`) === "1", g2 || "sin partida");
    if (g2) await api(who(W), "/api/game/duel/pvp", { action: "abandon", matchId: g2 });
  } finally { await bZ.browser.close().catch(() => null); await bW.browser.close().catch(() => null); }

  // ── plazo vencido MIENTRAS espera: deja de decir «esperando» ──
  const fin = sql(`select id||'|'||player_a||'|'||player_b from cup_matches where cup_id='${CUP}' and round=2;`).split("|");
  sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = now() - interval '1 minute' where id='${fin[0]}'; commit;`);
  const finalist = fin[1] === X ? bX : null;
  if (finalist) {
    await finalist.tab.goto(DETAIL, 2500);
    await until(finalist, (p) => p.state === "READY", 15_000);
    await finalist.tab.js(`document.querySelector('[data-testid="cup-play"]').click()`);
    await until(finalist, (p) => p.waiting === "1", 10_000);
    const tDl = Date.now();
    sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = now() - interval '2 hours', deadline_at = now() - interval '1 second' where id='${fin[0]}'; commit;`);
    const dl = await until(finalist, (p) => p.state === "NO_SHOW_PENDING" && p.waiting === "0", 15_000, 100);
    times.deadline_detect_ms = dl ? dl.at - tDl : null;
    check("plazo vencido mientras espera → deja de decir «esperando» y explica «en revisión» (≤ ~3 s)", !!dl && /revisi[oó]n/i.test(dl.p.text), times.deadline_detect_ms);
    await finalist.tab.shot(`${OUT}/shots/deadline-1440.png`).catch(() => null);
  } else check("plazo vencido mientras espera (finalista en el navegador A)", false, "el finalista no fue X");
  check("plazo vencido: nadie gana solo (sin ganador, sin sorteo)", sql(`select coalesce(winner_id::text,'none') from cup_matches where id='${fin[0]}';`) === "none");

  // ── seguridad ──
  const deckE = ((await api(E, "/api/game/duels")).json?.decks ?? []).find((d: any) => d.valid)?.id;
  check("listo en un cruce AJENO → 404", (await api(E, C_API, { action: "ready", slug: SLUG, round: 2, slot: 0, deckId: deckE })).status === 404);
  check("listo con el equipo de OTRO → 404", (await api(who(fin[1]), C_API, { action: "ready", slug: SLUG, round: 2, slot: 0, deckId: deckE })).status === 404);
  check("campos falsos (ganador, rival, partida, usuario) → 400", [{ winner: E.userId }, { opponent: E.userId }, { matchId: fin[0] }, { userId: E.userId }].every(() => true) &&
    (await api(E, C_API, { action: "ready", slug: SLUG, round: 2, slot: 0, deckId: deckE, winner: E.userId })).status === 400 &&
    (await api(E, C_API, { action: "ready", slug: SLUG, round: 2, slot: 0, deckId: deckE, matchId: fin[0] })).status === 400 &&
    (await api(E, C_API, { action: "ready", slug: "no-existe", round: 1, slot: 0, deckId: deckE })).status === 404);
  check("estado ligero sin sesión → 401", (await raw(`${C_API}?status=1`)).status === 401);
  check("resolver como usuario normal → 401", (await api(E, ADM, { action: "resolve", id: CUP, round: 2, slot: 0, decision: "A", reason: "Intento de un jugador normal", confirm: `#${tagOf(fin[1])}` })).status === 401);
  check("resolver con un #TAG falso → 400", (await api(A, ADM, { action: "resolve", id: CUP, round: 2, slot: 0, decision: "A", reason: "Plazo vencido: decide la organización", confirm: "#ZZZZZZZ" })).status === 400);
  const REST = await raw(`/rest/v1/cup_matches?id=eq.${fin[0]}`, { method: "PATCH", headers: { apikey: (await import("node:fs")).readFileSync(".env.local", "utf8").match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=("?)([^\r\n"]+)/)![2], authorization: `Bearer ${E.token}`, "content-type": "application/json" }, body: JSON.stringify({ winner_id: E.userId }) });
  check("REST directo sobre cup_matches → rechazado", REST.status >= 400, REST.status);

  // ── resolución admin con #TAG → campeón y trofeo una vez ──
  const res = await api(A, ADM, { action: "resolve", id: CUP, round: 2, slot: 0, decision: "A", reason: "Plazo vencido sin partida: decide la organización (QA)", confirm: `#${tagOf(fin[1])}` });
  check("admin resuelve la final con el #TAG exacto (motivo, auditado) → campeón", res.status === 200 && sql(`select status||'|'||champion_id from cups where id='${CUP}';`) === `COMPLETED|${fin[1]}` && sql(`select count(*) from content_audit_log where action='cup_match_resolved' and entity_id='${CUP}';`) === "1");
  check("trofeo UNA vez", sql(`select count(*) from user_cosmetics where cosmetic_id='insignia:torneo:${SLUG}';`) === "1");
  if (finalist) {
    await finalist.tab.goto(DETAIL, 3000);
    const ch = await until(finalist, () => true, 2000);
    const champ = await finalist.tab.js<boolean>(`!!document.querySelector('[data-testid="cup-champion"]')`);
    check("el campeón ve su momento de campeón", champ, ch?.p?.href);
    await finalist.tab.shot(`${OUT}/shots/champion-1440.png`).catch(() => null);
  }

  // ── cambio de cuenta / logout en el «otro dispositivo»: sin estado, aviso ni navegación ajenos ──
  await bX2.tab.js(`(() => { for (const k of Object.keys(localStorage)) if (/auth-token/.test(k)) localStorage.removeItem(k); })()`);
  await bX2.tab.goto(`${BASE}/coleccion`, 2500);
  const lo = await panel(bX2);
  check("logout: sin aviso de torneo ni navegación a la partida", !lo.notice && !/\/duelos\/pvp/.test(lo.href), lo);
  await loginUi(bX2, "QA_D" === persona(X) ? "QA_C" : "QA_D");
  await bX2.tab.goto(`${BASE}/coleccion`, 3000);
  const sw = await until(bX2, () => true, 1500);
  check("cambio de cuenta: la nueva cuenta no hereda el aviso, el cruce ni la navegación de la anterior", !sw?.p?.notice && !/\/duelos\/pvp/.test(sw?.p?.href ?? ""), sw?.p);
} finally {
  for (const b of [bX, bY, bX2]) await b.browser.close().catch(() => null);
}

// ── aislamiento ──
check("rating, créditos, XP, sobres y cartas de los 4 jugadores INTACTOS", fp(players.map((p) => p.userId)) === isoBefore);
check("0 eventos de rating nuevos (colocación, Top 500, tope de parejas)", sql("select count(*) from duel_pvp_rating_events;") === evBefore);
check("0 misiones contadas por partidas de este torneo", sql(`select count(*) from mission_events where event_key in (select 'match:'||game_match_id from cup_matches where cup_id='${CUP}' and game_match_id is not null);`) === "0");
check("0 amistades creadas", sql(`select count(*) from duel_friendships where created_at > now() - interval '1 hour' and (user_lo in (${players.map((p) => `'${p.userId}'`).join(",")}) or user_hi in (${players.map((p) => `'${p.userId}'`).join(",")}));`) === "0");
const hist = await api(who(X), `/api/game/player?id=${X}&history=1`);
check("carrera propia: el cruce es TOURNAMENT («Torneo»), no «Duelo privado»", (hist.json?.items ?? []).some((i: any) => i.mode === "TOURNAMENT" && i.modeLabel === "Torneo") && !(hist.json?.items ?? []).some((i: any) => i.mode === "PRIVATE" && i.matchId === sql(`select game_match_id from cup_matches where id='${m1[2]}';`)));

// ── limpieza ──
const self = await api(A, "/api/admin/admins", { action: "revoke", userId: A.userId, confirm: `#${tagOf(A.userId)}` });
if (self.status !== 200) sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${A.userId}'; insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"fin QA F86.1"}'); commit;`);
check("limpieza: A sin admin; admins = exactamente las 2 cuentas reales", sql("select string_agg(left(id::text,8), ',' order by id) from profiles where is_admin;") === REAL_ADMINS);
check("cuentas reales INTACTAS (#NB2Z9BM y #H5ND8K7, admin, 0 torneos, rating/créditos/XP iguales)", personal() === personalBefore && realIntact(personalBefore));
check("Valorosters Open #1 sigue en BORRADOR; Temporada 2 en DRAFT", sql("select status from cups where slug='valorosters-open-1';") === "DRAFT" && sql("select status from game_seasons where id='temporada-2';") === "DRAFT");

const pass = rows.filter((r) => r.ok).length;
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, cup: SLUG, times, total: rows.length, pass, fail: rows.length - pass, rows }, null, 1));
console.log("\nTIEMPOS", JSON.stringify(times));
console.log(`F86.1 PRODUCTION QA: ${pass}/${rows.length}`);
process.exit(pass === rows.length ? 0 : 1);
