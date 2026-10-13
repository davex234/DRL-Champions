/**
 * PACK WALKOUT 0.1 · la escena es determinista, saltable, repetible y no deja nada vivo.
 *
 *   W01–W04 timeline: misma entrada → mismos beats, orden narrativo, rangos de duración por intensidad, reducido corto
 *   W05–W09 controlador (reloj falso): cues una sola vez, SALTAR sin reloj, REPETIR, congelar, nada tras desmontar
 *   W10–W12 input: cartas REALES, bandera solo nacional, equipo impreso con logo o siglas, nada inventado
 *   W13–W14 escenario: respaldo 2D (sin WebGL, contexto perdido, fallo de carga, equipo modesto, reducido)
 *   W15–W16 audio: un cue por beat con sonido, `stopAll` corta todo, sin contexto no suena nada
 *   W17–W19 DOM final: nombre, media, equipo y rol presentes; asset roto → respaldo; reducido sin caídas
 *   W20     aislamiento: ni economía, ni API, ni store de juego, ni fetch; ruta dentro del arnés 404 en producción
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BEAT_TABLES, WALKOUT_INTENSITIES, beatsCrossed, buildTimeline, frameAt, heavyDrop, type BeatId } from "@/domain/walkout/timeline";
import { EDITION_PRESETS, editionPreset, walkoutInputFromCard } from "@/domain/walkout/input";
import { WalkoutController, type FrameScheduler } from "@/lib/walkout/controller";
import { CUE_OF_BEAT, WalkoutAudio } from "@/lib/walkout/audio";
import { chooseStage, dprCapFor, isLowEnd } from "@/lib/walkout/stageChoice";
import { DESIGNED_EDITIONS } from "@/domain/cards/variants";
import { getCard, getPlayer } from "@/data/catalog";
import { qaHarnessBlocked } from "@/domain/ops/edge";
import { FlagPiece, RatingPiece, RolePiece, TeamPiece, NamePiece, WalkoutSummary, type WalkoutLayout } from "./Reveals";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const WIDE: WalkoutLayout = { tall: false, w: 1440, h: 900 };
const input = (id: string) => { const c = getCard(id)!; return walkoutInputFromCard(c, getPlayer(c.playerId)); };

/** Reloj falso: los fotogramas se entregan a mano con el instante que diga el test. */
function fakeScheduler() {
  let next = 1; const q = new Map<number, (now: number) => void>();
  const s: FrameScheduler & { tick: (now: number) => void; size: () => number } = {
    request: (cb) => { const id = next++; q.set(id, cb); return id; },
    cancel: (id) => { q.delete(id); },
    tick: (now) => { const cbs = [...q.values()]; q.clear(); cbs.forEach((cb) => cb(now)); },
    size: () => q.size,
  };
  return s;
}

/* ───────── timeline ───────── */

test("W01 · determinista: la misma intensidad da los mismos beats y el mismo fotograma en el mismo instante", () => {
  for (const i of WALKOUT_INTENSITIES) {
    assert.deepEqual(buildTimeline(i), buildTimeline(i));
    const tl = buildTimeline(i);
    for (const t of [0, 0.5, 1.7, 3.33, tl.duration]) assert.deepEqual(frameAt(tl, t), frameAt(tl, t));
  }
});

test("W02 · orden narrativo: sobre → apagón → luces → … → OVR (primero parcial) → flash → nombre → carta → final", () => {
  const ORDER: BeatId[] = ["pack", "open", "blackout", "lights", "human", "flag", "role", "team", "edition", "celebrate", "ovrFirst", "ovrFull", "flash", "name", "card", "final"];
  for (const i of WALKOUT_INTENSITIES) {
    const ids = buildTimeline(i).beats.map((b) => b.id);
    const expected = ORDER.filter((id) => ids.includes(id));
    assert.deepEqual(ids, expected, i);
  }
  const w = buildTimeline("WALKOUT");
  // Walkout 0.2: 0–2 sobre · 2–3 luces y figura · 3–7 paseo con pistas · 7–9 se detiene, edición y media · 9–11 clímax
  assert.deepEqual(BEAT_TABLES.WALKOUT.ovrFirst?.[0], 9.7);
  assert.equal(w.duration, 12.6, "0.3: la celebración alarga la escena hasta 12,6 s");
  const at = (id: BeatId) => BEAT_TABLES.WALKOUT[id]![0];
  assert.ok(at("lights") >= 2 && at("lights") < 3 && at("flag") >= 3 && at("team") < 7 && at("edition") >= 7);
  // 0.3: se detiene, CELEBRA (la media entra a su lado durante la celebración) y después el clímax
  assert.ok(at("celebrate") >= 8 && at("celebrate") < at("ovrFirst") && at("flash") > at("celebrate") + 2);
});

