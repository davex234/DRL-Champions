/**
 * FASE 24.5 · INSTRUMENTO DE QA DEL EVENTO VIVO (fuera de package.json y de CI).
 *
 *   E2E_BASE_URL=http://127.0.0.1:3005 npx tsx scripts/_fase24-5-qa.ts
 *
 *   A. APP REAL (`next start`, sin backend): rutas de Pick'ems y regresión a 1440 / 1024 / 390
 *      sin excepciones de la app ni desbordamiento.
 *   B. REAL FUTURE EVENT: Champions 2026 descargado con el importador real (sin BD) → héroe +
 *      resumen (siguiente partido real, progreso real, sin partido en directo porque no lo hay).
 *      No se llama «live real» a nada: hoy no hay partido en directo en la fuente.
 *   C. QA LIVE FIXTURE (sintético, etiquetado): próximo, activo con un directo, varios en
 *      directo, predicción recién resuelta, clasificado recién resuelto, liga, a 1440/1024/390.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { launch, sleep } from "./lib/cdp";
import { importVlrTournament } from "@/importer-vlr/engine";
import { snapshotToSource } from "@/lib/esports/sync/vlrSnapshotSource";
import { PickemHero } from "@/components/pickems/PickemHero";
import { LiveMatchCard } from "@/components/pickems/live/LiveMatchCard";
import { EventProgress, EventToday, RecentEventActivity, PendingPredictions, LiveUpdateNotice, LiveChangesBanner, EventNav } from "@/components/pickems/live/EventSummary";
import { BracketPickemView } from "@/components/pickems/bracket/BracketPickemView";
import { PickemBoard } from "@/components/pickems/PickemBoard";
import { buildBracketModel, isBracketFormat, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import { deriveLiveEventSnapshot, diffLiveSnapshots, changedIdsOf, type LiveChange } from "@/domain/pickems/live";
import type { PickemQuestion, TournamentRankingRow } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(ROOT, "docs", "product", "qa", "fase24-5");
mkdirSync(OUT, { recursive: true });
const results: { label: string; ok: boolean; detail?: string }[] = [];
const check = (label: string, ok: boolean, detail = "") => { results.push({ label, ok, detail }); console.log(`  ${ok ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`); };
const isNetwork = (e: string) => /Failed to fetch|fetch failed|ERR_CONNECTION|ECONNREFUSED|NetworkError|net::/i.test(e);
const isResource = (e: string) => /Failed to load resource/i.test(e);
const VIEWPORTS: [number, number][] = [[1440, 960], [1024, 820], [390, 844]];
const NOW = Date.now();
const at = (hh: number) => new Date(NOW + hh * 3600_000).toISOString();

/* ═══════════════════════════ A · APP REAL ═══════════════════════════ */

async function partA() {
  console.log("\n# A · App real (sin backend)\n");
  const browser = await launch({ width: 1440, height: 960 });
  try {
    for (const route of ["/pickems", "/pickems/historial", "/ranking", "/torneos", "/coleccion", "/inventario", "/packs", "/duelos", "/progresion", "/tienda", "/mercado"]) {
      for (const [w, hh] of VIEWPORTS) {
        await browser.tab.resize(w, hh);
        await browser.tab.goto(`${BASE}${route}`, 3500);
        const real = browser.tab.takeErrors().filter((e) => !isNetwork(e) && !isResource(e));
        const overflow = await browser.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
        check(`${route} @${w} sin excepciones ni desbordamiento`, real.length === 0 && Number(overflow) <= 0, real[0]?.slice(0, 80) ?? "");
      }
    }
  } finally { await browser.close(); }
}

/* ═══════════════════════════ RENDER ═══════════════════════════ */

function page(title: string, banner: string, body: string, css: string): string {
  return `<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><base href="${BASE}/"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${css}"></head>
<body class="bg-base-900 text-white antialiased" style="margin:0"><div style="position:fixed;top:0;left:0;right:0;z-index:99;background:#7a1b1b;color:#fff;font:600 11px/1.4 system-ui;padding:3px 10px;letter-spacing:.06em;text-transform:uppercase">${banner}</div>
<main class="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6">${body}</main></body></html>`;
}

