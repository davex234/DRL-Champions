/**
 * F83 · RUTA DE TEMPORADA — dominio (curva, fase, rotación, reglas de XP, retos, validación, economía, vista) y render.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLevels, levelFor, levelProgress, curveValid } from "./curve";
import { phaseOf } from "./types";
import { periodOf, selectChallenges, activeChallenges } from "./rotation";
import { baseXp, challengeOps } from "./rules";
import { validateSeason } from "./validate";
import { economyTotals, simulate } from "./economy";
import { buildOverview, matchGain } from "./view";
import { t2Config, t2Draft, DAILY_POOL, WEEKLY_POOL } from "./template";
import { PACKS } from "@/data/packs";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import type { MatchEvent } from "@/domain/missionEngine/types";
import { SeasonTrackScreen } from "@/components/seasonTrack/SeasonTrackScreen";
import { SeasonLevelUp, SeasonPostMatchView } from "@/components/seasonTrack/SeasonMoments";
import { ACTIVE, CLAIM, MAX, GRACE, SCHEDULED, FRESH, POSTMATCH, MULTI, SEASON, QA_NOW } from "@/app/design-system/fase83/fixtures";
import { seasonBadgeFact } from "@/domain/collectionSets/badges";

const DAY = 86_400_000;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const price = (id: string) => PACKS.find((p) => p.id === id)?.price ?? null;
const cfg = t2Config();
const match = (o: Partial<MatchEvent> = {}): MatchEvent => ({ kind: "MATCH", key: "match:x", mode: "PVE", difficulty: "NORMAL", won: false, draw: false, finished: true, turnsWon: 4, humanDecisions: 9, autoDecisions: 0, deck: [], ...o });

/* ═══════════ curva y nivel ═══════════ */

test("F83-L1 · curva progresiva por escalones; el nivel se DERIVA de la XP (una sola fuente)", () => {
  const l = buildLevels(40, 1500, 50);
  assert.equal(l.length, 40); assert.equal(l[0], 1500); assert.equal(l[1], 1500 + 1550); assert.equal(l[39], 99_000);
  assert.ok(curveValid(l, 40)); assert.ok(!curveValid([10, 10], 2)); assert.ok(!curveValid(l, 39));
  assert.equal(levelFor(0, l), 0); assert.equal(levelFor(1499, l), 0); assert.equal(levelFor(1500, l), 1); assert.equal(levelFor(3049, l), 1); assert.equal(levelFor(3050, l), 2);
  const p = levelProgress(2000, l);
  assert.deepEqual([p.level, p.xpIntoLevel, p.xpForNext, p.isMax], [1, 500, 1550, false]);
});

test("F83-L2 · nivel máximo: la XP de más se registra pero no da niveles; la barra queda llena", () => {
  const l = buildLevels(40, 1500, 50);
  const p = levelProgress(150_000, l);
  assert.deepEqual([p.level, p.isMax, p.progress, p.xpForNext], [40, true, 1, 0]);
  assert.equal(p.xp, 150_000);
});

/* ═══════════ fase (hora del servidor) ═══════════ */

test("F83-T1 · fase por la hora del servidor: inicio −1 ms / inicio / fin −1 / fin / fin del reclamo", () => {
  const s = { status: "PUBLISHED" as const, startsAt: 1000, endsAt: 2000, claimUntil: 3000 };
  assert.equal(phaseOf(s, 999), "SCHEDULED"); assert.equal(phaseOf(s, 1000), "ACTIVE"); assert.equal(phaseOf(s, 1001), "ACTIVE");
  assert.equal(phaseOf(s, 1999), "ACTIVE"); assert.equal(phaseOf(s, 2000), "GRACE"); assert.equal(phaseOf(s, 2999), "GRACE"); assert.equal(phaseOf(s, 3000), "ARCHIVED");
  assert.equal(phaseOf({ ...s, status: "DRAFT" }, 1500), "DRAFT"); assert.equal(phaseOf({ ...s, status: "CANCELLED" }, 1500), "CANCELLED");
});

