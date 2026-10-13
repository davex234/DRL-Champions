/**
 * CORE GAME LOOP · QA EN PRODUCCIÓN (instrumento de operador, fuera de CI y de la release). SOLO cuentas QA nuevas.
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/coreloop/_prod-qa.mts M N
 *
 *   1 · diarias: abrir, jugar y ganar (sin «Haz una predicción»);
 *   2 · partida rápida PvE: recibo = saldo real, cupo diario 1 de 20; F5 y 10 lecturas a la vez = mismo recibo, sin cupo nuevo;
 *       doble envío de la última jugada = una transición; «Juega un duelo» avanza; otra persona → 404;
 *   3 · duelo PRIVADO M↔N jugado entero: «partidas jugadas/ganadas» de M y N NO cambian (antes: sí para el asiento A);
 *       sin créditos, sin XP, sin rating, sin eventos F73/F83;
 *   4 · «Declara tu región» (si la cuenta la tiene puesta, completa).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { execFileSync } = await import("node:child_process");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { login, api, pvpGet, validDeck, legalMove, uuid, sleep } = qa;
if (process.env.BASE_URL !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/core-loop/prod";
mkdirSync(OUT, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: (d ?? "").slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${ok ? "" : (d ?? "").slice(0, 300)}`); };
const sql = (q: string): string => execFileSync("ssh", ["nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1"], { input: `begin read only;\n${q}\nrollback;`, encoding: "utf8" }).trim();
const S = "/api/game/social";
const post = async (w: any, body: any) => { for (let i = 0; i < 30; i++) { const r = await api(w, S, body, { noRetry: true }); if (r.status !== 429) return r; await sleep(Math.max(2, Number(r.json?.retryAfter ?? 5)) * 1000); } throw new Error("429 persistente"); };
const prog = async (w: any) => (await api(w, "/api/game/progression", { action: "state" })).json;
// Las métricas se leen de las misiones del propio pase (vista del servidor): «Juega 25 duelos» (cuenta nueva → baseline 0,
// así que `current` = partidas que cuentan) y «Gana un duelo» de hoy.
const metrics = async (w: any) => { const ms = ((await prog(w))?.missions ?? []) as any[]; const f = (id: string) => ms.find((m) => m.id === id)?.current; return { duels_played: f("s-duelos-25"), duels_won: f("d-duelo-win") }; };
const st = async (w: any) => (await api(w, "/api/game/state")).json;

const [PM = "M", PN = "N"] = process.argv.slice(2);
const M = await login(PM), N = await login(PN);
console.log(`M=${M.userId.slice(0, 8)} N=${N.userId.slice(0, 8)}`);

/* ── 1 · diarias ── */
const p0 = await prog(M);
const dailies = ((p0?.missions ?? []) as any[]).filter((m) => m.kind === "daily").map((m) => m.id).sort();
check("1 · diarias = abrir, jugar y ganar (sin Pick'em, que era imposible)", JSON.stringify(dailies) === JSON.stringify(["d-abrir-1", "d-duelo-1", "d-duelo-win"]), dailies);

/* ── 2 · partida rápida PvE ── */
const deck = await validDeck(M);
check("2 · M tiene equipo válido", !!deck, deck);
const m0 = await metrics(M); const s0 = await st(M);
const paidBefore = Number(sql(`select count(*) from public.economy_ops where user_id='${M.userId}' and kind='duel_cap_slot';`));
const start = await api(M, "/api/game/duel", { action: "start", deckId: deck!.id, difficulty: "EASY" });
check("2 · start 200", start.status === 200, start.status);
let v = start.json?.view; const mid = v?.matchId as string;
let doubleChecked = false;
for (let k = 0; k < 20 && v?.status === "IN_PROGRESS"; k++) {
  const body = { action: "play", matchId: mid, cardUid: v.yourHand[0].uid, ...(v.youAreAttacker ? { stat: "stronghold" } : {}), expectedVersion: v.stateVersion };
  if (!doubleChecked && v.yourHand.length === 1) {
    const [r1, r2] = await Promise.all([api(M, "/api/game/duel", body), api(M, "/api/game/duel", body)]);
    check("2 · doble envío de la última jugada: una transición (la otra 409 con estado)", [r1.status, r2.status].sort().join() === "200,409", [r1.status, r2.status]);
    v = (r1.status === 200 ? r1 : r2).json?.view; doubleChecked = true; continue;
  }
  const r = await api(M, "/api/game/duel", body); v = r.json?.view;
}
check("2 · partida terminada", v?.status && v.status !== "IN_PROGRESS", v?.status);
const rw = v?.result?.rewards;
const s1 = await st(M);
const granted = (rw?.grants ?? []).reduce((s: number, g: any) => s + (g.reward?.credits ?? 0), 0);
check("2 · recibo = lo que subió el saldo real", s1.credits - s0.credits === granted && granted > 0, { before: s0.credits, after: s1.credits, granted });
check(`2 · cupo diario: partida con recompensa ${paidBefore + 1} de 20`, JSON.stringify(rw?.daily) === JSON.stringify({ slot: paidBefore + 1, cap: 20 }), rw?.daily);
const ops0 = sql(`select count(*) from public.economy_ops where user_id='${M.userId}' and kind like 'duel_cap%';`);
const reads = await Promise.all(Array.from({ length: 10 }, () => api(M, "/api/game/duel", { action: "state", matchId: mid })));
const same = reads.every((r) => r.status === 200 && JSON.stringify(r.json?.view?.result?.rewards) === JSON.stringify(rw));
check("2 · F5 y 10 lecturas a la vez: el mismo recibo (con su cupo)", same, reads.map((r) => r.status));
check("2 · leer no gasta cupos ni toca el libro", sql(`select count(*) from public.economy_ops where user_id='${M.userId}' and kind like 'duel_cap%';`) === ops0 && sql(`select count(*) from public.credit_transactions where user_id='${M.userId}' and ref='duel:${mid}';`) === "1" && (await st(M)).credits === s1.credits);
check("2 · otra persona no lee la partida (404)", (await api(N, "/api/game/duel", { action: "state", matchId: mid })).status === 404);
const m1 = await metrics(M);
check("2 · «partidas jugadas» +1 (PvE cuenta)", typeof m0.duels_played === "number" && m1.duels_played === (m0.duels_played ?? 0) + 1, { before: m0.duels_played, after: m1.duels_played });