interface Scenario {
  name: string; banner: string; eventName: string;
  stages: StageLike[]; matches: BracketMatchInput[]; questions: PickemQuestion[]; answers: AnswerMap;
  score: { points: number; correct: number; total: number } | null; ranking: TournamentRankingRow[]; userId: string;
  reward?: { id: string; reason: string; ref: string; delta: number; balance_after: number; created_at: string } | null;
  /** Estado previo (para simular el diff de un refresco): cambios a mostrar. */
  changes?: LiveChange[]; previousPosition?: number | null; pointsDelta?: number | null;
  offline?: boolean; refreshError?: string | null;
}

function renderScenario(sc: Scenario, mode: "desktop" | "mobile"): { body: string; live: number; next: boolean } {
  const model = buildBracketModel({ stages: sc.stages, matches: sc.matches, questions: sc.questions, answers: sc.answers, now: NOW });
  const snap = deriveLiveEventSnapshot({ model, stages: sc.stages, event: null, questions: sc.questions, answers: sc.answers, score: sc.score, ranking: sc.ranking, reward: sc.reward ?? null, userId: sc.userId, now: NOW });
  const useBracket = isBracketFormat(model.format) && model.reliable && model.rounds.length > 0;
  const changed = changedIdsOf(sc.changes ?? []);
  const pending = snap.pendingQuestions.length;
  const next = snap.nextMatches[0] ?? null;
  const body = renderToStaticMarkup(h("div", { className: "space-y-5" },
    h(PickemHero, { name: sc.eventName, phase: snap.status === "finished" ? "finalizado" : "activo", statusLabel: snap.statusLabel, stageLabel: snap.stageLabel, tournamentProgress: snap.progress, previousPosition: sc.previousPosition ?? null, pointsDelta: sc.pointsDelta ?? null, questions: sc.questions, answers: sc.answers, score: sc.score, ranking: sc.ranking, userId: sc.userId, now: NOW, onGoPending: pending > 0 ? () => undefined : undefined }),
    h(LiveUpdateNotice, { online: !sc.offline, refreshError: sc.refreshError ?? null, lastUpdatedAt: NOW - 3 * 60_000, now: NOW, onRetry: () => undefined }),
    h(LiveChangesBanner, { changes: sc.changes ?? [], onDismiss: () => undefined }),
    h(EventNav, { items: [{ id: "resumen", label: "Resumen" }, { id: "predicciones", label: "Predicciones" }, ...(useBracket ? [{ id: "cuadro", label: "Cuadro" }] : []), { id: "clasificacion", label: "Clasificación" }, { id: "recompensas", label: "Recompensas" }] }),
    h("section", { id: "resumen", className: "space-y-4" },
      h(PendingPredictions, { count: pending, onGo: () => undefined }),
      snap.liveMatches.length > 1 ? h("h2", { className: "nx-label" }, `En directo · ${snap.liveMatches.length} partidos`) : null,
      ...snap.liveMatches.map((lm) => h(LiveMatchCard, { key: lm.id, m: lm, mode: "live", now: NOW, canPick: false, highlight: changed.has(lm.id) })),
      next ? h(LiveMatchCard, { m: next, mode: "next", now: NOW, canPick: true, onPick: () => undefined, highlight: changed.has(next.id) }) : null,
      h(EventProgress, { progress: snap.progress }),
      h(EventToday, { matches: snap.todayMatches }),
      h(RecentEventActivity, { items: snap.activity }),
    ),
    h("section", { id: "predicciones" },
      useBracket
        ? h(BracketPickemView, { model, questions: sc.questions, answers: sc.answers, now: NOW, saving: null, feedback: null, canPick: true, onPick: () => undefined, bracketMode: mode, changedIds: changed })
        : h(PickemBoard, { questions: sc.questions, answers: sc.answers, now: NOW, saving: null, feedback: null, canPick: true, showResolved: false, onPick: () => undefined }),
    ),
  ));
  return { body, live: snap.liveMatches.length, next: !!next };
}

