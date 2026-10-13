/**
 * FASE 44 · XP que sube, momentos de juego, momentos de equipo y ajustes de sonido (todo puro).
 * Incluye el FUZZER DE MOVIMIENTO de la cola de momentos (10.000 secuencias).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, totalXpForLevel } from "@/domain/progression/levels";
import { xpAnimationMs, xpTimeline } from "./xp";
import { EMPTY_MOMENTS, MAX_QUEUE, MOMENT_COPY, momentDuration, momentsFromProgress, momentsReducer, type Moment, type MomentKind, type MomentState } from "./moments";
import { deckActiveMoment, deckReadyMoment } from "./deckMoments";
import { DEFAULT_AUDIO, effectiveGain, parseAudioSettings, SOUND_EVENTS } from "@/lib/sound";

/* ───────────── XP ───────────── */

test("XP · sin ganancia: un tramo quieto, sin subida", () => {
  const t = xpTimeline(500, 0);
  assert.equal(t.gained, 0); assert.equal(t.levelUp, false); assert.equal(t.segments.length, 1);
  assert.equal(t.segments[0].from, t.segments[0].to);
});
test("XP · dentro del nivel: del valor anterior real al nuevo real", () => {
  const base = totalXpForLevel(6);
  const t = xpTimeline(base + 200, 100);
  const before = levelFromXp(base + 100), after = levelFromXp(base + 200);
  assert.equal(t.segments.length, 1);
  assert.equal(t.segments[0].from, before.progress); assert.equal(t.segments[0].to, after.progress);
  assert.equal(t.levelUp, false);
});
test("XP · cruza un nivel: dos tramos y SUBIDA DE NIVEL con el nivel real", () => {
  const t = xpTimeline(totalXpForLevel(8) + 40, 110);
  assert.equal(t.levelUp, true); assert.equal(t.levelsGained, 1);
  assert.equal(t.before.level, 7); assert.equal(t.after.level, 8);
  assert.equal(t.segments[0].to, 1); assert.equal(t.segments[1].from, 0);
});
test("XP · varios niveles: un tramo completo por nivel intermedio", () => {
  const t = xpTimeline(totalXpForLevel(10) + 5, totalXpForLevel(10) + 5 - (totalXpForLevel(6) + 10));
  assert.equal(t.before.level, 6); assert.equal(t.after.level, 10); assert.equal(t.levelsGained, 4);
  assert.equal(t.segments.length, 5);
  for (const s of t.segments.slice(1, -1)) { assert.equal(s.from, 0); assert.equal(s.to, 1); }
});
test("XP · entradas imposibles se recortan (sin NaN, sin barra hacia atrás)", () => {
  for (const [x, g] of [[NaN, 10], [100, NaN], [-5, 10], [100, -30], [50, 999]] as const) {
    const t = xpTimeline(x, g);
    for (const s of t.segments) { assert.ok(s.from >= 0 && s.to <= 1 && s.to >= s.from, JSON.stringify(s)); }
    assert.ok(t.gained >= 0 && t.after.xp >= t.before.xp);
  }
});
test("XP · animación acotada a 1,2 s y 0 con movimiento reducido", () => {
  const t = xpTimeline(totalXpForLevel(20), totalXpForLevel(20) - 10);
  assert.ok(xpAnimationMs(t, false) <= 1200); assert.equal(xpAnimationMs(t, true), 0);
});
test("XP · propiedad: 2.000 pares aleatorios coherentes con la curva canónica", () => {
  let seed = 44;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const after = Math.floor(rnd() * 60000), gained = Math.floor(rnd() * 3000);
    const t = xpTimeline(after, gained);
    assert.equal(t.after.level, levelFromXp(after).level);
    assert.equal(t.before.level, levelFromXp(after - t.gained).level);
    assert.equal(t.levelUp, t.after.level > t.before.level);
    assert.equal(t.segments.length, t.gained === 0 ? 1 : t.after.level - t.before.level + 1);
  }
});

