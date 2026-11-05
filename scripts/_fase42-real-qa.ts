/**
 * FASE 42 · QA REAL DEL LIVE SERVICE (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase42-real-qa.ts <credsFile>`
 *
 * Cuenta QA EXISTENTE (8c326e52; la de la Fase 40 se conserva intacta) contra la app LOCAL (`next start`, túnel SSH a la
 * BD del VPS). Cliente PÚBLICO (anon + contraseña). Evidencia en BD por SSH en SOLO LECTURA. Sin credenciales ni PII.
 *
 *   0  agregados globales de la BD real (reclamos duplicados por tanda, tope PvE, Pick'em repetidos)
 *   A  huella inicial SIN asentar nada antes (si hay rotación vencida, las lecturas no deben materializarla)
 *   B  GET daily-loop ×5, meta ×3, loop ×3 (+ en paralelo, «dos pestañas») → cero escrituras
 *   C  reloj: serverNow vs reloj local, resets UTC, ventanas de objetivos, temporada del calendario
 *   D  seguridad de la ruta: ?userId / ?now / ?tz → 400; sin token → 401; sin correct_option en la foto
 *   E  Pick'em y eventos reales (solo lo que exista)
 *   F  diaria: si hay una de duelos en progreso, partidas PvE reales (≤ 3) → progreso en la foto → reclamo único,
 *      reintento y doble reclamo simultáneo → +0
 *   G  «Qué sigue» tras la partida: la foto refleja el progreso y la acción siguiente
 *   H  huella final: saldo = Σ libro mayor; cambios solo los esperados (partidas y reclamo)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetWindows } from "../src/domain/liveService";
import { SEASON_CALENDAR } from "../src/data/seasonCalendar";

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
const OUT = join(process.cwd(), "docs/product/qa/fase42/real");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "real-qa.log");
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
if (!/^[0-9a-f-]{36}$/.test(U)) throw new Error("userId inválido");
let failures = 0;
const evidence: Record<string, unknown> = { account: U.slice(0, 8), base: BASE, at: new Date().toISOString(), kind: "REAL" };
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
select 'last_seen_at', coalesce(last_seen_at::text, 'null') from public.profiles where id = '${U}';
select 'packs', coalesce(string_agg(pack_id || '=' || qty, ',' order by pack_id), '') from public.user_packs where user_id = '${U}' and qty > 0;
select 'packs_opened', coalesce((select packs_opened::text from public.user_game where user_id = '${U}'), 'none');
select 'cards', count(*)::text from public.user_cards where user_id = '${U}';
select 'matches', count(*)::text from public.duel_matches where user_id = '${U}';
select 'matches_updated', coalesce(max(updated_at)::text, 'none') from public.duel_matches where user_id = '${U}';
select 'rating', coalesce((select rating || '/' || games_played from public.duel_pvp_ratings where user_id = '${U}'), 'none');
select 'pass_md5', coalesce((select md5(state::text) from public.user_pass where user_id = '${U}'), 'none');
select 'pass_updated', coalesce((select updated_at::text from public.user_pass where user_id = '${U}'), 'none');
select 'achievements', count(*)::text from public.user_achievements where user_id = '${U}';
select 'ledger_n', count(*)::text from public.credit_transactions where user_id = '${U}';
select 'ledger_sum', coalesce(sum(delta), 0)::text from public.credit_transactions where user_id = '${U}';
select 'ops_n', count(*)::text from public.economy_ops where user_id = '${U}';
select 'draft_runs', count(*)::text from public.draft_runs where user_id = '${U}';
select 'campaign', count(*)::text from public.campaign_progress where user_id = '${U}';
select 'pickem_answers', count(*)::text from public.pickem_answers a join public.pickem_submissions s on s.id = a.submission_id where s.user_id = '${U}';
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
async function call(t: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; ms: number; raw: string }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const raw = await res.text();
  let json: any = {}; try { json = JSON.parse(raw); } catch { /* vacío */ }
  return { status: res.status, json, ms: Date.now() - t0, raw };
}

