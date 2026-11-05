/**
 * F86 · CUADRO — pruebas de propiedades y simulaciones (dominio puro, la especificación de la SQL de 0069).
 *
 *   · Tamaños exigidos: 4 5 6 7 8 10 12 16 20 32 64 (y todos los de 4 a 64).
 *   · Cada inscrito aparece UNA vez en la ronda 1, BYEs = tamaño − inscritos y se los llevan los mejores seeds.
 *   · Ningún cruce con el mismo jugador dos veces; cada ganador tiene un único camino; un campeón como mucho.
 *   · 5.000 cuadros aleatorios con resultados, retenciones y dobles no presentados: invariantes siempre.
 *   · Separación de seeds: 1 y 2 solo en la final; 1–4 no antes de semifinales; desempate estable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyOutcome, bracketSize, bracketViolations, holdMatch, matchAt, nextOf, placementForRound, planBracket, playable, roundName,
  roundsFor, seedPositions, type BracketState,
} from "./bracket";
import { seedEntries } from "./seeding";
import { cupPhase, displayState, roundWindow } from "./lifecycle";
import { validateCupDraft } from "./validation";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const players = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, "0")}`);
/** Generador determinista (mulberry32): las simulaciones se pueden repetir con la misma semilla. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Juega el cuadro entero: el ganador lo decide `pick` (o un resultado especial). Devuelve el estado final. */
function play(s0: BracketState, pick: (a: string, b: string, round: number) => string | "VOID" | "HOLD_THEN_A"): BracketState {
  let s = s0;
  for (let guard = 0; guard < 500 && !s.complete; guard++) {
    const m = playable(s)[0];
    if (!m) break;
    const a = m.a.kind === "PLAYER" ? m.a.userId : "", b = m.b.kind === "PLAYER" ? m.b.userId : "";
    const choice = pick(a, b, m.round);
    if (choice === "VOID") { s = must(applyOutcome(s, m.round, m.slot, { void: true }, "ADMIN_DOUBLE_NO_SHOW")); continue; }
    if (choice === "HOLD_THEN_A") {
      s = holdMatch(s, m.round, m.slot);
      assert.equal(matchAt(s, m.round, m.slot)!.status, "ACTION_REQUIRED");
      assert.deepEqual(bracketViolations(s), [], "retenido: nadie avanza");
      s = must(applyOutcome(s, m.round, m.slot, { winnerId: a }, "ADMIN_DECISION")); continue;
    }
    s = must(applyOutcome(s, m.round, m.slot, { winnerId: choice }, "PLAYED"));
  }
  return s;
}

const REQUIRED = [4, 5, 6, 7, 8, 10, 12, 16, 20, 32, 64];
const must = (r: ReturnType<typeof applyOutcome>): BracketState => { if (!r.ok) throw new Error(r.error); return r.state; };

test("CUP-B1 · tamaño, rondas y BYES para 4/5/6/7/8/10/12/16/20/32/64 (y fuera de rango → null)", () => {
  const expect: Record<number, [number, number]> = { 4: [4, 2], 5: [8, 3], 6: [8, 3], 7: [8, 3], 8: [8, 3], 10: [16, 4], 12: [16, 4], 16: [16, 4], 20: [32, 5], 32: [32, 5], 64: [64, 6] };
  for (const n of REQUIRED) {
    const s = planBracket(players(n));
    assert.deepEqual([s.size, s.rounds], expect[n], `n=${n}`);
    assert.equal(s.matches.length, s.size - 1, "un cuadro de S tiene S−1 cruces");
    assert.deepEqual(bracketViolations(s, players(n)), [], `n=${n}`);
    const byes = s.matches.filter((m) => m.round === 1 && m.status === "BYE");
    assert.equal(byes.length, s.size - n, `byes n=${n}`);
    // Los BYES son de las cabezas de serie más altas (1..byes) y avanzan sin partida.
    assert.deepEqual(byes.map((m) => (m.a.kind === "PLAYER" ? m.a.seed : null)).sort((x, y) => x! - y!), Array.from({ length: s.size - n }, (_, i) => i + 1));
    assert.ok(byes.every((m) => m.resolution === "BYE" && m.winnerId), "BYE = pase directo registrado");
    assert.equal(s.eliminated.size, 0, "un BYE no elimina a nadie");
  }
  for (const bad of [0, 1, 2, 3, 65, 100, 4.5]) assert.equal(bracketSize(bad), null, `n=${bad}`);
  assert.throws(() => planBracket(players(3)));
  assert.throws(() => planBracket(["a", "b", "c", "a"]), /repetido/);
});

