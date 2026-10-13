/**
 * FASE 44.1 · AUDIO (29–50) — un único gestor de música, original y procedural; efectos con catálogo completo; ajustes
 * de música y efectos independientes; nada suena sin gesto. Incluye un fuzzer de 20.000 eventos del estado de música.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  barEvents, barSeconds, createRateGate, crossfadeMs, CROSSFADE_MAX_MS, CROSSFADE_MIN_MS, DUCK_LEVEL, HOVER_SOUND_MIN_MS,
  INITIAL_MUSIC, MAX_EVENTS_PER_BAR, midiToHz, MUSIC_CONTEXTS, MUSIC_THEMES, musicContextForPath, musicPlan, musicReducer,
  packMusicDuck, scaleMidi, type MusicContext, type MusicEvent, type MusicState,
} from "./music";
import { DEFAULT_AUDIO, effectiveGain, musicGain, parseAudioSettings, SOUND_EVENTS } from "@/lib/sound";
import { AudioSettingsPanel, AUDIO_CHANNELS } from "@/components/ui/game/AudioSettingsPanel";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const run = (events: MusicEvent[], s: MusicState = INITIAL_MUSIC) => events.reduce(musicReducer, s);

/* ───────────── contextos y temas ───────────── */

test("AUDIO 29 · los nueve contextos del encargo, cada uno con su tema", () => {
  assert.deepEqual([...MUSIC_CONTEXTS], ["LOBBY", "COLLECTION", "PACKS", "DECKS", "CAMPAIGN", "DRAFT", "RANKED", "MATCH", "RESULT"]);
  for (const c of MUSIC_CONTEXTS) assert.equal(MUSIC_THEMES[c].context, c);
});

test("AUDIO 30 · temas válidos: tempo 60–130, modo de 7 notas ascendente dentro de la octava, progresión en escala", () => {
  for (const t of Object.values(MUSIC_THEMES)) {
    assert.ok(t.bpm >= 60 && t.bpm <= 130, t.context);
    assert.equal(t.mode.length, 7);
    assert.equal(t.mode[0], 0);
    for (let i = 1; i < 7; i++) assert.ok(t.mode[i] > t.mode[i - 1] && t.mode[i] < 12);
    for (const d of t.progression) assert.ok(d >= 0 && d <= 6);
    assert.ok(t.level > 0 && t.level <= 0.6, "la música acompaña, nunca tapa");
    assert.ok(t.cutoff >= 300 && t.cutoff <= 4000);
  }
});

test("AUDIO 31 · la partida es la sala más movida y el resultado resuelve en mayor sin pulso", () => {
  assert.ok(MUSIC_THEMES.MATCH.bpm > MUSIC_THEMES.LOBBY.bpm);
  assert.equal(MUSIC_THEMES.MATCH.pulse, "drive");
  assert.equal(MUSIC_THEMES.RESULT.pulse, "none");
  assert.deepEqual([...MUSIC_THEMES.RESULT.mode], [0, 2, 4, 5, 7, 9, 11]);
  assert.ok(MUSIC_THEMES.MATCH.level < MUSIC_THEMES.LOBBY.level, "en partida la música baja para no tapar los cues");
});

test("AUDIO 32 · rutas → contexto (sala a sala) y silencio en admin y arnés", () => {
  const cases: [string, MusicContext | null][] = [
    ["/", "LOBBY"], ["/jugar", "LOBBY"], ["/coleccion", "COLLECTION"], ["/tienda", "PACKS"], ["/inventario", "PACKS"],
    ["/duelos/mazos", "DECKS"], ["/jugar/road-to-champions", "CAMPAIGN"], ["/jugar/draft-gauntlet", "DRAFT"],
    ["/duelos/competitivo", "RANKED"], ["/duelos/jugar", "MATCH"], ["/duelos/pvp/abc", "MATCH"], ["/temporada", "LOBBY"],
    ["/admin", null], ["/admin/live", null], ["/design-system/fase44-1", null],
  ];
  for (const [p, c] of cases) assert.equal(musicContextForPath(p), c, p);
});