test("W03 · duración por intensidad dentro de su rango; persona y equipo solo en WALKOUT/MEGA", () => {
  const RANGE = { STANDARD: [2, 3], RARE: [4, 6], WALKOUT: [10, 13.5], MEGA_WALKOUT: [12, 15.5] } as const;
  for (const i of WALKOUT_INTENSITIES) {
    const tl = buildTimeline(i);
    assert.ok(tl.duration >= RANGE[i][0] && tl.duration <= RANGE[i][1], `${i}: ${tl.duration}`);
  }
  assert.equal(buildTimeline("STANDARD").walk, false);
  assert.equal(buildTimeline("RARE").walk, false);
  assert.equal(buildTimeline("RARE").human, "stand", "0.3: en RARE la persona ya está en la plataforma (pose breve)");
  assert.equal(buildTimeline("STANDARD").human, null);
  assert.equal(buildTimeline("WALKOUT").walk, true);
  assert.equal(buildTimeline("MEGA_WALKOUT").walk, true);
  assert.equal(heavyDrop(0), 1); assert.ok(Math.abs(heavyDrop(1)) < 1e-9, "la caída termina en su sitio");
});

test("W04 · movimiento reducido: sin paseo ni sobre, corto, con bandera·rol·equipo·OVR·carta", () => {
  for (const i of WALKOUT_INTENSITIES) {
    const tl = buildTimeline(i, { reduced: true });
    const ids = tl.beats.map((b) => b.id);
    assert.equal(tl.walk, false);
    assert.ok(tl.duration <= 4, `${i} reducido: ${tl.duration}`);
    for (const id of ["flag", "role", "team", "ovrFull", "card"] as BeatId[]) assert.ok(ids.includes(id), id);
    for (const id of ["human", "pack", "open", "flash"] as BeatId[]) assert.ok(!ids.includes(id), `sin ${id}`);
  }
});

/* ───────── controlador ───────── */

test("W05 · cada beat dispara su cue UNA vez, en orden, y termina en done", () => {
  const tl = buildTimeline("WALKOUT");
  const s = fakeScheduler(); const cues: BeatId[] = []; let done = 0;
  const c = new WalkoutController(tl, { onCue: (b) => cues.push(b), onDone: () => done++ }, s);
  c.play();
  s.tick(1000);                               // el primer fotograma fija el origen
  for (let ms = 1016; ms <= 1000 + 14000; ms += 16) s.tick(ms);   // 0.3: el final está en 12,6 s
  assert.deepEqual(cues, tl.beats.filter((b) => b.at > 0).map((b) => b.id));
  assert.equal(done, 1);
  assert.equal(c.status, "done");
  assert.equal(c.pending, false, "terminada: sin reloj");
  assert.deepEqual(beatsCrossed(tl, 0, 0.4), ["pack"]);
});

test("W06 · SALTAR: fotograma final con todo revelado, ningún cue más, ningún fotograma programado", () => {
  const tl = buildTimeline("MEGA_WALKOUT");
  const s = fakeScheduler(); const cues: BeatId[] = []; let last = frameAt(tl, 0);
  const c = new WalkoutController(tl, { onCue: (b) => cues.push(b), onFrame: (f) => { last = f; } }, s);
  c.play(); s.tick(0); s.tick(2000);
  const before = cues.length;
  c.skip();
  assert.equal(c.pending, false);
  assert.equal(s.size(), 0);
  assert.equal(last.done, true);
  for (const b of tl.beats) assert.equal(last.p[b.id], 1, `${b.id} revelado`);
  s.tick(99999);
  assert.equal(cues.length, before, "nada suena tras saltar");
});

