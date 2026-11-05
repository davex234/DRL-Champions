/**
 * FASE 36 · DAILY LOOP — PRESENTACIÓN PURA (héroe, hoy, temporada, competitivo, campaña, directo, colección).
 * Lo que se escribe sale de un dato: sin «en directo» falso, sin cifras sin denominador, cuenta ≠ pase.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyLoop, type DailyLoopFacts, type LiveEventFact } from "@/domain/dailyLoop";
import type { MetaObjective } from "@/domain/progression/meta";
import {
  heroModel, todayRows, expiresLabel, seasonModel, competitiveModel, campaignModel, liveBadge, liveCard, liveModel, stashModel, formatWhen,
} from "./presentation";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const H = 3600_000; const D = 24 * H;

const obj = (o: Partial<MetaObjective> & { id: string }): MetaObjective => ({
  label: `Objetivo ${o.id}`, kind: "daily", current: 0, goal: 5, complete: false, claimed: false, rewardCredits: 0, xp: 0,
  metric: "duels_played", packId: null, packCount: 0, assignedAt: NOW - H, expiresAt: NOW + 5 * H, ...o,
});
const ev = (e: Partial<LiveEventFact> & { id: string }): LiveEventFact => ({
  name: `Evento ${e.id}`, lifecycle: "ACTIVE", isDemo: false, startDate: null, endDate: null, liveCount: 0, liveMatch: null, nextMatch: null, pickem: null, ...e,
});

function facts(o: Partial<DailyLoopFacts> = {}): DailyLoopFacts {
  return {
    now: NOW, signedIn: true, catalogSize: 772, matches: [], social: { incoming: 0, from: null },
    progression: {
      account: { level: 7, xp: 2400, xpIntoLevel: 120, xpForNext: 600, progress: 0.2 },
      pass: { level: 3, maxLevel: 50, xp: 3400, xpIntoLevel: 400, xpForNext: 1000, progress: 0.4, nextReward: { level: 4, track: "free", label: "300 créditos" } },
      claimableLevels: 0, objectives: [], achievements: { total: 12, claimed: 2, claimable: 0, near: null }, rotationPending: false,
      metrics: { ownedCards: 25, distinctCards: 22, packsOpened: 5, duelsPlayed: 3 },
    },
    pickems: { pending: 0, open: 0, eventId: null, eventName: null }, packs: { unopened: 0 },
    decks: { total: 1, valid: 1, active: { id: "d", name: "Equipo 2", valid: true, size: 10, sumOvr: 813 }, firstInvalid: null },
    campaign: { completed: 1, total: 15, complete: false, next: { nodeId: "c1-n2", name: "Segundo asalto", team: "LOUD", chapterOrder: 1 } },
    competitive: { rating: null, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: [] },
    live: [], season: { current: { id: "nexus-s1", name: "Temporada 1", status: "ACTIVE", presentation: "ACTIVE", startsAtMs: NOW - 10 * D, endsAtMs: NOW + 50 * D }, next: null },
    ...o,
  };
}
const snap = (o: Partial<DailyLoopFacts> = {}) => buildDailyLoop(facts(o));

/* ───────────── héroe ───────────── */

test("HÉROE · campaña: título, progreso 1/15 con porcentaje real y botón a todos los modos", () => {
  const h = heroModel(snap());
  assert.equal(h.cta.label, "Continuar Road to Champions");
  assert.equal(h.visual, "campaign");
  assert.deepEqual(h.progress, { value: 1, max: 15, label: "1 / 15", pct: (1 / 15) * 100 });
  assert.deepEqual(h.secondary, { label: "Ver todos los modos", href: "/jugar", disabled: false });
});

test("HÉROE · partida a medias: visual de partida, urgente, sin progreso inventado", () => {
  const h = heroModel(snap({ matches: [{ id: "m", mode: "RANKED", difficulty: null, opponent: "Kira", node: null }] }));
  assert.equal(h.visual, "match");
  assert.equal(h.urgent, true);
  assert.equal(h.progress, null);
  assert.equal(h.title, "Contra Kira");
});

test("HÉROE · sin conexión: la acción que necesita servidor queda desactivada; la cuenta y el hub, no", () => {
  assert.equal(heroModel(snap({ packs: { unopened: 2 } }), { offline: true }).cta.disabled, true);
  const anon = buildDailyLoop({ ...facts(), signedIn: false });
  assert.equal(heroModel(anon, { offline: true }).cta.disabled, false);
  const hub = buildDailyLoop(facts({ decks: null, campaign: null, competitive: null }));
  assert.equal(heroModel(hub, { offline: true }).cta.disabled, false);
});

