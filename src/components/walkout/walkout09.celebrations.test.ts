/**
 * WALKOUT 0.9 · celebraciones humanas — contratos medibles sobre el rig REAL (Rocketbox, sin texturas, en Node).
 * Un test verde no prueba que una pose «se vea natural» (eso se revisa en capturas y vídeo: docs/product/qa/walkout-0.9);
 * estos fijan lo que SÍ se puede medir para que no vuelva lo que se corrigió:
 *
 *   N01 POINT: codo flexionado (nunca recto como un palo), mano por encima de la cabeza, índice hacia arriba y el puño cerrado
 *   N02 POINT: la clavícula sube con el brazo y la mirada sube (el hombro y la cabeza acompañan)
 *   N03 SHUSH: contacto delante de los labios, ningún dedo detrás del plano de la boca (no atraviesa la cara)
 *   N04 todas vuelven: tras su duración el brazo está otra vez en el reposo
 *   N05 ARMS CROSSED: los pies no se mueven al cruzar los brazos
 *   N06 sin acumulación: la misma t aplicada varias veces (pausa, seek, REPETIR) da exactamente la misma pose
 *   N07 sin saltos: entre fotogramas a 60 fps ninguna mano recorre más de lo físicamente plausible
 *   N08 coste: aplicar una celebración cuesta < 2 ms por fotograma (sin IK innecesaria)
 *   N09 procedencia: los clips capturados están en el asset y en la licencia; el reposo, base de todo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CELEBRATIONS, POINT, SHUSH, enabledCelebrations, type CelebrationId } from "@/domain/walkout/celebration";
import { createHumanRig, humanUniforms, type HumanRig } from "./human3d";
import { applyCelebrationPose } from "./celebrate3d";

const ROOT = process.cwd();
const DIR = join(ROOT, "public/walkout/human");
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };

let gP: Promise<GLTF> | null = null;
function rb(): Promise<GLTF> {
  if (gP) return gP;
  const j = JSON.parse(readFileSync(join(DIR, "rocketbox-player.gltf"), "utf8"));
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(join(DIR, j.buffers[0].uri)).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  gP = new Promise((res, rej) => new GLTFLoader().parse(JSON.stringify(j), "", res, rej));
  return gP;
}
const rigOf = async () => createHumanRig(await rb(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
const at = (r: HumanRig, id: CelebrationId, t: number) => applyCelebrationPose(r, id, t, 2 + t);
const B = (r: HumanRig, n: string) => r.bone(`Bip01_${n}`)!;
/** Flexión del codo (grados): 0 = brazo recto. */
const elbowFlex = (r: HumanRig) => {
  const s = B(r, "R_UpperArm"), e = B(r, "R_Forearm"), w = B(r, "R_Hand");
  return THREE.MathUtils.radToDeg(e.clone().sub(s).angleTo(w.clone().sub(e)));
};

test("N01 · POINT TO SKY: codo flexionado (25–70°), mano sobre la cabeza, índice arriba y el resto del puño cerrado", async () => {
  const r = await rigOf();
  for (const t of [POINT.raise + 0.05, 1.2, POINT.holdEnd - 0.05]) {
    at(r, "POINT_SKY", t);
    const flex = elbowFlex(r);
    assert.ok(flex > 25 && flex < 70, `t=${t}: codo ${flex.toFixed(0)}° (ni palo ni encogido)`);
    assert.ok(B(r, "R_Hand").y > B(r, "Head").y + 0.2, `t=${t}: la mano por encima de la cabeza`);
    const i0 = B(r, "R_Finger1"), i2 = B(r, "R_Finger12");
    assert.ok(i2.clone().sub(i0).normalize().y > 0.75, `t=${t}: el índice señala arriba`);
    const palm = B(r, "R_Hand").lerp(B(r, "R_Finger2"), 0.5);
    assert.ok(B(r, "R_Finger22").distanceTo(palm) < 0.07, `t=${t}: corazón cerrado`);
    assert.ok(B(r, "R_Finger42").distanceTo(palm) < 0.08, `t=${t}: meñique cerrado (no «cuernos»)`);
  }
  r.dispose();
});

test("N02 · POINT TO SKY: la clavícula sube con el brazo y la cabeza mira hacia arriba (no solo gira un hueso)", async () => {
  const r = await rigOf();
  r.layers([{ clip: "Idle_Loop", time: 2, weight: 1 }]);
  const clav0 = B(r, "R_UpperArm").y, nose0 = B(r, "MNose").clone().sub(B(r, "Head"));
  at(r, "POINT_SKY", 1.2);
  assert.ok(B(r, "R_UpperArm").y > clav0 + 0.015, `el hombro se eleva (${(B(r, "R_UpperArm").y - clav0).toFixed(3)} m)`);
  const nose = B(r, "MNose").clone().sub(B(r, "Head"));
  assert.ok(nose.normalize().y > nose0.normalize().y + 0.1, "la mirada sube");
  r.dispose();
});