test("CUP-B2 · simulación completa de cada tamaño exigido: un campeón, todos los demás eliminados una vez, invariantes", () => {
  for (const n of REQUIRED) {
    const r = rng(n);
    const s = play(planBracket(players(n)), (a, b) => (r() < 0.5 ? a : b));
    assert.ok(s.complete, `n=${n} completo`);
    assert.ok(s.championId, `n=${n} campeón`);
    assert.equal(s.eliminated.size, n - 1, `n=${n}: eliminados = n − 1`);
    assert.deepEqual(bracketViolations(s, players(n)), [], `n=${n}`);
    const runnerUp = [...s.eliminated.values()].filter((e) => e.placement === "RUNNER_UP");
    assert.equal(runnerUp.length, 1, "un subcampeón");
    // Nadie queda «5.º»: cada eliminado lleva la ronda en la que cayó.
    for (const e of s.eliminated.values()) assert.equal(e.placement, placementForRound(e.round, s.rounds));
  }
});

test("CUP-B3 · todos los tamaños de 4 a 64 × 100 simulaciones aleatorias (6.100 cuadros): invariantes siempre", () => {
  let brackets = 0;
  for (let n = 4; n <= 64; n++) {
    for (let k = 0; k < 100; k++) {
      const r = rng(n * 1000 + k);
      const s = play(planBracket(players(n)), (a, b) => {
        const x = r();
        if (x < 0.04) return "VOID";
        if (x < 0.08) return "HOLD_THEN_A";
        return x < 0.54 ? a : b;
      });
      brackets++;
      assert.ok(s.complete, `n=${n} k=${k}`);
      const v = bracketViolations(s, players(n));
      assert.deepEqual(v, [], `n=${n} k=${k}`);
      // Con dobles no presentados puede no haber campeón, pero nunca dos.
      const finals = s.matches.filter((m) => m.round === s.rounds);
      assert.equal(finals.length, 1);
      if (s.championId) assert.equal(s.eliminated.has(s.championId), false);
    }
  }
  assert.equal(brackets, 6100, `${brackets} cuadros`);
});

test("CUP-B4 · exactamente una vez: repetir el mismo resultado (20×) no avanza dos veces ni cambia el ganador", () => {
  const s = planBracket(players(8));
  const m = matchAt(s, 1, 0)!;
  const a = (m.a as { userId: string }).userId, b = (m.b as { userId: string }).userId;
  const st = must(applyOutcome(s, 1, 0, { winnerId: a }, "PLAYED"));
  for (let i = 0; i < 20; i++) {
    const again = applyOutcome(st, 1, 0, { winnerId: i % 2 ? a : b }, "PLAYED");
    assert.equal(again.ok, false, "un cruce resuelto no admite otro resultado");
    if (!again.ok) assert.equal(again.error, "NOT_PLAYABLE");
  }
  assert.equal(matchAt(st, 2, 0)!.a.kind, "PLAYER");
  assert.equal((matchAt(st, 2, 0)!.a as { userId: string }).userId, a);
  // El ganador tiene que ser participante del cruce.
  const forged = applyOutcome(st, 1, 1, { winnerId: a }, "PLAYED");
  assert.deepEqual(forged, { ok: false, error: "NOT_A_PARTICIPANT" });
  // Un cruce que espera a su origen no se puede jugar.
  assert.deepEqual(applyOutcome(st, 2, 0, { winnerId: a }, "PLAYED"), { ok: false, error: "NOT_PLAYABLE" });
  assert.equal(matchAt(s, 1, 0)!.status, "READY", "el estado de entrada no se muta");
});

test("CUP-B5 · retenido (empate / sin resolver): el cruce siguiente NO recibe a nadie hasta la resolución", () => {
  let s = planBracket(players(4));
  s = holdMatch(s, 1, 0);
  assert.equal(matchAt(s, 1, 0)!.status, "ACTION_REQUIRED");
  assert.equal(matchAt(s, 2, 0)!.a.kind, "PENDING", "la final no se llena con un resultado no final");
  assert.equal(matchAt(s, 2, 0)!.status, "PENDING", "la final no puede empezar");
  const m = matchAt(s, 1, 0)!;
  const r = must(applyOutcome(s, 1, 0, { winnerId: (m.b as { userId: string }).userId }, "ADMIN_DECISION"));
  assert.equal(matchAt(r, 2, 0)!.a.kind, "PLAYER", "resuelto: avanza una vez");
});