/* ── 3 · duelo privado M↔N ── */
await post(M, { action: "friend_request", targetUserId: N.userId });
await post(N, { action: "friend_accept", targetUserId: M.userId });
const dN = await validDeck(N);
const before = { m: await metrics(M), n: await metrics(N), sm: await st(M), sn: await st(N) };
const ch = (await post(M, { action: "challenge_create", targetUserId: N.userId, deckId: deck!.id })).json?.challengeId;
const acc = await post(N, { action: "challenge_accept", challengeId: ch, deckId: dN!.id });
const pmid = acc.json?.matchId as string;
check("3 · reto aceptado → partida PVP_PRIVATE (M = asiento A)", !!pmid && sql(`select mode||'|'||(user_id='${M.userId}') from public.duel_matches where id='${pmid}';`) === "PVP_PRIVATE|true", acc.json);
for (let i = 0; i < 80; i++) {
  const [x, y] = await Promise.all([pvpGet(M, pmid), pvpGet(N, pmid)]).then((r) => r.map((z) => z.json?.snapshot));
  if (["FINISHED", "ABANDONED", "EXPIRED"].includes(x?.lifecycle)) break;
  const w = x?.isYourTurn ? M : y?.isYourTurn ? N : null;
  if (!w) { await sleep(400); continue; }
  const s = w === M ? x : y;
  await api(w, "/api/game/duel/pvp", { action: "play", matchId: pmid, actionId: uuid(), expectedVersion: s.stateVersion, ...legalMove(s)! });
}
const fin = sql(`select status||'|'||coalesce(winner,'-') from public.duel_matches where id='${pmid}';`);
check("3 · duelo privado jugado hasta el final", /^(COMPLETED|DRAW)\|/.test(fin), fin);
await sleep(1500);
const after = { m: await metrics(M), n: await metrics(N), sm: await st(M), sn: await st(N) };
check("3 · M (asiento A): partidas jugadas y ganadas SIN cambio (antes contaba)", typeof before.m.duels_played === "number" && after.m.duels_played === before.m.duels_played && after.m.duels_won === before.m.duels_won, { before: [before.m.duels_played, before.m.duels_won], after: [after.m.duels_played, after.m.duels_won], fin });
check("3 · N (asiento B): partidas jugadas y ganadas SIN cambio", typeof before.n.duels_played === "number" && after.n.duels_played === before.n.duels_played && after.n.duels_won === before.n.duels_won, { before: [before.n.duels_played, before.n.duels_won], after: [after.n.duels_played, after.n.duels_won] });
check("3 · sin créditos ni XP para nadie", after.sm.credits === before.sm.credits && after.sn.credits === before.sn.credits && after.sm.xp === before.sm.xp && after.sn.xp === before.sn.xp);
check("3 · sin rating, ni misiones F73, ni XP de temporada", sql(`select (select count(*) from public.duel_pvp_rating_events where match_id='${pmid}') + (select count(*) from public.mission_events where event_key like '%${pmid}%') + (select count(*) from public.season_xp_ledger where event_key like '%${pmid}%');`) === "0");

/* ── 4 · «Declara tu región» ── */
const pr = await prog(M);
const reg = ((pr?.missions ?? []) as any[]).find((m) => m.id === "s-region");
check("4 · «Declara tu región» sin región: no completa (no regala)", !!reg && reg.current === 0 && !reg.complete, reg);

// limpieza social (la partida queda como historial; la cuenta entera se borra después con el SQL de limpieza)
await post(M, { action: "unfriend", targetUserId: N.userId }).catch(() => null);
writeFileSync(`${OUT}/checks.json`, JSON.stringify({ at: new Date().toISOString(), total: rows.length, failed: rows.filter((r) => !r.ok).length, rows }, null, 2));
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} PASS`);
process.exit(rows.some((r) => !r.ok) ? 1 : 0);