test("HÉROE · sin secundaria cuando no aporta (anónimo sin directo)", () => {
  assert.equal(heroModel(buildDailyLoop({ ...facts(), signedIn: false })).secondary, null);
});

test("HÉROE · con acción no-jugar no repite la barra «Después»: la siguiente acción vive solo allí", () => {
  const s = snap({ packs: { unopened: 3 } });
  const h = heroModel(s);
  assert.equal(h.cta.label, "Abrir 3 sobres");
  assert.equal(h.count, 3);
  assert.equal(h.secondary, null);
  assert.equal(s.secondaryActions[0].cta, "Continuar Road to Champions");
  const ranked = snap({ matches: [{ id: "m", mode: "RANKED", difficulty: null, opponent: "K", node: null }], social: { incoming: 1, from: "A" } });
  assert.equal(heroModel(ranked).secondary, null, "RESPONDER RETO no aparece dos veces");
});

/* ───────────── hoy ───────────── */

test("HOY · filas con estado textual, caducidad del servidor y porcentaje con denominador", () => {
  // Con un objetivo reclamable la acción principal ya es «Reclamar» (→ /logros): HOY no repite ese destino.
  const s = snap({ progression: { ...facts().progression!, objectives: [obj({ id: "a", current: 4, goal: 5 }), obj({ id: "b", current: 5, complete: true })] } });
  assert.equal(s.primaryAction.id, "claim");
  const rows = todayRows(s, NOW);
  assert.ok(!rows.some((r) => r.status === "CLAIMABLE"));
  assert.equal(rows[0].statusLabel, "Casi completado");
  assert.equal(rows[0].expires, "Caduca en 5 h");
  assert.equal(rows[0].pct, 80);
  // Sin acción de reclamar delante (p. ej. partida a medias), el reclamable encabeza HOY.
  const busy = buildDailyLoop(facts({ matches: [{ id: "m", mode: "PVE", difficulty: "EASY", opponent: null, node: null }], progression: { ...facts().progression!, objectives: [obj({ id: "b", current: 5, complete: true })] } }));
  assert.equal(todayRows(busy, NOW)[0].statusLabel, "Reclamar");
});

test("CADUCIDAD · días, horas, minutos; nada si no caduca o ya caducó", () => {
  assert.equal(expiresLabel(NOW + 3 * D + H, NOW), "Caduca en 3 días");
  assert.equal(expiresLabel(NOW + D, NOW), "Caduca en 1 día");
  assert.equal(expiresLabel(NOW + 2 * H, NOW), "Caduca en 2 h");
  assert.equal(expiresLabel(NOW + 30_000, NOW), "Caduca en 1 min");
  assert.equal(expiresLabel(null, NOW), null);
  assert.equal(expiresLabel(NOW - 1, NOW), null);
});

/* ───────────── temporada · cuenta vs pase ───────────── */

test("TEMPORADA · activa: tiempo restante del servidor y DOS barras etiquetadas (pase ≠ cuenta)", () => {
  const m = seasonModel(snap(), NOW)!;
  assert.equal(m.name, "Temporada 1");
  assert.equal(m.statusLabel, "En curso");
  assert.equal(m.timeLabel, "Quedan 50 días");
  assert.match(m.pass!.levelLabel, /^Pase · nivel 3 de 50$/);
  assert.match(m.pass!.xpLabel, /XP del pase$/);
  assert.match(m.account!.levelLabel, /^Cuenta · nivel 7$/);
  assert.match(m.account!.xpLabel, /XP de cuenta$/);
  assert.equal(m.pass!.pct, 40);
  assert.equal(m.account!.pct, 20);
  assert.equal(m.pass!.nextReward, "Nivel 4: 300 créditos");
});

test("TEMPORADA · últimos días marcados; objetivos resumidos con recuentos reales", () => {
  const f = facts({ season: { current: { id: "s", name: "Temporada 1", status: "ACTIVE", presentation: "ENDING_SOON", startsAtMs: NOW - 50 * D, endsAtMs: NOW + 3 * D }, next: null } });
  f.progression!.objectives = [obj({ id: "a", complete: true, current: 5 }), obj({ id: "b" }), obj({ id: "w", kind: "weekly", expiresAt: NOW + 4 * D })];
  const m = seasonModel(buildDailyLoop(f), NOW)!;
  assert.equal(m.endingSoon, true);
  assert.equal(m.statusLabel, "Últimos días");
  assert.equal(m.objectivesLabel, "Diarios 1/2 · Semanales 0/1");
});