/* ───────────── compases ───────────── */

test("AUDIO 33 · compás determinista: mismo tema y compás → mismas notas", () => {
  for (const t of Object.values(MUSIC_THEMES)) for (let b = 0; b < 16; b++) assert.deepEqual(barEvents(t, b), barEvents(t, b));
});

test("AUDIO 34 · presupuesto: ≤ 20 notas por compás, todas dentro del compás y en rango audible", () => {
  for (const t of Object.values(MUSIC_THEMES)) {
    const len = barSeconds(t);
    for (let b = 0; b < 32; b++) {
      const ev = barEvents(t, b);
      assert.ok(ev.length > 0 && ev.length <= MAX_EVENTS_PER_BAR);
      for (const n of ev) {
        assert.ok(n.at >= 0 && n.at < len, `${t.context} ${n.voice}`);
        assert.ok(n.dur > 0 && n.at + n.dur <= len + 1e-9 || n.voice === "pulse");
        const hz = midiToHz(n.midi);
        assert.ok(hz >= 20 && hz <= 5000, `${t.context} ${hz}`);
      }
    }
  }
});

test("AUDIO 35 · el pad es una tríada de la escala y el bajo cae una octava por debajo", () => {
  const t = MUSIC_THEMES.LOBBY;
  const ev = barEvents(t, 0);
  const pad = ev.filter((n) => n.voice === "pad").map((n) => n.midi);
  assert.deepEqual(pad, [scaleMidi(t, 0), scaleMidi(t, 2), scaleMidi(t, 4)]);
  assert.equal(ev.find((n) => n.voice === "bass")!.midi, scaleMidi(t, 0, -1));
});

test("AUDIO 36 · el arpegio respira cada 4.º compás (no es una cinta repetida)", () => {
  const t = MUSIC_THEMES.DRAFT;
  const arps = (b: number) => barEvents(t, b).filter((n) => n.voice === "arp").length;
  assert.ok(arps(3) < arps(0));
  assert.equal(arps(7), arps(3));
});

test("AUDIO 37 · compases absurdos (negativos, NaN) no rompen", () => {
  for (const b of [-5, Number.NaN, Infinity, 1e9]) assert.ok(barEvents(MUSIC_THEMES.MATCH, b).length > 0);
});

test("AUDIO 38 · grados fuera de la escala suben/bajan de octava con la nota correcta", () => {
  const t = MUSIC_THEMES.COLLECTION;
  assert.equal(scaleMidi(t, 7), scaleMidi(t, 0) + 12);
  assert.equal(scaleMidi(t, -1), scaleMidi(t, 6) - 12);
  assert.equal(Math.round(midiToHz(69)), 440);
});

/* ───────────── fundidos y estado ───────────── */

test("AUDIO 39 · fundidos de 500 a 1500 ms para TODOS los pares de contextos", () => {
  const all: (MusicContext | null)[] = [null, ...MUSIC_CONTEXTS];
  for (const a of all) for (const b of all) {
    const ms = crossfadeMs(a, b);
    assert.ok(ms >= CROSSFADE_MIN_MS && ms <= CROSSFADE_MAX_MS, `${a}→${b} ${ms}`);
  }
  assert.ok(crossfadeMs("LOBBY", "MATCH") < crossfadeMs("LOBBY", "COLLECTION"), "hacia la acción, más rápido");
});

test("AUDIO 40 · nada suena antes de un gesto (autoplay): sin unlock no hay contexto ni ganancia", () => {
  const s = run([{ type: "route", context: "LOBBY" }, { type: "volume", value: 0.8 }]);
  assert.deepEqual(musicPlan(s), { context: null, gain: 0 });
  assert.equal(musicPlan(run([{ type: "unlock" }], s)).context, "LOBBY");
});

