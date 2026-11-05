/**
 * FASE 42 · FUZZ DEL LIVE SERVICE (núcleo puro, lo usan los tests y `scripts/live-service-fuzz.ts`).
 *
 *   · PRIORIDAD: combinaciones aleatorias de hechos (PvP/privada/campaña/PvE/Draft en combate, run de Draft, retos,
 *     recompensas diarias/semanales/logros/pase, Pick'em con cierre real, evento en directo, temporada acabando,
 *     sobres, equipo incompleto, primera sesión, subsistemas caídos) → `buildDailyLoop` → invariantes.
 *   · RETORNO: un jugador con una tanda materializada en su última visita vuelve tras 0 h … 30 d con actividad real
 *     entre medias → `resolvePassWindows` + `buildDailyLoop` → invariantes (sin vestíbulo muerto, sin diarias acumuladas,
 *     continuidad semanal, ≤ 3 hechos verdaderos, sin recompensa ni racha por volver).
 */
import type { Rng } from "@/sim/rng";
import { freshPassState } from "@/battlepass/season";
import type { MetricSnapshot, PassState } from "@/battlepass/types";
import { CURRENT_SEASON } from "@/data/season";
import type { MetaObjective } from "@/domain/progression/meta";
import { liveObjective, todayRank } from "@/domain/progression/meta";
import { periodWindow } from "@/domain/progression/periods";
import { resolvePassWindows, countKey, missionViewsOf, WINDOW_METRICS } from "@/domain/progression/rotation";
import { buildDailyLoop, type ActiveMatchFact, type DailyLoopFacts, type DailyLoopSnapshot, type LiveEventFact } from "@/domain/dailyLoop";
import { DAY, HOUR, RETURNING_MAX_FACTS } from "./index";

export interface Violation { invariant: string; detail: string }

const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.next() * xs.length)];
const chance = (rng: Rng, p: number) => rng.next() < p;
const int = (rng: Rng, a: number, b: number) => a + Math.floor(rng.next() * (b - a + 1));

/** Una tanda viva con estados aleatorios (reclamable, cobrada, en progreso) de las definiciones reales del pool. */
function randomObjectives(rng: Rng, now: number): MetaObjective[] {
  const out: MetaObjective[] = [];
  for (const kind of ["daily", "weekly"] as const) {
    const w = periodWindow(kind, now)!;
    const defs = CURRENT_SEASON.missionPool.filter((m) => m.kind === kind);
    const n = chance(rng, 0.1) ? 0 : kind === "daily" ? 3 : 2;
    for (const def of [...defs].sort(() => 0).slice(0, n)) {
      const r = rng.next();
      const claimed = r < 0.25; const complete = claimed || r < 0.5;
      const current = complete ? def.goal : int(rng, 0, Math.max(0, def.goal - 1));
      // A veces una tanda de una ventana ANTERIOR (caducada) sigue en los hechos: nunca puede recomendarse.
      const stale = chance(rng, 0.08);
      const assignedAt = stale ? w.startsAt - (kind === "daily" ? DAY : 7 * DAY) : w.startsAt;
      out.push({ id: def.id, label: def.label, kind, current, goal: def.goal, complete, claimed, rewardCredits: def.reward.credits ?? 0, xp: def.xp ?? 0, metric: def.metric, packId: def.reward.packId ?? null, packCount: def.reward.packId ? def.reward.packCount ?? 1 : 0, assignedAt, expiresAt: (stale ? w.startsAt : w.endsAt) });
    }
  }
  return out;
}

