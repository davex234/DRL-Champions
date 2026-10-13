/**
 * FASE 24.6 · QA DEL PIPELINE AUTOMÁTICO (instrumento `_`, fuera de CI) — `npx tsx scripts/_fase24-6-qa-autosync.ts`
 *
 * Escenarios del brief sobre fixtures QA SYNTHETIC y la base de datos en memoria (`FakeDb`):
 * UPCOMING · ACTIVE · LIVE · FINISHED · SOURCE FAILURE · RETRY · DUPLICATE TRIGGER · DRY RUN ·
 * KILL SWITCH. Imprime una matriz escenario → esperado → medido. No hay red, no hay Supabase, no
 * hay escritura fuera del proceso. Los nombres de torneo llevan «QA SYNTHETIC»: nada de esto es
 * un dato real.
 */
import type { RawSnapshot } from "@/importer";
import { DEFAULT_AUTO_SYNC_CONFIG, type EsportsAutoSyncConfig } from "@/lib/esports/autosync/config";
import { runEsportsSync, type EsportsSyncRunResult } from "@/lib/esports/autosync/runner";
import { classifyEvent } from "@/lib/esports/autosync/policy";
import { createTimedFetcher, SourceError } from "@/lib/esports/autosync/sourceRef";
import { formatRunReport } from "@/lib/esports/autosync/report";
import { createMemoryLogger } from "@/lib/esports/autosync/log";
import { FakeDb } from "@/lib/esports/autosync/testing/fakeSupabase";
import { resetProgressionProbe } from "@/lib/esports/sync/schemaCompat";