test("CUP-B6 · doble no presentado: el rival del siguiente cruce avanza por pase directo; dos vacíos suben como VOID", () => {
  let s = planBracket(players(8));
  s = must(applyOutcome(s, 1, 0, { void: true }, "ADMIN_DOUBLE_NO_SHOW"));
  assert.equal(matchAt(s, 1, 0)!.status, "VOID");
  assert.equal(matchAt(s, 2, 0)!.a.kind, "EMPTY");
  const m1 = matchAt(s, 1, 1)!;
  const w = (m1.a as { userId: string }).userId;
  s = must(applyOutcome(s, 1, 1, { winnerId: w }, "PLAYED"));
  const semi = matchAt(s, 2, 0)!;
  assert.equal(semi.status, "BYE", "un solo participante en semifinal → pase directo");
  assert.equal(semi.winnerId, w);
  assert.equal(semi.resolution, "BYE");
  assert.deepEqual(bracketViolations(s, players(8)), []);
  // Los dos de un cruce eliminados en esa ronda (cuartos), con la misma colocación.
  const elim = [...s.eliminated.values()].filter((e) => e.round === 1);
  assert.ok(elim.length >= 3 && elim.every((e) => e.placement === "QUARTERFINAL"));
  // Final con los dos lados vacíos → sin campeón, torneo completo, nadie inventado.
  let t = planBracket(players(4));
  t = must(applyOutcome(t, 1, 0, { void: true }, "ADMIN_DOUBLE_NO_SHOW"));
  t = must(applyOutcome(t, 1, 1, { void: true }, "ADMIN_DOUBLE_NO_SHOW"));
  assert.equal(t.complete, true);
  assert.equal(t.championId, null);
  assert.equal(matchAt(t, 2, 0)!.status, "VOID");
  assert.deepEqual(bracketViolations(t, players(4)), []);
});

test("CUP-B7 · colocación estándar: 1 y 2 solo en la final, 1–4 no antes de semifinales (todos los tamaños)", () => {
  for (const size of [4, 8, 16, 32, 64]) {
    const pos = seedPositions(size);
    assert.deepEqual([...pos].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1), "permutación");
    const half = (seed: number) => (pos.indexOf(seed) < size / 2 ? 0 : 1);
    assert.notEqual(half(1), half(2), `size=${size}: 1 y 2 en mitades distintas`);
    const quarter = (seed: number) => Math.floor(pos.indexOf(seed) / (size / 4));
    assert.equal(new Set([1, 2, 3, 4].map(quarter)).size, 4, `size=${size}: 1–4 en cuartos distintos`);
    // Primera ronda: el seed s se cruza con size + 1 − s (el 1 con el último).
    for (let i = 0; i < size; i += 2) assert.equal(pos[i] + pos[i + 1], size + 1);
  }
  // Con resultados «gana el mejor seed» la final es 1 contra 2 y la semifinal 1–4 / 2–3.
  for (const n of [8, 16, 32, 64, 12, 20]) {
    const ps = players(n);
    const seedOf = (id: string) => ps.indexOf(id) + 1;
    const s = play(planBracket(ps), (a, b) => (seedOf(a) < seedOf(b) ? a : b));
    const final = s.matches[s.matches.length - 1];
    assert.deepEqual([final.a, final.b].map((x) => (x as { seed: number }).seed).sort(), [1, 2], `n=${n}`);
    assert.equal(s.championId, ps[0]);
  }
});

test("CUP-B8 · cabezas de serie por foto de rating: orden por rating, sin rating = 1000, empate estable por hash (no por inscripción)", () => {
  const entries = [
    { userId: "u-a", rating: 1200 }, { userId: "u-b", rating: null }, { userId: "u-c", rating: 1000 },
    { userId: "u-d", rating: 1500 }, { userId: "u-e", rating: 1000 },
  ];
  const s1 = seedEntries("cup-1", entries, md5);
  assert.deepEqual(s1.slice(0, 2).map((e) => e.userId), ["u-d", "u-a"]);
  assert.deepEqual(s1.map((e) => e.seed), [1, 2, 3, 4, 5]);
  const tied = s1.slice(2).map((e) => e.userId);
  assert.deepEqual([...tied].sort(), ["u-b", "u-c", "u-e"]);
  assert.equal(s1.find((e) => e.userId === "u-b")!.seedRating, 1000, "sin ranked: 1000, rated=false");
  assert.equal(s1.find((e) => e.userId === "u-b")!.rated, false);
  // El orden de inscripción (orden del array) NO cambia los seeds.
  const s2 = seedEntries("cup-1", [...entries].reverse(), md5);
  assert.deepEqual(s2.map((e) => e.userId), s1.map((e) => e.userId));
  // El desempate es el hash de (copa, usuario): estable, y cambia de una copa a otra (nadie tiene ventaja fija).
  const ordersByCup = new Set(Array.from({ length: 12 }, (_, i) => seedEntries(`cup-${i}`, entries, md5).slice(2).map((e) => e.userId).join()));
  assert.ok(ordersByCup.size > 1, "el desempate no favorece siempre al mismo");
  // La foto no se recalcula: cambiar ratings después y volver a sembrar es OTRA foto (el cuadro guardado no se toca).
  const later = seedEntries("cup-1", entries.map((e) => (e.userId === "u-a" ? { ...e, rating: 2000 } : e)), md5);
  assert.equal(later[0].userId, "u-a");
  assert.equal(s1[0].userId, "u-d", "la foto original sigue igual");
});