async function shoot(tab: Awaited<ReturnType<typeof launch>>["tab"], sc: Scenario, css: string, expectLive: number) {
  for (const [w, hh] of VIEWPORTS) {
    const mode = w < 768 ? "mobile" : "desktop";
    const { body, live } = renderScenario(sc, mode);
    const file = join(OUT, `_qa-${sc.name}-${mode}.html`);
    writeFileSync(file, page(`QA · ${sc.name}`, sc.banner, body, css));
    await tab.resize(w, hh);
    await tab.goto(`file:///${file.replace(/\\/g, "/")}`, 1200);
    await sleep(250);
    const overflow = await tab.js<number>("document.documentElement.scrollWidth - window.innerWidth");
    const small = await tab.js<number>(`[...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().height < 44 && b.getBoundingClientRect().height > 0).length`);
    const liveLabels = await tab.js<number>(`document.querySelectorAll('[data-live-mode="live"]').length`);
    check(`${sc.name} @${w}: sin desbordamiento, botones ≥ 44px, ${liveLabels} directo(s) pintados = ${expectLive} reales`, Number(overflow) <= 0 && Number(small) === 0 && Number(liveLabels) === expectLive && live === expectLive, `${overflow}px · ${small} pequeños`);
    const height = await tab.js<number>("document.documentElement.scrollHeight");
    await tab.resize(w, Math.min(Number(height) + 20, 7000));
    await sleep(200);
    await tab.shot(join(OUT, `${sc.name}-${w}.png`));
  }
}

/* ═══════════════════════════ B · REAL FUTURE EVENT ═══════════════════════════ */

async function realFuture(tab: Awaited<ReturnType<typeof launch>>["tab"], css: string) {
  console.log("\n# B · REAL FUTURE EVENT · Champions 2026 (importador real, sin BD, sin partido en directo)\n");
  let out;
  try { out = await importVlrTournament("https://www.vlr.gg/event/2766/valorant-champions-2026", { includeMatchDetails: false }); }
  catch (e) { check("descarga de la fuente real", false, e instanceof Error ? e.message : String(e)); return; }
  const { source } = snapshotToSource(out.snapshot, { eventId: `vlr-${out.ref.eventId}`, agents: new Map(), maps: new Map() });
  const [raw, teams, stages] = await Promise.all([source.getMatches(`vlr-${out.ref.eventId}`), source.getTeams(`vlr-${out.ref.eventId}`), source.getStages(`vlr-${out.ref.eventId}`)]);
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const stagesLike: StageLike[] = stages.map((s, i) => ({ id: `st-${s.slug}`, name: s.name, kind: s.kind ?? null, order_idx: s.orderIdx ?? i }));
  const matches: BracketMatchInput[] = raw.map((m) => ({
    id: m.id, stage_id: m.stageSlug ? `st-${m.stageSlug}` : null, team_a: nameOf.get(m.teamAId) ?? null, team_b: nameOf.get(m.teamBId) ?? null,
    team_a_id: m.teamAId, team_b_id: m.teamBId, start_time: m.startTime ?? null, status: m.status ?? "upcoming",
    score_a: m.scoreA ?? null, score_b: m.scoreB ?? null, winner_team_id: m.winnerTeamId ?? null, winner_team: m.winnerTeamId ? nameOf.get(m.winnerTeamId) ?? null : null,
    round: m.round ?? null, match_order: m.matchOrder ?? null,
    winner_to_match_id: m.progression?.winnerTo?.matchId ?? null, winner_to_slot: m.progression?.winnerTo?.slot ?? null,
    winner_qualifies: m.progression?.winnerQualifies?.key ?? null, winner_qualifies_label: m.progression?.winnerQualifies?.label ?? null,
    progression_evidence: m.progression?.evidence ?? null, progression_confidence: m.progression?.confidence ?? null,
  }));
  for (const m of matches) { if (/^tbd$/i.test(m.team_a ?? "")) m.team_a = null; if (/^tbd$/i.test(m.team_b ?? "")) m.team_b = null; }
  const model = buildBracketModel({ stages: stagesLike, matches, questions: [], answers: {}, now: NOW });
  const snap = deriveLiveEventSnapshot({ model, stages: stagesLike, event: { status: out.snapshot.tournament.status }, questions: [], answers: {}, score: null, ranking: [], reward: null, userId: null, now: NOW });
  check(`estado real: ${snap.statusLabel} · fase ${snap.stageLabel} · ${snap.liveMatches.length} en directo · siguiente ${snap.nextMatches[0]?.teamA?.name ?? "?"} vs ${snap.nextMatches[0]?.teamB?.name ?? "?"} · ${snap.progress.finished}/${snap.progress.total} partidos`, snap.liveMatches.length === 0 && snap.nextMatches.length > 0);
  writeFileSync(join(OUT, "_real-champions-2026.json"), JSON.stringify({ status: snap.status, stageLabel: snap.stageLabel, live: snap.liveMatches.length, next: snap.nextMatches.slice(0, 3).map((m) => [m.teamA?.name, m.teamB?.name, m.startsAt]), progress: snap.progress, today: snap.todayMatches.length }, null, 2));
  const sc: Scenario = { name: "real-future-champions-2026", banner: "REAL FUTURE EVENT · vlr.gg/event/2766 · IMPORTADOR REAL SIN BD · SIN PARTIDO EN DIRECTO HOY (NO ES LIVE REAL)", eventName: out.snapshot.tournament.name, stages: stagesLike, matches, questions: [], answers: {}, score: null, ranking: [], userId: "me" };
  await shoot(tab, sc, css, 0);
}