export function randomFacts(rng: Rng, baseNow = Date.UTC(2026, 9, 1, 12)): DailyLoopFacts {
  const now = baseNow + int(rng, 0, 50) * DAY + int(rng, 0, 23) * HOUR + int(rng, 0, 59) * 60_000;
  const down = (p = 0.07) => chance(rng, p);
  const matches: ActiveMatchFact[] = [];
  if (chance(rng, 0.12)) matches.push({ id: "m-pvp", mode: "RANKED", difficulty: null, opponent: chance(rng, 0.8) ? "QA_Rival" : null, node: null });
  if (chance(rng, 0.08)) matches.push({ id: "m-priv", mode: "PRIVATE", difficulty: null, opponent: "QA_Friend", node: null });
  if (chance(rng, 0.1)) matches.push({ id: "m-pve", mode: pick(rng, ["PVE", "CAMPAIGN"] as const), difficulty: "EASY", opponent: null, node: chance(rng, 0.5) ? { id: "c1-n2", name: "Nodo" } : null });
  const draftCombat = chance(rng, 0.07);
  if (draftCombat) matches.push({ id: "m-draft", mode: "DRAFT", difficulty: null, opponent: null, node: null });
  const pending = chance(rng, 0.3) ? int(rng, 1, 6) : 0;
  const lockIn = pick(rng, [5 * 60_000, 90 * 60_000, 5 * HOUR, 30 * HOUR, -HOUR]);
  const seasonEndsIn = pick(rng, [60 * DAY, 20 * DAY, 6 * DAY, 20 * HOUR, -DAY]);
  const live: LiveEventFact[] = chance(rng, 0.4) ? [{
    id: "ev1", name: "VCT QA", lifecycle: pick(rng, ["UPCOMING", "ACTIVE", "COMPLETED"] as const), isDemo: chance(rng, 0.2), startDate: null, endDate: null,
    liveCount: chance(rng, 0.5) ? int(rng, 1, 2) : 0, liveMatch: null, nextMatch: null, pickem: { open: pending, pending },
  }] : [];
  const journeyFresh = chance(rng, 0.1);
  const owned = journeyFresh ? int(rng, 0, 12) : int(rng, 20, 300);
  const f: DailyLoopFacts = {
    now, signedIn: !chance(rng, 0.03), catalogSize: 772,
    matches: down() ? null : matches,
    social: down() ? null : { incoming: chance(rng, 0.1) ? int(rng, 1, 3) : 0, from: "QA_Friend" },
    progression: down() ? null : {
      account: { level: 10, xp: 5000, xpIntoLevel: 100, xpForNext: 500, progress: 0.2 },
      pass: { level: 5, maxLevel: 30, xp: 5000, xpIntoLevel: 0, xpForNext: 1000, progress: 0, nextReward: null },
      claimableLevels: chance(rng, 0.15) ? int(rng, 1, 2) : 0,
      objectives: randomObjectives(rng, now),
      achievements: { total: 7, claimed: 1, claimable: chance(rng, 0.1) ? 1 : 0, near: null },
      rotationPending: chance(rng, 0.2),
      metrics: { ownedCards: owned, distinctCards: owned, packsOpened: 10, duelsPlayed: 5 },
    },
    pickems: down() ? null : { pending, open: pending, eventId: "ev1", eventName: "VCT QA", nextLockAt: pending > 0 && lockIn > 0 ? now + lockIn : null },
    packs: down() ? null : { unopened: chance(rng, 0.3) ? int(rng, 1, 4) : 0 },
    decks: down() ? null : pick(rng, [
      { total: 1, valid: 1, active: { id: "d1", name: "Equipo", valid: true, size: 10, sumOvr: 800 }, firstInvalid: null },
      { total: 0, valid: 0, active: null, firstInvalid: null },
      { total: 1, valid: 0, active: null, firstInvalid: { id: "d2", name: "Medio", valid: false, size: 6, sumOvr: 400 } },
    ]),
    campaign: down() ? null : { completed: int(rng, 0, 15), total: 15, complete: chance(rng, 0.1), next: { nodeId: "c1-n3", name: "Nodo 3", team: "NAVI", chapterOrder: 1 } },
    competitive: down() ? null : { rating: 1000, gamesPlayed: int(rng, 0, 30), wins: 1, losses: 1, draws: 0, provisional: chance(rng, 0.5), position: null, rankedTotal: 50, recent: [] },
    live: down() ? null : live,
    season: down() ? null : { current: { id: "s1", name: "Temporada 1", status: seasonEndsIn > 0 ? "ACTIVE" : "ENDED", presentation: seasonEndsIn > 0 ? "ACTIVE" : "ENDED", startsAtMs: now - 30 * DAY, endsAtMs: now + seasonEndsIn }, next: null },
    draftRun: draftCombat ? null : chance(rng, 0.12) ? { id: "r1", status: pick(rng, ["DRAFTING", "READY"] as const), stage: int(rng, 1, 5) } : null,
    activity: down() ? null : { lastActivityAt: now - pick(rng, [0, 6 * HOUR, DAY + HOUR, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY]), recent: [{ id: "l0", label: "Victoria en partida rápida (+120 créditos)", at: now - HOUR }] },
  };
  if (journeyFresh && f.progression && f.packs && f.decks) {
    f.journey = { ownedCards: owned, packsOpened: 0, matchesCompleted: 0, unopenedPacks: f.packs.unopened, firstPackId: f.packs.unopened > 0 ? "inicial" : null, decks: { total: 0, valid: 0, firstInvalid: null }, readyDeck: null, readiness: { ready: false, dataVersion: null, roles: [], shortages: [] } };
  }
  return f;
}