const EVENT_ID = "qa-2766";
const TEAMS = [{ id: "1", name: "Alpha" }, { id: "2", name: "Beta" }, { id: "3", name: "Gamma" }, { id: "4", name: "Delta" }];
interface M { id: string; a: string; b: string; status?: string; scoreA?: number; scoreB?: number; winner?: string; round?: string; start?: string }
const BASE: M[] = [
  { id: "sf1", a: "Alpha", b: "Beta", round: "Semifinal", start: "2027-01-10T10:00:00Z" },
  { id: "sf2", a: "Gamma", b: "Delta", round: "Semifinal", start: "2027-01-10T13:00:00Z" },
  { id: "gf", a: "Alpha", b: "Gamma", round: "Grand Final", start: "2027-01-11T10:00:00Z" },
];
const snap = (matches: M[]): RawSnapshot => ({
  tournament: { id: "2766", name: "QA SYNTHETIC Champions", type: "international", status: "upcoming", startDate: "2027-01-10", endDate: "2027-01-11" },
  stages: [{ id: "st", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: TEAMS, players: [], coaches: [], maps: [], mapStats: [], standings: [], awards: {},
  matches: matches.map((m, i) => ({ id: m.id, stageId: "st", teamA: m.a, teamB: m.b, startTime: m.start, status: m.status ?? "upcoming", format: "bo3", bestOf: 3, round: m.round, matchOrder: i + 1, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner })),
});
const patch = (p: Record<string, Partial<M>>): M[] => BASE.map((m) => ({ ...m, ...(p[m.id] ?? {}) }));

const rows: { scenario: string; expected: string; measured: string; ok: boolean }[] = [];
const row = (scenario: string, expected: string, measured: string, ok: boolean) => rows.push({ scenario, expected, measured, ok });

function mk(enabled = true) {
  const db = new FakeDb();
  db.seed("events", [{ id: EVENT_ID, name: "QA SYNTHETIC Champions", status: "upcoming", source: "vlr", vlr_url: "https://www.vlr.gg/event/2766", start_date: "2027-01-10T00:00:00Z", end_date: "2027-01-11T23:59:59Z" }]);
  db.seed("profiles", [{ id: "u1", points: 0 }]);
  const sb = db.client();
  const cfg: EsportsAutoSyncConfig = { ...DEFAULT_AUTO_SYNC_CONFIG, enabled, jitterRatio: 0 };
  const logger = createMemoryLogger();
  const run = (source: RawSnapshot | Error, now: number, extra: Record<string, unknown> = {}): Promise<EsportsSyncRunResult> => {
    resetProgressionProbe(sb);
    return runEsportsSync(
      { sb, cfg, now: () => now, logger, fetchSnapshot: async () => { if (source instanceof Error) throw source; return { snapshot: source, warnings: [] }; } },
      { mode: "scheduled", force: true, ...extra },
    );
  };
  return { db, sb, cfg, run, logger };
}

async function main(): Promise<void> {
  const T0 = Date.parse("2026-12-01T12:00:00Z");
  let last: EsportsSyncRunResult | null = null;

  // ── UPCOMING ──
  {
    const { db, run, cfg } = mk();
    const r = await run(snap(BASE), T0);
    last = r;
    const cls = classifyEvent({ id: EVENT_ID, matches: db.rows("matches").map((m) => ({ status: String(m.status), startTime: m.start_time as string })) }, T0, cfg);
    row("UPCOMING · primer sync", "3 partidos, 7 preguntas, clase future/upcoming", `${db.rows("matches").length} partidos, ${db.rows("pickem_questions").length} preguntas, clase ${cls}`, db.rows("matches").length === 3 && db.rows("pickem_questions").length === 7);
  }
  // ── ACTIVE ──
  {
    const { db, run, cfg } = mk();
    await run(snap(BASE), T0);
    const t = Date.parse("2027-01-10T12:30:00Z");
    await run(snap(patch({ sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), t);
    const cls = classifyEvent({ id: EVENT_ID, matches: db.rows("matches").map((m) => ({ status: String(m.status), startTime: m.start_time as string })) }, t, cfg);
    row("ACTIVE · un partido terminado, otros por jugar", "clase active, intervalo 10 min", `clase ${cls}, intervalo ${cfg.intervals.active / 60000} min`, cls === "active");
  }
  // ── LIVE ──
  {
    const { db, run, cfg } = mk();
    await run(snap(BASE), T0);
    const t = Date.parse("2027-01-10T10:30:00Z");
    const r = await run(snap(patch({ sf1: { status: "live" } })), t);
    const cls = classifyEvent({ id: EVENT_ID, matches: db.rows("matches").map((m) => ({ status: String(m.status), startTime: m.start_time as string })) }, t, cfg);
    row("LIVE · partido en directo", "clase live, intervalo 2 min (no 20 s), sin scoring", `clase ${cls}, intervalo ${cfg.intervals.live / 1000} s, scoring=${r.pickemsScored}`, cls === "live" && cfg.intervals.live >= 60_000 && r.pickemsScored === 0);
  }
  // ── FINISHED (upcoming → finished directo + scoring + reward) ──
  {
    const { db, run } = mk();
    await run(snap(BASE), T0);
    const ev = db.rows("pickem_events")[0];
    db.seed("pickem_submissions", [{ id: "s1", pickem_event_id: ev.id, user_id: "u1" }]);
    for (const q of db.rows("pickem_questions").filter((q) => q.kind === "match_winner")) db.seed("pickem_answers", [{ id: `a-${q.id}`, submission_id: "s1", question_id: q.id, option_key: "a" }]);
    const r = await run(snap(patch({ sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), Date.parse("2027-01-10T12:30:00Z"));
    const pts = db.rows("profiles")[0].points;
    row("FINISHED · upcoming→finished directo", "1 terminado, scoring 1, 20 pts, 1 recompensa", `terminados ${r.matchesFinished}, scoring ${r.pickemsScored}, ${pts} pts, recompensa ${db.granted("u1", `pickem:${ev.id}:acertante`)}`, r.matchesFinished === 1 && r.pickemsScored === 1 && pts === 20);
    last = r;
  }
  // ── SOURCE FAILURE ──
  {
    const { db, run } = mk();
    await run(snap(BASE), T0);
    const before = JSON.stringify(db.tables.matches);
    const r = await run(new SourceError("transient", "timeout: 15000 ms"), T0 + 3_600_000);
    row("SOURCE FAILURE · timeout", "1 fallo, partidos intactos, fallos consecutivos 1", `fallos ${r.eventsFailed}, intactos=${JSON.stringify(db.tables.matches) === before}, consecutivos ${r.health?.events[EVENT_ID].consecutiveFailures}`, r.eventsFailed === 1 && JSON.stringify(db.tables.matches) === before);
    const r2 = await run(snap([]), T0 + 7_200_000);
    row("SOURCE FAILURE · lista vacía", "SOURCE_SUSPICIOUS, 3 partidos siguen", `${r2.events[0].notifications.map((n) => n.code).join(",")}, ${db.rows("matches").length} partidos`, db.rows("matches").length === 3);
  }
  // ── RETRY ──
  {
    let n = 0;
    const fetcher = createTimedFetcher({ timeoutMs: 1000, retry: { maxAttempts: 3, baseDelayMs: 1 }, sleep: async () => {}, fetchImpl: (async () => { n++; return ({ ok: n >= 3, status: n >= 3 ? 200 : 503, text: async () => "ok" }) as unknown as Response; }) as typeof fetch });
    const out = await fetcher("https://www.vlr.gg/event/2766").catch((e: Error) => e.message);
    row("RETRY · 503, 503, 200", "3 intentos y éxito", `${n} intentos, resultado ${out}`, n === 3 && out === "ok");
    let m = 0;
    const f404 = createTimedFetcher({ timeoutMs: 1000, retry: { maxAttempts: 3, baseDelayMs: 1 }, sleep: async () => {}, fetchImpl: (async () => { m++; return ({ ok: false, status: 404, text: async () => "" }) as unknown as Response; }) as typeof fetch });
    await f404("https://www.vlr.gg/event/2766").catch(() => {});
    row("RETRY · 404", "1 intento (no se reintenta)", `${m} intento(s)`, m === 1);
  }
  // ── DUPLICATE TRIGGER ──
  {
    const { db, run } = mk();
    const src = snap(patch({ sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } }));
    const [a, b] = await Promise.all([run(src, T0), run(src, T0)]);
    const locked = [a, b].filter((r) => r.skipped === "locked").length;
    row("DUPLICATE TRIGGER · dos a la vez", "1 efectiva + 1 locked, 1 Pick'em, 3 partidos", `locked ${locked}, pickems ${db.rows("pickem_events").length}, partidos ${db.rows("matches").length}`, locked === 1 && db.rows("pickem_events").length === 1);
  }
  // ── DRY RUN ──
  {
    const { db, run } = mk();
    await run(snap(BASE), T0);
    const w = db.writes.length; const c = db.rpcCalls.length;
    const r = await run(snap(patch({ sf1: { status: "finished", scoreA: 2, scoreB: 0, winner: "Alpha" } })), T0 + 60_000, { dryRun: true });
    row("DRY RUN · resultado nuevo", "0 escrituras, 0 RPC, informa 1 would-finish", `${db.writes.length - w} escrituras, ${db.rpcCalls.length - c} RPC, finish ${r.events[0].matches.finished}, needs-scoring ${r.events[0].pickems.needed}`, db.writes.length === w && db.rpcCalls.length === c && r.events[0].matches.finished === 1);
    console.log(formatRunReport(r));
  }
  // ── KILL SWITCH ──
  {
    const { db, run } = mk(false);
    const r = await run(snap(BASE), T0);
    row("KILL SWITCH · ESPORTS_AUTO_SYNC_ENABLED ausente", "skipped=disabled, 0 partidos, 0 escrituras", `skipped=${r.skipped}, ${db.rows("matches").length} partidos, ${db.writes.length} escrituras`, r.skipped === "disabled" && db.writes.length === 0);
  }

  console.log("\n# FASE 24.6 · QA AUTO-SYNC (QA SYNTHETIC · FakeDb)\n");
  console.log("| escenario | esperado | medido | |");
  console.log("|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.scenario} | ${r.expected} | ${r.measured} | ${r.ok ? "✅" : "❌"} |`);
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`\n${bad === 0 ? "✅" : "❌"} ${rows.length - bad}/${rows.length} escenarios`);
  if (last) console.log(`\núltimo run: ${last.runId} · ${last.durationMs} ms`);
  process.exitCode = bad === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