test("W07 · REPETIR: vuelve a 0 y suena todo otra vez (sin duplicar relojes)", () => {
  const tl = buildTimeline("RARE");
  const s = fakeScheduler(); const cues: BeatId[] = [];
  const c = new WalkoutController(tl, { onCue: (b) => cues.push(b) }, s);
  c.play(); s.tick(0); s.tick(6000);
  const first = cues.length;
  c.reset(); assert.equal(c.time, 0); assert.equal(c.status, "idle");
  c.play(); c.play();                         // doble pulsación: un solo reloj
  assert.equal(s.size(), 1);
  s.tick(10000); s.tick(16000);
  assert.equal(cues.length, first * 2);
});

test("W08 · congelar un instante: un fotograma, sin reloj ni cues", () => {
  const tl = buildTimeline("WALKOUT");
  const s = fakeScheduler(); const cues: BeatId[] = []; let f = frameAt(tl, 0);
  const c = new WalkoutController(tl, { onCue: (b) => cues.push(b), onFrame: (x) => { f = x; } }, s);
  c.seek(6.0);
  assert.equal(f.t, 6.0); assert.equal(c.pending, false); assert.equal(cues.length, 0);
  assert.ok((f.p.team ?? 0) > 0 && (f.p.card ?? 0) === 0);
});

test("W09 · desmontar (dispose): ni fotogramas ni cues ni done después — y no se puede relanzar", () => {
  const tl = buildTimeline("WALKOUT");
  const s = fakeScheduler(); let calls = 0;
  const c = new WalkoutController(tl, { onCue: () => calls++, onFrame: () => calls++, onDone: () => calls++ }, s);
  c.play(); s.tick(0); s.tick(500);
  const at = calls;
  c.dispose();
  assert.equal(c.pending, false); assert.equal(s.size(), 0);
  s.tick(20000); c.play(); c.skip(); c.reset(); c.seek(3);
  assert.equal(calls, at); assert.equal(s.size(), 0);
});

/* ───────── input ───────── */

test("W10 · cartas reales de cada edición diseñada → input completo, preset propio por edición", () => {
  for (const ed of DESIGNED_EDITIONS) assert.ok(EDITION_PRESETS[ed], `preset de ${ed}`);
  assert.equal(editionPreset("no-existe"), EDITION_PRESETS.base);
  const fs = input("lar0k__future-star");
  assert.equal(fs.ovr, 95); assert.equal(fs.edition.id, "future-star"); assert.equal(fs.role, "Flex"); assert.equal(fs.roleAbbr, "FLX");
  assert.equal(fs.flag?.iso, "TR"); assert.equal(fs.flag?.src, "/flags/tr.svg");
  assert.equal(fs.team.logoSrc, "/hints/teams/bbl.png");
});

test("W11 · equipo sin logo: siglas impresas (nunca un nombre recortado) · sin logo inventado", () => {
  const prx = input("f0rsaken__base");
  assert.equal(prx.team.logoSrc, null);
  assert.equal(prx.team.tag, "PRX");
  const html = renderToStaticMarkup(<TeamPiece frame={frameAt(buildTimeline("WALKOUT"), buildTimeline("WALKOUT").duration)} input={prx} layout={WIDE} reduced={false} failed={false} />);
  assert.match(text(html), /PRX/); assert.doesNotMatch(text(html), /\bPAPE\b/);
  assert.doesNotMatch(html, /<img/);
});

test("W12 · bandera solo si el país es una nacionalidad real; si no, el emblema de región", () => {
  const c = getCard("lar0k__future-star")!; const p = getPlayer(c.playerId)!;
  const noFlag = walkoutInputFromCard(c, { ...p, country: "EU" });
  assert.equal(noFlag.flag, null);
  const html = renderToStaticMarkup(<FlagPiece frame={frameAt(buildTimeline("WALKOUT"), buildTimeline("WALKOUT").duration)} input={noFlag} layout={WIDE} reduced={false} failed={false} />);
  assert.match(html, /Región: EMEA/); assert.doesNotMatch(html, /<img/);
});

/* ───────── escenario ───────── */

