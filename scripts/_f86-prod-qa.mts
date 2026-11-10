/**
 * F86 · TORNEOS — QA EN PRODUCCIÓN (instrumento, fuera de CI). SOLO cuentas QA: A (f45) actúa de admin TEMPORAL
 * (operador, auditado → se retira al final), B, C, D juegan, E mira desde fuera. La cuenta personal NO se abre ni se
 * inscribe; solo se lee su huella para demostrar que no cambió.
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f86-prod-qa.mts   (cwd = prodqa)
 *
 * 1 · cabeza 0069 y check «cups» · 2 · panel: autorización, borrador NO LISTADO, invisible, publicar con versión,
 *     publicado = solo texto · 3 · inscripción: 20 a la vez = 1, retirarse, campos prohibidos, anónimo 401
 * 4 · cierre → cuadro perezoso UNA vez (20 lecturas), foto de rating, público sin ids · 5 · cruces con el MOTOR real:
 *     «listo» de los dos → UNA partida PVP_PRIVATE; abandono → gana quien se queda; final → campeón + trofeo
 * 6 · aislamiento: rating, eventos de rating, misiones, cara a cara social · 7 · Sala de Trofeos (TOURNAMENT)
 * 8 · cancelar un torneo con inscritos · 9 · navegador 1440/1024/390 (hub, ficha, cuadro, campeón, panel) y cambio de
 *     cuenta B → C sin estado de B · 10 · borrador «Valorosters Open #1» SIN publicar · limpieza: A sin admin.
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
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/cups/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
PERSONA_FILES.QA_A = QA_FILES.A; PERSONA_FILES.QA_B = QA_FILES.B; PERSONA_FILES.QA_C = QA_FILES.C; PERSONA_FILES.QA_D = QA_FILES.D;
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${(d ?? "").slice(0, 220)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const raw = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${BASE}${path}`, init); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: r.status, json: j, text: t }; };
const UUIDRE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
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
const iso = (ms: number) => new Date(ms).toISOString();

// ── 1 · cabeza ──
const ready = (await raw("/api/ready")).json;
check("ready: cabeza ≥ 0069 por estado real y check «cups» en verde", ready?.status === "ready" && String(ready?.migrationHead ?? "") >= "0069_player_cups" && (ready?.checks ?? []).some((c: any) => c.id === "cups" && c.ok), { head: ready?.migrationHead, status: ready?.status });
check("página /copas pública responde 200", (await raw("/copas")).status === 200);

const A = await login("A"), B = await login("B"), C = await login("C"), D = await login("D"), E = await login("E");
for (const w of [A, B, C, D, E]) if (isRealActor(w.userId)) throw new Error("cuenta real: prohibido");
const tagOf = (id: string) => sql(`select public_tag from profiles where id='${id}';`);
const nameOf = (id: string) => sql(`select username from profiles where id='${id}';`);
const ratingFp = (ids: string[]) => sql(`select coalesce(md5(string_agg(to_jsonb(r)::text, '|' order by user_id)),'-') from duel_pvp_ratings r where user_id in (${ids.map((i) => `'${i}'`).join(",")});`);
const players = [A, B, C, D];
const ratingsBefore = ratingFp(players.map((p) => p.userId));
const ratingEventsBefore = sql(`select count(*) from duel_pvp_rating_events;`);

// ── 2 · panel ──
sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = true where id = '${A.userId}';
insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'GRANT_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"QA F86 torneos (cuenta QA temporal)"}'); commit;`);
check("anónimo → /api/admin/cups 401", (await raw(ADM)).status === 401);
check("usuario normal (B) → /api/admin/cups 401 (lectura y escritura)", (await api(B, ADM)).status === 401 && (await api(B, ADM, { action: "create", fields: {} })).status === 401);
const SLUG = `qa-f86-${Date.now().toString(36)}`;
const now = Date.now();
const fields = { slug: SLUG, name: "QA F86 (no listado)", description: "Torneo de prueba de la QA de F86. No listado.", rules: "Eliminación directa a partida única. Prueba QA.", registrationOpenAt: iso(now - 60_000), registrationCloseAt: iso(now + 110_000), startsAt: iso(now + 110_000), minParticipants: 4, maxParticipants: 8, roundWindowMinutes: 30, visibility: "UNLISTED" };
const cr = await api(A, ADM, { action: "create", fields: { ...fields, maxParticipants: 128 } });
check("panel: validación (máximo 128 no soportado) → 400", cr.status === 400, cr.json?.error);
const made = await api(A, ADM, { action: "create", fields });
const CUP = made.json?.id as string;
check("panel: crear BORRADOR no listado (nunca publica solo)", made.status === 200 && sql(`select status||'|'||visibility from cups where id='${CUP}';`) === "DRAFT|UNLISTED", made.json);
check("borrador invisible: ficha 404 (anónimo y jugador), fuera del hub", (await raw(`${C_API}?slug=${SLUG}`)).status === 404 && (await api(B, `${C_API}?slug=${SLUG}`)).status === 404 && !(await raw(C_API)).text.includes(SLUG));
const v0 = Number(sql(`select version from cups where id='${CUP}';`));
check("publicar con versión vieja → 409", (await api(A, ADM, { action: "publish", id: CUP, version: v0 - 1 })).status === 409);
const pub = await api(A, ADM, { action: "publish", id: CUP, version: v0 });
check("publicar (admin, versión actual) → PUBLICADO + auditoría con actor", pub.status === 200 && sql(`select status from cups where id='${CUP}';`) === "PUBLISHED" && sql(`select count(*) from content_audit_log where action='cup_published' and entity_id='${CUP}' and actor='${A.userId}';`) === "1", pub.json);
const v1 = Number(sql(`select version from cups where id='${CUP}';`));
check("publicado: cambiar el máximo → 409 (solo texto)", (await api(A, ADM, { action: "update", id: CUP, version: v1, fields: { maxParticipants: 4 } })).status === 409);
check("publicado: corregir la descripción → 200", (await api(A, ADM, { action: "update", id: CUP, version: v1, fields: { description: "Torneo de prueba de la QA de F86 (no listado)." } })).status === 200);

// ── 3 · inscripción ──
check("anónimo → inscribirse 401", (await raw(C_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "register", slug: SLUG }) })).status === 401);
check("cuerpo con «winner» / «seed» / «userId» → 400 (lista blanca)", (await api(B, C_API, { action: "register", slug: SLUG, winner: B.userId })).status === 400 && (await api(B, C_API, { action: "register", slug: SLUG, seed: 1 })).status === 400 && (await api(B, C_API, { action: "register", slug: SLUG, userId: C.userId })).status === 400);
const many = await Promise.all(Array.from({ length: 20 }, () => api(B, C_API, { action: "register", slug: SLUG })));
check("20 inscripciones simultáneas de B → 1 fila (1 REGISTERED + 19 ALREADY)", sql(`select count(*) from cup_registrations where cup_id='${CUP}' and user_id='${B.userId}';`) === "1" && many.filter((r) => r.json?.code === "REGISTERED").length === 1 && many.filter((r) => r.json?.code === "ALREADY_REGISTERED").length === 19, many.map((r) => r.json?.code ?? r.status).join(","));
for (const w of [C, D, A]) await api(w, C_API, { action: "register", slug: SLUG });
check("D se retira con la inscripción abierta y vuelve (misma fila)", (await api(D, C_API, { action: "withdraw", slug: SLUG })).json?.code === "WITHDRAWN" && (await api(D, C_API, { action: "register", slug: SLUG })).json?.code === "REGISTERED" && sql(`select count(*) from cup_registrations where cup_id='${CUP}' and user_id='${D.userId}';`) === "1");
check("4 inscritos, contador = filas", sql(`select participant_count||'|'||(select count(*) from cup_registrations where cup_id='${CUP}' and status='REGISTERED') from cups where id='${CUP}';`) === "4|4");
const hubB = (await api(B, C_API)).json;
check("no listado: B lo ve en «Mis torneos»; el hub público no lo lista", hubB?.mine?.some((c: any) => c.slug === SLUG && c.mine === "REGISTERED") && !(await raw(C_API)).text.includes(SLUG));

// ── 4 · cierre y cuadro ──
const closeAt = Date.parse(sql(`select registration_close_at from cups where id='${CUP}';`));
while (Date.now() < closeAt + 2000) await sleep(2000);
check("cerrada: retirarse → 409 CLOSED", (await api(B, C_API, { action: "withdraw", slug: SLUG })).json?.code === "CLOSED");
const reads = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? raw(`${C_API}?slug=${SLUG}`) : api(E, `${C_API}?slug=${SLUG}`))));
check("20 lecturas a la vez tras el cierre → UN cuadro (3 cruces, 2 rondas), una auditoría del sistema", sql(`select (select count(*) from cup_matches where cup_id='${CUP}')||'|'||rounds||'|'||(select count(*) from content_audit_log where action='cup_bracket_generated' and entity_id='${CUP}' and actor is null) from cups where id='${CUP}';`) === "3|2|1", reads.map((r) => r.status).join(","));
check("foto de rating en cada inscrito (seed 1..4, rating = ranked o 1000)", sql(`select count(*) from cup_registrations g left join duel_pvp_ratings r on r.user_id=g.user_id where g.cup_id='${CUP}' and g.seed between 1 and 4 and g.seed_rating = coalesce(r.rating,1000);`) === "4");
const anonDetail = await raw(`${C_API}?slug=${SLUG}`);
check("cuadro PÚBLICO sin ids de usuario ni correos; con #TAG; nombres de ronda verdaderos", anonDetail.status === 200 && !UUIDRE.test(anonDetail.text) && !/@[a-z0-9-]+\.[a-z]{2,}/.test(anonDetail.text) && anonDetail.json?.bracket?.map((r: any) => r.name).join(",") === "Semifinal,Final" && new RegExp(tagOf(B.userId)).test(anonDetail.text));

// ── 5 · cruces con el motor ──
const deckOf = async (w: any) => ((await api(w, "/api/game/duels")).json?.decks ?? []).find((d: any) => d.valid)?.id as string;
const who = (id: string) => players.find((p) => p.userId === id)!;
async function playByAbandon(round: number, slot: number) {
  const m = sql(`select player_a||'|'||player_b||'|'||id from cup_matches where cup_id='${CUP}' and round=${round} and slot=${slot};`).split("|");
  const pa = who(m[0]), pb = who(m[1]);
  sql(`begin; select set_config('drl.cup_writer','on',true); update cup_matches set available_at = least(available_at, now() - interval '1 minute') where id='${m[2]}'; commit;`); // la ventana de la ronda ya abrió (equivale al paso del tiempo)
  const r1 = await api(pa, C_API, { action: "ready", slug: SLUG, round, slot, deckId: await deckOf(pa) });
  const r2 = await api(pb, C_API, { action: "ready", slug: SLUG, round, slot, deckId: await deckOf(pb) });
  const again = await api(pa, C_API, { action: "ready", slug: SLUG, round, slot, deckId: await deckOf(pa) });
  const game = r2.json?.gameMatchId as string;
  check(`R${round}·${slot}: «listo» A → WAITING; B → STARTED; A otra vez → la MISMA partida`, r1.json?.code === "WAITING" && r2.json?.code === "STARTED" && again.json?.gameMatchId === game, { r1: r1.json?.code, r2: r2.json?.code, same: again.json?.gameMatchId === game });
  check(`R${round}·${slot}: partida del motor PVP_PRIVATE, UNA por cruce, cruce EN JUEGO`, sql(`select d.mode||'|'||(select count(*) from cup_matches where game_match_id='${game}')||'|'||m.status from duel_matches d join cup_matches m on m.game_match_id=d.id where d.id='${game}';`) === "PVP_PRIVATE|1|ACTIVE");
  const ab = await api(pa, "/api/game/duel/pvp", { action: "abandon", matchId: game });
  for (let i = 0; i < 10 && sql(`select status from cup_matches where id='${m[2]}';`) === "ACTIVE"; i++) await sleep(500);
  const res = sql(`select status||'|'||winner_id||'|'||resolution from cup_matches where id='${m[2]}';`);
  check(`R${round}·${slot}: abandono de A → gana B (cierre canónico del motor), ABANDON`, ab.status === 200 && res === `COMPLETED|${pb.userId}|ABANDON`, res);
  const info = (await api(pb, `/api/game/social?match=${game}`)).json;
  check(`R${round}·${slot}: la arena sabe que es un cruce de torneo (sin revancha); el cara a cara social NO lo cuenta`, info?.cup?.slug === SLUG && !JSON.stringify(info?.h2h ?? {}).includes(game), info?.cup);
  return { game, winner: pb };
}
const s1 = await playByAbandon(1, 0);
const snap1 = sql(`select md5(string_agg(to_jsonb(m)::text, '|' order by round, slot)) from cup_matches m where cup_id='${CUP}';`);
await Promise.all(Array.from({ length: 20 }, () => raw(`${C_API}?slug=${SLUG}`)));
check("20 lecturas más (red de liquidación) → el cuadro no cambia: un solo avance", sql(`select md5(string_agg(to_jsonb(m)::text, '|' order by round, slot)) from cup_matches m where cup_id='${CUP}';`) === snap1);
check("el ganador está en la final (lado A), una vez", sql(`select player_a from cup_matches where cup_id='${CUP}' and round=2;`) === s1.winner.userId);
const s2 = await playByAbandon(1, 1);
check("final con los dos finalistas → READY", sql(`select status from cup_matches where cup_id='${CUP}' and round=2;`) === "READY");
const fin = await playByAbandon(2, 0);
const champ = fin.winner;
check("final → torneo COMPLETADO, campeón = ganador de la final, UN trofeo con referencia al torneo", sql(`select status||'|'||champion_id from cups where id='${CUP}';`) === `COMPLETED|${champ.userId}` && sql(`select count(*)||'|'||max(user_id::text)||'|'||max(source) from user_cosmetics where cosmetic_id='insignia:torneo:${SLUG}';`) === `1|${champ.userId}|cup:${CUP}`);
check("colocaciones guardadas: campeón, subcampeón y dos semifinalistas", sql(`select string_agg(placement, ',' order by placement) from cup_registrations where cup_id='${CUP}';`) === "CHAMPION,RUNNER_UP,SEMIFINAL,SEMIFINAL");

// ── 6 · aislamiento ──
check("rating, colocación y pico de los 4 jugadores INTACTOS", ratingFp(players.map((p) => p.userId)) === ratingsBefore);
check("0 eventos de rating nuevos (ni Top 500, ni tope de parejas, ni récord competitivo)", sql(`select count(*) from duel_pvp_rating_events;`) === ratingEventsBefore);
check("0 misiones contadas por las partidas de torneo", sql(`select count(*) from mission_events where event_key in ('match:${s1.game}','match:${s2.game}','match:${fin.game}');`) === "0");
check("0 amistades creadas por el torneo", sql(`select count(*) from duel_friendships where created_at > now() - interval '30 minutes' and (user_lo in ('${A.userId}','${B.userId}','${C.userId}','${D.userId}') or user_hi in ('${A.userId}','${B.userId}','${C.userId}','${D.userId}'));`) === "0");

// ── 7 · Sala de Trofeos ──
const room = (await api(champ, "/api/game/collection-sets")).json;
const trophy = room?.badges?.unlocked?.find((b: any) => b.id === `insignia:torneo:${SLUG}`);
check("Sala de Trofeos del campeón: trofeo TOURNAMENT «Campeón · QA F86 (no listado)» con fecha", trophy?.kind === "TOURNAMENT" && trophy?.label === "Campeón · QA F86 (no listado)" && /^Torneo · /.test(trophy?.caption ?? ""), trophy);
const fd = (await raw(`${C_API}?slug=${SLUG}`)).json;
check("ficha final pública: FINALIZADO + campeón con #TAG", fd?.card?.phase === "COMPLETED" && fd?.card?.champion?.tag === tagOf(champ.userId));
check("resolver un cruce de un torneo terminado → 409", (await api(A, ADM, { action: "resolve", id: CUP, round: 2, slot: 0, decision: "A", reason: "Intento sobre un torneo terminado", confirm: `#${tagOf(champ.userId)}` })).status === 409);

// ── 8 · cancelar ──
const SLUG2 = `${SLUG}-c`;
const m2 = await api(A, ADM, { action: "create", fields: { ...fields, slug: SLUG2, name: "QA F86 cancelación", registrationOpenAt: iso(Date.now() - 60_000), registrationCloseAt: iso(Date.now() + 3_600_000), startsAt: iso(Date.now() + 3_600_000) } });
const CUP2 = m2.json?.id as string;
await api(A, ADM, { action: "publish", id: CUP2, version: Number(sql(`select version from cups where id='${CUP2}';`)) });
await api(E, C_API, { action: "register", slug: SLUG2 });
check("cancelar sin motivo → 400", (await api(A, ADM, { action: "cancel", id: CUP2, reason: "x" })).status === 400);
const cc = await api(A, ADM, { action: "cancel", id: CUP2, reason: "Cancelación de prueba QA F86" });
check("cancelar con inscritos (motivo) → CANCELADO, auditado; ya nadie se inscribe", cc.status === 200 && sql(`select status from cups where id='${CUP2}';`) === "CANCELLED" && (await api(B, C_API, { action: "register", slug: SLUG2 })).json?.code === "CANCELLED" && sql(`select count(*) from content_audit_log where action='cup_cancelled' and entity_id='${CUP2}';`) === "1");

// ── 9 · navegador ──
async function shotsFor(persona: string, w: number, paths: [string, string][]) {
  const c = await openBrowser(persona, w, { label: `f86-${persona}-${w}` });
  try {
    await loginUi(c, persona);
    for (const [path, tag] of paths) {
      c.tab.takeErrors();
      await c.tab.goto(`${BASE}${path}`, 2500);
      for (let i = 0; i < 40; i++) { if (await c.tab.js<boolean>(`!!document.querySelector('[data-testid="cup-detail"],[data-testid="cups-hub"],[data-testid="admin-cups"]')`).catch(() => false)) break; await sleep(250); }
      await sleep(900);
      const f = await c.tab.js<any>(`(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, text: document.body.innerText,
        tree: !!document.querySelector('[data-testid="cup-tree"]')?.offsetParent, tabs: !!document.querySelector('[data-testid="cup-rounds"]')?.offsetParent,
        champion: !!document.querySelector('[data-testid="cup-champion"]'), nav: [...document.querySelectorAll('a[href="/copas"]')].length }))()`);
      check(`navegador ${persona} @${w} · ${path} · sin desbordamiento y contenido`, f.overflow <= 0 && (path.includes("/admin") ? /QA F86/.test(f.text) : path === "/copas" ? /torneos/i.test(f.text) : f.champion && (w >= 1024 ? f.tree : f.tabs)), { overflow: f.overflow, tree: f.tree, tabs: f.tabs, champion: f.champion });
      const errs = c.tab.takeErrors().filter((e: string) => !/status of (401|404|429)/.test(e));
      check(`navegador ${persona} @${w} · ${path} · consola limpia`, errs.length === 0, errs.slice(0, 3));
      await c.tab.shot(`${OUT}/shots/${tag}-${w}.png`).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}
const champPersona = champ === A ? "QA_A" : champ === B ? "QA_B" : champ === C ? "QA_C" : "QA_D";
for (const w of [1440, 1024, 390]) await shotsFor(champPersona, w, [["/copas", "hub"], [`/copas/${SLUG}`, "detail-champion"]]);
await shotsFor("QA_A", 1440, [["/admin/copas", "admin"]]);
// Cambio de cuenta: B en la ficha → sale → entra C: nunca se pinta el «tú» de B.
{
  const c = await openBrowser("QA_B", 390, { label: "f86-switch" });
  try {
    await loginUi(c, "QA_B");
    await c.tab.goto(`${BASE}/copas/${SLUG}`, 2500); await sleep(1500);
    const nameB = nameOf(B.userId);
    const youB = await c.tab.js<string[]>(`[...document.querySelectorAll('[data-field="cup-slot"][data-you="1"]')].map((e) => e.innerText)`);
    await c.tab.js(`(async () => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); if (k) localStorage.removeItem(k); })()`);
    await loginUi(c, "QA_C");
    await c.tab.goto(`${BASE}/copas/${SLUG}`, 0);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { for (const t of await c.tab.js<string[]>(`[...document.querySelectorAll('[data-field="cup-slot"][data-you="1"]')].map((e) => e.innerText)`).catch(() => [])) seen.add(t); await sleep(40); }
    check("cambio de cuenta B → C: nunca se marca a B como «tú» con la sesión de C", youB.some((t) => t.includes(nameB.toUpperCase()) || t.toUpperCase().includes(nameB.toUpperCase())) && ![...seen].some((t) => t.toUpperCase().includes(nameB.toUpperCase())), { youB: youB.length, seen: [...seen].slice(0, 4) });
  } finally { await c.browser.close().catch(() => null); }
}

// ── 10 · borrador del primer torneo real (NO se publica) ──
const exists = sql(`select count(*) from cups where slug='valorosters-open-1';`);
if (exists === "0") {
  const vo = await api(A, ADM, { action: "create", fields: { slug: "valorosters-open-1", name: "Valorosters Open #1", description: "El primer torneo abierto de Valorosters: eliminación directa 1 contra 1, inscripción gratuita y un trofeo único para quien gane la final.", rules: "Eliminación directa a partida única con tu equipo de diez cartas.\nSembrado por rating ranked al cerrar la inscripción.\nCada ronda tiene un día para jugarse: si nadie juega a tiempo o hay un empate exacto, la organización resuelve el cruce. Nunca hay sorteo.\nSin premios en créditos, sobres ni cartas: el campeón recibe su trofeo permanente.", registrationOpenAt: "2026-10-19T17:00:00Z", registrationCloseAt: "2026-10-24T17:00:00Z", startsAt: "2026-10-24T18:00:00Z", minParticipants: 8, maxParticipants: 64, roundWindowMinutes: 1440, visibility: "PUBLIC" } });
  check("«Valorosters Open #1» preparado como BORRADOR (no publicado, invisible)", vo.status === 200 && sql(`select status from cups where slug='valorosters-open-1';`) === "DRAFT" && (await raw(`${C_API}?slug=valorosters-open-1`)).status === 404, vo.json);
} else check("«Valorosters Open #1» ya existía: sigue en BORRADOR", sql(`select status from cups where slug='valorosters-open-1';`) === "DRAFT");

// ── limpieza ──
const self = await api(A, "/api/admin/admins", { action: "revoke", userId: A.userId, confirm: `#${tagOf(A.userId)}` });
if (self.status !== 200) sql(`begin; select set_config('drl.admin_writer','on',true); update public.profiles set is_admin = false where id = '${A.userId}'; insert into public.content_audit_log (actor, action, entity_type, entity_id, detail) values (null, 'REVOKE_ADMIN', 'user', '${A.userId}', '{"via":"operator","purpose":"fin QA F86"}'); commit;`);
check("limpieza: A ya no es admin; admins = exactamente las 2 cuentas reales", sql(`select string_agg(left(id::text,8), ',' order by id) from profiles where is_admin;`) === REAL_ADMINS, self.status);
const personalAfter = personal();
check("cuentas reales INTACTAS (davex, ValoRosters): mismo #TAG, siguen admin, 0 inscripciones, 0 cruces, 0 trofeos de torneo, rating y créditos/XP iguales", personalAfter === personalBefore && realIntact(personalAfter), { before: personalBefore.split("|").slice(0, 5), after: personalAfter.split("|").slice(0, 5) });
check("Temporada 2 sigue en BORRADOR", sql(`select status from game_seasons where id='temporada-2';`) === "DRAFT");

const pass = rows.filter((r) => r.ok).length;
writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, cup: SLUG, champion: champ.name, total: rows.length, pass, fail: rows.length - pass, rows }, null, 1));
console.log(`\nF86 PRODUCTION QA: ${pass}/${rows.length}`);
process.exit(pass === rows.length ? 0 : 1);
