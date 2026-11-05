/**
 * PACK WALKOUT 0.4 · REDIRIGE clips de Quaternius (UAL, CC0) al esqueleto Biped de Rocketbox (instrumento local, fuera de
 * CI). Para cada fotograma: pose del clip en el rig Quaternius → para cada hueso emparejado, el giro en el MUNDO respecto
 * a su reposo (Δ) se aplica al hueso Rocketbox, corregido por la diferencia de reposos (T-pose ↔ A-pose: C alinea el
 * segmento del reposo destino con el del reposo origen). Altura de la pelvis escalada por la longitud de pierna.
 * Sale un JSON de pistas (cuaternión local por hueso + traslación de `Bip01`) que `_walkout-rocketbox-build.mjs` hornea.
 *
 *   npx tsx scripts/_walkout-retarget.ts <salida.json> Clip1,Clip2,…   (con public/walkout/human/{esports,rocketbox}-player.gltf)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHumanRig, humanUniforms } from "../src/components/walkout/human3d";

(globalThis as any).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
(globalThis as any).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };

const load = (file: string) => new Promise<GLTF>((res, rej) => {
  const dir = "public/walkout/human/"; const j = JSON.parse(readFileSync(dir + file, "utf8"));
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(dir + j.buffers[0].uri).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  new GLTFLoader().parse(JSON.stringify(j), "", res, rej);
});

/** [hueso Quaternius, hijo para la dirección, hueso Rocketbox, hijo para la dirección] — de padres a hijos. */
const S = (q: string, s: "l" | "r") => q.replace("$", s);
const B = (r: string, s: "l" | "r") => r.replace("$", s === "l" ? "L" : "R");
const PAIRS: [string, string | null, string, string | null][] = [
  ["pelvis", "spine_01", "Bip01_Pelvis", "Bip01_Spine"],
  ["spine_01", "spine_02", "Bip01_Spine", "Bip01_Spine1"],
  ["spine_02", "spine_03", "Bip01_Spine1", "Bip01_Spine2"],
  ["spine_03", "neck_01", "Bip01_Spine2", "Bip01_Neck"],
  ["neck_01", "Head", "Bip01_Neck", "Bip01_Head"],
  ["Head", null, "Bip01_Head", null],
  ...(["l", "r"] as const).flatMap((s) => [
    [S("clavicle_$", s), S("upperarm_$", s), B("Bip01_$_Clavicle", s), B("Bip01_$_UpperArm", s)],
    [S("upperarm_$", s), S("lowerarm_$", s), B("Bip01_$_UpperArm", s), B("Bip01_$_Forearm", s)],
    [S("lowerarm_$", s), S("hand_$", s), B("Bip01_$_Forearm", s), B("Bip01_$_Hand", s)],
    [S("hand_$", s), S("middle_01_$", s), B("Bip01_$_Hand", s), B("Bip01_$_Finger2", s)],
    [S("thigh_$", s), S("calf_$", s), B("Bip01_$_Thigh", s), B("Bip01_$_Calf", s)],
    [S("calf_$", s), S("foot_$", s), B("Bip01_$_Calf", s), B("Bip01_$_Foot", s)],
    [S("foot_$", s), S("ball_$", s), B("Bip01_$_Foot", s), B("Bip01_$_Toe0", s)],
  ] as [string, string | null, string, string | null][]),
];

async function run() {
  const [out = "retarget.json", list = "Idle_FoldArms_Loop,Jump_Start,Jump_Land"] = process.argv.slice(2);
  const [gq, gr] = await Promise.all([load("esports-player.gltf"), load("rocketbox-player.gltf")]);
  const U = humanUniforms(0xffffff, 0xffffff);
  const q = createHumanRig(gq, { uniforms: U, sheen: false, castShadow: false });
  const r = createHumanRig(gr, { uniforms: U, sheen: false, castShadow: false });
  const QN = (n: string) => q.root.getObjectByName(n)!, RN = (n: string) => r.root.getObjectByName(n)!;
  const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  // reposos (antes de cualquier pose: el rig sale en su pose de reposo; Quaternius en T, Rocketbox en A)
  q.root.updateMatrixWorld(true); r.root.updateMatrixWorld(true);
  const restQ = new Map<string, THREE.Quaternion>(), restR = new Map<string, THREE.Quaternion>(), corr = new Map<string, THREE.Quaternion>();
  const restLocalR = new Map<string, THREE.Quaternion>();
  r.root.traverse((o) => restLocalR.set(o.name, o.quaternion.clone()));
  for (const [qs, qc, rs, rc] of PAIRS) {
    restQ.set(qs, wq(QN(qs))); restR.set(rs, wq(RN(rs)));
    // C: lleva el segmento del reposo destino al del reposo origen (aplicado sobre el reposo destino)
    const c = new THREE.Quaternion();
    if (qc && rc) c.setFromUnitVectors(wp(RN(rc)).sub(wp(RN(rs))).normalize(), wp(QN(qc)).sub(wp(QN(qs))).normalize());
    corr.set(rs, c);
  }
  const legQ = wp(QN("thigh_l")).y, legR = wp(RN("Bip01_L_Thigh")).y;
  const pelvisRestQ = wp(QN("pelvis")), bip = RN("Bip01"), bipRest = bip.position.clone();
  const result: Record<string, { duration: number; times: number[]; rot: Record<string, number[]>; bipPos: number[] }> = {};
  for (const clipName of list.split(",")) {
    const clip = gq.animations.find((a) => a.name === clipName);
    if (!clip) { console.log("falta", clipName); continue; }
    const times: number[] = [], rot: Record<string, number[]> = {}, bipPos: number[] = [];
    for (let t = 0; t <= clip.duration + 1e-6; t += 1 / 30) {
      times.push(+t.toFixed(4));
      q.layers([{ clip: clipName, time: Math.min(t, clip.duration - 1e-4), weight: 1 }]);
      q.root.updateMatrixWorld(true);
      // reposo del destino en cada fotograma (locales de reposo) y después hueso a hueso, de padres a hijos
      r.root.traverse((o) => { const l = restLocalR.get(o.name); if (l) o.quaternion.copy(l); });
      bip.position.copy(bipRest);
      // pelvis: altura y desplazamiento escalados
      const dp = wp(QN("pelvis")).sub(pelvisRestQ).multiplyScalar(legR / legQ);
      bip.position.copy(bipRest);
      r.root.updateMatrixWorld(true);
      const bipW = wp(bip).add(dp);
      bip.parent!.worldToLocal(bipW); bip.position.copy(bipW);
      bipPos.push(bip.position.x, bip.position.y, bip.position.z);
      r.root.updateMatrixWorld(true);
      for (const [qs, , rs] of PAIRS) {
        const delta = wq(QN(qs)).multiply(restQ.get(qs)!.clone().invert());
        const target = delta.multiply(corr.get(rs)!).multiply(restR.get(rs)!);
        const o = RN(rs); const pw = wq(o.parent!);
        o.quaternion.copy(pw.invert().multiply(target)); o.updateMatrixWorld(true);
        (rot[rs] ??= []).push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w);
      }
    }
    result[clipName] = { duration: clip.duration, times, rot, bipPos };
    console.log("ok", clipName, times.length, "fotogramas");
  }
  writeFileSync(out, JSON.stringify(result));
  q.dispose(); r.dispose();
}
run().catch((e) => { console.error(e); process.exit(1); });