test("W13 · respaldo 2D: sin WebGL, contexto perdido, fallo de carga, equipo modesto o reducido", () => {
  const ok = { webgl: true, reduced: false, lowEnd: false };
  assert.equal(chooseStage(ok), "3d");
  assert.equal(chooseStage({ ...ok, webgl: false }), "2d");
  assert.equal(chooseStage({ ...ok, contextLost: true }), "2d");
  assert.equal(chooseStage({ ...ok, loadFailed: true }), "2d");
  assert.equal(chooseStage({ ...ok, lowEnd: true }), "2d");
  assert.equal(chooseStage({ ...ok, reduced: true }), "2d");
  assert.equal(chooseStage({ ...ok, forced: "2d" }), "2d");
  assert.equal(chooseStage({ ...ok, webgl: false, forced: "3d" }), "2d", "forzar 3D no inventa WebGL");
  assert.equal(chooseStage({ ...ok, contextLost: true, forced: "3d" }), "2d");
});

test("W14 · equipo modesto y DPR con tope", () => {
  assert.equal(isLowEnd({ hardwareConcurrency: 2 }), true);
  assert.equal(isLowEnd({ deviceMemory: 2 }), true);
  assert.equal(isLowEnd({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(isLowEnd({}), false);
  assert.equal(dprCapFor(390), 1.25); assert.equal(dprCapFor(1440), 1.5);
});

/* ───────── audio ───────── */

function fakeAudio() {
  const live: { stopped: boolean }[] = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect() {} });
  const source = () => { const n = { ...node(), stopped: false, onended: null as unknown, start() {}, stop() { n.stopped = true; }, frequency: param(), type: "", buffer: null }; live.push(n); return n; };
  const ac = {
    currentTime: 0, sampleRate: 8000, destination: {},
    createOscillator: source, createBufferSource: source,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param(), Q: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ac: ac as unknown as AudioContext, live };
}

test("W15 · un cue por beat sonoro; stopAll corta todo lo programado (SALTAR / REPETIR / salir)", () => {
  const { ac, live } = fakeAudio();
  const a = new WalkoutAudio(() => ac);
  for (const b of buildTimeline("MEGA_WALKOUT").beats) { const cue = CUE_OF_BEAT[b.id]; if (cue) a.play(cue, { steps: 8, stepEvery: 0.5 }); }
  assert.ok(live.length > 10);
  a.stopAll();
  assert.ok(live.every((n) => n.stopped), "todo parado");
  for (const id of ["open", "human", "flag", "role", "team", "ovrFirst", "flash", "card"] as BeatId[]) assert.ok(CUE_OF_BEAT[id], `cue de ${id}`);
});

test("W16 · sin contexto (sin gesto) o desactivado: no suena nada", () => {
  const silent = new WalkoutAudio(() => null);
  assert.doesNotThrow(() => silent.play("teamImpact"));
  const { ac, live } = fakeAudio();
  const off = new WalkoutAudio(() => ac);
  off.setEnabled(false); off.play("revealHit");
  assert.equal(live.length, 0);
});

/* ───────── DOM final ───────── */

test("W17 · estado final: nombre, media, equipo, rol, edición y país en el DOM", () => {
  const fs = input("lar0k__future-star");
  const t = text(renderToStaticMarkup(<WalkoutSummary input={fs} />));
  for (const s of ["Lar0k", "Media 95", "Equipo BBL Esports", "Rol Flex", "Edición Future Star", "País Turquía"]) assert.ok(t.includes(s), s);
  const end = frameAt(buildTimeline("WALKOUT"), buildTimeline("WALKOUT").duration);
  const pieces = text(renderToStaticMarkup(<>
    <RolePiece frame={end} input={fs} layout={WIDE} reduced={false} accent="#fff" />
    <RatingPiece frame={end} input={fs} layout={WIDE} reduced={false} preset={editionPreset("future-star")} />
    <NamePiece frame={end} input={fs} layout={WIDE} reduced={false} />
  </>));
  assert.match(pieces, /Flex/); assert.match(pieces, /95/); assert.match(pieces, /Lar0k/);
});

test("W18 · asset roto (bandera/logo): la pieza usa su respaldo y la escena sigue", () => {
  const fs = input("lar0k__future-star");
  const end = frameAt(buildTimeline("WALKOUT"), buildTimeline("WALKOUT").duration);
  const flag = renderToStaticMarkup(<FlagPiece frame={end} input={fs} layout={WIDE} reduced={false} failed />);
  const team = renderToStaticMarkup(<TeamPiece frame={end} input={fs} layout={WIDE} reduced={false} failed />);
  assert.doesNotMatch(flag, /<img/); assert.match(flag, /EMEA/);
  assert.doesNotMatch(team, /<img/); assert.match(text(team), /BBL/);
});

test("W19 · la OVR va primero parcial («9») y después entera; reducido sin caídas ni desplazamientos", () => {
  const fs = input("lar0k__future-star"); const tl = buildTimeline("WALKOUT");
  const partial = text(renderToStaticMarkup(<RatingPiece frame={frameAt(tl, 9.9)} input={fs} layout={WIDE} reduced={false} preset={editionPreset("future-star")} />));
  assert.match(partial, /\b9\b/); assert.doesNotMatch(partial, /95/);
  const r = buildTimeline("WALKOUT", { reduced: true });
  const html = renderToStaticMarkup(<FlagPiece frame={frameAt(r, 0.2)} input={fs} layout={WIDE} reduced failed={false} />);
  assert.match(html, /translate\(0vw, 0vh\)/, "sin caída con movimiento reducido");
});

/* ───────── aislamiento ───────── */

test("W20 · sin economía, API, store de juego ni fetch; prototipo dentro del arnés (404 en producción)", () => {
  const files = [
    ...readdirSync(join(process.cwd(), "src/components/walkout")).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => `src/components/walkout/${f}`),
    "src/lib/walkout/controller.ts", "src/lib/walkout/audio.ts", "src/lib/walkout/stageChoice.ts",
    "src/domain/walkout/timeline.ts", "src/domain/walkout/input.ts", "src/domain/walkout/walk.ts", "src/domain/walkout/celebration.ts", "src/domain/walkout/countryTheme.ts", "src/app/design-system/pack-walkout/page.tsx",
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\bfetch\s*\(|\/api\/|useGameStore|@\/store\/|economy|supabase|serverOpen|openPack|grant|credits/i, f);
  }
  // three.js solo entra por el escenario 3D y su persona (import dinámico desde WalkoutStage; 0.2: human3d, ver H12)
  for (const f of files.filter((x) => !/(stage3d|human3d|arena3d)\.ts$/.test(x))) assert.doesNotMatch(read(f), /from "three"/, f);
  assert.match(read("src/components/walkout/WalkoutStage.tsx"), /import\("\.\/stage3d"\)/);
  const req = (path: string, env: Record<string, string | undefined>) => qaHarnessBlocked(path, env as NodeJS.ProcessEnv);
  assert.equal(req("/design-system/pack-walkout", { NODE_ENV: "production" }), true);
  assert.equal(req("/design-system/pack-walkout", { NODE_ENV: "production", NEXUS_QA_HARNESS: "1" }), false);
});