/* ═══════════════════════════ C · QA LIVE FIXTURES ═══════════════════════════ */

const C = { progression_evidence: "SOURCE_STRUCTURED_HTML", progression_confidence: "CONFIRMED" } as const;
const STAGES: StageLike[] = [{ id: "st-g", name: "Group Stage", kind: "group", order_idx: 0 }];
const mm = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({ id, stage_id: "st-g", team_a: null, team_b: null, start_time: at(24), status: "upcoming", score_a: null, score_b: null, round: null, match_order: null, ...over });
const pq = (id: string, matchId: string, over: Partial<PickemQuestion> = {}): PickemQuestion => ({ id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15, locks_at: at(1), order_idx: 0, locked: false, correct_option: null, options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over });
const ranking = (me: number): TournamentRankingRow[] => Array.from({ length: 12 }, (_, i) => ({ user_id: i === me - 1 ? "me" : `u${i}`, username: i === me - 1 ? "davex" : ["nyx", "kairo", "vega", "sable", "orion", "mika", "rune", "zed", "lyra", "atlas", "juno", "pax"][i], avatar: "🦊", points: 120 - i * 7, correct: 9, total: 12 }));
const BANNER = "QA LIVE FIXTURE · ESCENARIO SINTÉTICO ETIQUETADO · NO ES UN DIRECTO REAL";

const gsl = (): BracketMatchInput[] => [
  mm("o1", { team_a: "100 Thieves", team_b: "T1", round: "Opening (A)", match_order: 1, start_time: at(-3), status: "finished", score_a: 2, score_b: 0, winner_team: "100 Thieves", ...C, winner_to_match_id: "w", winner_to_slot: 1 }),
  mm("o2", { team_a: "JD Gaming", team_b: "FUT Esports", round: "Opening (A)", match_order: 2, start_time: at(-1), status: "live", score_a: 1, score_b: 1, ...C, winner_to_match_id: "w", winner_to_slot: 2 }),
  mm("ob1", { team_a: "Global Esports", team_b: "Team Vitality", round: "Opening (B)", match_order: 3, start_time: at(0.3), ...C, winner_to_match_id: "wb", winner_to_slot: 1 }),
  mm("ob2", { team_a: "Paper Rex", team_b: "Fnatic", round: "Opening (B)", match_order: 4, start_time: at(3), ...C, winner_to_match_id: "wb", winner_to_slot: 2 }),
  mm("w", { team_a: "100 Thieves", round: "Winner's (A)", start_time: at(26), ...C, winner_qualifies: "qualified:groupa:winners", winner_qualifies_label: "Qualified" }),
  mm("wb", { round: "Winner's (B)", start_time: at(28), ...C, winner_qualifies: "qualified:groupb:winners", winner_qualifies_label: "Qualified" }),
];
const gslQ = (): PickemQuestion[] => [pq("q1", "o1", { locked: true, locks_at: at(-3), correct_option: "a" }), pq("q2", "o2", { locked: true, locks_at: at(-1) }), pq("q3", "ob1", { locks_at: at(0.3) }), pq("q4", "ob2", { locks_at: at(3) })];
const gslA: AnswerMap = { q1: { option: "a", isCorrect: true, pointsAward: 15 }, q2: { option: "b", isCorrect: null, pointsAward: null } };

