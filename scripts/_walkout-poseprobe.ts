/**
 * PACK WALKOUT 0.3 · sonda de poses en Node (instrumento local, fuera de CI): carga el rig real (sin texturas), recorre un
 * clip y mide la mano respecto a la boca, y comprueba que las formas de mano (puño / índice) cambian los dedos.
 *   npx tsx scripts/_walkout-poseprobe.ts [clip] [desde] [hasta]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHumanRig, humanUniforms } from "../src/components/walkout/human3d";

(globalThis as any).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
(globalThis as any).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };

const dir = "public/walkout/human/";
const j = JSON.parse(readFileSync(dir + "esports-player.gltf", "utf8"));
j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(dir + j.buffers[0].uri).toString("base64")}`;
delete j.images; delete j.textures; delete j.samplers;
for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
const [clip = "Consume", from = "0", to = "1.33"] = process.argv.slice(2);

new GLTFLoader().parse(JSON.stringify(j), "", (g: GLTF) => {
  const rig = createHumanRig(g, { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  const v = (n: string) => rig.bone(n)!;
  for (let t = Number(from); t <= Number(to) + 1e-6; t += 0.05) {
    rig.layers([{ clip, time: t, weight: 1 }]);
    const side = process.env.SIDE ?? "l"; const head = v("Head"), hand = v(`hand_${side}`), tip = v(`index_03_${side}`);
    const mouth = head.clone().add(new THREE.Vector3(0, -0.07, 0.11));
    console.log(t.toFixed(2), "punta→boca", tip.distanceTo(mouth).toFixed(3), "mano→boca", hand.distanceTo(mouth).toFixed(3), "punta", tip.toArray().map((x) => x.toFixed(2)).join(","), "cabeza", head.toArray().map((x) => x.toFixed(2)).join(","));
  }
  // SHUSH: IK a los labios + índice extendido
  for (const w of [0.5, 1]) {
    rig.layers([{ clip: "Idle_Loop", time: 0.5, weight: 1 }]); rig.reach("r", "lips", w); rig.hand("r", "point", w);
    const head = v("Head"), mouth = head.clone().add(new THREE.Vector3(0, -0.075, 0.12));
    const tip = v("index_03_r"), base = v("index_01_r"), wrist = v("hand_r"), elbow = v("lowerarm_r");
    const dirIdx = tip.clone().sub(base).normalize();
    console.log(`lips w=${w}`, "punta→labios", tip.distanceTo(mouth).toFixed(3), "índice dir", dirIdx.toArray().map((x) => x.toFixed(2)).join(","), "muñeca", wrist.toArray().map((x) => x.toFixed(2)).join(","), "codo", elbow.toArray().map((x) => x.toFixed(2)).join(","), "boca", mouth.toArray().map((x) => x.toFixed(2)).join(","));
  }
  // ¿las formas de mano mueven los dedos?
  rig.layers([{ clip: "Idle_Loop", time: 0, weight: 1 }]);
  const before = v("index_03_r").clone(), mid0 = v("middle_03_r").clone();
  rig.hand("r", "fist", 1);
  console.log("puño: punta índice se mueve", v("index_03_r").distanceTo(before).toFixed(3), "· corazón", v("middle_03_r").distanceTo(mid0).toFixed(3));
  rig.layers([{ clip: "Idle_Loop", time: 0, weight: 1 }]); rig.hand("r", "point", 1);
  console.log("índice: punta índice", v("index_03_r").distanceTo(before).toFixed(3), "· corazón", v("middle_03_r").distanceTo(mid0).toFixed(3));
  rig.dispose();
}, (e: unknown) => console.error("ERR", e));