test("AUDIO 41 · volumen 0 (o música silenciada) → no se programa ningún tema", () => {
  const s = run([{ type: "unlock" }, { type: "route", context: "PACKS" }, { type: "volume", value: 0 }]);
  assert.equal(musicPlan(s).context, null);
});

test("AUDIO 42 · pestaña oculta → ganancia 0 y vuelve al volver", () => {
  const on = run([{ type: "unlock" }, { type: "route", context: "LOBBY" }, { type: "volume", value: 0.5 }]);
  assert.equal(musicPlan(run([{ type: "visibility", hidden: true }], on)).gain, 0);
  assert.equal(musicPlan(run([{ type: "visibility", hidden: true }, { type: "visibility", hidden: false }], on)).gain, 0.5);
});

test("AUDIO 43 · duck con contador: sobre + stinger a la vez; solo vuelve al soltar los dos", () => {
  const on = run([{ type: "unlock" }, { type: "route", context: "PACKS" }, { type: "volume", value: 1 }]);
  const two = run([{ type: "duck", on: true }, { type: "duck", on: true }], on);
  assert.equal(musicPlan(two).gain, DUCK_LEVEL);
  assert.equal(musicPlan(run([{ type: "duck", on: false }], two)).gain, DUCK_LEVEL);
  assert.equal(musicPlan(run([{ type: "duck", on: false }, { type: "duck", on: false }], two)).gain, 1);
  assert.equal(run([{ type: "duck", on: false }], on).ducks, 0, "nunca negativo");
});

test("AUDIO 44 · el resultado impone su tema sobre la ruta y al soltarlo vuelve la sala", () => {
  const on = run([{ type: "unlock" }, { type: "route", context: "MATCH" }, { type: "volume", value: 1 }]);
  assert.equal(musicPlan(run([{ type: "override", context: "RESULT" }], on)).context, "RESULT");
  assert.equal(musicPlan(run([{ type: "override", context: "RESULT" }, { type: "override", context: null }], on)).context, "MATCH");
});

test("AUDIO 45 · la ceremonia de sobre agacha la música mientras salen las cartas", () => {
  for (const p of ["opening", "buildup", "hero", "hero_hold", "rest"]) assert.equal(packMusicDuck(p), true, p); // F81
  for (const p of ["ready", "requesting", "summary", "error", "no_pack", "recovering"]) assert.equal(packMusicDuck(p), false, p);
  assert.match(read("src", "components", "packs", "PackOpeningExperience.tsx"), /useMusicDuck\(packMusicDuck\(phase\)\)/);
});

/* ───────────── efectos ───────────── */

test("AUDIO 46 · catálogo de efectos del encargo completo; los de paso marcados como hover", () => {
  const required = ["ui.hover", "ui.confirm", "ui.back", "ui.error", "play.hover", "play.confirm", "pack.select", "pack.open", "card.reveal", "card.rare", "card.epic", "card.legendary", "serial.one", "match.turn", "match.win", "match.loss", "match.draw", "level.up", "mission.complete", "achievement.unlock"];
  // Fase 45 añade el turno resuelto (distinto del desenlace de la partida); los de Fase 44.1 siguen todos.
  const fase45 = ["turn.win", "turn.loss", "turn.tie"];
  // Fase 61 añade el ritmo de la partida (VS, equipo, eje revelado, paso de desempate); ninguno es de paso.
  const fase61 = ["match.vs", "match.lineup", "stat.reveal", "tiebreak.step"];
  // Fase 64 añade la respuesta global (acción correcta, cambio de sección, rival encontrado); ninguno es de paso.
  const fase64 = ["ui.success", "ui.nav", "match.found"];
  assert.deepEqual(Object.keys(SOUND_EVENTS).sort(), [...required, ...fase45, ...fase61, ...fase64].sort());
  const hovers = Object.entries(SOUND_EVENTS).filter(([, e]) => e.hover).map(([k]) => k).sort();
  assert.deepEqual(hovers, ["play.hover", "ui.hover"]);
  assert.equal(SOUND_EVENTS["serial.one"].level, 4);
});