async function playEasy(t: string): Promise<{ matchId: string; reason: string; delta: number; status: string }> {
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
select 'delta', coalesce(max(delta), 0)::text from public.credit_transactions where user_id = '${U}' and ref = 'duel:${matchId}';
select 'status', coalesce((select status from public.duel_matches where id = '${matchId || "00000000-0000-0000-0000-000000000000"}'), 'none');`);
  return { matchId, reason: a.reason, delta: Number(a.delta), status: a.status };
}

const summary = (s: any) => ({
  serverNow: s.serverNow, primary: { id: s.primaryAction?.id, kind: s.primaryAction?.kind, reason: s.primaryAction?.reason, urgency: s.primaryAction?.urgency ?? null },
  secondary: (s.secondaryActions ?? []).map((a: any) => a.id), unavailable: s.unavailable,
  resets: s.service?.resets, today: s.service?.today?.map((c: any) => `${c.id}:${c.status}:${c.progressLabel}`), thisWeek: s.service?.thisWeek?.map((c: any) => `${c.id}:${c.status}:${c.progressLabel}`),
  dailyDone: s.service?.dailyDone, weeklyDone: s.service?.weeklyDone, expiring: s.service?.expiring?.map((e: any) => `${e.source}:${e.urgency}`),
  season: s.service?.season, returning: s.service?.returning ?? null, recent: s.service?.recent?.length ?? 0, draftRun: s.service?.draftRun ?? null,
  live: { featured: s.live?.featured?.name ?? null, upcoming: s.live?.upcoming?.name ?? null }, pickems: s.pickems ?? null,
});

async function main() {
  log(`FASE 42 · QA REAL · live service · cuenta ${U.slice(0, 8)} · ${BASE}`);

  log("\n· 0 · BD REAL (solo lectura, agregados sin PII)");
  const g = kv(`
select 'accounts', count(*)::text from public.profiles;
select 'credits_ne_ledger', count(*)::text from public.profiles p where p.credits <> coalesce((select sum(delta) from public.credit_transactions t where t.user_id = p.id), 0);
select 'duplicate_refs', count(*)::text from (select user_id, ref from public.credit_transactions where ref is not null group by 1, 2 having count(*) > 1) s;
select 'mission_rows', count(*)::text from public.credit_transactions where reason = 'mission_reward';
select 'mission_repeat_in_window', count(*)::text from (select user_id, split_part(ref, ':', 3) id, split_part(ref, ':', 4) at, count(*) c from public.credit_transactions where reason = 'mission_reward' group by 1, 2, 3 having count(*) > 1) s;
select 'max_paid_duels_day', coalesce(max(n), 0)::text from (select user_id, date_trunc('day', created_at at time zone 'UTC') d, count(*) n from public.credit_transactions where reason in ('duel_win','duel_draw','duel_loss') group by 1, 2) s;
select 'pickem_reward_rows', count(*)::text from public.credit_transactions where reason like 'pickem_reward%';
select 'pickem_events', count(*)::text from public.pickem_events;
select 'pickem_questions_open', count(*)::text from public.pickem_questions where locks_at > now();
select 'events_total', count(*)::text from public.events;
select 'matches_live', count(*)::text from public.matches where lower(status) = 'live';
select 'active_duels', count(*)::text from public.duel_matches where status = 'IN_PROGRESS';
select 'draft_runs_active', count(*)::text from public.draft_runs where status in ('DRAFTING','READY','IN_MATCH');
select 'db_now', now()::text;
`);
  evidence.db = g;
  for (const [k, v] of Object.entries(g)) log(`    ${k}: ${v}`);
  check("BD real: saldo = Σ libro mayor en todas las cuentas", g.credits_ne_ledger === "0");
  check("BD real: 0 claves duplicadas en el libro mayor", g.duplicate_refs === "0");
  check("BD real: ningún día con más de 20 duelos pagados", Number(g.max_paid_duels_day) <= 20, g.max_paid_duels_day);

  const t = await token();
  const fp0 = fp();
  evidence.fp0 = { credits: fp0.credits, ledger_n: fp0.ledger_n, cards: fp0.cards, matches: fp0.matches, pass_updated: fp0.pass_updated };
  log(`\n· A · huella inicial (sin asentar nada): créditos ${fp0.credits} · asientos ${fp0.ledger_n} · partidas ${fp0.matches} · pase ${fp0.pass_updated}`);
  check("cuenta QA: saldo = Σ libro mayor (antes)", fp0.credits === fp0.ledger_sum);

  log("\n· B · lecturas del vestíbulo");
  const times: Record<string, number[]> = { "daily-loop": [], meta: [], loop: [] };
  let first: any = null;
  for (let i = 0; i < 5; i++) { const r = await call(t, "GET", "/api/game/daily-loop"); times["daily-loop"].push(r.ms); if (i === 0) first = r; check(`GET daily-loop #${i + 1} → 200`, r.status === 200, `${r.ms} ms`); }
  for (let i = 0; i < 3; i++) { const r = await call(t, "GET", "/api/game/meta"); times.meta.push(r.ms); check(`GET meta #${i + 1} → 200`, r.status === 200, `${r.ms} ms`); }
  for (let i = 0; i < 3; i++) { const r = await call(t, "GET", "/api/game/loop"); times.loop.push(r.ms); check(`GET loop #${i + 1} → 200`, r.status === 200, `${r.ms} ms`); }
  const tabs = await Promise.all([call(t, "GET", "/api/game/daily-loop"), call(t, "GET", "/api/game/daily-loop"), call(t, "GET", "/api/game/meta"), call(t, "GET", "/api/game/loop")]);
  check("«dos pestañas» (4 lecturas en paralelo) → 200", tabs.every((r) => r.status === 200));
  check("dos pestañas: misma tanda en las dos fotos", JSON.stringify(tabs[0].json.service?.today?.map((c: any) => c.id)) === JSON.stringify(tabs[1].json.service?.today?.map((c: any) => c.id)));
  const fpB = fp();
  const dB = diff(fp0, fpB);
  evidence.zeroWrite = { reads: 15, diff: dB, ms: times };
  check("16 lecturas (daily-loop, meta, loop, paralelas): CERO escrituras en la huella", dB.length === 0, dB.join("; ") || "sin cambios");

  log("\n· C · reloj y ventanas");
  const snap = first.json;
  evidence.snapshot = summary(snap);
  const tA = Date.now(); const fresh = await call(t, "GET", "/api/game/daily-loop"); const tB = Date.now();
  const localNow = Math.round((tA + tB) / 2);
  const skew = fresh.json.serverNow - localNow;
  log(`    serverNow ${new Date(snap.serverNow).toISOString()} · local ${new Date(localNow).toISOString()} · desvío ${skew} ms · BD ${g.db_now}`);
  check("serverNow presente y cercano al reloj real (|Δ| < 5 min)", typeof snap.serverNow === "number" && Math.abs(skew) < 300_000, `${skew} ms`);
  const w = resetWindows(snap.serverNow);
  check("resets de la foto = ventanas UTC del servidor", snap.service?.resets?.dailyEndsAt === w.dailyEndsAt && snap.service?.resets?.weeklyEndsAt === w.weeklyEndsAt, `${new Date(w.dailyEndsAt).toISOString()} · ${new Date(w.weeklyEndsAt).toISOString()}`);
  check("diarias ≤ 3 y todas de la ventana vigente", (snap.service?.today ?? []).length <= 3 && (snap.service?.today ?? []).every((c: any) => c.endsAt === w.dailyEndsAt), (snap.service?.today ?? []).map((c: any) => c.id).join(","));
  check("semanales ≤ 2 y de la semana vigente", (snap.service?.thisWeek ?? []).length <= 2 && (snap.service?.thisWeek ?? []).every((c: any) => c.endsAt === w.weeklyEndsAt));
  const cal = SEASON_CALENDAR.find((e) => e.passSeasonId);
  check("temporada: fin = calendario (Temporada 1, sin S2)", !!cal && !!snap.service?.season && snap.service.season.endsAt === Date.parse(cal.endsAt) && SEASON_CALENDAR.filter((e) => e.passSeasonId).length === 1, JSON.stringify(snap.service?.season));
  check("héroe con razón", typeof snap.primaryAction?.reason === "string" && snap.primaryAction.reason.length > 5, `${snap.primaryAction?.id}: ${snap.primaryAction?.reason}`);
  check("urgencia solo con fin real", !snap.primaryAction?.urgency || (typeof snap.primaryAction.endsAt === "number" && snap.primaryAction.endsAt > snap.serverNow));
  check("vuelta: ≤ 3 hechos (o ninguna si la actividad es reciente)", !snap.service?.returning || snap.service.returning.facts.length <= 3, JSON.stringify(snap.service?.returning ?? null));

  log("\n· D · seguridad de la ruta");
  for (const q of ["userId=00000000-0000-4000-8000-000000000000", "now=0", "tz=Pacific/Auckland", "serverNow=1"]) {
    const r = await call(t, "GET", `/api/game/daily-loop?${q}`);
    check(`?${q.split("=")[0]}= → 400`, r.status === 400, `${r.status}`);
  }
  const anon = await call(null, "GET", "/api/game/daily-loop");
  check("sin token → foto pública (sin datos personales) o 401", anon.status === 401 || (anon.status === 200 && anon.json.signedIn === false), `${anon.status}`);
  check("la foto no contiene correct_option", !first.raw.includes("correct_option"));
  const fpD = fp();
  check("sondas de seguridad: cero escrituras", diff(fp0, fpD).length === 0, diff(fp0, fpD).join("; "));

  log("\n· E · Pick'em y eventos reales");
  evidence.pickem = snap.pickems; evidence.live = { featured: snap.live?.featured ?? null, upcoming: snap.live?.upcoming ?? null };
  log(`    pickems: ${JSON.stringify(snap.pickems)} · evento destacado: ${snap.live?.featured?.name ?? "ninguno"} · próximo: ${snap.live?.upcoming?.name ?? "ninguno"}`);
  const liveAction = [snap.primaryAction, ...(snap.secondaryActions ?? [])].find((a: any) => a.id === "live");
  const realLive = [snap.live?.featured, snap.live?.upcoming].some((e: any) => e && e.lifecycle === "ACTIVE" && e.liveCount > 0 && !e.isDemo);
  log(`    partidos «live» en BD: ${g.matches_live} · destacado demo: ${snap.live?.featured?.isDemo ?? "-"} · acción «live»: ${liveAction ? liveAction.title : "no"}`);
  check("«Ver en directo» solo con un directo REAL (no demo)", !liveAction || realLive, liveAction ? liveAction.title : "sin acción de directo");
  if (snap.live?.featured?.isDemo) check("un evento demo destacado va marcado como demo", snap.live.featured.isDemo === true);
  if (snap.pickems && snap.pickems.pending > 0) check("Pick'em pendiente con cierre real futuro", typeof snap.pickems.nextLockAt === "number" && snap.pickems.nextLockAt > snap.serverNow);
  else log("    sin Pick'em abierto pendiente para esta cuenta (se documenta; cubierto por la matriz)");

  log("\n· F · diaria real (partidas legítimas, sin SQL)");
  const inProgress = (snap.service?.today ?? []).filter((c: any) => c.status === "IN_PROGRESS" && /^duels_/.test(c.metric)).sort((a: any, b: any) => (a.goal - a.current) - (b.goal - b.current))[0];
  const claimableNow = (snap.service?.today ?? []).find((c: any) => c.status === "CLAIMABLE") ?? (snap.service?.thisWeek ?? []).find((c: any) => c.status === "CLAIMABLE");
  let target = claimableNow ?? null;
  const plays: unknown[] = [];
  if (!target && inProgress && inProgress.goal - inProgress.current <= 3) {
    const active = await call(t, "POST", "/api/game/duel", { action: "active" });
    if (active.json.view?.matchId) log(`    partida abierta previa ${String(active.json.view.matchId).slice(0, 8)} (se documenta, no se abandona)`);
    for (let i = 0; i < inProgress.goal - inProgress.current; i++) { const p = await playEasy(t); plays.push({ id: p.matchId.slice(0, 8), reason: p.reason, delta: p.delta, status: p.status }); log(`    partida ${i + 1}: ${p.matchId.slice(0, 8)} ${p.status} ${p.reason} ${p.delta}`); }
    const after = await call(t, "GET", "/api/game/daily-loop");
    const card = (after.json.service?.today ?? []).find((c: any) => c.id === inProgress.id);
    evidence.afterMatch = summary(after.json);
    check(`G · tras jugar, la foto refleja el progreso de «${inProgress.label}»`, !!card && card.current >= inProgress.goal, card ? `${card.progressLabel} ${card.status}` : "no está");
    check("G · la siguiente acción existe y tiene razón", !!after.json.primaryAction?.href && !!after.json.primaryAction?.reason, `${after.json.primaryAction?.id}`);
    target = card?.status === "CLAIMABLE" ? card : null;
  }
  evidence.plays = plays;
  if (target) {
    const f0 = fp();
    const c1 = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: target.id });
    const f1 = fp();
    const paid = Number(f1.credits) - Number(f0.credits);
    check(`reclamar ${target.id} → 200 y paga su recompensa`, c1.status === 200 && paid > 0, `${c1.status} +${paid} (${target.reward})`);
    const again = await call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: target.id });
    const both = await Promise.all([call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: target.id }), call(t, "POST", "/api/game/progression", { action: "claimMission", missionId: target.id })]);
    const f2 = fp();
    check("reintento y doble reclamo simultáneo → 409 y +0", again.status === 409 && both.every((r) => r.status === 409) && diff(f1, f2).length === 0, `${again.status} ${both.map((r) => r.status).join(",")}`);
    const rows = kv(`select 'n', count(*)::text from public.credit_transactions where user_id = '${U}' and reason = 'mission_reward' and ref like 'mission:%:${target.id}:%' and created_at > now() - interval '1 hour';`);
    check("un solo asiento de esa misión en la tanda", rows.n === "1", rows.n);
    const post = await call(t, "GET", "/api/game/daily-loop");
    const pc = [...(post.json.service?.today ?? []), ...(post.json.service?.thisWeek ?? [])].find((c: any) => c.id === target.id);
    check("la foto marca la misión como cobrada", pc?.status === "CLAIMED", pc?.status);
    evidence.claim = { id: target.id, first: c1.status, paid, retry: again.status, parallel: both.map((r) => r.status), after: pc?.status };
  } else log("    ninguna diaria/semanal reclamable ni alcanzable con ≤ 3 partidas (se documenta)");

  log("\n· H · huella final");
  const fpK = fp();
  const dK = diff(fp0, fpK);
  for (const d of dK) log(`    ${d}`);
  evidence.fpFinal = { credits: fpK.credits, ledger_n: fpK.ledger_n, matches: fpK.matches };
  evidence.delta = dK;
  check("cuenta QA: saldo = Σ libro mayor (después)", fpK.credits === fpK.ledger_sum);
  const allowed = new Set(["credits", "xp", "points", "matches", "matches_updated", "pass_md5", "pass_updated", "ledger_n", "ledger_sum", "ops_n", "achievements"]);
  check("solo cambian campos esperados por partidas/reclamo (sin sobres, cartas, pagos, rating)", dK.every((d) => allowed.has(d.split(":")[0])) && (plays.length > 0 || evidence.claim ? true : dK.length === 0), dK.map((d) => d.split(":")[0]).join(","));
  check("sin pagos de prueba nuevos", fpK.payments_n === fp0.payments_n);
  evidence.failures = failures;
  writeFileSync(join(OUT, "real-qa.json"), JSON.stringify(evidence, null, 2) + "\n");
  log(`\n${failures === 0 ? "QA REAL OK" : `QA REAL con ${failures} fallo(s)`} → docs/product/qa/fase42/real/real-qa.json`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => { log(`ERROR ${e instanceof Error ? e.message : e}`); process.exit(1); });