const scenarios: (Scenario & { expectLive: number })[] = [
  { name: "upcoming", banner: BANNER, eventName: "Valorant Champions 2026", stages: STAGES, matches: gsl().map((x) => ({ ...x, status: "upcoming", score_a: null, score_b: null, winner_team: null, start_time: at(30 + Number(x.match_order ?? 0)) })), questions: gslQ().map((x) => ({ ...x, locked: false, correct_option: null, locks_at: at(30) })), answers: {}, score: null, ranking: [], userId: "me", expectLive: 0 },
  { name: "active-one-live", banner: BANNER, eventName: "Valorant Champions 2026", stages: STAGES, matches: gsl(), questions: gslQ(), answers: gslA, score: { points: 15, correct: 1, total: 1 }, ranking: ranking(8), userId: "me", expectLive: 1 },
  { name: "active-multi-live", banner: BANNER, eventName: "Valorant Champions 2026", stages: STAGES, matches: gsl().map((x) => x.id === "ob1" ? { ...x, status: "live", score_a: 0, score_b: 1, start_time: at(-0.5) } : x), questions: gslQ(), answers: gslA, score: { points: 15, correct: 1, total: 1 }, ranking: ranking(8), userId: "me", expectLive: 2 },
  { name: "just-resolved", banner: BANNER + " · PREDICCIÓN RECIÉN RESUELTA + CLASIFICADO + RANKING", eventName: "Valorant Champions 2026", stages: STAGES,
    matches: gsl().map((x) => x.id === "o2" ? { ...x, status: "finished", score_a: 1, score_b: 2, winner_team: "FUT Esports" } : x.id === "w" ? { ...x, team_b: "FUT Esports", status: "finished", score_a: 2, score_b: 1, winner_team: "100 Thieves", start_time: at(-0.2) } : x),
    questions: gslQ().map((x) => x.id === "q2" ? { ...x, correct_option: "b" } : x), answers: { ...gslA, q2: { option: "b", isCorrect: true, pointsAward: 15 } },
    score: { points: 30, correct: 2, total: 2 }, ranking: ranking(3), userId: "me", previousPosition: 8, pointsDelta: 15,
    reward: { id: "t1", reason: "pickem_reward:acertante", ref: "pickem:e1:acertante", delta: 1500, balance_after: 9000, created_at: at(-0.1) },
    changes: [{ id: "pick:q2", kind: "PREDICTION_RESOLVED", questionId: "q2", outcome: "acertada", points: 15 }, { id: "qual:qualified:groupa:winners", kind: "QUALIFIED", key: "qualified:groupa:winners", team: "100 Thieves" }, { id: "team:w:b", kind: "PARTICIPANT_SET", matchId: "w", slot: "b", team: "FUT Esports" }, { id: "rank:8>3", kind: "RANK_CHANGED", from: 8, to: 3 }, { id: "points:15>30", kind: "POINTS_CHANGED", from: 15, to: 30 }, { id: "reward:acertante", kind: "REWARD_EARNED", tier: "acertante" }], expectLive: 0 },
  { name: "refresh-error", banner: BANNER + " · FALLO DE ACTUALIZACIÓN (SNAPSHOT CONSERVADO)", eventName: "Valorant Champions 2026", stages: STAGES, matches: gsl(), questions: gslQ(), answers: gslA, score: { points: 15, correct: 1, total: 1 }, ranking: ranking(8), userId: "me", refreshError: "TypeError: Failed to fetch", expectLive: 1 },
  { name: "league", banner: BANNER + " · LIGA (SIN CUADRO)", eventName: "VCT EMEA Stage 2", stages: [{ id: "st-l", name: "Regular Season", kind: "group", order_idx: 0 }],
    matches: [
      mm("w1", { stage_id: "st-l", team_a: "Fnatic", team_b: "KOI", round: "Week 1", status: "finished", score_a: 2, score_b: 0, winner_team: "Fnatic", start_time: at(-30) }),
      mm("w2", { stage_id: "st-l", team_a: "Team Heretics", team_b: "Team Liquid", round: "Week 2", status: "live", score_a: 1, score_b: 0, start_time: at(-1) }),
      mm("w3", { stage_id: "st-l", team_a: "Karmine Corp", team_b: "Natus Vincere", round: "Week 2", start_time: at(2) }),
      mm("w4", { stage_id: "st-l", team_a: "Gen.G", team_b: "Paper Rex", round: "Week 3", start_time: at(50) }),
    ],
    questions: [pq("l1", "w1", { locked: true, locks_at: at(-30), correct_option: "a" }), pq("l2", "w2", { locked: true, locks_at: at(-1) }), pq("l3", "w3", { locks_at: at(2) }), pq("l4", "w4", { locks_at: at(50) })],
    answers: { l1: { option: "b", isCorrect: false, pointsAward: 0 }, l2: { option: "a", isCorrect: null, pointsAward: null } }, score: { points: 0, correct: 0, total: 1 }, ranking: ranking(11), userId: "me", expectLive: 1 },
];