const ROUTE_RE = /^\/[a-z0-9\-/]*(\?[a-z0-9=&%\-._]*)?(#[a-z]+)?$/i;
const FORBIDDEN_TEXT = /racha|streak|recompensa por volver|has perdido|última oportunidad|login|mercado|marketplace/i;

/** Invariantes de una foto del vestíbulo con sus hechos. `routeExists` comprueba la ruta de verdad (fs en scripts). */
export function checkSnapshot(f: DailyLoopFacts, s: DailyLoopSnapshot, routeExists: (href: string) => boolean = () => true): Violation[] {
  const v: Violation[] = [];
  const bad = (invariant: string, detail: string) => v.push({ invariant, detail });
  const actions = [s.primaryAction, ...s.secondaryActions];
  if (!s.primaryAction || !s.primaryAction.href) bad("accion-existe", "sin acción principal");
  for (const a of actions) {
    if (!ROUTE_RE.test(a.href) || !routeExists(a.href)) bad("ruta-valida", `${a.id} → ${a.href}`);
    if (/mercado|market/i.test(a.href)) bad("sin-marketplace", a.href);
    if (!a.reason || a.reason.length < 5) bad("razon", a.id);
    if (FORBIDDEN_TEXT.test(`${a.title} ${a.detail} ${a.reason ?? ""}`)) bad("sin-fomo-falso", `${a.id}: ${a.reason}`);
    if (a.urgency && (a.endsAt === null || a.endsAt === undefined || a.endsAt <= f.now)) bad("urgencia-con-fin-real", a.id);
  }
  if (!f.signedIn) return v;
  const openMatch = (f.matches ?? []).length > 0;
  if (openMatch && !s.primaryAction.id.startsWith("resume-") ) bad("partida-activa-primero", s.primaryAction.id);
  if (openMatch && s.primaryAction.id === "resume-draft-run") bad("partida-antes-que-run", "run por encima de partida");
  const ranked = (f.matches ?? []).find((m) => m.mode === "RANKED");
  if (ranked && s.primaryAction.id !== "resume-ranked") bad("ranked-primero", s.primaryAction.id);
  if (!openMatch && f.draftRun && !(f.journey && s.primaryAction.id.startsWith("journey-")) && s.primaryAction.kind !== "run" && s.primaryAction.kind !== "resume") bad("run-draft-prioridad", s.primaryAction.id);
  for (let i = 1; i < actions.length; i++) if (todayRank(actions[i]) < todayRank(actions[i - 1])) bad("orden-unico", `${actions[i - 1].id} > ${actions[i].id}`);
  if (new Set(actions.map((a) => a.kind)).size !== actions.length) bad("un-tipo-por-accion", actions.map((a) => a.kind).join(","));
  for (const a of actions) {
    if (a.id === "claim") {
      const p = f.progression;
      const live = p ? p.objectives.filter((o) => o.complete && !o.claimed && liveObjective(o, f.now)).length : 0;
      if (!p || p.claimableLevels + live + p.achievements.claimable === 0) bad("claim-real", "reclamar sin nada reclamable");
    }
    if (a.id === "predict" && !(f.pickems && f.pickems.pending > 0)) bad("pickem-real", "predicción sin pendientes");
    if (a.id === "objective" && a.progress && a.progress.value >= a.progress.max) bad("objetivo-no-completado", a.title);
    if (a.id === "live" && !(f.live ?? []).some((e) => e.lifecycle === "ACTIVE" && e.liveCount > 0 && !e.isDemo)) bad("sin-fake-live", "directo sin partido real (o de demostración)");
    const src = a.source;
    if ((src === "pickems" && f.pickems === null) || (src === "progression" && f.progression === null) || (src === "campaign" && f.campaign === null) || (src === "competitive" && f.competitive === null) || (src === "social" && f.social === null) || (src === "live" && f.live === null)) bad("subsistema-caido-no-recomienda", a.id);
  }
  const sv = s.service;
  if (!sv) { bad("servicio", "sin vista temporal con sesión"); return v; }
  if (sv.resets.dailyEndsAt <= f.now || sv.resets.weeklyEndsAt <= f.now) bad("reset-futuro", "reset en el pasado");
  for (const c of [...sv.today, ...sv.thisWeek]) if (c.endsAt !== null && c.endsAt <= f.now) bad("sin-tanda-caducada", c.id);
  if (sv.today.length > 3 || sv.thisWeek.length > 2) bad("diarias-no-acumuladas", `${sv.today.length}/${sv.thisWeek.length}`);
  for (const e of sv.expiring) if (e.endsAt <= f.now) bad("caducidad-real", e.id);
  if (sv.returning && sv.returning.facts.length > RETURNING_MAX_FACTS) bad("vuelta-max-3", String(sv.returning.facts.length));
  if (sv.returning && sv.returning.facts.some((x) => FORBIDDEN_TEXT.test(x))) bad("vuelta-sin-castigo", sv.returning.facts.join(" | "));
  if (JSON.stringify(s).includes("correct_option")) bad("sin-fuga-pickem", "correct_option en la foto");
  return v;
}

/* ───────────────────────────── retorno ───────────────────────────── */

export const RETURN_HORIZONS = [0, 6 * HOUR, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY] as const;

interface Ev { at: number; metric: (typeof WINDOW_METRICS)[number] }

/**
 * Un retorno: materializa la tanda en la última visita (`t0`), genera actividad real repartida entre `t0` y `now`
 * (a veces ninguna), resuelve el pase en `now` y construye la foto. Devuelve violaciones.
 */
export function returnState(rng: Rng, userId: string, horizon: number): { violations: Violation[]; snap: DailyLoopSnapshot } {
  const v: Violation[] = [];
  const bad = (invariant: string, detail: string) => v.push({ invariant, detail });
  const t0 = Date.UTC(2026, 8, 7) + int(rng, 1, 40) * DAY + int(rng, 0, 23) * HOUR;
  const now = t0 + horizon + int(rng, 0, 59) * 60_000;
  const events: Ev[] = [];
  const burst = (from: number, to: number, n: number) => { for (let i = 0; i < n; i++) events.push({ at: from + rng.next() * Math.max(1, to - from), metric: pick(rng, WINDOW_METRICS) }); };
  burst(t0 - 20 * DAY, t0, int(rng, 0, 60));
  const at = (t: number): MetricSnapshot => {
    const m: MetricSnapshot = { points: 0, decks_saved: 1, region_set: 1, owned_cards: 50 };
    for (const k of WINDOW_METRICS) m[k] = events.filter((e) => e.metric === k && e.at <= t).length;
    return m;
  };
  const since = (t: number, ws: number): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const k of WINDOW_METRICS) o[countKey(k, ws)] = events.filter((e) => e.metric === k && e.at >= ws && e.at <= t).length;
    return o;
  };
  const counts = (t: number) => ({ ...since(t, periodWindow("daily", t)!.startsAt), ...since(t, periodWindow("weekly", t)!.startsAt) });
  // Visita t0: materializa.
  let state: PassState = freshPassState(CURRENT_SEASON.id);
  state = resolvePassWindows({ state, season: CURRENT_SEASON, userId, metrics: at(t0), sinceWindow: counts(t0), now: t0, accountCreatedAt: t0 - 30 * DAY, seasonStartsAt: Date.UTC(2026, 8, 7) }).state;
  // Actividad entre la visita y la vuelta.
  if (chance(rng, 0.7)) burst(t0, now, int(rng, 1, 30));
  const metricsNow = at(now);
  const r = resolvePassWindows({ state, season: CURRENT_SEASON, userId, metrics: metricsNow, sinceWindow: counts(now), now, accountCreatedAt: t0 - 30 * DAY, seasonStartsAt: Date.UTC(2026, 8, 7) });
  // Idempotencia (dos pestañas / relectura): resolver otra vez no cambia nada.
  const again = resolvePassWindows({ state: r.state, season: CURRENT_SEASON, userId, metrics: metricsNow, sinceWindow: counts(now), now, accountCreatedAt: t0 - 30 * DAY, seasonStartsAt: Date.UTC(2026, 8, 7) });
  if (again.changed) bad("rotacion-idempotente", "resolver dos veces cambia el estado");
  const objectives = missionViewsOf(r.state.missions, metricsNow, CURRENT_SEASON.missionPool) as MetaObjective[];
  const dw = periodWindow("daily", now)!; const ww = periodWindow("weekly", now)!;
  for (const m of r.state.missions) {
    if (m.kind === "daily" && m.assignedAt !== dw.startsAt) bad("sin-mision-hibrida", `diaria de otra ventana ${m.id}`);
    if (m.kind === "weekly" && m.assignedAt !== ww.startsAt) bad("sin-mision-hibrida", `semanal de otra ventana ${m.id}`);
  }
  // Progreso EXACTO: lo ocurrido desde el inicio de la ventana (acotado al objetivo).
  for (const o of objectives) {
    if (o.kind !== "daily" && o.kind !== "weekly") continue;
    const ws = o.kind === "daily" ? dw.startsAt : ww.startsAt;
    const expected = Math.min(o.goal, events.filter((e) => e.metric === o.metric && e.at >= ws && e.at <= now).length);
    if (o.current !== expected) bad("progreso-anclado-a-la-ventana", `${o.id}: ${o.current} ≠ ${expected}`);
  }
  // Continuidad semanal: misma semana → misma tanda y misma baseline que en t0.
  if (periodWindow("weekly", t0)!.startsAt === ww.startsAt) {
    const before = state.missions.filter((m) => m.kind === "weekly").map((m) => `${m.id}:${m.baseline}`).sort().join();
    const after = r.state.missions.filter((m) => m.kind === "weekly").map((m) => `${m.id}:${m.baseline}`).sort().join();
    if (before !== after) bad("continuidad-semanal", `${before} → ${after}`);
  }
  const f: DailyLoopFacts = {
    now, signedIn: true, catalogSize: 772, matches: chance(rng, 0.1) ? [{ id: "m1", mode: "PVE", difficulty: "EASY", opponent: null, node: null }] : [],
    social: { incoming: 0, from: null },
    progression: { account: { level: 5, xp: 1, xpIntoLevel: 1, xpForNext: 10, progress: 0 }, pass: null, claimableLevels: 0, objectives, achievements: { total: 7, claimed: 0, claimable: 0, near: null }, rotationPending: r.rotated.length > 0, metrics: { ownedCards: 50, distinctCards: 50, packsOpened: metricsNow.packs_opened ?? 0, duelsPlayed: metricsNow.duels_played ?? 0 } },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null, nextLockAt: null }, packs: { unopened: chance(rng, 0.3) ? 1 : 0 },
    decks: { total: 1, valid: 1, active: { id: "d", name: "E", valid: true, size: 10, sumOvr: 800 }, firstInvalid: null },
    campaign: { completed: 3, total: 15, complete: false, next: { nodeId: "c1-n4", name: "N4", team: "FNC", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 10, recent: [] },
    live: [], season: { current: { id: "s1", name: "T1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: Date.UTC(2026, 8, 7), endsAtMs: Date.UTC(2026, 10, 30) }, next: null },
    draftRun: chance(rng, 0.1) ? { id: "r", status: "READY", stage: 2 } : null,
    activity: { lastActivityAt: events.filter((e) => e.at <= now).reduce((m, e) => Math.max(m, e.at), t0), recent: [] },
  };
  const snap = buildDailyLoop(f);
  v.push(...checkSnapshot(f, snap));
  const away = now - (f.activity!.lastActivityAt ?? now);
  if (away >= DAY && !snap.service?.returning && (snap.service?.today.length ?? 0) > 0) bad("vuelta-reconocida", `fuera ${Math.round(away / HOUR)} h sin contexto`);
  if (away < DAY && snap.service?.returning) bad("vuelta-solo-tras-1-dia", `${Math.round(away / HOUR)} h`);
  if (!snap.primaryAction || snap.primaryAction.id === "fallback" && !(f.decks)) bad("sin-vestibulo-muerto", "sin acción");
  return { violations: v, snap };
}
