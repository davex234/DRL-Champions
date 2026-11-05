/**
 * FASE 41 · QA REAL DE ECONOMÍA (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase41-real-qa.ts <credsFile>`
 *
 * Cuenta QA EXISTENTE (no la de la Fase 40, cuya evidencia se conserva) contra la app LOCAL (`next start`, túnel SSH a
 * la BD del VPS). Cliente PÚBLICO (anon + contraseña): nunca la service key en las llamadas. Evidencia en BD por SSH en
 * SOLO LECTURA. No imprime credenciales ni PII (ids truncados, conteos, importes).
 *
 *   0  agregados globales de la BD real (solo lectura, sin PII)
 *   A  huella inicial
 *   B  GET starter → plantilla posible, sin gratis · cero escrituras
 *   C  sonda de granja: comprar Sobre Inicial (×1 y ráfaga ×5) → 409, cero escrituras
 *   D  tienda de créditos de prueba → 403, +0
 *   E  GET competitivo (snapshot ×2 + posición) → cero escrituras
 *   F  «actualizar misiones» tras asentar la lectura → cero escrituras
 *   G  comprar Sobre Estándar (−750) · reintento mismo gesto → +0
 *   H  abrir Sobre Estándar (5 cartas) · reintento mismo gesto → mismas cartas, +0
 *   I  partida PvE real por la API → recompensa (asiento duel:<id> único) · jugada repetida → rechazada, +0
 *   J  reclamo de misión (si hay una completa) y re-reclamo → 409, +0
 *   K  huella final · saldo = Σ libro mayor
 *
 *   `… <credsFile> missions` · sonda del P0 de misiones: cobra las periódicas completas, juega OTRA partida real y
 *   re-reclama → 409 y el único cambio de saldo es la recompensa de la partida. Evidencia en real/real-missions.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase41/real");
mkdirSync(OUT, { recursive: true });
const MODE = process.argv[3] ?? "all";
const LOG = join(OUT, MODE === "missions" ? "real-missions.log" : "real-qa.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
if (!/^[0-9a-f-]{36}$/.test(U)) throw new Error("userId inválido");
let failures = 0;
const evidence: Record<string, unknown> = { account: U.slice(0, 8), base: BASE, at: new Date().toISOString() };
const check = (label: string, cond: boolean, detail = "") => { if (!cond) failures++; log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };

function psql(sql: string): string {
  return execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "nexusadmin@212.95.40.144",
    "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -F ' | ' -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
}
const kv = (sql: string) => Object.fromEntries(psql(sql).split("\n").filter((l) => l.includes(" | ")).map((l) => { const [k, ...v] = l.split(" | "); return [k, v.join(" | ")]; }));

function fp(): Record<string, string> {
  return kv(`
select 'credits', credits::text from public.profiles where id = '${U}';
select 'xp', xp::text from public.profiles where id = '${U}';
select 'points', points::text from public.profiles where id = '${U}';
select 'packs', coalesce(string_agg(pack_id || '=' || qty, ',' order by pack_id), '') from public.user_packs where user_id = '${U}' and qty > 0;
select 'packs_opened', coalesce((select packs_opened::text from public.user_game where user_id = '${U}'), 'none');
select 'cards', count(*)::text from public.user_cards where user_id = '${U}';
select 'matches', count(*)::text from public.duel_matches where user_id = '${U}';
select 'rating', coalesce((select rating || '/' || games_played from public.duel_pvp_ratings where user_id = '${U}'), 'none');
select 'pass_md5', coalesce((select md5(state::text) from public.user_pass where user_id = '${U}'), 'none');
select 'pass_updated', coalesce((select updated_at::text from public.user_pass where user_id = '${U}'), 'none');
select 'ledger_n', count(*)::text from public.credit_transactions where user_id = '${U}';
select 'ledger_sum', coalesce(sum(delta), 0)::text from public.credit_transactions where user_id = '${U}';
select 'ops_n', count(*)::text from public.economy_ops where user_id = '${U}';
select 'payments_n', count(*)::text from public.payments where user_id = '${U}';
`);
}
const diff = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`);

async function token(): Promise<string> {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: creds.email, password: creds.password });
  if (error || !data.session) throw new Error("login QA falló");
  return data.session.access_token;
}
async function call(t: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${t}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function playEasy(t: string): Promise<{ matchId: string; reason: string; delta: number }> {
  const ws = await call(t, "GET", "/api/game/duels");
  const deckId = ws.json.activeDeckId ?? ws.json.decks?.find((d: any) => d.valid)?.id;
  const s = await call(t, "POST", "/api/game/duel", { action: "start", deckId, difficulty: "EASY" });
  let view = s.json.view; const matchId = view?.matchId ?? "";
  let guard = 0;
  while (view && view.status === "IN_PROGRESS" && guard++ < 40) {
    const card = view.yourHand?.[0]; if (!card) break;
    const stat = view.youAreAttacker ? (["stronghold", "gamesense", "entryfrag"] as const).reduce((a, b) => (card.combat[a] >= card.combat[b] ? a : b)) : undefined;
    const r = await call(t, "POST", "/api/game/duel", { action: "play", matchId, cardUid: card.uid, ...(stat ? { stat } : {}) });
    if (r.status !== 200) break;
    view = r.json.view;
  }
  const a = kv(`select 'reason', coalesce(max(reason), '') from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';
select 'delta', coalesce(max(delta), 0)::text from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';`);
  return { matchId, reason: a.reason, delta: Number(a.delta) };
}

async function missionsProbe() {
  log(`FASE 41 · QA REAL · sonda de misiones periódicas · cuenta ${U.slice(0, 8)} · ${BASE}`);
  const t = await token();
  const state = async () => ((await call(t, "POST", "/api/game/progression", { action: "state" })).json.missions ?? []) as any[];
  let ms = await state();
  log(`  tanda: ${ms.filter((m) => m.kind === "daily" || m.kind === "weekly").map((m) => `${m.id}(${m.current}/${m.goal}${m.claimed ? ",cobrada" : ""})`).join(" · ")}`);
  const probe: Record<string, unknown>[] = [];
  // Asegura una periódica de duelos completa: jugar hasta completar la de menor objetivo (máx. 5 partidas).
  const duelMission = ms.filter((m) => (m.kind === "daily" || m.kind === "weekly") && /^duels_/.test(m.metric) && !m.claimed).sort((a, b) => (a.goal - a.current) - (b.goal - b.current))[0];
  let plays = 0;
  while (duelMission && plays < 5) {
    const cur = (await state()).find((m) => m.id === duelMission.id);
    if (!cur || cur.complete) break;
    const p = await playEasy(t); plays++;
    log(`  partida ${plays}: ${p.matchId.slice(0, 8)} ${p.reason} ${p.delta}`);
  }
  ms = await state();
  for (const m of ms.filter((x) => (x.kind === "daily" || x.kind === "weekly") && x.complete && !x.claimed)) {
    const f0 = fp();
    const c1 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: m.id });
    const f1 = fp();
    const p = await playEasy(t);
    const f2 = fp();
    const c2 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: m.id });
    const f3 = fp();
    const row = { id: m.id, kind: m.kind, first: c1.status, paid: Number(f1.credits) - Number(f0.credits), extraMatch: { reason: p.reason, delta: p.delta }, reclaim: c2.status, reclaimDelta: Number(f3.credits) - Number(f2.credits) };
    probe.push(row);
    check(`${m.id}: cobra una vez (+${row.paid})`, c1.status === 200 && row.paid === m.rewardCredits, JSON.stringify(row));
    check(`${m.id}: tras OTRA partida real, re-reclamar → 409 y +0`, c2.status === 409 && row.reclaimDelta === 0 && diff(f2, f3).length === 0);
  }
  if (probe.length === 0) log("  ninguna periódica completa y sin cobrar en esta tanda (se documenta)");
  const fpK = fp();
  check("saldo = Σ libro mayor", fpK.credits === fpK.ledger_sum);
  writeFileSync(join(OUT, "real-missions.json"), JSON.stringify({ account: U.slice(0, 8), at: new Date().toISOString(), plays, probe, failures }, null, 2) + "\n");
  log(`\n${failures === 0 ? "SONDA OK" : `SONDA con ${failures} fallo(s)`}`);
  if (failures) process.exitCode = 1;
}

async function main() {
  if (MODE === "missions") return missionsProbe();
  log(`FASE 41 · QA REAL · cuenta ${U.slice(0, 8)} · ${BASE}`);

  log("\n· 0 · BD REAL (solo lectura, agregados sin PII)");
  const g = kv(`
select 'accounts', count(*)::text from public.profiles;
select 'negative_credits', count(*)::text from public.profiles where credits < 0;
select 'credits_ne_ledger', count(*)::text from public.profiles p where p.credits <> coalesce((select sum(delta) from public.credit_transactions t where t.user_id = p.id), 0);
select 'inicial_buys_hist', coalesce(string_agg(n::text, ',' order by n), '') from (select count(*) n from public.credit_transactions where reason = 'buy_pack:inicial' group by user_id) s;
select 'inicial_buys_max', coalesce(max(n), 0)::text from (select count(*) n from public.credit_transactions where reason = 'buy_pack:inicial' group by user_id) s;
select 'sandbox_purchase_rows', count(*)::text from public.credit_transactions where reason like 'sandbox_purchase:%';
select 'mission_rows', count(*)::text from public.credit_transactions where reason = 'mission_reward';
select 'mission_repeat_in_window', count(*)::text from (select user_id, split_part(ref, ':', 3) id, split_part(ref, ':', 4) at, count(*) c from public.credit_transactions where reason = 'mission_reward' group by 1, 2, 3 having count(*) > 1) s;
select 'prestige_rows', count(*)::text from public.credit_transactions where reason like 'prestige:%';
select 'duplicate_refs', count(*)::text from (select user_id, ref from public.credit_transactions where ref is not null group by 1, 2 having count(*) > 1) s;
select 'duel_capped_rows', count(*)::text from public.credit_transactions where reason like 'duel_capped_%';
select 'max_paid_duels_day', coalesce(max(n), 0)::text from (select user_id, date_trunc('day', created_at at time zone 'UTC') d, count(*) n from public.credit_transactions where reason in ('duel_win','duel_draw','duel_loss') group by 1, 2) s;
`);
  evidence.db = g;
  for (const [k, v] of Object.entries(g)) log(`    ${k}: ${v}`);
  check("BD real: 0 saldos negativos", g.negative_credits === "0");
  check("BD real: saldo = Σ libro mayor en todas las cuentas", g.credits_ne_ledger === "0");
  check("BD real: 0 claves duplicadas en el libro mayor", g.duplicate_refs === "0");
  check("BD real: ningún día con más de 20 duelos pagados", Number(g.max_paid_duels_day) <= 20, g.max_paid_duels_day);

  const t = await token();
  await call(t, "POST", "/api/game/progression", { action: "state" }); // asienta rotaciones pendientes ANTES de la huella
  const fp0 = fp();
  evidence.fp0 = fp0;
  log(`\n· A · huella inicial: créditos ${fp0.credits} · sobres ${fp0.packs || "-"} · cartas ${fp0.cards} · asientos ${fp0.ledger_n}`);
  check("cuenta QA: saldo = Σ libro mayor (antes)", fp0.credits === fp0.ledger_sum);

  log("\n· B · GET /api/game/starter");
  const st = await call(t, "GET", "/api/game/starter");
  evidence.starter = { status: st.status, eligible: st.json.eligible, reason: st.json.reason, deckReady: st.json.deckReady, freeClaims: st.json.freeClaims };
  check("200 y plantilla posible → Sobre Inicial gratis NO disponible (DECK_READY)", st.status === 200 && st.json.deckReady === true && st.json.eligible === false && st.json.reason === "DECK_READY", JSON.stringify(evidence.starter));
  check("GET starter: cero escrituras", diff(fp0, fp()).length === 0);

  log("\n· C · sonda de granja del Sobre Inicial");
  const farm = await call(t, "POST", "/api/game/packs", { action: "buy", packId: "inicial", ref: `f41-farm-${randomUUID()}` });
  check("comprar Sobre Inicial con plantilla posible → 409", farm.status === 409, `${farm.status} ${farm.json.error ?? ""}`);
  const burst = await Promise.all(Array.from({ length: 5 }, () => call(t, "POST", "/api/game/packs", { action: "buy_and_open", packId: "inicial", ref: `f41-farm-${randomUUID()}` })));
  check("ráfaga ×5 comprar-y-abrir Sobre Inicial → todas 409", burst.every((r) => r.status === 409), burst.map((r) => r.status).join(","));
  check("sonda de granja: cero escrituras", diff(fp0, fp()).length === 0, diff(fp0, fp()).join("; "));

  log("\n· D · tienda de créditos de prueba");
  const sb = await call(t, "POST", "/api/game/credits", { action: "sandboxPurchase", productId: "drlc-ultimate", ref: `f41-sb-${randomUUID().slice(0, 8)}` });
  check("sandboxPurchase → 403 (cerrada)", sb.status === 403, `${sb.status} ${sb.json.error ?? ""}`);
  const cv = await call(t, "GET", "/api/game/credits");
  check("GET créditos declara purchasesOpen=false", cv.status === 200 && cv.json.purchasesOpen === false);
  check("tienda cerrada: cero escrituras (sin pago ni asiento)", diff(fp0, fp()).length === 0);

  log("\n· E · GET competitivo");
  const c1 = await call(t, "GET", "/api/game/competitive"); const c2 = await call(t, "GET", "/api/game/competitive"); const c3 = await call(t, "GET", "/api/game/competitive?position=1");
  check("snapshot ×2 + posición → 200", [c1, c2, c3].every((r) => r.status === 200), [c1, c2, c3].map((r) => r.status).join(","));
  check("GET competitivo: cero escrituras (rating y pase intactos)", diff(fp0, fp()).length === 0, diff(fp0, fp()).join("; "));

  log("\n· F · «actualizar misiones»");
  const rf = await call(t, "POST", "/api/game/progression", { action: "refreshMissions" });
  check("refreshMissions → 200 sin re-sorteo (pase intacto)", rf.status === 200 && diff(fp0, fp()).length === 0, diff(fp0, fp()).join("; "));

  log("\n· G · comprar Sobre Estándar (−750) y reintento");
  const gBuy = `f41-buy-${randomUUID()}`;
  const b1 = await call(t, "POST", "/api/game/packs", { action: "buy", packId: "estandar", ref: gBuy });
  const fpB = fp();
  check("compra → 200 y −750 exactos", b1.status === 200 && Number(fpB.credits) === Number(fp0.credits) - 750, `${b1.status} ${fp0.credits} → ${fpB.credits}`);
  const b2 = await call(t, "POST", "/api/game/packs", { action: "buy", packId: "estandar", ref: gBuy });
  const fpB2 = fp();
  check("reintento con el mismo gesto → 200 y +0 (sin segundo cobro ni sobre)", b2.status === 200 && diff(fpB, fpB2).length === 0, diff(fpB, fpB2).join("; "));

  log("\n· H · abrir Sobre Estándar y reintento");
  const gOpen = `f41-open-${randomUUID()}`;
  const o1 = await call(t, "POST", "/api/game/packs", { action: "open", packId: "estandar", ref: gOpen });
  const fpO = fp();
  check("apertura → 5 cartas, +1 sobre abierto", o1.status === 200 && o1.json.opened?.length === 5 && Number(fpO.cards) === Number(fpB2.cards) + 5, `${o1.status} cartas ${fp0.cards}→${fpO.cards}`);
  const o2 = await call(t, "POST", "/api/game/packs", { action: "open", packId: "estandar", ref: gOpen });
  check("reintento → mismas cartas (uids), repeated, +0", o2.status === 200 && o2.json.repeated === true && JSON.stringify(o2.json.opened?.map((c: any) => c.uid)) === JSON.stringify(o1.json.opened?.map((c: any) => c.uid)) && diff(fpO, fp()).length === 0);
  check("abrir un sobre: 0 créditos", fpO.credits === fpB2.credits);

  log("\n· I · partida PvE real (Fácil) y recompensa");
  const ws = await call(t, "GET", "/api/game/duels");
  const deckId = ws.json.activeDeckId ?? ws.json.decks?.find((d: any) => d.valid)?.id;
  const fpI0 = fp();
  let matchId = "";
  if (!deckId) check("equipo válido para jugar", false, "sin equipo");
  else {
    const active = await call(t, "POST", "/api/game/duel", { action: "active" });
    if (active.json.view?.matchId) await call(t, "POST", "/api/game/duel", { action: "abandon", matchId: active.json.view.matchId });
    const s = await call(t, "POST", "/api/game/duel", { action: "start", deckId, difficulty: "EASY" });
    let view = s.json.view; matchId = view?.matchId ?? "";
    check("start PvE Fácil → 200", s.status === 200 && !!matchId, `${s.status} ${s.json.error ?? ""}`);
    let guard = 0; let lastPlay: { cardUid: string; stat?: string } | null = null;
    while (view && view.status === "IN_PROGRESS" && guard++ < 40) {
      const card = view.yourDraftCardUid ? null : view.yourHand?.[0];
      if (!card) break;
      const stat = view.youAreAttacker ? (["stronghold", "gamesense", "entryfrag"] as const).reduce((a, b) => (card.combat[a] >= card.combat[b] ? a : b)) : undefined;
      lastPlay = { cardUid: card.uid, stat };
      const r = await call(t, "POST", "/api/game/duel", { action: "play", matchId, cardUid: card.uid, ...(stat ? { stat } : {}) });
      if (r.status !== 200) { log(`    jugada ${guard} → ${r.status} ${r.json.error ?? ""}`); break; }
      view = r.json.view;
    }
    const fpI = fp();
    const award = kv(`select 'rows', count(*)::text from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';
select 'reason', coalesce(max(reason), '') from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';
select 'delta', coalesce(max(delta), 0)::text from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';
select 'status', status from public.duel_matches where id = '${matchId}';
select 'turns', jsonb_array_length(state->'turns')::text from public.duel_matches where id = '${matchId}';`);
    evidence.match = { id: matchId.slice(0, 8), ...award, view: { status: view?.status, winner: view?.result?.winner ?? null, award: view?.result?.award ?? null } };
    check("partida terminada en servidor (10 turnos)", award.status === "COMPLETED" && award.turns === "10", `${award.status} turnos ${award.turns}`);
    check("recompensa: UN asiento duel:<id> con la tabla PvE (Fácil: 120/60/25 o topada 0)", award.rows === "1" && /^duel_(capped_)?(win|draw|loss)$/.test(award.reason) && ["120", "60", "25", "0"].includes(award.delta), `${award.reason} ${award.delta}`);
    check("créditos = antes + recompensa", Number(fpI.credits) === Number(fpI0.credits) + Number(award.delta), `${fpI0.credits} → ${fpI.credits}`);
    if (lastPlay) {
      const again = await call(t, "POST", "/api/game/duel", { action: "play", matchId, ...lastPlay });
      const fpI2 = fp();
      check("jugada repetida sobre partida terminada → rechazada y +0 (recompensa no se repite)", again.status >= 400 && diff(fpI, fpI2).length === 0, `${again.status} · ${diff(fpI, fpI2).join("; ")}`);
    }
  }

  log("\n· J · misiones");
  const prog = await call(t, "POST", "/api/game/progression", { action: "state" });
  const missions: any[] = prog.json.missions ?? prog.json.objectives ?? [];
  const claimable = missions.find((m) => (m.complete ?? (m.current >= m.goal)) && !m.claimed);
  if (claimable) {
    const fpJ0 = fp();
    const m1 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: claimable.id });
    const fpJ1 = fp();
    const m2 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: claimable.id });
    const fpJ2 = fp();
    evidence.mission = { id: claimable.id, first: m1.status, second: m2.status, delta: Number(fpJ1.credits) - Number(fpJ0.credits) };
    check(`reclamar ${claimable.id} → 200 y paga`, m1.status === 200 && Number(fpJ1.credits) > Number(fpJ0.credits), `+${Number(fpJ1.credits) - Number(fpJ0.credits)}`);
    check("re-reclamar en la misma tanda → 409 y +0", m2.status === 409 && diff(fpJ1, fpJ2).length === 0, `${m2.status}`);
  } else {
    const claimed = missions.find((m) => m.claimed && (m.kind === "daily" || m.kind === "weekly"));
    if (claimed) {
      const fpJ0 = fp();
      const m2 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: claimed.id });
      evidence.mission = { id: claimed.id, reclaim: m2.status };
      check(`re-reclamar misión ya cobrada (${claimed.id}) → 409 y +0`, m2.status === 409 && diff(fpJ0, fp()).length === 0, `${m2.status}`);
    } else log("    sin misión completa ni cobrada en esta tanda (cubierto por la matriz y el fuzzer)");
  }

  log("\n· K · huella final");
  const fpK = fp();
  evidence.fpFinal = fpK;
  evidence.delta = diff(fp0, fpK);
  for (const d of diff(fp0, fpK)) log(`    ${d}`);
  check("cuenta QA: saldo = Σ libro mayor (después)", fpK.credits === fpK.ledger_sum);
  check("sin pagos de prueba nuevos", fpK.payments_n === fp0.payments_n);
  evidence.failures = failures;
  writeFileSync(join(OUT, "real-qa.json"), JSON.stringify(evidence, null, 2) + "\n");
  log(`\n${failures === 0 ? "QA REAL OK" : `QA REAL con ${failures} fallo(s)`} → docs/product/qa/fase41/real/real-qa.json`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { log(`ERROR ${e instanceof Error ? e.message : e}`); process.exit(1); });
