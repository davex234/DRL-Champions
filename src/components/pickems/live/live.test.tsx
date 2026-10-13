/**
 * PICK'EMS · EVENTO VIVO (Fase 24.5) — presentación, refresco y contratos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveMatchCard } from "./LiveMatchCard";
import { EventProgress, EventToday, RecentEventActivity, PendingPredictions, LiveUpdateNotice, LiveChangesBanner, EventNav, describeChange } from "./EventSummary";
import { PickemHero } from "../PickemHero";
import { buildBracketModel, type BracketMatchInput, type StageLike } from "@/domain/pickems/bracket";
import { deriveLiveEventSnapshot } from "@/domain/pickems/live";
import type { PickemQuestion } from "@/lib/game/client";
import type { AnswerMap } from "@/domain/pickems/progress";

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const NOW = Date.parse("2026-09-27T14:00:00Z");
const at = (h: number) => new Date(NOW + h * 3600_000).toISOString();
const STAGES: StageLike[] = [{ id: "st-g", name: "Group Stage", kind: "group", order_idx: 0 }];
const m = (id: string, over: Partial<BracketMatchInput> = {}): BracketMatchInput => ({
  id, stage_id: "st-g", team_a: null, team_b: null, start_time: at(24), status: "upcoming", score_a: null, score_b: null, round: null, match_order: null, ...over,
});
const q = (id: string, matchId: string, over: Partial<PickemQuestion> = {}): PickemQuestion => ({
  id, pickem_event_id: "e1", kind: "match_winner", match_id: matchId, prompt: "¿Quién gana?", points: 15, locks_at: at(1), locked: false, correct_option: null, order_idx: 0,
  options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], ...over,
});
const matches = (): BracketMatchInput[] => [
  m("o1", { team_a: "100 Thieves", team_b: "T1", round: "Opening (A)", match_order: 1, start_time: at(-3), status: "finished", score_a: 2, score_b: 0, winner_team: "100 Thieves" }),
  m("o2", { team_a: "JD Gaming", team_b: "FUT Esports", round: "Opening (A)", match_order: 2, start_time: at(-1), status: "live", score_a: 1, score_b: 1 }),
  m("ob1", { team_a: "Global Esports", team_b: "Team Vitality", round: "Opening (B)", match_order: 3, start_time: at(0.2) }),
];
const questions = (): PickemQuestion[] => [q("q1", "o1", { locked: true, locks_at: at(-3), correct_option: "a" }), q("q2", "o2", { locked: true, locks_at: at(-1) }), q("q3", "ob1", { locks_at: at(0.2) })];
const answers: AnswerMap = { q1: { option: "a", isCorrect: true, pointsAward: 15 }, q2: { option: "b", isCorrect: null, pointsAward: null } };
const snapshot = () => {
  const model = buildBracketModel({ stages: STAGES, matches: matches(), questions: questions(), answers, now: NOW });
  return deriveLiveEventSnapshot({ model, stages: STAGES, event: { status: "live" }, questions: questions(), answers, score: { points: 15, correct: 1, total: 1 }, ranking: [{ user_id: "u1" }, { user_id: "me" }], reward: null, userId: "me", now: NOW });
};
const noop = () => undefined;

/* ─────────────── 45-47 · HÉROE ─────────────── */

