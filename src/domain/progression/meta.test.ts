/**
 * META GAME 2.0 · MODELO DE LECTURA (Fase 27) — `domain/progression/meta`.
 *
 * Tests 1–7 (nivel/XP), 8–12 y 16–18 (objetivos), 19–24 (logros), 25–32 (recompensas), 38–40
 * (recomendación, FTUE, jugador que vuelve). Todo puro: sin red, sin reloj implícito.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, totalXpForLevel } from "./levels";
import { CURRENT_SEASON } from "@/data/season";
import { ACHIEVEMENTS } from "./achievements";
import {
  accountLevel, levelsGained, objectiveStatus, objectivePct, sortObjectives, objectiveDeltas, summarizeDeltas,
  achievementCategory, categoriesPresent, achievementStatus, isSecretAchievement,
  describeReward, rewardHistory, isRewardEntry, nearObjective, todayActions, continueCta, ftueState, progressEvents,
  type MetaObjective, type TodayAction,
} from "./meta";

const obj = (over: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: over.id, kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 100, xp: 50,
  metric: "duels_won", packId: null, packCount: 0, assignedAt: 1_000, expiresAt: null, ...over,
});

/* ─────────────── nivel / XP ─────────────── */

test("1+3 · el nivel de cuenta se deriva SIEMPRE de levelFromXp (una sola curva, sin tabla paralela)", () => {
  for (const xp of [0, 99, 100, 250, 1230, 5000]) {
    const l = accountLevel(xp);
    const c = levelFromXp(xp);
    assert.equal(l.level, c.level);
    assert.equal(l.xpIntoLevel, c.xpIntoLevel);
    assert.equal(l.progress, c.progress);
  }
});

test("4+5 · siguiente nivel y umbral exacto", () => {
  const l2 = totalXpForLevel(2);
  assert.equal(accountLevel(l2 - 1).toNext, 1, "un XP menos: falta 1");
  assert.equal(accountLevel(l2).level, 2, "justo en el umbral se es nivel 2");
  assert.equal(accountLevel(l2).nextTotal, totalXpForLevel(3));
  assert.equal(accountLevel(l2).toNext, totalXpForLevel(3) - l2);
});

test("6 · un salto de varios niveles entre dos lecturas del servidor se detecta entero", () => {
  assert.deepEqual(levelsGained(0, totalXpForLevel(4) + 1), [2, 3, 4]);
  assert.deepEqual(levelsGained(500, 500), []);
  assert.deepEqual(levelsGained(900, 100), [], "bajar no es subir");
});

/* ─────────────── objetivos ─────────────── */

test("8 · la definición de cada objetivo es la del pool real: recompensa y XP no se inventan", () => {
  const def = CURRENT_SEASON.missionPool.find((m) => m.id === "w-victorias")!;
  assert.equal(def.reward.credits, 1800);
  assert.equal(def.xp, 1000);
  assert.equal(def.goal, 3);
});

test("9+10+11 · estados: en progreso, pendiente de recoger, recompensa conseguida; porcentaje acotado", () => {
  assert.equal(objectiveStatus(obj({ id: "a" })), "EN_PROGRESO");
  assert.equal(objectiveStatus(obj({ id: "b", complete: true })), "PENDIENTE_DE_RECOGER");
  assert.equal(objectiveStatus(obj({ id: "c", complete: true, claimed: true })), "RECOMPENSA_CONSEGUIDA");
  assert.equal(objectivePct(obj({ id: "d", current: 2, goal: 5 })), 40);
  assert.equal(objectivePct(obj({ id: "e", current: 9, goal: 5 })), 100);
  assert.equal(objectivePct(obj({ id: "f", current: 1, goal: 0 })), 0);
});

test("12 · el cliente no completa: los deltas SOLO comparan dos lecturas del servidor y de la misma tanda", () => {
  const before = [obj({ id: "w", current: 3 }), obj({ id: "d", current: 0, assignedAt: 1 })];
  const after = [obj({ id: "w", current: 5, complete: true }), obj({ id: "d", current: 1, assignedAt: 2 })];
  const d = objectiveDeltas(before, after);
  assert.equal(d.length, 1, "la tanda distinta (rotó) no se compara");
  assert.deepEqual(d[0], { id: "w", label: "w", kind: "daily", goal: 5, from: 3, to: 5, completed: true });
  assert.deepEqual(objectiveDeltas(after, before), [], "retroceder no es progreso");
});

test("16 · un evento duplicado (misma lectura dos veces) no produce delta", () => {
  const same = [obj({ id: "w", current: 4 })];
  assert.deepEqual(objectiveDeltas(same, same), []);
});