test("AUDIO 47 · hover limitado: como mucho uno cada 90 ms aunque se barra el menú", () => {
  const gate = createRateGate(HOVER_SOUND_MIN_MS);
  let passed = 0;
  for (let t = 0; t < 1000; t += 5) if (gate(t)) passed++;
  assert.ok(passed <= Math.ceil(1000 / HOVER_SOUND_MIN_MS) + 1, String(passed));
  assert.ok(passed >= 10);
  assert.equal(createRateGate(90)(Number.NaN), false);
  const src = read("src", "lib", "sound.ts");
  assert.match(src, /e\.hover && \(!runningAudioContext\(\) \|\| !hoverGate\(/, "un hover nunca crea el contexto de audio");
});

/* ───────────── ajustes ───────────── */

test("AUDIO 48 · ajustes: música y efectos con volumen y silencio propios; lo guardado en Fase 44 sigue valiendo", () => {
  assert.deepEqual(DEFAULT_AUDIO, { master: 0.8, sfx: 0.8, muted: false, music: 0.5, musicMuted: false, sfxMuted: false });
  const legacy = parseAudioSettings(JSON.stringify({ master: 0.6, sfx: 0.4, muted: false }));
  assert.equal(legacy.music, 0.5); assert.equal(legacy.sfx, 0.4); assert.equal(legacy.musicMuted, false);
  const junk = parseAudioSettings(JSON.stringify({ master: 3, music: -1, musicMuted: "sí", sfxMuted: 1 }));
  assert.equal(junk.master, 1); assert.equal(junk.music, 0); assert.equal(junk.musicMuted, false); assert.equal(junk.sfxMuted, false);
  assert.deepEqual(parseAudioSettings("null"), DEFAULT_AUDIO);
  const base = { ...DEFAULT_AUDIO, master: 1, sfx: 0.5, music: 0.25 };
  assert.equal(effectiveGain({ ...base, musicMuted: true }), 0.5, "silenciar música no calla los efectos");
  assert.equal(musicGain({ ...base, sfxMuted: true }), 0.25, "silenciar efectos no calla la música");
  assert.equal(musicGain({ ...base, muted: true }), 0);
  assert.equal(effectiveGain({ ...base, muted: true }), 0);
});

test("AUDIO 49 · panel: MÚSICA y EFECTOS con deslizador 0–100 y silencio propio, operables (label/aria-pressed)", () => {
  const h = renderToStaticMarkup(<AudioSettingsPanel />);
  assert.deepEqual(AUDIO_CHANNELS.map((c) => c.label), ["Música", "Efectos"]);
  for (const k of ["master", "music", "sfx"]) assert.match(h, new RegExp(`type="range" min="0" max="100"[^>]*data-testid="audio-${k}"`));
  for (const k of ["audio-mute", "audio-music-mute", "audio-sfx-mute"]) assert.match(h, new RegExp(`aria-pressed="true"[^>]*data-testid="${k}"`));
  assert.match(h, /Nada suena hasta que interactúas/);
  assert.equal((h.match(/<label/g) ?? []).length, 3);
});

test("AUDIO 50 · UN solo gestor y solo audio original: sin ficheros de audio, sin <audio>, sin librerías de terceros", () => {
  const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "public")));
  assert.equal(files.filter((p) => /\.(mp3|ogg|wav|m4a|aac|flac|webm)$/i.test(p)).length, 0);
  const srcs = walk(join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p));
  const engines = srcs.filter((p) => /new (window\.)?AudioContext|new AC\(\)/.test(code(readFileSync(p, "utf8"))));
  assert.deepEqual(engines.map((p) => p.replace(/\\/g, "/").split("/src/")[1]), ["lib/sound.ts"], "un único contexto de audio");
  for (const p of srcs) {
    const s = code(readFileSync(p, "utf8"));
    assert.ok(!/<audio[\s>]|new Audio\(/.test(s), p);
    assert.ok(!/from ["'](howler|tone|pizzicato)/.test(s), p);
  }
  const shell = read("src", "components", "layout", "GameShell.tsx");
  assert.equal((shell.match(/<MusicDirector \/>/g) ?? []).length, 2, "una por rama (inmersiva / normal), nunca ambas");
  const pkg = read("package.json");
  assert.ok(!/"(howler|tone)"/.test(pkg));
});

test("AUDIO 51 · efectos conectados a las pantallas reales (no solo definidos)", async () => {
  const { MOMENT_SOUND } = await import("@/components/ui/game/GameMoment");
  assert.equal(MOMENT_SOUND.objective, "mission.complete");
  assert.equal(MOMENT_SOUND.achievement, "achievement.unlock");
  assert.equal(MOMENT_SOUND["level-up"], null, "la subida de nivel ya suena en la barra de XP: sin doble sonido");
  const wires: [string[], RegExp][] = [
    [["src", "components", "ui", "game", "PlayButton.tsx"], /playSound\("play\.hover"\)[\s\S]*|playSound\("play\.confirm"\)/],
    [["src", "components", "layout", "GameShell.tsx"], /onMouseEnter=\{\(\) => playSound\("ui\.hover"\)\}/],
    // Fase 49 · Tienda 4.0: elegir un producto (sobre, caja, carta o pack) suena como elegir un sobre.
    [["src", "app", "tienda", "page.tsx"], /function select\(p: ResolvedProduct\) \{\s*playSound\("pack\.select"\)/],
    [["src", "components", "duel", "MatchBoard.tsx"], /if \(view\.turn > 1\) playSound\("match\.turn"\)/],
    [["src", "components", "duel", "ResultScreen.tsx"], /stingDuck\(\);[\s\S]*if \(kind === "draw"\) playSound\("match\.draw"\)/],
    [["src", "components", "duel", "ResultScreen.tsx"], /useMusicOverride\(kind \? "RESULT" : null\)/],
    [["src", "components", "ui", "game", "XpProgress.tsx"], /playSound\("level\.up"\)/],
    [["src", "components", "packs", "CardReveal.tsx"], /playReveal\(/],
  ];
  for (const [p, re] of wires) assert.match(read(...p), re, p.join("/"));
});

/* ───────────── fuzzer ───────────── */

test("AUDIO FUZZ · 20.000 eventos al azar: ganancia 0..1, nada sin unlock ni oculto, duck acotado, tema ∈ contextos", () => {
  let seed = 4410;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ctxs: (MusicContext | null)[] = [null, ...MUSIC_CONTEXTS];
  let s = INITIAL_MUSIC;
  for (let i = 0; i < 20_000; i++) {
    const r = rnd();
    const e: MusicEvent = r < 0.05 ? { type: "unlock" }
      : r < 0.3 ? { type: "route", context: ctxs[Math.floor(rnd() * ctxs.length)] }
        : r < 0.4 ? { type: "override", context: rnd() < 0.5 ? null : "RESULT" }
          : r < 0.6 ? { type: "duck", on: rnd() < 0.5 }
            : r < 0.75 ? { type: "visibility", hidden: rnd() < 0.3 }
              : { type: "volume", value: rnd() * 1.6 - 0.3 };
    s = musicReducer(s, e);
    const p = musicPlan(s);
    assert.ok(p.gain >= 0 && p.gain <= 1);
    assert.ok(s.ducks >= 0 && s.ducks <= 8);
    if (!s.unlocked || s.volume === 0) assert.equal(p.context, null);
    if (s.hidden) assert.equal(p.gain, 0);
    if (p.context) assert.ok(MUSIC_CONTEXTS.includes(p.context));
    if (s.ducks > 0 && p.context && !s.hidden) assert.ok(p.gain <= s.volume * DUCK_LEVEL + 1e-3);
  }
});