test("N03 · SHUSH: el índice apoya delante de los labios; ningún dedo queda detrás del plano de la boca (no atraviesa la cara)", async () => {
  const r = await rigOf();
  for (const t of [SHUSH.reach + 0.05, 1.2, SHUSH.holdEnd - 0.05]) {
    at(r, "SHUSH", t);
    const lips = B(r, "MUpperLip").lerp(B(r, "MBottomLip"), 0.5);
    const contact = B(r, "R_Finger11").lerp(B(r, "R_Finger12"), 0.25);
    assert.ok(contact.distanceTo(lips) < 0.045, `t=${t}: contacto a ${contact.distanceTo(lips).toFixed(3)} m de la boca`);
    for (const f of ["R_Finger1", "R_Finger11", "R_Finger12", "R_Finger2", "R_Finger21", "R_Finger3", "R_Finger31"]) assert.ok(B(r, f).z > lips.z, `t=${t}: ${f} delante de la boca`);
    assert.ok(B(r, "R_Finger12").y < B(r, "MNose").y + 0.03, `t=${t}: la punta no sube por encima de la nariz`);
    assert.ok(elbowFlex(r) > 100, `t=${t}: codo flexionado (${elbowFlex(r).toFixed(0)}°)`);
  }
  r.dispose();
});

test("N04 · todas vuelven al reposo: tras su duración, el brazo derecho está donde lo pone el reposo", async () => {
  const r = await rigOf();
  for (const id of ["POINT_SKY", "SHUSH"] as const) {
    const t = CELEBRATIONS[id].duration + 0.05;
    r.layers([{ clip: "Idle_Loop", time: 2 + t, weight: 1 }]);
    const ref = B(r, "R_Hand").clone();
    at(r, id, t);
    assert.ok(B(r, "R_Hand").distanceTo(ref) < 0.02, `${id}: mano a ${B(r, "R_Hand").distanceTo(ref).toFixed(3)} m del reposo`);
  }
  r.dispose();
});

test("N05 · ARMS CROSSED: los pies no se mueven al cruzar los brazos (piernas del reposo)", async () => {
  const r = await rigOf();
  // referencia: el reposo solo, al mismo instante (el propio reposo cambia el peso de pie a pie: eso no es deslizar)
  const idleFeet = (t: number) => { r.layers([{ clip: "Idle_Loop", time: 2 + t, weight: 1 }]); return (["l", "r"] as const).map((s) => r.foot(s).clone()); };
  const feet = (t: number) => { const a = at(r, "ARMS_CROSSED", t); return (["l", "r"] as const).map((s) => r.foot(s).clone().add(new THREE.Vector3(a.offset.x, 0, a.offset.z))); };
  for (const t of [0.3, 0.6, 0.9, 2]) { const ref = idleFeet(t); feet(t).forEach((p, i) => assert.ok(p.distanceTo(ref[i]) < 0.01, `t=${t} pie ${i}: ${p.distanceTo(ref[i]).toFixed(3)} m`)); }
  r.dispose();
});

test("N06 · sin acumulación: la misma t aplicada tres veces (pausa, seek, REPETIR) deja exactamente la misma pose", async () => {
  const r = await rigOf();
  const snap = () => ["R_Hand", "R_Finger12", "R_Finger22", "Head", "R_Forearm"].map((n) => B(r, n).toArray()).flat();
  for (const id of enabledCelebrations()) for (const t of [0.4, 1.1, 2]) {
    at(r, id, t); const a = snap(); at(r, id, t); at(r, id, t); const b = snap();
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${id} t=${t}`));
  }
  r.dispose();
});

test("N07 · sin saltos: a 60 fps ninguna mano ni la cabeza recorre más de 9 cm entre fotogramas (≈ 5,4 m/s; 14 cm en el puño del salto)", async () => {
  const r = await rigOf();
  for (const id of enabledCelebrations()) {
    let prev: THREE.Vector3[] | null = null;
    for (let t = 0; t <= CELEBRATIONS[id].duration + 0.3; t += 1 / 60) {
      const a = at(r, id, t);
      const o = new THREE.Vector3(a.offset.x, a.lift, a.offset.z);
      const cur = ["R_Hand", "L_Hand", "Head"].map((n) => B(r, n).add(o));
      const lim = id === "HYPE_JUMP" ? 0.14 : 0.09;   // el puño del salto sale con el impulso: ≈ 8 m/s, como uno real
      if (prev) cur.forEach((p, i) => assert.ok(p.distanceTo(prev![i]) < lim, `${id} t=${t.toFixed(2)} hueso ${i}: ${p.distanceTo(prev![i]).toFixed(3)} m`));
      prev = cur;
    }
  }
  r.dispose();
});

test("N08 · coste: aplicar una celebración cuesta < 2 ms por fotograma de media (en Node, sin GPU)", async () => {
  const r = await rigOf();
  for (const id of enabledCelebrations()) at(r, id, 0.5);       // calienta las cachés de pistas
  const N = 240, t0 = performance.now();
  for (let i = 0; i < N; i++) at(r, enabledCelebrations()[i % 4], (i % 150) / 60);
  const ms = (performance.now() - t0) / N;
  assert.ok(ms < 2, `${ms.toFixed(3)} ms por fotograma`);
  r.dispose();
});

test("N09 · procedencia: los clips capturados están en el asset y en la licencia; las celebraciones no tocan economía", () => {
  const j = JSON.parse(readFileSync(join(DIR, "rocketbox-player.gltf"), "utf8"));
  const names = j.animations.map((a: { name: string }) => a.name);
  for (const c of ["Cheer_04", "TouchFace_01", "Idle_Loop", "Idle_FoldArms_Loop", "Jump_Start", "Jump_Land"]) assert.ok(names.includes(c), c);
  const lic = readFileSync(join(DIR, "LICENSE-ASSETS.txt"), "utf8");
  assert.match(lic, /m_idle_touch_face_01/); assert.match(lic, /m_cheer_04/); assert.match(lic, /MIT License/);
  for (const f of ["src/domain/walkout/celebration.ts", "src/components/walkout/celebrate3d.ts"]) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(s, /Math\.random|openPack|economy|credits|\/api\/|fetch\(/, f);
  }
});