test("18 · orden y resumen: completados primero, mayor avance después; «+ N más»", () => {
  const list = objectiveDeltas(
    [obj({ id: "a", current: 1 }), obj({ id: "b", current: 0 }), obj({ id: "c", current: 4 }), obj({ id: "d", current: 2 })],
    [obj({ id: "a", current: 3 }), obj({ id: "b", current: 1 }), obj({ id: "c", current: 5, complete: true }), obj({ id: "d", current: 3 })],
  );
  assert.equal(list[0].id, "c");
  assert.equal(list[1].id, "a");
  const s = summarizeDeltas(list, 3);
  assert.equal(s.shown.length, 3);
  assert.equal(s.more, 1);
});

test("sortObjectives · pendientes de recoger delante, después los más avanzados, reclamados al final", () => {
  const s = sortObjectives([obj({ id: "x", current: 1 }), obj({ id: "y", complete: true, claimed: true }), obj({ id: "z", complete: true }), obj({ id: "w", current: 4 })]);
  assert.deepEqual(s.map((o) => o.id), ["z", "w", "x", "y"]);
});

/* ─────────────── logros ─────────────── */

test("19+20+21 · bloqueado (0), en progreso, pendiente de recoger, conseguido; sin secretos en el catálogo", () => {
  assert.equal(achievementStatus({ current: 0, goal: 10, complete: false, claimed: false }), "BLOQUEADO");
  assert.equal(achievementStatus({ current: 3, goal: 10, complete: false, claimed: false }), "EN_PROGRESO");
  assert.equal(achievementStatus({ current: 10, goal: 10, complete: true, claimed: false }), "PENDIENTE_DE_RECOGER");
  assert.equal(achievementStatus({ current: 10, goal: 10, complete: true, claimed: true }), "CONSEGUIDO");
  for (const a of ACHIEVEMENTS) assert.equal(isSecretAchievement(a.id), false);
});

test("23 · las categorías se DERIVAN del catálogo real: solo Sobres y Colección existen", () => {
  assert.deepEqual(categoriesPresent(ACHIEVEMENTS.map((a) => a.id)), ["COLECCION", "PACKS"]);
  assert.equal(achievementCategory("sobres-100"), "PACKS");
  assert.equal(achievementCategory("completa-emea"), "COLECCION");
});

test("24 · un logro conseguido se conserva en el historial de eventos: solo se avisa una vez, al cambiar", () => {
  const before = { xp: 0, objectives: [], achievements: [{ id: "a", name: "A", complete: true }, { id: "b", name: "B", complete: false }] };
  const after = { xp: 0, objectives: [], achievements: [{ id: "a", name: "A", complete: true }, { id: "b", name: "B", complete: true }] };
  const ev = progressEvents(before, after);
  assert.deepEqual(ev.map((e) => e.id), ["achievement:b"], "el ya conseguido no se repite");
});

/* ─────────────── recompensas ─────────────── */

test("25+26+31 · el libro mayor es la fuente: créditos del asiento, fuente por `reason`, clave `ref` estable", () => {
  const e = describeReward({ id: "1", reason: "duel_win", ref: "duel:abc", delta: 220, created_at: "2026-09-14T10:00:00Z" });
  assert.equal(e.source, "duel");
  assert.equal(e.credits, 220);
  assert.equal(e.ref, "duel:abc");
  assert.equal(e.label, "Duelo ganado");
  const capped = describeReward({ id: "2", reason: "duel_capped_loss", ref: "duel:x", delta: 0, created_at: "" });
  assert.match(capped.label, /tope diario/);
  assert.equal(capped.credits, 0);
});

test("27+28 · XP y sobre solo cuando la DEFINICIÓN referida los fija (misión del pool, nivel del carril, escalón)", () => {
  const m = describeReward({ id: "3", reason: "mission_reward", ref: "mission:nexus-s1:w-sobres-10:1:0", delta: 1500, created_at: "" });
  assert.equal(m.source, "mission");
  assert.equal(m.xp, 900, "XP del pase de la definición");
  assert.equal(m.pack, null);
  const p = describeReward({ id: "4", reason: "pass_reward", ref: "pass:nexus-s1:free:10", delta: 1500, created_at: "" });
  assert.equal(p.source, "pass");
  assert.deepEqual(p.pack, { packId: "premium", count: 1, label: "Sobre Plata" });
  const s = describeReward({ id: "5", reason: "mission_reward", ref: "mission:nexus-s1:s-duelos-25:1:0", delta: 0, created_at: "" });
  assert.deepEqual(s.pack, { packId: "estandar", count: 2, label: "Sobre Bronce" });
  const unknown = describeReward({ id: "6", reason: "achievement", ref: "achievement:coleccionista", delta: 4000, created_at: "" });
  assert.equal(unknown.xp, null, "un logro no tiene XP definida: no se inventa");
  assert.match(unknown.label, /Coleccionista/);
});