/* ───────────── momentos ───────────── */

const m = (key: string, kind: MomentKind = "objective"): Moment => ({ key, kind, fact: `hecho ${key}` });

test("MOMENTOS · uno visible a la vez; el resto en cola", () => {
  let s = momentsReducer(EMPTY_MOMENTS, { type: "push", moment: m("a"), now: 0 });
  s = momentsReducer(s, { type: "push", moment: m("b"), now: 1 });
  assert.equal(s.visible?.key, "a"); assert.deepEqual(s.queue.map((q) => q.key), ["b"]);
});
test("MOMENTOS · caduca solo y entra el siguiente", () => {
  let s = momentsReducer(EMPTY_MOMENTS, { type: "push", moment: m("a"), now: 0 });
  s = momentsReducer(s, { type: "push", moment: m("b"), now: 0 });
  s = momentsReducer(s, { type: "tick", now: 10_000 });
  assert.equal(s.visible?.key, "b");
});
test("MOMENTOS · el mismo hecho no se celebra dos veces", () => {
  let s = momentsReducer(EMPTY_MOMENTS, { type: "push", moment: m("a"), now: 0 });
  s = momentsReducer(s, { type: "dismiss", now: 1 });
  s = momentsReducer(s, { type: "push", moment: m("a"), now: 2 });
  assert.equal(s.visible, null);
});
test("MOMENTOS · sin hecho no hay momento (no se inventa)", () => {
  const s = momentsReducer(EMPTY_MOMENTS, { type: "push", moment: { key: "x", kind: "objective", fact: "" }, now: 0 });
  assert.equal(s.visible, null);
});
test("MOMENTOS · cola acotada", () => {
  let s: MomentState = EMPTY_MOMENTS;
  for (let i = 0; i < 20; i++) s = momentsReducer(s, { type: "push", moment: m(`k${i}`), now: 0 });
  assert.ok(s.queue.length <= MAX_QUEUE);
});
for (const kind of Object.keys(MOMENT_COPY) as MomentKind[]) {
  test(`MOMENTOS · ${kind}: copy de juego y nivel 2–3 (nunca «Success»)`, () => {
    const c = MOMENT_COPY[kind];
    assert.ok(c.level >= 2 && c.level <= 3);
    assert.ok(!/success|updated|saved|actualizado correctamente/i.test(c.title));
    assert.ok(momentDuration(kind, false) <= 3200 && momentDuration(kind, true) <= 3200);
  });
}
test("MOMENTOS · desde eventos reales del servidor: objetivo, logro y nivel; sin momento de sobre", () => {
  const out = momentsFromProgress([
    { id: "level:7", kind: "LEVEL_UP", text: "¡Nivel 7!" },
    { id: "objective:d1:9", kind: "OBJECTIVE_COMPLETE", text: "Objetivo completado · Gana un duelo" },
    { id: "achievement:a1", kind: "ACHIEVEMENT", text: "Logro conseguido · Primera victoria" },
    { id: "pack:x", kind: "PACK_REWARD", text: "Sobre" },
  ]);
  assert.deepEqual(out.map((o) => o.kind), ["level-up", "objective", "achievement"]);
  assert.equal(out[0].fact, "Nivel 7"); assert.equal(out[1].fact, "Gana un duelo"); assert.equal(out[2].key, "achievement:a1");
});

