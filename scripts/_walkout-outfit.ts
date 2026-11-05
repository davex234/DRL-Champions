import * as THREE from "three";
import { readFileSync } from "node:fs";
import { tailorOutfit, pieceMask } from "../src/components/walkout/human3d";
const dir = process.argv[2];
const j = JSON.parse(readFileSync(dir + "/esports-player.gltf", "utf8"));
const bin = readFileSync(dir + "/esports-player.bin");
const acc = (i: number) => {
  const a = j.accessors[i]; const bv = j.bufferViews[a.bufferView];
  const C: any = ({ 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array, 5125: Uint32Array } as Record<number, any>)[a.componentType];
  const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0); const stride = bv.byteStride ?? n * C.BYTES_PER_ELEMENT;
  const out = new C(a.count * n); const dv = new DataView(bin.buffer, bin.byteOffset);
  const rd = (o: number) => (C === Float32Array ? dv.getFloat32(o, true) : C === Uint16Array ? dv.getUint16(o, true) : C === Uint32Array ? dv.getUint32(o, true) : dv.getUint8(o));
  for (let e = 0; e < a.count; e++) for (let k = 0; k < n; k++) out[e * n + k] = rd(base + e * stride + k * C.BYTES_PER_ELEMENT);
  return out;
};
const mesh = j.meshes.find((m: any) => m.name.startsWith("Sphere"));
const pr = mesh.primitives[0];
const g = new THREE.BufferGeometry();
g.setAttribute("position", new THREE.BufferAttribute(acc(pr.attributes.POSITION), 3));
g.setAttribute("normal", new THREE.BufferAttribute(acc(pr.attributes.NORMAL), 3));
g.setAttribute("uv", new THREE.BufferAttribute(acc(pr.attributes.TEXCOORD_0), 2));
g.setAttribute("skinIndex", new THREE.BufferAttribute(acc(pr.attributes.JOINTS_0), 4));
g.setAttribute("skinWeight", new THREE.BufferAttribute(acc(pr.attributes.WEIGHTS_0), 4));
g.setIndex(new THREE.BufferAttribute(acc(pr.indices), 1));
const joints = j.skins[0].joints.map((i: number) => j.nodes[i].name);
const t0 = performance.now();
const o = tailorOutfit(g, joints);
console.log("ms", Math.round(performance.now() - t0), "body tris", g.index!.count / 3, "->", o.body.index!.count / 3);
for (const p of o.pieces) console.log(p.name, "tris", p.geometry.index!.count / 3, "verts", p.geometry.getAttribute("position").count);
// arm vertex joint stats
const sw = g.getAttribute("skinWeight"), si = g.getAttribute("skinIndex"), pos = g.getAttribute("position");
const cnt: Record<string, number> = {};
for (let v = 0; v < pos.count; v++) { let b = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); b = si.getComponent(v, k); } const nm = joints[b]; if (/arm|clav/.test(nm)) { const m = pieceMask(nm, pos.getX(v), pos.getY(v)); cnt[nm + ":" + m] = (cnt[nm + ":" + m] ?? 0) + 1; } }
console.log(cnt);
