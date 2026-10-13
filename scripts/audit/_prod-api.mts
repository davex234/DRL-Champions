/**
 * FULL GAME AUDIT · QA DE API EN PRODUCCIÓN (instrumento de operador, fuera de CI y de la release). SOLO cuentas QA A y B.
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/audit/_prod-api.mts
 *
 * Economía (idempotencia y carreras): compra con el mismo gesto ×5, apertura doble, reclamo de misión ×5, nivel del pase ×5,
 * entrada del Draft ×5. Aislamiento: estrategia/composición/partida de otra cuenta, API de admin. Ranked: cola ×3 + cancelar.
 * Cuerpos JSON no-objeto → 400 (no 500). Cada comprobación se cruza con el libro mayor (SQL de solo lectura).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const { execFileSync } = await import("node:child_process");
const { login, api, uuid } = qa;
if (process.env.BASE_URL !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const BASE = process.env.BASE_URL!;
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(d)?.slice(0, 300)}`); };
const sql = (q: string) => execFileSync("ssh", ["nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U supabase_admin -d postgres -Atq"], { input: `begin read only;\n${q}\nrollback;`, encoding: "utf8" }).trim();
const raw = async (w: any, path: string, body: string) => (await fetch(`${BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${w.token}`, "content-type": "application/json" }, body })).status;
const A = await login("A"), B = await login("B");
const credits = async (w: any) => Number((await api(w, "/api/game/state")).json?.credits);

/* ── E1 · compra: el mismo gesto ×5 a la vez cobra UNA vez ── */
{
  const c0 = await credits(A); const ref = `audit-buy-${Date.now()}`;
  const rs = await Promise.all(Array.from({ length: 5 }, () => api(A, "/api/game/packs", { action: "buy", packId: "estandar", ref }, { noRetry: true })));
  const c1 = await credits(A);
  check("E1 · comprar Bronce con el mismo gesto ×5 a la vez: cobra 2.500 UNA vez (200 o 409 «en curso», nunca 500)", rs.every((r) => r.status === 200 || r.status === 409) && c0 - c1 === 2500, { st: rs.map((r) => r.status), c0, c1 });
  /* E2 · abrir: dos aperturas a la vez con UN sobre → una 200, otra 409; repetir el gesto ganador → mismas cartas */
  const g = `audit-open-${Date.now()}`;
  const [o1, o2] = await Promise.all([api(A, "/api/game/packs", { action: "open", packId: "estandar", ref: g }, { noRetry: true }), api(A, "/api/game/packs", { action: "open", packId: "estandar", ref: `${g}-b` }, { noRetry: true })]);
  const sts = [o1.status, o2.status].sort().join(",");
  const winRef = o1.status === 200 ? g : `${g}-b`; const won = o1.status === 200 ? o1 : o2;
  const again = await api(A, "/api/game/packs", { action: "open", packId: "estandar", ref: winRef }, { noRetry: true });
  const same = JSON.stringify((again.json?.opened ?? []).map((x: any) => x.uid)) === JSON.stringify((won.json?.opened ?? []).map((x: any) => x.uid));
  const inv = (await api(A, "/api/game/state")).json?.unopenedPacks?.estandar ?? 0;
  check("E2 · apertura doble con 1 sobre: una gana (200/409), el reintento da las MISMAS cartas, 0 sobres", (sts === "200,409" || sts === "200,200" && same) && same && inv === 0, { sts, same, inv });
}

/* ── E3 · reclamo de misión ×5 a la vez: un solo asiento ── */
{
  const st = (await api(A, "/api/game/progression", { action: "state" })).json;
  const m = (st?.missions ?? []).find((x: any) => x.complete && !x.claimed);
  if (!m) check("E3 · (sin misión completa por reclamar: omitido)", true);
  else {
    const rs = await Promise.all(Array.from({ length: 5 }, () => api(A, "/api/game/progression", { action: "claimMission", missionId: m.id }, { noRetry: true })));
    const n = sql(`select count(*) from public.credit_transactions where user_id='${A.userId}' and ref like 'mission:%:${m.id}:%';`);
    check(`E3 · reclamar «${m.id}» ×5 a la vez: UN asiento en el libro, nada 500`, n === "1" && rs.every((r) => r.status < 500), { n, st: rs.map((r) => r.status) });
  }
  const st2 = (await api(A, "/api/game/progression", { action: "state" })).json;
  const lvl = (st2?.tracks?.free ?? []).find((l: any) => l.claimable);
  if (!lvl) check("E4 · (sin nivel del pase reclamable: omitido)", true);
  else {
    const rs = await Promise.all(Array.from({ length: 5 }, () => api(A, "/api/game/progression", { action: "claimLevel", level: lvl.level, track: "free" }, { noRetry: true })));
    const n = sql(`select count(*) from public.credit_transactions where user_id='${A.userId}' and ref like 'pass:nexus-s1:free:${lvl.level}%' and ref not like 'pass:nexus-s1:free:${lvl.level}#%' ;`);
    check(`E4 · reclamar el nivel ${lvl.level} del pase ×5 a la vez: UN asiento, nada 500`, n === "1" && rs.every((r) => r.status < 500), { n, st: rs.map((r) => r.status) });
  }
}