test("30+32 · historial: solo recompensas (compras y otros fuera), acotado, sin botón de reclamar (es lectura)", () => {
  const rows = [
    { id: "a", reason: "buy_pack:estandar", ref: "b", delta: -800, created_at: "" },
    { id: "b", reason: "pickem_reward:acertante", ref: "pickem:00000000-0000-4000-8000-000000000001:acertante", delta: 1500, created_at: "" },
    { id: "c", reason: "starter_grant", ref: "starter:x", delta: 6000, created_at: "" },
    { id: "d", reason: "event_challenge:e:c", ref: "event:e:c", delta: 300, created_at: "" },
    { id: "e", reason: "algo_raro", ref: null, delta: 1, created_at: "" },
  ];
  const h = rewardHistory(rows, 8);
  assert.deepEqual(h.map((r) => r.source), ["pickem", "starter", "event"]);
  assert.equal(h[0].xp, 150, "XP del escalón real");
  assert.ok(!isRewardEntry({ source: "purchase" }) && !isRewardEntry({ source: "other" }));
  assert.equal(rewardHistory(rows, 1).length, 1);
});

/* ─────────────── hoy / recomendación / FTUE ─────────────── */

const step = (kind: TodayAction["kind"], id = kind): TodayAction => ({ id, kind, label: id, detail: "", href: `/${id}` });

test("38 · prioridad fija y pura: partida > recompensa > Pick'em > objetivo casi completo > sobre > equipo > jugar", () => {
  const steps = [step("play"), step("open"), step("predict"), step("claim"), step("build"), step("explore"), step("resume")];
  const objectives = [obj({ id: "near", current: 4, goal: 5, expiresAt: 10 })];
  const a = todayActions({ steps, objectives, max: 8 });
  assert.deepEqual(a.map((x) => x.kind), ["resume", "claim", "predict", "objective", "open", "build", "play", "explore"]);
  assert.equal(a[3].detail, "near · 4 / 5");
  assert.equal(a[3].urgent, true, "una tanda que caduca marca urgencia");
  assert.equal(todayActions({ steps, objectives }).length, 4, "como mucho cuatro");
});

test("nearObjective · la mitad o más, sin terminar; nunca uno completo o reclamado", () => {
  assert.equal(nearObjective([obj({ id: "a", current: 2, goal: 5 })]), null);
  assert.equal(nearObjective([obj({ id: "b", current: 5, goal: 5, complete: true })]), null);
  assert.equal(nearObjective([obj({ id: "c", current: 3, goal: 5 }), obj({ id: "d", current: 4, goal: 5 })])?.id, "d");
});

test("continueCta · la primera acción con su verbo; sin acciones no hay recomendación", () => {
  assert.deepEqual(continueCta([{ ...step("open"), count: 3 }]), { label: "Abre tus 3 sobres", href: "/open", kind: "open" });
  assert.equal(continueCta([step("build")])?.label, "Completa tu equipo");
  assert.equal(continueCta([step("predict")])?.label, "Haz tus Pick'ems");
  assert.equal(continueCta([]), null);
});

test("39+40 · primera sesión: cuenta sin actividad; los pasos se marcan con datos reales y no prometen premios", () => {
  const f = ftueState({ packsOpened: 0, duelsPlayed: 0, hasValidDeck: false, level: 1, unopenedPacks: 4 });
  assert.equal(f.isNew, true);
  assert.deepEqual(f.steps.map((s) => s.done), [false, false, false, false]);
  assert.equal(f.steps[0].href, "/inventario", "con sobres, abrirlos");
  const r = ftueState({ packsOpened: 12, duelsPlayed: 3, hasValidDeck: true, level: 3, unopenedPacks: 0 });
  assert.equal(r.isNew, false);
  assert.deepEqual(r.steps.map((s) => s.done), [true, true, true, true]);
});

test("progressEvents · identidad estable: nivel, objetivo+tanda, logro", () => {
  const before = { xp: 0, objectives: [obj({ id: "w", current: 4, assignedAt: 7 })], achievements: [] };
  const after = { xp: totalXpForLevel(2), objectives: [obj({ id: "w", current: 5, complete: true, assignedAt: 7 })], achievements: [] };
  assert.deepEqual(progressEvents(before, after).map((e) => e.id), ["level:2", "objective:w:7"]);
});