test("45 · el héroe muestra estado real, fase, posición, puntos, aciertos, predicciones y progreso del torneo", () => {
  const s = snapshot();
  const out = html(<PickemHero name="Valorant Champions 2026" phase="activo" statusLabel={s.statusLabel} stageLabel={s.stageLabel} tournamentProgress={s.progress}
    questions={questions()} answers={answers} score={{ points: 1240, correct: 12, total: 15 }} ranking={[{ user_id: "u1", username: "a", avatar: "", points: 1, correct: 0, total: 0 }, { user_id: "me", username: "b", avatar: "", points: 0, correct: 0, total: 0 }]} userId="me" now={NOW} />);
  assert.match(out, /En curso/); assert.match(out, /Group Stage/);
  assert.match(out, /#2/); assert.match(out, /1\.240/); assert.match(out, />12</);
  assert.match(out, /2 \/ 3/, "predicciones respondidas / total");
  assert.match(out, /1 \/ 3/); assert.match(out, /partidos completados · 33%/);
});

test("11-14 · posición anterior → actual y +pts solo cuando la sesión los tiene", () => {
  const base = { name: "X", phase: "activo" as const, questions: questions(), answers, score: { points: 1340, correct: 12, total: 15 }, ranking: [{ user_id: "me", username: "b", avatar: "", points: 0, correct: 0, total: 0 }], userId: "me", now: NOW };
  const withDelta = html(<PickemHero {...base} previousPosition={24} pointsDelta={100} />);
  assert.match(withDelta, /data-rank-delta="-23"/); assert.match(withDelta, /#24 →/); assert.match(withDelta, /data-points-delta="100"/); assert.match(withDelta, /\+100/);
  const without = html(<PickemHero {...base} />);
  assert.ok(!/data-rank-delta|data-points-delta/.test(without), "sin dato de sesión, solo la posición actual");
});

/* ─────────────── 46 · EN DIRECTO Y SIGUIENTE ─────────────── */

test("46 · «En directo» solo con partido live; el siguiente lleva cuenta atrás local y urgencia del dominio", () => {
  const s = snapshot();
  const live = html(<LiveMatchCard m={s.liveMatches[0]} mode="live" now={NOW} canPick={false} />);
  assert.match(live, /En directo/); assert.match(live, /data-live-mode="live"/); assert.match(live, /JD Gaming/); assert.match(live, /aria-label="1"/);
  assert.ok(!/<button/.test(live), "un partido en directo ya no se predice");
  const next = html(<LiveMatchCard m={s.nextMatches[0]} mode="next" now={NOW} canPick onPick={noop} />);
  assert.match(next, /Siguiente partido/); assert.match(next, /data-urgent="true"/, "cierra en 12 min: urgente");
  assert.equal((next.match(/<button/g) ?? []).length, 2, "se puede elegir desde aquí con la misma caja");
  assert.match(next, /aria-label="Seleccionar Global Esports como ganador frente a Team Vitality"/);
  assert.ok(!/setInterval|fetch\(/.test(src("./LiveMatchCard.tsx")), "sin peticiones ni temporizadores propios");
});

test("22 · varios en directo: el resumen los lista todos (contrato de la página)", () => {
  const page = readFileSync(new URL("../../../app/pickems/page.tsx", import.meta.url), "utf8");
  assert.match(page, /snapshot\.liveMatches\.length > 1 && \(/);
  assert.match(page, /En directo <span[^>]*>· \{snapshot\.liveMatches\.length\} partidos/);
  assert.match(page, /snapshot\.liveMatches\.map\(\(m\) => \(/);
});

/* ─────────────── 47 · PENDIENTES, HOY, ACTIVIDAD, PROGRESO ─────────────── */

test("47 · pendientes con CTA; hoy con hora local, estado y pick; actividad con acierto y puntos", () => {
  const s = snapshot();
  const pend = html(<PendingPredictions count={3} onGo={noop} />);
  assert.match(pend, /3 predicciones pendientes/); assert.match(pend, /Completar ahora/); assert.match(pend, /<button/);
  assert.equal(html(<PendingPredictions count={0} onGo={noop} />), "");
  const today = html(<EventToday matches={s.todayMatches} />);
  assert.match(today, /Hoy/); assert.match(today, /En directo/); assert.match(today, /Finalizado/); assert.match(today, /Próximo/);
  assert.match(today, /\d{2}:\d{2}/);
  const act = html(<RecentEventActivity items={s.activity} />);
  assert.match(act, /Acertaste/); assert.match(act, /\+15/); assert.match(act, /100 Thieves vence 2–0 a T1/);
  const prog = html(<EventProgress progress={s.progress} />);
  assert.match(prog, /1 \/ 3/); assert.match(prog, /aria-valuenow="33"/);
});

/* ─────────────── 31-33 · AVISOS ─────────────── */

test("31-33 · sin red, error con reintento y «última actualización hace N min»; aria-live solo cuando hay algo que decir", () => {
  const off = html(<LiveUpdateNotice online={false} refreshError={null} lastUpdatedAt={NOW - 60_000} now={NOW} onRetry={noop} />);
  assert.match(off, /Sin conexión/); assert.match(off, /aria-live="polite"/); assert.match(off, /hace 1 min/);
  const err = html(<LiveUpdateNotice online refreshError="boom" lastUpdatedAt={NOW - 5 * 60_000} now={NOW} onRetry={noop} />);
  assert.match(err, /No se ha podido actualizar/); assert.match(err, /Reintentar/); assert.match(err, /hace 5 min/);
  const stale = html(<LiveUpdateNotice online refreshError={null} lastUpdatedAt={NOW - 3 * 60_000} now={NOW} />);
  assert.match(stale, /data-live-notice="stale"/); assert.match(stale, /aria-live="off"/);
  assert.equal(html(<LiveUpdateNotice online refreshError={null} lastUpdatedAt={NOW - 30_000} now={NOW} />), "", "reciente y sano: nada");
});

test("49 · el banner de cambios es aria-live polite y describe resultado, recompensa y posición", () => {
  const out = html(<LiveChangesBanner changes={[
    { id: "pick:q2", kind: "PREDICTION_RESOLVED", questionId: "q2", outcome: "acertada", points: 15 },
    { id: "reward:acertante", kind: "REWARD_EARNED", tier: "acertante" },
    { id: "rank:24>18", kind: "RANK_CHANGED", from: 24, to: 18 },
  ]} onDismiss={noop} />);
  assert.match(out, /aria-live="polite"/); assert.match(out, /acertada · \+15 pts/); assert.match(out, /Recompensa conseguida · Acertante/); assert.match(out, /#24 → #18 \(\+6\)/);
  assert.equal(describeChange({ id: "x", kind: "PREDICTION_RESOLVED", questionId: "q", outcome: "fallada", points: 0 }), "Tu predicción se ha resuelto: fallada · +0 pts");
  assert.match(html(<LiveChangesBanner changes={[]} />), /data-live-changes="0"/);
});

/* ─────────────── 20 · NAVEGACIÓN ─────────────── */

test("20 · navegación del evento: anclas; «Cuadro» solo con bracket (contrato de la página)", () => {
  const out = html(<EventNav items={[{ id: "resumen", label: "Resumen" }, { id: "cuadro", label: "Cuadro" }]} />);
  assert.match(out, /href="#resumen"/); assert.match(out, /href="#cuadro"/);
  const page = readFileSync(new URL("../../../app/pickems/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\.\.\.\(useBracket \? \[\{ id: "cuadro", label: "Cuadro" \}\] : \[\]\)/);
  assert.match(page, /id="resumen"/); assert.match(page, /id="predicciones"/); assert.match(page, /id="clasificacion"/); assert.match(page, /id="recompensas"/);
});

/* ─────────────── 21-34 · REFRESCO (contratos del hook) ─────────────── */

test("21-23 · un fallo de refresco conserva el lote y anota el error; reintento con retroceso", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(bundleRef\.current\) \{\s*\/\/ Hay un lote válido: se conserva/);
  assert.match(hook, /setRefreshError\(msg\);\s*failuresRef\.current \+= 1;/);
  assert.match(hook, /refreshIntervalFor\(\{ status, hasLive, visibility, online, failures \}\)/);
  assert.ok(!/setBundle\(null\)[^;]*catch/.test(hook), "nunca se vacía el lote por un error temporal");
});

test("24-26 · pestaña oculta pausa; al volver refresca; sin `setInterval` ni sondeo por segundo", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(hook, /if \(v === "visible"\) void load\(true\);/);
  assert.ok(!/setInterval/.test(hook), "el ritmo va por setTimeout con el intervalo del dominio");
  assert.match(hook, /const t = setTimeout\(\(\) => void load\(true\), ms\);/);
});

test("27 · las cuentas atrás siguen locales (useNow), sin request", () => {
  const cd = readFileSync(new URL("../Countdown.tsx", import.meta.url), "utf8");
  assert.match(cd, /useNow\(1000\)/); assert.ok(!/fetch\(/.test(cd));
});

test("30 · carrera envío/refresco: el lote no pisa la respuesta que se está guardando", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /const inFlight = savingRef\.current;\s*if \(inFlight && bundleRef\.current\?\.answers\[inFlight\]\) merged\[inFlight\] = bundleRef\.current\.answers\[inFlight\];/);
});

test("31-32 · sin red no se afirma un guardado ni se sondea; al volver, refresco inmediato", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /!navigator\.onLine\) \{\s*\/\/ sin red no se afirma nada/);
  assert.match(hook, /const onOnline = \(\) => \{ setOnline\(true\); void load\(true\); \};/);
  assert.match(hook, /window\.addEventListener\("offline", onOffline\)/);
});

test("34 · el refresco es silencioso: no vuelve a «Cargando» (loading solo en la carga inicial)", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /if \(!silent\) setLoading\(true\);/);
  assert.match(hook, /const reload = useCallback\(\(\) => load\(true\), \[load\]\);/);
});

test("28-29 · deduplicación por sesión en memoria (nunca localStorage) y toast una sola vez por cambio", () => {
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.match(hook, /const seenChanges = new Map<string, Set<string>>\(\);/);
  assert.match(hook, /dedupeChanges\(diffLiveSnapshots\(prev, snap\), seen\)/);
  assert.ok(!/localStorage/.test(hook.replace(/\/\*[\s\S]*?\*\//g, "")));
  const page = readFileSync(new URL("../../../app/pickems/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const fresh = live\.changes\.slice\(announced\.current\);/);
});

/* ─────────────── 41-42 · CUADRO EN VIVO (UI) ─────────────── */

test("41-42 · el cuadro no se remonta al refrescar: claves estables, brillo por id y ronda elegida derivada", () => {
  const tb = readFileSync(new URL("../bracket/TournamentBracket.tsx", import.meta.url), "utf8");
  assert.match(tb, /key=\{c\.round\.id\}/); assert.match(tb, /changedIds\?\.has\(n\.id\)/);
  assert.ok(!/scrollTo\(\{ left: 0/.test(tb), "no se devuelve el cuadro al inicio");
  const card = readFileSync(new URL("../bracket/BracketMatch.tsx", import.meta.url), "utf8");
  assert.match(card, /highlight && "nx-live-glow"/);
  const s = snapshot();
  const glow = html(<LiveMatchCard m={s.liveMatches[0]} mode="live" now={NOW} canPick={false} highlight />);
  assert.match(glow, /nx-live-glow/); assert.match(glow, /data-highlight="true"/);
});

/* ─────────────── 48-51 · ACCESIBILIDAD Y MOVIMIENTO ─────────────── */

test("48-51 · botones reales, sin aria-live en la cuenta atrás, brillo bajo la regla global de reduced motion", () => {
  const s = snapshot();
  const next = html(<LiveMatchCard m={s.nextMatches[0]} mode="next" now={NOW} canPick onPick={noop} />);
  assert.match(next, /<button type="button"/); assert.match(next, /nx-focus/);
  const cd = readFileSync(new URL("../Countdown.tsx", import.meta.url), "utf8");
  assert.ok(!/aria-live/.test(cd), "la cuenta atrás no se anuncia cada segundo");
  const css = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /nx-live-glow/); assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: nx-live-glow 1\.8s ease-out 1;/, "una vez, no permanente");
});

test("56 · sin N+1: el refresco es el mismo lote de usePickem; ningún componente vivo lee por su cuenta", () => {
  for (const f of ["./LiveMatchCard.tsx", "./EventSummary.tsx"]) {
    assert.ok(!/fetch|from\("|supabase/.test(src(f)), `${f} no lee nada`);
  }
  const hook = readFileSync(new URL("../../../lib/usePickem.ts", import.meta.url), "utf8");
  assert.equal((hook.match(/await Promise\.all\(\[/g) ?? []).length, 1, "un solo lote por refresco");
});