test("CUP-B9 · nombres de ronda verdaderos y colocaciones por ronda", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((r) => roundName(r, 6)), ["Ronda de 64", "Ronda de 32", "Ronda de 16", "Cuartos de final", "Semifinal", "Final"]);
  assert.deepEqual([1, 2].map((r) => roundName(r, 2)), ["Semifinal", "Final"]);
  assert.deepEqual([1, 2, 3].map((r) => placementForRound(r, 3)), ["QUARTERFINAL", "SEMIFINAL", "RUNNER_UP"]);
  assert.deepEqual(nextOf(1, 3, 3), { round: 2, slot: 1, side: "B" });
  assert.equal(nextOf(3, 0, 3), null);
  assert.equal(roundsFor(64), 6);
});

test("CUP-B10 · ciclo de vida derivado de fechas con la hora del servidor; ventanas por ronda; plazo vencido = revisión", () => {
  const base = { status: "PUBLISHED" as const, registrationOpenAt: 1000, registrationCloseAt: 2000, startsAt: 3000, startedAt: null };
  assert.equal(cupPhase(base, 999), "SCHEDULED");
  assert.equal(cupPhase(base, 1000), "REGISTRATION_OPEN");
  assert.equal(cupPhase(base, 1999), "REGISTRATION_OPEN");
  assert.equal(cupPhase(base, 2000), "REGISTRATION_CLOSED");
  assert.equal(cupPhase({ ...base, startedAt: 2100 }, 2100), "IN_PROGRESS");
  assert.equal(cupPhase({ ...base, status: "DRAFT" }, 1500), "DRAFT");
  assert.equal(cupPhase({ ...base, status: "CANCELLED" }, 1500), "CANCELLED");
  const w = roundWindow(Date.UTC(2026, 9, 10, 18), 60, 3);
  assert.equal(w.deadlineAt - w.availableAt, 3_600_000);
  assert.equal(w.availableAt, Date.UTC(2026, 9, 10, 20));
  assert.equal(displayState("READY", 10, 20, 25), "NO_SHOW_PENDING");
  assert.equal(displayState("READY", 10, 20, 5), "WAITING_WINDOW");
  assert.equal(displayState("READY", 10, 20, 15), "READY");
  assert.equal(displayState("ACTIVE", 10, 20, 25), "ACTIVE", "una partida en curso no vence: la juega el reloj F72.8");
});

test("CUP-B11 · validación del panel: fechas, mínimo/máximo, máximo soportado, ventana imposible, nombre y reglas", () => {
  const now = Date.UTC(2026, 9, 5);
  const ok = { slug: "valorosters-open-1", name: "Valorosters Open #1", description: "", rules: "Eliminación directa, mejor de una.", registrationOpenAt: "2026-10-10T18:00:00Z", registrationCloseAt: "2026-10-12T18:00:00Z", startsAt: "2026-10-12T19:00:00Z", minParticipants: 4, maxParticipants: 64, roundWindowMinutes: 1440, visibility: "PUBLIC" as const };
  assert.equal(validateCupDraft(ok, now, { forPublish: true }).ok, true);
  const fields = (o: object, p = true) => { const r = validateCupDraft({ ...ok, ...o }, now, { forPublish: p }); return r.ok ? [] : r.errors.map((e) => e.field); };
  assert.ok(fields({ registrationOpenAt: "2026-10-13T00:00:00Z" }).includes("dates"));
  assert.ok(fields({ startsAt: "2026-10-11T00:00:00Z" }).includes("dates"));
  assert.ok(fields({ minParticipants: 16, maxParticipants: 8 }).includes("minParticipants"));
  assert.ok(fields({ maxParticipants: 128 }).includes("maxParticipants"), "máximo no soportado");
  assert.ok(fields({ minParticipants: 2 }).includes("minParticipants"));
  assert.ok(fields({ roundWindowMinutes: 5 }).includes("roundWindowMinutes"));
  assert.ok(fields({ roundWindowMinutes: 10080, maxParticipants: 64 }).includes("schedule"), "6 rondas × 7 días > 30 días");
  assert.ok(fields({ name: "  " }).includes("name"));
  assert.ok(fields({ rules: "" }).includes("rules"), "publicar sin reglas");
  assert.deepEqual(fields({ rules: "" }, false), [], "un borrador puede no tener reglas todavía");
  assert.ok(fields({ registrationCloseAt: "2026-10-04T00:00:00Z", registrationOpenAt: "2026-10-01T00:00:00Z" }).includes("registrationCloseAt"), "no se publica un torneo ya cerrado");
  assert.ok(fields({ slug: "Mal Slug" }).includes("slug"));
  assert.ok(fields({ registrationOpenAt: "mañana" }).includes("registrationOpenAt"));
});