test("FUZZ DE MOVIMIENTO · 10.000 secuencias: nunca atascado, nunca dos visibles, siempre caduca", () => {
  let seed = 4404;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const kinds = Object.keys(MOMENT_COPY) as MomentKind[];
  let violations = 0;
  for (let run = 0; run < 10_000; run++) {
    let s: MomentState = EMPTY_MOMENTS;
    let now = 0;
    const reduced = rnd() < 0.3;
    for (let step = 0; step < 12; step++) {
      now += Math.floor(rnd() * 1500);
      const r = rnd();
      s = r < 0.45 ? momentsReducer(s, { type: "push", moment: { key: `k${Math.floor(rnd() * 8)}`, kind: kinds[Math.floor(rnd() * kinds.length)], fact: "hecho" }, now, reduced })
        : r < 0.6 ? momentsReducer(s, { type: "dismiss", now, reduced })
          : r < 0.62 ? momentsReducer(s, { type: "reset" })
            : momentsReducer(s, { type: "tick", now, reduced });
      if (s.queue.length > MAX_QUEUE) violations++;
      if (s.visible && s.visible.expiresAt - s.visible.shownAt > 3200) violations++;
      if (!s.visible && s.queue.length > 0) violations++; // nada espera si no hay nada visible
    }
    // Drenaje: con tiempo suficiente todo termina; ningún rótulo queda pegado.
    for (let i = 0; i < MAX_QUEUE + 2; i++) { now += 4000; s = momentsReducer(s, { type: "tick", now, reduced }); }
    if (s.visible || s.queue.length) violations++;
  }
  assert.equal(violations, 0);
});

/* ───────────── equipo ───────────── */

test("PLANTILLA LISTA · de incompleto a legal", () => {
  const mo = deckReadyMoment(false, { id: "d", name: "Equipo 2", valid: true, version: "v2" });
  assert.equal(mo?.kind, "deck-ready"); assert.match(mo!.fact, /Equipo 2/);
});
test("PLANTILLA LISTA · equipo nuevo ya legal", () => { assert.equal(deckReadyMoment(null, { id: "d", name: "E", valid: true })?.kind, "deck-ready"); });
test("PLANTILLA LISTA · guardar uno que ya era legal no repite", () => { assert.equal(deckReadyMoment(true, { id: "d", name: "E", valid: true }), null); });
test("PLANTILLA LISTA · guardar incompleto no celebra", () => { assert.equal(deckReadyMoment(false, { id: "d", name: "E", valid: false }), null); });
test("PLANTILLA LISTA · sin recompensa", () => { assert.equal(deckReadyMoment(false, { id: "d", name: "E", valid: true })?.reward, null); });
test("EQUIPO ACTIVO · momento con el nombre real", () => {
  const mo = deckActiveMoment({ id: "d", name: "Equipo 1", valid: true }, 5);
  assert.equal(mo.kind, "deck-active"); assert.match(mo.fact, /Equipo 1/); assert.equal(mo.key, "deck-active:d:5");
});

/* ───────────── sonido ───────────── */

test("SONIDO · ajustes por defecto sin nada guardado", () => { assert.deepEqual(parseAudioSettings(null), DEFAULT_AUDIO); });
test("SONIDO · basura guardada → valores por defecto", () => { assert.deepEqual(parseAudioSettings("{no json"), DEFAULT_AUDIO); });
test("SONIDO · volúmenes recortados a 0..1", () => {
  const s = parseAudioSettings(JSON.stringify({ master: 7, sfx: -2, muted: "yes" }));
  assert.equal(s.master, 1); assert.equal(s.sfx, 0); assert.equal(s.muted, false);
});
test("SONIDO · silencio → ganancia 0; general × efectos", () => {
  assert.equal(effectiveGain({ master: 1, sfx: 1, muted: true }), 0);
  assert.equal(effectiveGain({ master: 0.5, sfx: 0.5, muted: false }), 0.25);
});
test("SONIDO · eventos del encargo, todos sintetizados (sin ficheros)", () => {
  // Fase 44.1 amplía el catálogo: los nueve de Fase 44 siguen todos.
  for (const k of ["card.epic", "card.legendary", "card.rare", "level.up", "match.loss", "match.win", "pack.open", "ui.confirm", "ui.hover"]) assert.ok(k in SOUND_EVENTS, k);
  assert.equal(SOUND_EVENTS["card.legendary"].level, 4); assert.equal(SOUND_EVENTS["ui.hover"].level, 1);
});