/* ═══════════ rotación ═══════════ */

test("F83-R1 · periodos UTC: 23:59:59.999 y 00:00 caen en días distintos; la semana empieza el lunes", () => {
  const mon = Date.parse("2026-11-30T00:00:00Z");
  assert.equal(periodOf("daily", mon - 1).key, "d:2026-11-29"); assert.equal(periodOf("daily", mon).key, "d:2026-11-30");
  assert.equal(periodOf("weekly", mon - 1).key, "w:2026-11-23"); assert.equal(periodOf("weekly", mon).key, "w:2026-11-30");
  assert.equal(periodOf("weekly", mon + 6 * DAY + 23 * 3_600_000).key, "w:2026-11-30");
  assert.equal(periodOf("daily", mon).endsAt - periodOf("daily", mon).startsAt, DAY);
});

test("F83-R2 · rotación determinista (misma fecha = misma selección), sin familias repetidas, cambia con el día", () => {
  const a = selectChallenges(DAILY_POOL, 3, "temporada-2|d:2026-12-01").map((c) => c.id);
  assert.deepEqual(selectChallenges(DAILY_POOL, 3, "temporada-2|d:2026-12-01").map((c) => c.id), a);
  const fams = selectChallenges(DAILY_POOL, 3, "temporada-2|d:2026-12-01").map((c) => c.family);
  assert.equal(new Set(fams).size, 3);
  const days = new Set(Array.from({ length: 14 }, (_, i) => selectChallenges(DAILY_POOL, 3, `temporada-2|d:2026-12-${String(i + 1).padStart(2, "0")}`).map((c) => c.id).join(",")));
  assert.ok(days.size > 3, "hay rotación real entre días");
  const w = activeChallenges("temporada-2", cfg, Date.parse("2026-12-03T10:00:00Z"));
  assert.equal(w.weekly.challenges.length, 5); assert.equal(new Set(w.weekly.challenges.map((c) => c.family)).size, 5);
  assert.equal(w.daily.challenges.length, 3);
});

/* ═══════════ reglas de XP ═══════════ */

test("F83-X1 · partida que cuenta: base por modo + bonus de victoria; perder también suma la base", () => {
  assert.deepEqual(baseXp(cfg, match({ mode: "PVE", won: false })), { source: "MATCH", amount: 40, dailyCap: 600 });
  assert.equal(baseXp(cfg, match({ mode: "PVE", won: true }))!.amount, 70);
  assert.equal(baseXp(cfg, match({ mode: "RANKED", won: true, difficulty: null }))!.amount, 90);
  assert.equal(baseXp(cfg, match({ mode: "DRAFT", won: false }))!.amount, 50);
});

test("F83-X2 · anti-AFK y anti-farm: sin decisiones humanas, privada, sin terminar → 0 XP y 0 progreso de retos", () => {
  const act = activeChallenges("temporada-2", cfg, Date.parse("2026-12-03T10:00:00Z"));
  for (const e of [match({ humanDecisions: 4, autoDecisions: 6, won: true }), match({ mode: "PRIVATE", won: true }), match({ finished: false, won: true })]) {
    assert.equal(baseXp(cfg, e), null, JSON.stringify(e));
    assert.deepEqual(challengeOps(act, e), []);
  }
});

test("F83-X3 · crafteo con tope; abrir sobres y comprar NO dan XP; colección completada sí (sin tope, una vez por clave)", () => {
  assert.deepEqual(baseXp(cfg, { kind: "CRAFT_PACK", key: "c1", packId: "estandar" }), { source: "CRAFT", amount: 50, dailyCap: 100 });
  assert.deepEqual(baseXp(cfg, { kind: "CRAFT_CARD", key: "c2", recipeId: "r" }), { source: "CRAFT", amount: 50, dailyCap: 100 });
  assert.equal(baseXp(cfg, { kind: "OPEN_PACK", key: "o1", packId: "estandar" }), null);
  assert.deepEqual(baseXp(cfg, { kind: "COLLECTION", key: "collection:team-g2-v1", setId: "team-g2-v1" }), { source: "COLLECTION", amount: 300, dailyCap: null });
});