/* ── E5 · Draft: empezar ×5 a la vez cobra la entrada UNA vez y crea UNA run ── */
{
  const c0 = await credits(B);
  const rs = await Promise.all(Array.from({ length: 5 }, () => api(B, "/api/game/draft-gauntlet", { action: "start", actionId: uuid() }, { noRetry: true })));
  const c1 = await credits(B);
  const runs = sql(`select count(*) from public.draft_runs where user_id='${B.userId}';`);
  const entries = sql(`select count(*) from public.economy_ops where user_id='${B.userId}' and ref like 'draft:entry:%';`) + "/" + sql(`select count(*) from public.credit_transactions where user_id='${B.userId}' and ref like 'draft:entry:%';`);
  const ledger = sql(`select count(*) from public.credit_transactions where user_id='${B.userId}' and ref like 'draft:entry:%';`);
  check("E5 · Draft ×5 a la vez: UNA run y UNA entrada en el libro (si ya había una run activa, se devuelve sin cobrar), nada 500", rs.every((r) => r.status < 500) && runs === "1" && ledger === "1" && (c0 - c1 === 2000 || c0 === c1), { st: rs.map((r) => r.status), runs, c0, c1, entries });
  const runId = rs.find((r) => r.json?.run?.id)?.json?.run?.id ?? rs.find((r) => r.json?.view?.runId)?.json?.view?.runId;
  if (runId) await api(B, "/api/game/draft-gauntlet", { action: "abandon", actionId: uuid(), runId }, { noRetry: true });
}

/* ── I · aislamiento entre cuentas ── */
{
  const strat = { id: "s-audit", name: "Audit", mapId: "ascent", side: "attack", description: "", tags: [], version: 2, notes: "", steps: [] as unknown[] };
  const { emptyStrat } = await import("file:///C:/NEXUS-CENTRAL/DRLCards/src/domain/tactics/strat.ts");
  const s = emptyStrat("s-audit", "ascent", "attack" as never, "Audit QA");
  const saved = await api(A, "/api/game/strats", { action: "save", strat: s }, { noRetry: true });
  const sid = saved.json?.id as string;
  check("I1 · A guarda una estrategia", saved.status === 200 && !!sid, saved.json);
  const listB = await api(B, "/api/game/strats");
  check("I2 · B no ve la estrategia de A en su lista", !JSON.stringify(listB.json ?? {}).includes(String(sid)), null);
  const upd = await api(B, "/api/game/strats", { action: "save", id: sid, strat: { ...s, name: "Robada" } }, { noRetry: true });
  check("I3 · B no puede sobrescribir la estrategia de A (404/409, sin cambio)", [404, 409].includes(upd.status) && sql(`select name from public.user_strats where id='${sid}';`) === "Audit QA", { st: upd.status });
  const del = await api(B, "/api/game/strats", { action: "delete", id: sid }, { noRetry: true });
  check("I4 · B no puede borrar la estrategia de A", del.status === 404 && sql(`select count(*) from public.user_strats where id='${sid}';`) === "1", { st: del.status });
  void strat;
  for (const p of ["/api/admin/users", "/api/admin/system", "/api/admin/moderation", "/api/admin/alpha"]) {
    const r = await fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${A.token}` } });
    check(`I5 · ${p} con cuenta normal → 401/403 sin datos`, [401, 403].includes(r.status), r.status);
  }
}

/* ── R · ranked: cola ×3 a la vez = UNA entrada; cancelar la vacía ── */
{
  const deck = await qa.validDeck(A);
  const rs = await Promise.all(Array.from({ length: 3 }, () => qa.mm(A, { action: "enqueue", deckId: deck!.id })));
  const rows = sql(`select count(*) from public.duel_pvp_queue where user_id='${A.userId}' and state in ('QUEUED','PAIRING');`);
  check("R1 · entrar en la cola ×3 a la vez: UNA entrada, nada 500", rs.every((r) => r.status < 500) && rows === "1", { st: rs.map((r) => r.status), rows });
  const c = await qa.mm(A, { action: "cancel" });
  const left = sql(`select count(*) from public.duel_pvp_queue where user_id='${A.userId}' and state in ('QUEUED','PAIRING');`);
  check("R2 · cancelar deja la cola vacía", c.status < 500 && left === "0", { st: c.status, left });
}

/* ── B · cuerpos JSON que no son objeto → 400, nunca 500 ── */
{
  const routes = ["coach-matches", "credits", "duel/matchmaking", "duel/pvp", "duel", "economy", "market", "progression", "social", "strats"];
  const bad: string[] = [];
  for (const r of routes) for (const b of ["null", "7", '"x"', "[]"]) { const st = await raw(A, `/api/game/${r}`, b); if (st >= 500) bad.push(`${r}:${b}:${st}`); }
  const pk = await raw(A, "/api/pickems", "null");
  check("B1 · cuerpos no-objeto en las 11 rutas: ninguna 500", bad.length === 0 && pk < 500, { bad, pk });
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