test("W21 · 0.2: con la persona en escena ninguna pista entra sobre ella (bandera, rol y escudo a su lado; la media a su derecha) y el escudo se retira tras el impacto", () => {
  const fs = input("lar0k__future-star"); const tl = buildTimeline("WALKOUT");
  const left = (h: string) => Number(/left: ?([\d.]+)%/.exec(h)?.[1]);
  const at = (t: number) => frameAt(tl, t);
  for (const [t, el] of [
    [3.8, <FlagPiece key="f" frame={at(3.8)} input={fs} layout={WIDE} reduced={false} failed={false} walk />],
    [4.9, <RolePiece key="r" frame={at(4.9)} input={fs} layout={WIDE} reduced={false} accent="#fff" walk />],
    [6.1, <TeamPiece key="t" frame={at(6.1)} input={fs} layout={WIDE} reduced={false} failed={false} walk />],
  ] as const) assert.ok(left(renderToStaticMarkup(el)) < 35, `pieza a ${t} s lejos del centro`);
  assert.ok(left(renderToStaticMarkup(<RatingPiece frame={at(9.9)} input={fs} layout={WIDE} reduced={false} preset={editionPreset("future-star")} walk />)) > 65, "media a la derecha");
  // sin persona (RARE/STANDARD o 0.1) siguen entrando al centro
  assert.equal(left(renderToStaticMarkup(<RatingPiece frame={at(9.9)} input={fs} layout={WIDE} reduced={false} preset={editionPreset("future-star")} />)), 50);
  const docked = renderToStaticMarkup(<TeamPiece frame={at(7.2)} input={fs} layout={WIDE} reduced={false} failed={false} walk retreat={1} />);
  assert.equal(left(docked), 12, "escudo en su carril");
});
