/**
 * PACK WALKOUT 0.4 · mide los APOYOS de los pies en los clips de paso y frenada (instrumento local, fuera de CI).
 * Un apoyo = instante en que el talón deja de bajar y queda quieto en el suelo (mínimo de altura + velocidad baja).
 *   npx tsx scripts/_walkout-contacts.ts [rocketbox|quaternius]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHumanRig, humanUniforms } from "../src/components/walkout/human3d";
(globalThis as any).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
(globalThis as any).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };
const which = process.argv[2] ?? "rocketbox";
const file = which === "rocketbox" ? "rocketbox-player.gltf" : "esports-player.gltf";
const dir = "public/walkout/human/"; const j = JSON.parse(readFileSync(dir + file, "utf8"));
j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(dir + j.buffers[0].uri).toString("base64")}`;
delete j.images; delete j.textures; delete j.samplers;
for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
new GLTFLoader().parse(JSON.stringify(j), "", (g: GLTF) => {
  const rig = createHumanRig(g, { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  for (const clip of ["Walk_Loop", "Walk_Stop"]) {
    const a = g.animations.find((x) => x.name === clip); if (!a) continue;
    const N = Math.round(a.duration * 120); const ys: Record<"l" | "r", number[]> = { l: [], r: [] };
    const zs: Record<"l" | "r", number[]> = { l: [], r: [] };
    for (let i = 0; i <= N; i++) { rig.layers([{ clip, time: (i / N) * a.duration, weight: 1 }]); for (const s of ["l", "r"] as const) { const f = rig.foot(s); ys[s].push(f.y); zs[s].push(f.z); } }
    const out: string[] = [];
    for (const s of ["l", "r"] as const) {
      const y = ys[s]; const lo = Math.min(...y), hi = Math.max(...y);
      // apoyo: cruza hacia abajo el 15 % de la altura de paso
      const th = lo + (hi - lo) * 0.15;
      // …y se QUEDA abajo al menos 0,1 s (un amago o un roce no es un paso)
      const hold = Math.round(0.1 * 120);
      for (let i = 1; i <= N; i++) if (y[i - 1] > th && y[i] <= th && y.slice(i, i + hold).every((v) => v <= th + (hi - lo) * 0.05)) out.push(`${s}@${((i / N) * a.duration).toFixed(3)}`);
    }
    console.log(clip, `dur ${a.duration.toFixed(3)}`, out.sort((p, q) => Number(p.slice(2)) - Number(q.slice(2))).join(" "));
  }
});
void THREE;
