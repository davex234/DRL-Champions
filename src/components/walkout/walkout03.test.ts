/**
 * PACK WALKOUT 0.3 · arena nacional y celebraciones.
 *
 *   A01–A06 países: alfa-3, paletas de bandera (franjas / campo), tema país·región·neutro, acento del logo real o neutro,
 *           ningún jugador recibe España (vista previa solo DEV)
 *   C01–C06 celebraciones: elección (RANDOM visual), reglas por intensidad, determinismo, transiciones sin saltos,
 *           física del salto, SHUSH/brazo/mano (0.9: capturas enmascaradas + IK de precisión; ver walkout09)
 *   R01–R04 rig real en Node: clips presentes, índice en los labios, puño de verdad, aterrizaje con los pies en el suelo,
 *           pose segura si falta un clip
 *   T01–T02 timeline y audio (cues de arena y celebración; stopAll corta el público)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ISO3, countryArenaTheme, flagPalette, teamAccentFromLogo } from "@/domain/walkout/countryTheme";
import { CELEBRATIONS, CELEBRATION_IDS, HYPE, HYPE_TIMES, SHUSH, celebrationForIntensity, celebrationPose, enabledCelebrations, pickCelebration, type CelebrationId } from "@/domain/walkout/celebration";
import { buildTimeline, frameAt, WALKOUT_INTENSITIES } from "@/domain/walkout/timeline";
import { walkoutInputFromCard } from "@/domain/walkout/input";
import { CUE_OF_BEAT, WalkoutAudio } from "@/lib/walkout/audio";
import { LOCAL_FLAGS, NON_NATIONALITY_CODES } from "@/data/flags";
import { CARDS, getPlayer } from "@/data/catalog";
import { createHumanRig, humanUniforms } from "./human3d";
import { applyCelebrationPose } from "./celebrate3d";

const ROOT = process.cwd();
const EDITION = { light: "#7de3ff", accent: "#2b6cff" };

/** Bandera sintética RGBA (w×h) a partir de una función de color por píxel. */
function raster(w: number, h: number, at: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = at(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
}
const RED: [number, number, number] = [198, 11, 30], YELLOW: [number, number, number] = [255, 196, 0], WHITE: [number, number, number] = [255, 255, 255], BLUE: [number, number, number] = [10, 49, 97];
const near = (hex: string, c: [number, number, number]) => { const n = parseInt(hex.slice(1), 16); return Math.hypot((n >> 16) - c[0], ((n >> 8) & 255) - c[1], (n & 255) - c[2]) < 40; };

/* ───────── países ───────── */

test("A01 · alfa-3: todos los países reales del catálogo (y ES de vista previa) tienen código: ESP, JPN, USA…", () => {
  for (const iso of LOCAL_FLAGS) if (!NON_NATIONALITY_CODES.has(iso)) assert.ok(/^[A-Z]{3}$/.test(ISO3[iso] ?? ""), iso);
  assert.equal(ISO3.ES, "ESP"); assert.equal(ISO3.JP, "JPN"); assert.equal(ISO3.US, "USA"); assert.equal(ISO3.KR, "KOR");
});

test("A02 · paleta de la bandera real: España (franjas horizontales rojo/amarillo), Japón (campo blanco con disco rojo), EE. UU. (rojo, blanco y azul)", () => {
  const es = flagPalette(raster(64, 48, (_x, y) => (y < 12 || y >= 36 ? RED : YELLOW)), 64, 48);
  assert.equal(es.layout, "horizontal");
  assert.ok(es.colors.some((c) => near(c.hex, RED)) && es.colors.some((c) => near(c.hex, YELLOW)), JSON.stringify(es));
  const jp = flagPalette(raster(64, 48, (x, y) => (Math.hypot(x - 32, y - 24) < 14 ? RED : WHITE)), 64, 48);
  assert.equal(jp.layout, "field");
  assert.ok(near(jp.colors[0].hex, WHITE) && jp.colors.some((c) => near(c.hex, RED)), JSON.stringify(jp));
  const us = flagPalette(raster(64, 48, (x, y) => (x < 26 && y < 26 ? BLUE : Math.floor(y / (48 / 13)) % 2 ? WHITE : RED)), 64, 48);
  for (const c of [RED, WHITE, BLUE]) assert.ok(us.colors.some((x) => near(x.hex, c)), JSON.stringify(us));
  // vertical (Francia, Italia…)
  const fr = flagPalette(raster(64, 48, (x) => (x < 21 ? BLUE : x < 43 ? WHITE : RED)), 64, 48);
  assert.equal(fr.layout, "vertical");
});

test("A03 · CountryArenaTheme: con país → bandera, código y SUS colores para luces; sin país → región rotulada; nada → neutro", () => {
  const es = flagPalette(raster(64, 48, (_x, y) => (y < 12 || y >= 36 ? RED : YELLOW)), 64, 48);
  const t = countryArenaTheme({ flag: { iso: "ES", src: "/walkout/flags/es.svg", name: "España" }, region: "EMEA" }, es, EDITION);
  assert.equal(t.kind, "country"); assert.equal(t.code, "ESP"); assert.equal(t.label, "España"); assert.equal(t.flagSrc, "/walkout/flags/es.svg");
  assert.ok(t.colors.some((c) => near(c, RED)) && t.colors.some((c) => near(c, YELLOW)));
  // antes de rasterizar la bandera: código y bandera, colores de la edición (nunca un color inventado del país)
  const pending = countryArenaTheme({ flag: { iso: "JP", src: "/flags/jp.svg", name: "Japón" }, region: null }, null, EDITION);
  assert.equal(pending.code, "JPN"); assert.deepEqual(pending.colors, [EDITION.light, EDITION.accent]);
  const region = countryArenaTheme({ flag: null, region: "EMEA" }, null, EDITION);
  assert.equal(region.kind, "region"); assert.equal(region.code, "EMEA"); assert.match(region.label, /Región EMEA/); assert.equal(region.flagSrc, null);
  const neutral = countryArenaTheme({ flag: null, region: null }, null, EDITION);
  assert.equal(neutral.kind, "neutral"); assert.equal(neutral.code, ""); assert.equal(neutral.flagSrc, null);
  // una bandera casi negra no se usa como luz
  const de = flagPalette(raster(64, 48, (_x, y) => (y < 16 ? [0, 0, 0] : y < 32 ? [221, 0, 0] : [255, 206, 0])), 64, 48);
  assert.ok(!countryArenaTheme({ flag: { iso: "DE", src: "/flags/de.svg", name: "Alemania" }, region: null }, de, EDITION).colors.some((c) => c === "#000000"));
});

test("A04 · equipo: acento SOLO de los píxeles del logo real; sin logo o logo sin color → acento neutro (null)", () => {
  const orange = flagPalette(raster(32, 32, (x) => (x < 16 ? [255, 89, 0] : [20, 20, 20])), 32, 32);
  assert.ok(near(teamAccentFromLogo(orange)!, [255, 89, 0]));
  const grey = flagPalette(raster(32, 32, (x) => (x < 16 ? [240, 240, 240] : [30, 30, 30])), 32, 32);
  assert.equal(teamAccentFromLogo(grey), null);
  assert.equal(teamAccentFromLogo(null), null, "logo ausente");
});

test("A05 · ningún jugador recibe España: el catálogo no tiene españoles y la bandera de vista previa solo la usa el panel DEV", () => {
  const es = CARDS.map((c) => walkoutInputFromCard(c, getPlayer(c.playerId))).filter((i) => i.flag?.iso === "ES");
  assert.equal(es.length, 0);
  assert.ok(!LOCAL_FLAGS.has("ES"), "public/flags sigue siendo solo el catálogo");
  const page = readFileSync(join(ROOT, "src/app/design-system/pack-walkout/page.tsx"), "utf8");
  assert.match(page, /PREVIEW_FLAGS[^\n]*ES: "\/walkout\/flags\/es\.svg"/);
  const readme = readFileSync(join(ROOT, "public/walkout/flags/README.md"), "utf8");
  assert.match(readme, /flag-icons \*\*7\.5\.0\*\* \(MIT/); assert.match(readme, /c0b80bf0e08006a60f56621d6bc49f8c7131f4d1fef6737a165a673431f4b518/);
});

test("A06 · Japón y EE. UU. con jugadores REALES del catálogo y su nacionalidad canónica", () => {
  const jp = walkoutInputFromCard(CARDS.find((c) => c.id === "absol__future-star")!, getPlayer("absol"));
  const us = walkoutInputFromCard(CARDS.find((c) => c.id === "trent__masters-l")!, getPlayer("trent"));
  assert.equal(jp.flag?.iso, "JP"); assert.equal(us.flag?.iso, "US");
  assert.equal(countryArenaTheme({ flag: jp.flag, region: jp.region }, null, EDITION).code, "JPN");
  assert.equal(countryArenaTheme({ flag: us.flag, region: us.region }, null, EDITION).code, "USA");
});

/* ───────── celebraciones ───────── */

test("C01 · elección: concreta o RANDOM entre las habilitadas con el azar que pase quien llama (visual, nunca el de sobres)", () => {
  const ok = enabledCelebrations();
  assert.ok(ok.includes("SHUSH") && ok.includes("HYPE_JUMP") && ok.includes("ARMS_CROSSED"));
  for (const id of ok) assert.equal(pickCelebration(id, () => 0.99), id);
  const seen = new Set([0, 0.26, 0.51, 0.76, 0.999].map((r) => pickCelebration("RANDOM", () => r)));
  assert.equal(seen.size, ok.length, "RANDOM recorre todas");
  // la elección no lee Math.random: con el mismo rand, la misma celebración
  assert.equal(pickCelebration("RANDOM", () => 0.4), pickCelebration("RANDOM", () => 0.4));
  const src = readFileSync(join(ROOT, "src/domain/walkout/celebration.ts"), "utf8");
  assert.doesNotMatch(src, /Math\.random|crypto|openPack|economy|grant|credits|\/api\//);
});

test("C02 · por intensidad: STANDARD sin celebración, RARE pose breve (brazos cruzados), WALKOUT y MEGA la completa", () => {
  for (const id of CELEBRATION_IDS) {
    assert.equal(celebrationForIntensity("STANDARD", id), null);
    assert.equal(celebrationForIntensity("RARE", id), "ARMS_CROSSED");
    assert.equal(celebrationForIntensity("WALKOUT", id), id);
    assert.equal(celebrationForIntensity("MEGA_WALKOUT", id), id);
  }
});

test("C03 · deterministas y sin saltos: misma t → misma pose; pesos que suman 1 y cambian suave fotograma a fotograma", () => {
  for (const id of enabledCelebrations()) {
    const def = CELEBRATIONS[id];
    let prev = celebrationPose(id, 0, 0);
    for (let t = 1 / 60; t <= def.duration + 0.5; t += 1 / 60) {
      const p = celebrationPose(id, t, t);
      assert.deepEqual(p, celebrationPose(id, t, t));
      const sum = p.layers.reduce((s, l) => s + l.weight, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${id} t=${t.toFixed(2)} suma ${sum}`);
      // ninguna capa fina salta de golpe (0.9: IK de precisión, manos y clips enmascarados)
      assert.ok(Math.abs((p.arm?.weight ?? 0) - (prev.arm?.weight ?? 0)) < 0.12, `${id} arm t=${t.toFixed(2)}`);
      for (const side of ["l", "r"] as const) {
        const w = (q: typeof p) => q.hands.filter((h) => h.side === side).reduce((s, h) => s + h.weight, 0);
        assert.ok(Math.abs(w(p) - w(prev)) < 0.12, `${id} mano ${side} t=${t.toFixed(2)}`);
      }
      const mw = (q: typeof p, m: string) => q.masked.filter((x) => x.mask === m).reduce((s, x) => s + x.weight, 0);
      for (const m of ["armR", "armL", "spine", "upper"]) assert.ok(Math.abs(mw(p, m) - mw(prev, m)) < 0.12, `${id} máscara ${m} t=${t.toFixed(2)}`);
      assert.ok(Math.abs(p.lift - prev.lift) < 0.06, `${id} elevación t=${t.toFixed(2)}`);
      prev = p;
    }
  }
});

test("C04 · HYPE JUMP: despegue, vuelo y aterrizaje reales — la raíz solo se eleva en el vuelo, como una parábola de g≈9,8", () => {
  const T = HYPE_TIMES;
  assert.equal(celebrationPose("HYPE_JUMP", T.crouchEnd * 0.5, 0).lift, 0, "agachado: en el suelo");
  assert.equal(celebrationPose("HYPE_JUMP", T.takeoffEnd - 0.01, 0).lift, 0, "despegue: aún apoyado");
  const apex = celebrationPose("HYPE_JUMP", T.takeoffEnd + HYPE.flight / 2, 0);
  assert.ok(Math.abs(apex.lift - HYPE.height) < 1e-9, "altura máxima a mitad del vuelo");
  assert.ok(Math.abs(HYPE.height - (9.8 * HYPE.flight ** 2) / 8) / HYPE.height < 0.05, "h = g·T²/8");
  assert.equal(celebrationPose("HYPE_JUMP", T.landAt + 0.01, 0).lift, 0, "aterrizado");
  // las piernas animan (no se sube el modelo entero): clips de salto y aterrizaje en cada fase
  assert.equal(celebrationPose("HYPE_JUMP", T.crouchEnd * 0.9, 0).layers.find((l) => l.clip === "Jump_Start")!.weight > 0.8, true);
  assert.ok(celebrationPose("HYPE_JUMP", T.landAt + 0.3, 0).layers.some((l) => l.clip === "Jump_Land" && l.weight === 1));
  // puño arriba desde el despegue (0.9: brazo capturado de Cheer_04 + IK de precisión a la vertical; puño de datos)
  const end = celebrationPose("HYPE_JUMP", T.end, 0);
  assert.equal(end.arm?.goal, "sky"); assert.equal(end.arm?.weight, 1); assert.equal(end.hands.find((h) => h.side === "r")?.shape, "fist");
  assert.ok(end.masked.some((m) => m.clip === "Cheer_04" && m.mask === "armR" && m.weight === 1));
  // los cambios de pose en el suelo clavan un pie
  assert.ok(CELEBRATIONS.HYPE_JUMP.locks.length === 2 && CELEBRATIONS.HYPE_JUMP.locks.every((l) => l.side === "l"));
});

test("C05 · SHUSH: brazo capturado (TouchFace_01) + índice a los labios; ARMS CROSSED: clip solo en tronco y brazos; POINT: brazo capturado (Cheer_04) al cielo con el índice", () => {
  const sh = celebrationPose("SHUSH", SHUSH.reach + 0.2, 1);
  assert.equal(sh.arm?.goal, "lips"); assert.equal(sh.arm?.weight, 1);
  assert.deepEqual(sh.hands, [{ side: "r", shape: "shush", weight: 1 }]);
  assert.ok(sh.masked.some((m) => m.clip === "TouchFace_01" && m.mask === "armR" && m.weight === 1));
  const ac = celebrationPose("ARMS_CROSSED", 2, 2);
  assert.ok(ac.masked.some((m) => m.clip === "Idle_FoldArms_Loop" && m.mask === "upper" && m.weight === 1));
  assert.deepEqual(ac.layers.map((l) => l.clip), ["Idle_Loop"], "piernas y pelvis del reposo: los pies no se deslizan");
  const pt = celebrationPose("POINT_SKY", 1.2, 2);
  assert.equal(pt.arm?.goal, "sky"); assert.equal(pt.hands[0]?.shape, "point");
  assert.ok(pt.masked.some((m) => m.clip === "Cheer_04" && m.mask === "armR"));
});

test("C06 · cada celebración termina antes del clímax de su intensidad (no bloquea el reveal)", () => {
  for (const i of ["WALKOUT", "MEGA_WALKOUT"] as const) {
    const tl = buildTimeline(i);
    const c = tl.beats.find((b) => b.id === "celebrate")!, flash = tl.beats.find((b) => b.id === "flash")!;
    for (const id of enabledCelebrations()) assert.ok(c.at + CELEBRATIONS[id].duration <= flash.at + 1e-9, `${i} ${id}`);
  }
  const rare = buildTimeline("RARE"), rc = rare.beats.find((b) => b.id === "celebrate")!, rf = rare.beats.find((b) => b.id === "flash")!;
  assert.ok(rc.at + CELEBRATIONS.ARMS_CROSSED.duration <= rf.at);
});

/* ───────── rig real (Node) ───────── */

(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };
let gltfP: Promise<GLTF> | null = null;
function gltf(): Promise<GLTF> {
  if (gltfP) return gltfP;
  const dir = join(ROOT, "public/walkout/human");
  const j = JSON.parse(readFileSync(join(dir, "esports-player.gltf"), "utf8"));
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(join(dir, j.buffers[0].uri)).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  gltfP = new Promise((res, rej) => new GLTFLoader().parse(JSON.stringify(j), "", res, rej));
  return gltfP;
}
const rigOf = async () => createHumanRig(await gltf(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
let rbP: Promise<GLTF> | null = null;
/** La persona por defecto (Rocketbox), sin texturas. */
function rbGltfOf(): Promise<GLTF> {
  if (rbP) return rbP;
  const dir = join(ROOT, "public/walkout/human");
  const j = JSON.parse(readFileSync(join(dir, "rocketbox-player.gltf"), "utf8"));
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(join(dir, j.buffers[0].uri)).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  rbP = new Promise((res, rej) => new GLTFLoader().parse(JSON.stringify(j), "", res, rej));
  return rbP;
}

test("R01 · el asset por defecto (Rocketbox) trae todos los clips de las celebraciones; Quaternius conserva la mano cerrada de Punch_Cross (y sin los capturados cae a pose segura)", async () => {
  const rb = createHumanRig(await rbGltfOf(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  for (const id of enabledCelebrations()) assert.ok(rb.hasClips(CELEBRATIONS[id].clips), id);
  rb.dispose();
  const rig = await rigOf();
  assert.ok(rig.hasClips(["Punch_Cross"]));
  assert.equal(rig.hasClips(CELEBRATIONS.SHUSH.clips), false, "Quaternius (comparación) sin TouchFace_01: la escena usa el reposo");
  rig.dispose();
});

test("R02 · SHUSH en el rig real (Rocketbox): la falange media del índice delante de los labios, el dedo vertical; el resto recogido", async () => {
  const rig = createHumanRig(await rbGltfOf(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  applyCelebrationPose(rig, "SHUSH", SHUSH.reach + 0.3, 2);
  const lips = rig.bone("Bip01_MUpperLip")!.lerp(rig.bone("Bip01_MBottomLip")!, 0.5);
  const i0 = rig.bone("Bip01_R_Finger1")!, i1 = rig.bone("Bip01_R_Finger11")!, i2 = rig.bone("Bip01_R_Finger12")!;
  const contact = i1.clone().lerp(i2, 0.25);
  assert.ok(Math.abs(contact.x - lips.x) < 0.02 && Math.abs(contact.y - (lips.y - 0.032)) < 0.02, `contacto centrado en la boca (${contact.x - lips.x}, ${contact.y - lips.y})`);
  assert.ok(contact.z - lips.z > 0.01 && contact.z - lips.z < 0.04, `delante de los labios, sin atravesarlos (${(contact.z - lips.z).toFixed(3)})`);
  assert.ok(i2.clone().sub(i0).normalize().y > 0.9, "índice vertical");
  const palm = rig.bone("Bip01_R_Hand")!.lerp(rig.bone("Bip01_R_Finger2")!, 0.5);
  assert.ok(rig.bone("Bip01_R_Finger22")!.distanceTo(palm) < 0.08, "corazón recogido");
  rig.dispose();
});

test("R03 · puño: la forma «fist» cierra la mano de verdad (más que el medio cerrado de los clips)", async () => {
  const rig = await rigOf();
  rig.layers([{ clip: "Idle_Loop", time: 0.3, weight: 1 }]);
  const tip0 = rig.bone("middle_03_r")!, palm = rig.bone("hand_r")!;
  const open = tip0.distanceTo(palm);
  rig.hand("r", "fist", 1);
  assert.ok(rig.bone("middle_03_r")!.distanceTo(rig.bone("hand_r")!) < open - 0.02, "la punta del corazón se acerca a la palma");
  rig.dispose();
});

test("R04 · aterrizaje: con la pose de toma de contacto los pies están en el suelo; un clip que falta → pose segura (reposo)", async () => {
  const rig = await rigOf();
  rig.layers([{ clip: "Jump_Land", time: 0, weight: 1 }]);
  for (const s of ["l", "r"] as const) assert.ok(Math.abs(rig.foot(s).y - 0.013) < 0.03, `bola ${s} a ${rig.foot(s).y.toFixed(3)}`);
  rig.layers([{ clip: "Idle_Loop", time: 0.5, weight: 1 }]); const ref = rig.foot("l").clone();
  assert.doesNotThrow(() => rig.layers([{ clip: "No_Existe", time: 0.5, weight: 1 }]));
  assert.ok(rig.foot("l").distanceTo(ref) < 0.03, "sin el clip, el reposo");
  assert.equal(rig.hasClips(["No_Existe"]), false);
  rig.dispose();
});

/* ───────── timeline y audio ───────── */

test("T01 · timeline: beat de celebración en RARE/WALKOUT/MEGA (no en STANDARD ni reducido) y la persona siempre llega antes", () => {
  for (const i of WALKOUT_INTENSITIES) {
    const tl = buildTimeline(i);
    const c = tl.beats.find((b) => b.id === "celebrate");
    assert.equal(!!c, i !== "STANDARD", i);
    assert.equal(buildTimeline(i, { reduced: true }).beats.some((b) => b.id === "celebrate"), false);
    if (c && tl.human === "walk") { const h = tl.beats.find((b) => b.id === "human")!; assert.ok(c.at >= h.at + h.dur - 0.25, `${i}: celebra al llegar`); }
  }
  // congelar en mitad de la celebración da siempre el mismo fotograma
  const tl = buildTimeline("WALKOUT");
  assert.deepEqual(frameAt(tl, 9.1), frameAt(tl, 9.1));
});

test("T02 · audio: la arena (pantallas + público) y la celebración suenan con su cue y stopAll lo corta todo", () => {
  const live: { stopped: boolean }[] = [];
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {} });
  const source = () => { const n = { ...node(), stopped: false, onended: null as unknown, loop: false, start() {}, stop() { n.stopped = true; }, frequency: param(), type: "", buffer: null }; live.push(n); return n; };
  const ac = {
    currentTime: 0, sampleRate: 8000, destination: node(),
    createOscillator: source, createBufferSource: source,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param(), Q: param() }),
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
  } as unknown as AudioContext;
  const a = new WalkoutAudio(() => ac);
  assert.equal(CUE_OF_BEAT.lights, "arena"); assert.equal(CUE_OF_BEAT.celebrate, "celebrate");
  a.play("arena", { crowd: [[0.01, 0.3], [2, 1], [6, 0.0001]] });
  a.play("celebrate", { celebration: "HYPE_JUMP", landAt: HYPE_TIMES.landAt });
  a.play("celebrate", { celebration: "SHUSH" });
  assert.ok(live.length >= 8);
  a.stopAll();
  assert.ok(live.every((n) => n.stopped));
});