test("F83-X4 · retos: el evaluador de F73 (ganar solo si gana, dificultad mínima, rondas suman, racha)", () => {
  const act = { daily: { period: periodOf("daily", 0), challenges: DAILY_POOL.filter((c) => ["d-ganar-1", "d-rondas-8", "d-ia-normal"].includes(c.id)) },
    weekly: { period: periodOf("weekly", 0), challenges: WEEKLY_POOL.filter((c) => ["w-racha-3", "w-ia-dificil", "w-jugar-10"].includes(c.id)) } };
  const lost = challengeOps(act, match({ won: false, turnsWon: 5 }));
  assert.deepEqual(lost.map((o) => o.challenge).sort(), ["d-rondas-8", "w-jugar-10", "w-racha-3"]);
  assert.equal(lost.find((o) => o.challenge === "d-rondas-8")!.value, 5);
  assert.equal(lost.find((o) => o.challenge === "w-racha-3")!.op, "STREAK_RESET");
  const wonEasy = challengeOps(act, match({ won: true, difficulty: "EASY" })).map((o) => o.challenge);
  assert.ok(wonEasy.includes("d-ganar-1") && !wonEasy.includes("d-ia-normal") && !wonEasy.includes("w-ia-dificil"));
  const wonHard = challengeOps(act, match({ won: true, difficulty: "HARD" })).map((o) => o.challenge);
  assert.ok(wonHard.includes("d-ia-normal") && wonHard.includes("w-ia-dificil"));
  assert.ok(challengeOps(act, match({ won: true })).every((o) => o.period.startsWith(o.challenge.startsWith("d-") ? "d:" : "w:")));
});

/* ═══════════ validación ═══════════ */

const ctx = (over: Partial<Parameters<typeof validateSeason>[1]> = {}) => ({
  now: Date.parse("2026-10-03T00:00:00Z"), others: [], packIds: new Set(PACKS.map((p) => p.id)),
  legacy: SEASON_CALENDAR.map((e) => ({ id: e.id, startsAt: Date.parse(e.startsAt), endsAt: Date.parse(e.endsAt) })), ...over,
});

test("F83-V1 · la plantilla de la Temporada 2 es válida para publicar y NO se solapa con la Temporada 1 heredada", () => {
  assert.deepEqual(validateSeason({ ...t2Draft() }, ctx(), { publishing: true }), []);
  assert.equal(t2Draft().startsAt, Date.parse(SEASON_CALENDAR[0].endsAt), "empieza justo cuando termina el pase heredado");
});