test("TEMPORADA · el reloj del servidor manda: si ya terminó al pintar, «Finalizada» y sin pase", () => {
  const m = seasonModel(snap(), NOW + 60 * D)!;
  assert.equal(m.statusLabel, "Finalizada");
  assert.equal(m.timeLabel, null);
  assert.equal(m.pass, null);
});

test("TEMPORADA · sin temporada ni siguiente → sin bloque (no se inventa)", () => {
  assert.equal(seasonModel(snap({ season: { current: null, next: null } }), NOW), null);
});

test("TEMPORADA · próxima (si el calendario la trae) → «Empieza en…»", () => {
  const m = seasonModel(snap({ season: { current: null, next: { id: "s2", name: "Temporada X", status: "UPCOMING", presentation: "UPCOMING", startsAtMs: NOW + 2 * D, endsAtMs: NOW + 60 * D } } }), NOW)!;
  assert.equal(m.timeLabel, "Empieza en 2 días");
  assert.equal(m.pass, null);
});

/* ───────────── competitivo ───────────── */

test("COMPETITIVO · sin partidas: sin rating inventado", () => {
  const m = competitiveModel(snap(), 10)!;
  assert.equal(m.stateLabel, "Sin partidas");
  assert.equal(m.ratingLabel, "Sin rating todavía");
  assert.equal(m.recordLabel, null);
});

test("COMPETITIVO · provisional: calibración real y forma V/D/E con nombre accesible", () => {
  const m = competitiveModel(snap({ competitive: { rating: 1040, gamesPlayed: 4, wins: 3, losses: 1, draws: 0, provisional: true, position: null, rankedTotal: 40, recent: ["WIN", "LOSS", "DRAW"] } }), 10)!;
  assert.equal(m.stateLabel, "Provisional");
  assert.deepEqual(m.placement, { value: 4, max: 10 });
  assert.equal(m.recordLabel, "3V · 1D");
  assert.deepEqual(m.form.map((f) => f.letter), ["V", "D", "E"]);
  assert.equal(m.form[1].label, "Derrota");
});

test("COMPETITIVO · clasificado: rating y posición, sin divisiones", () => {
  const m = competitiveModel(snap({ competitive: { rating: 1234, gamesPlayed: 25, wins: 15, losses: 9, draws: 1, provisional: false, position: 3, rankedTotal: 40, recent: [] } }), 10)!;
  assert.equal(m.positionLabel, "#3 de 40");
  assert.equal(m.recordLabel, "15V · 9D · 1E");
  assert.equal(m.placement, null);
  assert.ok(!/oro|plata|divisi|tier/i.test(JSON.stringify(m)));
});

test("COMPETITIVO · no legible → null (el bloque lo dice)", () => {
  assert.equal(competitiveModel(snap({ competitive: null }), 10), null);
});

/* ───────────── campaña ───────────── */

test("CAMPAÑA · en curso / sin empezar / completada (sin NG+)", () => {
  const c = campaignModel(snap())!;
  assert.equal(c.statusLabel, "En curso");
  assert.equal(c.progressLabel, "1 / 15");
  assert.equal(c.next!.href, "/jugar/road-to-champions?node=c1-n2");
  assert.equal(campaignModel(snap({ campaign: { completed: 0, total: 15, complete: false, next: { nodeId: "c1-n1", name: "P", team: "NAVI", chapterOrder: 1 } } }))!.statusLabel, "Sin empezar");
  const done = campaignModel(snap({ campaign: { completed: 15, total: 15, complete: true, next: null } }))!;
  assert.equal(done.statusLabel, "Completada");
  assert.equal(done.next, null);
  assert.equal(done.pct, 100);
  assert.equal(campaignModel(snap({ campaign: null })), null);
});

/* ───────────── directo ───────────── */