async function main() {
  await partA();
  const cssFile = readdirSync(join(ROOT, ".next", "static", "chunks")).find((f) => f.endsWith(".css"));
  if (!cssFile) throw new Error("No hay CSS compilado: ejecuta `npm run build` antes.");
  const css = `/_next/static/chunks/${cssFile}`;
  const browser = await launch({ width: 1440, height: 960 });
  try {
    await realFuture(browser.tab, css);
    console.log("\n# C · QA LIVE FIXTURES (sintéticos, etiquetados)\n");
    for (const sc of scenarios) {
      // Diff real entre «antes» y «después» del escenario recién resuelto: lo que la sesión anunciaría.
      if (sc.name === "just-resolved") {
        const before = deriveLiveEventSnapshot({ model: buildBracketModel({ stages: STAGES, matches: gsl(), questions: gslQ(), answers: gslA, now: NOW }), stages: STAGES, event: null, questions: gslQ(), answers: gslA, score: { points: 15, correct: 1, total: 1 }, ranking: ranking(8), reward: null, userId: "me", now: NOW });
        const after = deriveLiveEventSnapshot({ model: buildBracketModel({ stages: STAGES, matches: sc.matches, questions: sc.questions, answers: sc.answers, now: NOW }), stages: STAGES, event: null, questions: sc.questions, answers: sc.answers, score: sc.score, ranking: sc.ranking, reward: sc.reward ?? null, userId: "me", now: NOW });
        const d = diffLiveSnapshots(before, after);
        check(`diff real del escenario: ${d.map((c) => c.kind).join(", ")}`, ["PREDICTION_RESOLVED", "QUALIFIED", "PARTICIPANT_SET", "RANK_CHANGED", "POINTS_CHANGED", "REWARD_EARNED", "MATCH_FINISHED"].every((k) => d.some((c) => c.kind === k)));
      }
      await shoot(browser.tab, sc, css, sc.expectLive);
    }
  } finally { await browser.close(); }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n━━━ Resultado: ${results.length - bad.length} ✓ / ${bad.length} ✗ ━━━`);
  writeFileSync(join(OUT, "_resultados.json"), JSON.stringify(results, null, 2));
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error("💥", e instanceof Error ? e.stack : e); process.exit(1); });