test("F83-V2 · publicar basura se rechaza: solape (BD y heredado), curva, sobre inexistente, recompensa enorme, reto imposible, pool pequeño, fecha pasada", () => {
  const t = t2Draft();
  const codes = (s: Parameters<typeof validateSeason>[0], c = ctx()) => validateSeason(s, c, { publishing: true }).map((i) => i.code);
  assert.ok(codes({ ...t, startsAt: Date.parse("2026-11-01T00:00:00Z") }).includes("OVERLAP_LEGACY"));
  assert.ok(codes(t, ctx({ others: [{ id: "otra", startsAt: t.startsAt + DAY, endsAt: t.endsAt + DAY }] })).includes("OVERLAP"));
  assert.ok(codes({ ...t, config: { ...t.config, levels: [...t.config.levels].reverse() } }).includes("BAD_CURVE"));
  assert.ok(codes({ ...t, config: { ...t.config, rewards: [{ level: 3, reward: { packId: "no-existe", packCount: 1 } }] } }).includes("UNKNOWN_PACK"));
  assert.ok(codes({ ...t, config: { ...t.config, rewards: [{ level: 3, reward: { credits: 999_999 } }] } }).includes("REWARD_TOO_BIG"));
  assert.ok(codes({ ...t, config: { ...t.config, rewards: [{ level: 3, reward: { packId: "premium", packCount: 9 } }] } }).includes("REWARD_TOO_BIG"));
  assert.ok(codes({ ...t, config: { ...t.config, rewards: [{ level: 99, reward: { credits: 10 } }] } }).includes("BAD_REWARD_LEVEL"));
  assert.ok(codes({ ...t, config: { ...t.config, challenges: { ...t.config.challenges, daily: { count: 3, pool: [{ ...DAILY_POOL[0], condition: { type: "CRAFT_CARD" } }, DAILY_POOL[2], DAILY_POOL[4]] } } } }).includes("UNSUPPORTED_CONDITION"));
  assert.ok(codes({ ...t, config: { ...t.config, challenges: { ...t.config.challenges, daily: { count: 3, pool: DAILY_POOL.filter((c) => c.family === "play") } } } }).includes("POOL_TOO_SMALL"));
  assert.ok(codes({ ...t, startsAt: Date.parse("2026-10-01T00:00:00Z") }, ctx({ legacy: [] })).includes("STARTS_IN_PAST"));
  assert.ok(codes({ ...t, config: { ...t.config, rewards: [{ level: 3, reward: { badge: "insignia:coleccion:x" } }] } }).includes("BAD_BADGE"));
});

/* ═══════════ economía ═══════════ */

test("F83-E1 · totales del carril (solo créditos, sobres reales y 2 insignias) y conservador frente al pase heredado", () => {
  const e = economyTotals(cfg, price);
  assert.equal(e.credits, 6400);
  assert.deepEqual(e.packs.map((p) => [p.packId, p.count]).sort(), [["estandar", 2], ["premium", 2]]);
  assert.equal(e.packValue, 2 * 2500 + 2 * 6000);
  assert.equal(e.badges.length, 2);
  assert.ok(e.totalValue < 41_400, "menos que el carril libre heredado (15.900 créditos + 3 Bronce + 3 Plata)");
});

test("F83-E2 · simulación: casual < regular < muy activo; el «grind» máximo NO supera al muy activo (topes)", () => {
  const r = Object.fromEntries(simulate(cfg, 84, price).map((x) => [x.id, x]));
  assert.ok(r.casual.levelAtEnd < r.regular.levelAtEnd && r.regular.levelAtEnd <= r.high.levelAtEnd);
  assert.equal(r.max.xpPerDay, r.high.xpPerDay, "40 partidas al día dan lo mismo que 12: el tope diario manda");
  assert.equal(r.max.credits, r.high.credits);
  assert.ok(r.high.daysToMax !== null && r.high.daysToMax > 45, "ni el muy activo termina antes de la mitad larga de la temporada");
  assert.equal(r.casual.daysToMax, null);
});

/* ═══════════ vista ═══════════ */

test("F83-W1 · nodos: reclamada / disponible / bloqueada / plazo cerrado; reclamables = niveles alcanzados con recompensa", () => {
  assert.deepEqual(ACTIVE.claimable, [10, 12]);
  assert.equal(ACTIVE.track.find((n) => n.level === 4)!.state, "CLAIMED");
  assert.equal(ACTIVE.track.find((n) => n.level === 14)!.state, "LOCKED");
  assert.equal(ACTIVE.track.find((n) => n.level === 13)!.current, true);
  assert.deepEqual(GRACE.phase, "GRACE"); assert.ok(GRACE.claimable.length > 0 && GRACE.daily === null, "en gracia: se reclama, no hay retos");
  const archived = buildOverview({ now: SEASON.claimUntil + 1, season: SEASON, legacy: null, xp: SEASON.config.levels[9], claims: [], challengeRows: [], recent: [], history: [] });
  assert.equal(archived.track.find((n) => n.level === 10)!.state, "EXPIRED"); assert.deepEqual(archived.claimable, []);
  assert.equal(SCHEDULED.progress!.level, 0); assert.equal(SCHEDULED.daily, null);
});