test("DIRECTO · «EN DIRECTO» solo con partido en juego; activo sin partido → «EN CURSO»", () => {
  assert.equal(liveBadge({ lifecycle: "ACTIVE", liveCount: 1 }), "EN DIRECTO");
  assert.equal(liveBadge({ lifecycle: "ACTIVE", liveCount: 0 }), "EN CURSO");
  assert.equal(liveBadge({ lifecycle: "UPCOMING", liveCount: 0 }), "PRÓXIMAMENTE");
  assert.equal(liveBadge({ lifecycle: "COMPLETED", liveCount: 0 }), "FINALIZADO");
  // Fase 42 · QA real: un evento demo con un partido `live` residual no se anuncia «EN DIRECTO».
  assert.equal(liveBadge({ lifecycle: "ACTIVE", liveCount: 1, isDemo: true }), "DEMO");
  assert.equal(liveCard(ev({ id: "d", liveCount: 1, isDemo: true, liveMatch: { teamA: "NRG", teamB: "SEN", scoreA: 1, scoreB: 1 } })).isLive, false);
});

test("DIRECTO · la línea dice el marcador real o el próximo partido; TBD se dice", () => {
  const live = liveCard(ev({ id: "a", liveCount: 1, liveMatch: { teamA: "FNC", teamB: null, scoreA: 1, scoreB: 0 } }));
  assert.equal(live.line, "FNC vs Por determinar · 1-0");
  assert.equal(live.isLive, true);
  const next = liveCard(ev({ id: "b", lifecycle: "UPCOMING", nextMatch: { teamA: "G2", teamB: "SEN", startTime: "2026-09-21T18:00:00.000Z" } }));
  assert.match(next.line!, /^Próximo: G2 vs SEN · /);
  assert.equal(next.href, "/torneos/b");
});

test("DIRECTO · destacado y próximo; Pick'ems pendientes solo con sesión", () => {
  const m = liveModel(snap({ live: [ev({ id: "a", liveCount: 1, pickem: { open: 2, pending: 2 } }), ev({ id: "b", lifecycle: "UPCOMING", pickem: { open: 1, pending: 1 } })] }))!;
  assert.equal(m.featured!.badge, "EN DIRECTO");
  assert.equal(m.upcoming!.badge, "PRÓXIMAMENTE");
  assert.equal(m.pickemPending, 3);
  assert.equal(liveModel(snap({ live: null })), null);
});

test("FECHAS · formato español de España, zona Madrid; basura → null", () => {
  assert.match(formatWhen("2026-09-21T18:00:00.000Z")!, /21 sept/);
  assert.equal(formatWhen("no-es-fecha"), null);
  assert.equal(formatWhen(null), null);
});

/* ───────────── colección ───────────── */

test("COLECCIÓN · sobres pendientes con CTA al inventario; sin sobres, al catálogo (sin regalos)", () => {
  assert.deepEqual(stashModel(snap({ packs: { unopened: 3 } })).packs, { label: "Tienes 3 sobres sin abrir", cta: { label: "Abrir 3 sobres", href: "/inventario" } });
  const none = stashModel(snap({ packs: { unopened: 0 } })).packs!;
  assert.equal(none.cta.href, "/packs");
  assert.ok(!/gratis|regalo|recompensa/i.test(JSON.stringify(none)));
});

test("COLECCIÓN · progreso distinto sobre el catálogo real; sin «cartas nuevas hoy»", () => {
  const m = stashModel(snap());
  assert.equal(m.collection!.label, "22 / 772 cartas distintas");
  assert.ok(!/nuev|hoy|esta temporada/i.test(JSON.stringify(m.collection)));
});

test("LOGROS · por reclamar > casi completo > resumen", () => {
  const f = facts();
  f.progression!.achievements = { total: 12, claimed: 2, claimable: 1, near: null };
  assert.equal(stashModel(buildDailyLoop(f)).achievements!.claimable, true);
  f.progression!.achievements = { total: 12, claimed: 2, claimable: 0, near: { id: "x", name: "Coleccionista", current: 40, goal: 50 } };
  assert.equal(stashModel(buildDailyLoop(f)).achievements!.detail, "40 / 50");
  f.progression!.achievements = { total: 12, claimed: 2, claimable: 0, near: null };
  assert.equal(stashModel(buildDailyLoop(f)).achievements!.label, "2 de 12 logros");
});

test("ANÓNIMO · sin bloques personales", () => {
  const s = buildDailyLoop({ ...facts(), signedIn: false });
  const m = stashModel(s);
  assert.equal(m.packs, null); assert.equal(m.collection, null); assert.equal(m.achievements, null);
  assert.equal(competitiveModel(s, 10), null);
  assert.equal(campaignModel(s), null);
});
