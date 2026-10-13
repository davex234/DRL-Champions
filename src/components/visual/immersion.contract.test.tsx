/**
 * FASE 44.1 · INMERSIÓN — contratos por pieza: cada mundo dibuja SU lugar, cada tema suena en SU escala, cada efecto es
 * seguro sin gesto, cada sección del arnés existe y cada pantalla core tiene lugar y música coherentes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ENVIRONMENTS, environmentForPath, type EnvironmentVariant } from "@/design/environment";
import { GameEnvironment } from "./GameEnvironment";
import { barEvents, MUSIC_CONTEXTS, MUSIC_THEMES, musicContextForPath } from "@/lib/audio/music";
import { SOUND_EVENTS, playSound, type SoundEvent } from "@/lib/sound";
import { FASE441_SCENES, SECTIONS_441 } from "@/app/design-system/fase44-1/fixtures";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const html = (v: EnvironmentVariant) => renderToStaticMarkup(<GameEnvironment variant={v} />);

/* ───────────── cada mundo dibuja su lugar (12) ───────────── */

const SIGNATURE: Record<EnvironmentVariant, { what: string; re: RegExp }> = {
  lobby: { what: "skyline + suelo en perspectiva + pilares de luz", re: /M0 560 L120 560[\s\S]*id="pillar"/ },
  collection: { what: "paredes con huecos de cartas y haces de luz", re: /id="shaft"[\s\S]*M0 0 L380 170 L380 830/ },
  packs: { what: "cono de luz sobre el pedestal", re: /id="cone"[\s\S]*points="740,0 860,0 1120,800 480,800"/ },
  loadout: { what: "rejilla táctica y los cinco roles", re: /id="tgrid"[\s\S]*>DUE<[\s\S]*>FLX</ },
  campaign: { what: "curvas de nivel y ruta punteada con nodos", re: /stroke-dasharray="6 10"/ },
  draft: { what: "tres focos con marcos de carta", re: /id="spot"/ },
  ranked: { what: "peldaños de escalera ascendentes", re: /points="1040,860 1180,860 1160,900 1020,900"/ },
  season: { what: "arcos del horizonte y estrellas", re: /A 220 220 0 0 1 1020 900/ },
  match: { what: "anillos de la arena", re: /<ellipse cx="800" cy="620"/ },
  events: { what: "cuadro de torneo", re: /M500 270 H620 V450 H760/ },
  profile: { what: "galería de marcos", re: /<line x1="0" y1="760" x2="1600" y2="760"/ },
  world: { what: "globo con meridianos", re: /<circle cx="1180" cy="620" r="420"/ },
};

for (const v of Object.keys(ENVIRONMENTS) as EnvironmentVariant[]) {
  test(`MUNDO · ${v}: ${SIGNATURE[v].what}`, () => {
    const h = html(v);
    assert.match(h, SIGNATURE[v].re);
    const others = (Object.keys(ENVIRONMENTS) as EnvironmentVariant[]).filter((o) => ENVIRONMENTS[o].architecture !== ENVIRONMENTS[v].architecture);
    for (const o of others) assert.ok(!SIGNATURE[o].re.test(h), `${v} no dibuja lo de ${o}`);
  });
}

/* ───────────── cada tema en su escala (9) ───────────── */

for (const c of MUSIC_CONTEXTS) {
  test(`MÚSICA · ${c}: 64 compases, todas las notas en su escala y tempo/pulso coherentes`, () => {
    const t = MUSIC_THEMES[c];
    const pcs = new Set(t.mode.map((m) => (t.root + m) % 12));
    let notes = 0;
    for (let b = 0; b < 64; b++) {
      for (const n of barEvents(t, b)) {
        notes++;
        if (n.voice === "pulse") continue; // el pulso es la tónica grave
        assert.ok(pcs.has(((n.midi % 12) + 12) % 12), `${c} compás ${b}: ${n.midi} fuera de escala`);
      }
    }
    assert.ok(notes / 64 >= 4, "hay música, no silencio");
    if (t.pulse === "drive") assert.ok(t.bpm >= 100, "el pulso marcado va con tempo alto");
  });
}

/* ───────────── cada efecto es seguro sin gesto (20) ───────────── */

for (const k of Object.keys(SOUND_EVENTS) as SoundEvent[]) {
  test(`EFECTO · ${k}: sin contexto de audio (servidor/sin gesto) no lanza ni suena`, () => {
    assert.doesNotThrow(() => playSound(k));
    const e = SOUND_EVENTS[k];
    assert.ok([1, 2, 3, 4].includes(e.level));
    if (e.hover) assert.equal(e.level, 1, "un sonido de paso es discreto");
    if (/legendary|serial\.one/.test(k)) assert.equal(e.level, 4, "lo más raro suena más");
  });
}

/* ───────────── arnés (13 secciones) ───────────── */

const PAGE = read("src", "app", "design-system", "fase44-1", "page.tsx");
for (const sec of SECTIONS_441) {
  test(`ARNÉS · sección ${sec}: tiene escenas, mundo válido y la página las monta`, () => {
    const scenes = FASE441_SCENES.filter((s) => s.section === sec);
    assert.ok(scenes.length >= 1);
    for (const s of scenes) {
      assert.ok(ENVIRONMENTS[s.world], s.id);
      const handled = s.section === "AMBIENT WORLDS" || PAGE.includes(`"${s.id}"`) || PAGE.includes(`s.id.startsWith("${s.id.split("-")[0]}-`);
      assert.ok(handled, `escena sin montar: ${s.id}`);
    }
  });
}

test("ARNÉS · ids únicos, 12 mundos y QA SYNTHETIC visible", () => {
  const ids = FASE441_SCENES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(FASE441_SCENES.filter((s) => s.section === "AMBIENT WORLDS").length, 12);
  assert.match(PAGE, /QA SYNTHETIC/);
});

/* ───────────── pantallas core: lugar y música coherentes (12) ───────────── */

const CORE: [string, EnvironmentVariant, string][] = [
  ["/", "lobby", "LOBBY"], ["/coleccion", "collection", "COLLECTION"], ["/tienda", "packs", "PACKS"], ["/inventario", "packs", "PACKS"],
  ["/duelos/mazos", "loadout", "DECKS"], ["/jugar/road-to-champions", "campaign", "CAMPAIGN"], ["/jugar/draft-gauntlet", "draft", "DRAFT"],
  ["/duelos/competitivo", "ranked", "RANKED"], ["/temporada", "season", "LOBBY"], ["/jugador/me", "profile", "COLLECTION"],
  ["/duelos/jugar", "match", "MATCH"], ["/jugar", "lobby", "LOBBY"],
];
for (const [path, env, music] of CORE) {
  test(`PANTALLA · ${path}: lugar ${env} y música ${music}`, () => {
    assert.equal(environmentForPath(path), env);
    assert.equal(musicContextForPath(path), music);
  });
}