test("F83-W2 · post-partida desde el libro mayor: XP de la partida + retos que completó; una celebración para varios niveles", () => {
  const g = matchGain(POSTMATCH, "qa-m1")!;
  assert.deepEqual([g.matchXp, g.challengeXp, g.challenges, g.levelBefore, g.levelAfter], [70, 150, 1, 11, 12]);
  const m = matchGain(MULTI, "qa-big")!;
  assert.deepEqual([m.levelBefore, m.levelAfter], [17, 20]);
  assert.equal(matchGain(ACTIVE, "otra-partida"), null, "una partida sin asientos (privada/abandonada/AFK) no enseña nada");
});

/* ═══════════ render ═══════════ */

test("F83-U1 · pantalla: héroe con nivel/XP/cuenta atrás, un botón RECLAMAR por reclamable, retos diarios y semanales, reglas", () => {
  const h = html(<SeasonTrackScreen data={CLAIM} onClaim={() => {}} />);
  assert.equal((h.match(/data-action="claim"/g) ?? []).length, CLAIM.claimable.length);
  assert.ok(h.includes('data-testid="challenges-daily"') && h.includes('data-testid="challenges-weekly"') && h.includes('data-testid="season-rules"'));
  assert.match(text(h), /Termina en \d+ d/);
  assert.match(text(h), /XP de temporada/);
  assert.equal((h.match(/<h1/g) ?? []).length, 1);
  assert.ok(h.includes('role="region"') && h.includes('tabindex="0"'), "carril recorrible con teclado");
  assert.ok(!/premium pass|pase premium|comprar nivel|saltar nivel/i.test(text(h)), "sin pase de pago ni saltos de nivel");
});

test("F83-U2 · estados: nivel máximo, gracia (reclama antes de…), programada (sin retos), nuevo jugador", () => {
  assert.match(text(html(<SeasonTrackScreen data={MAX} />)), /Nivel máximo alcanzado/);
  assert.match(text(html(<SeasonTrackScreen data={GRACE} />)), /Reclama antes de/);
  const sch = text(html(<SeasonTrackScreen data={SCHEDULED} />));
  assert.match(sch, /Empieza en/); assert.match(sch, /empiezan cuando empiece la temporada/);
  assert.match(text(html(<SeasonTrackScreen data={FRESH} />)), /Aún no has ganado XP en esta temporada/);
  assert.ok(html(<SeasonTrackScreen data={MAX} />).includes("Temporadas anteriores"));
});

test("F83-U3 · subida de nivel: un diálogo, «+N niveles» si son varios, foco y sin animación obligatoria", () => {
  const one = html(<SeasonLevelUp from={11} to={12} rewards={1} onClose={() => {}} />);
  assert.ok(one.includes('role="dialog"') && one.includes('aria-modal="true"'));
  assert.ok(!text(one).includes("+1 niveles"));
  assert.match(text(html(<SeasonLevelUp from={17} to={20} rewards={2} onClose={() => {}} />)), /\+3 niveles/);
  assert.ok(!/animate-|transition-transform/.test(one));
  const pm = html(<SeasonPostMatchView matchId="qa-m1" data={POSTMATCH} />);
  assert.match(text(pm), /\+220 XP/); assert.match(text(pm), /Partida \+70/);
});

test("F83-U4 · insignia de temporada en el sistema de F82 (nombre, tono propio, sin logo inventado)", () => {
  assert.deepEqual(seasonBadgeFact("insignia:temporada:temporada-2-oro"), { id: "insignia:temporada:temporada-2-oro", label: "Temporada 2 · Oro", kind: "SEASON", logo: null, color: "#ffce4f", caption: "Ruta de temporada", setId: null });
  assert.equal(seasonBadgeFact("insignia:temporada:inventada"), null);
  assert.ok(QA_NOW > SEASON.startsAt);
});
