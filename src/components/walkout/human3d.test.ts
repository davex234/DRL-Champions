/**
 * PACK WALKOUT 0.2 · la persona es un humano riggeado de verdad, camina sin patinar y no deja nada vivo.
 *
 *   H01–H04 paseo (puro): arranca, crucero, frena y se queda en su marca; la fase del clip sale de la distancia
 *           (sin patinar); se detiene en la fase medida; cadencia creíble; pasos sonoros = apoyos
 *   H05–H06 asset: glTF con recursos externos (CSP sin blob:), 65 huesos, clips de paso y reposo, licencia CC0 documentada
 *   H07–H09 rig real (cargado en Node sin texturas): ropa confeccionada (cara y manos a la vista, piel tapada fuera),
 *           pose determinista, IK del pie libre, apoyado sobre la suela, cuerpo de atleta
 *   H10     carga: un fallo no se queda cacheado (el siguiente intento vuelve a cargar)
 *   H11     limpieza: dispose libera geometrías y materiales del rig y lo vacía
 *   H12     arquitectura: three solo en stage3d + human3d; human3d solo desde stage3d; fallo del GLB → 2D
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { IDLE_CLIP, STOP_PHASE, WALK_CLIP, WALK_PLAN, cadenceScale, cruiseSpeed, footfalls, walkAt, walkSpecFromExtras } from "@/domain/walkout/walk";
import { buildTimeline } from "@/domain/walkout/timeline";
import { HUMAN_ASSETS, HUMAN_ASSET_URL, athleticBuild, createHumanRig, humanUniforms, loadHumanAsset, tailorOutfit } from "./human3d";
import { applyCelebrationPose } from "./celebrate3d";

const ROOT = process.cwd();
const ASSET_DIR = join(ROOT, "public/walkout/human");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const DUR = buildTimeline("WALKOUT").beats.find((b) => b.id === "human")!.dur;

/* ───────── paseo ───────── */

test("H01 · paseo: arranca de parado, avanza siempre hacia cámara, frena y se queda en su marca antes de acabar el beat", () => {
  let prev = -Infinity;
  for (let t = 0; t <= DUR; t += 0.02) {
    const s = walkAt(t, DUR);
    assert.ok(s.z >= prev - 1e-9, `retrocede en t=${t}`); prev = s.z;
    assert.ok(s.walkWeight >= 0 && s.walkWeight <= 1);
  }
  assert.equal(walkAt(0, DUR).speed, 0, "sale de parado");
  assert.equal(walkAt(0, DUR).z, WALK_PLAN.startZ);
  const end = walkAt(DUR, DUR);
  assert.ok(Math.abs(end.z - WALK_PLAN.markZ) < 1e-9, "llega a su marca");
  assert.equal(end.speed, 0); assert.equal(end.walkWeight, 0); assert.ok(end.stopped);
  assert.ok(walkAt(DUR - WALK_PLAN.settle + 1e-6, DUR).stopped, "quieto antes de que acabe el beat (reposo)");
  // la velocidad no salta: sin tirones entre arranque, crucero y frenada
  for (let t = 0.02; t <= DUR; t += 0.02) assert.ok(Math.abs(walkAt(t, DUR).speed - walkAt(t - 0.02, DUR).speed) < 0.06, `tirón en t=${t}`);
});

test("H02 · sin patinar: la fase del clip es la distancia recorrida entre la zancada medida (1,30 m por ciclo)", () => {
  for (let t = 0; t <= DUR; t += 0.1) {
    const s = walkAt(t, DUR);
    assert.ok(Math.abs(s.walkTime - (s.distance / WALK_CLIP.stride) * WALK_CLIP.cycle) < 1e-9);
  }
  // el paseo termina en la fase medida para detenerse (pie de apoyo bajo la pelvis, el otro pasando a su lado)
  const total = WALK_PLAN.markZ - WALK_PLAN.startZ;
  const phase = (total / WALK_CLIP.stride) % 1;
  assert.ok(Math.abs(phase - STOP_PHASE) < 1e-9, `fase final ${phase}`);
});

test("H03 · cadencia creíble: ni a cámara rápida ni a cámara lenta (1,0–1,35 × la del clip) en todas las intensidades", () => {
  for (const i of ["WALKOUT", "MEGA_WALKOUT"] as const) {
    const dur = buildTimeline(i).beats.find((b) => b.id === "human")!.dur;
    const c = cadenceScale(cruiseSpeed(dur));
    assert.ok(c >= 1 && c <= 1.35, `${i}: ${c.toFixed(2)}`);
    assert.ok(cruiseSpeed(dur) > 0.95 && cruiseSpeed(dur) < 1.45, "velocidad de paseo humana (m/s)");
  }
});

test("H04 · los pasos suenan cuando el pie apoya: uno por media zancada, crecientes y dentro del paseo", () => {
  const f = footfalls(DUR);
  const total = WALK_PLAN.markZ - WALK_PLAN.startZ;
  assert.equal(f.length, Math.floor(total / (WALK_CLIP.stride / 2)));
  for (let i = 1; i < f.length; i++) assert.ok(f[i] > f[i - 1]);
  assert.ok(f[f.length - 1] < DUR);
  for (const t of f) { const d = walkAt(t, DUR).distance / (WALK_CLIP.stride / 2); assert.ok(Math.abs(d - Math.round(d)) < 0.05, `apoyo en t=${t}`); }
});

/* ───────── asset ───────── */

const gltfJson = () => JSON.parse(readFileSync(join(ASSET_DIR, "esports-player.gltf"), "utf8"));

test("H05 · asset: glTF con .bin y texturas .webp externas (la CSP no admite blob:), 65 huesos, clips de paso y reposo", () => {
  const j = gltfJson();
  const uris = [...j.buffers.map((b: { uri: string }) => b.uri), ...j.images.map((i: { uri: string }) => i.uri)];
  for (const u of uris) { assert.ok(u && !u.startsWith("data:"), `embebido: ${u}`); statSync(join(ASSET_DIR, u)); }
  assert.ok(j.images.every((i: { uri: string }) => i.uri.endsWith(".webp")));
  assert.equal(j.skins.length, 1); assert.equal(j.skins[0].joints.length, 65);
  const names = j.animations.map((a: { name: string }) => a.name);
  for (const c of [WALK_CLIP.name, IDLE_CLIP.name]) assert.ok(names.includes(c), c);
  // 0.4: conviven dos personas y el navegador descarga SOLO una; el presupuesto es por persona
  const bytes = readdirSync(ASSET_DIR).filter((f) => !f.endsWith(".txt") && !f.startsWith("rb-") && !f.startsWith("rocketbox-")).reduce((s, f) => s + statSync(join(ASSET_DIR, f)).size, 0);
  assert.ok(bytes < 2_000_000, `peso total ${bytes}`);
});

test("H06 · licencia documentada: CC0 de Quaternius con enlaces exactos a cada pack y las modificaciones propias", () => {
  const lic = read("public/walkout/human/LICENSE-ASSETS.txt");
  assert.match(lic, /CC0 1\.0 Universal/);
  for (const u of ["https://quaternius.itch.io/universal-base-characters", "https://quaternius.itch.io/universal-animation-library", "https://quaternius.itch.io/universal-animation-library-2"]) assert.ok(lic.includes(u), u);
  assert.match(lic, /sin logotipos ni\s+patrocinadores/);
});

/* ───────── rig real (Node: sin texturas, con el .bin en línea) ───────── */

(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { loaded = 0; total = 0; lengthComputable = false; };
// Lienzo mínimo (la normal de punto se genera con canvas 2D).
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };

let gltfP: Promise<GLTF> | null = null;
function gltf(): Promise<GLTF> {
  if (gltfP) return gltfP;
  const j = gltfJson();
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(join(ASSET_DIR, j.buffers[0].uri)).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  gltfP = new Promise((res, rej) => new GLTFLoader().parse(JSON.stringify(j), "", res, rej));
  return gltfP;
}
const rigOf = async () => createHumanRig(await gltf(), { uniforms: humanUniforms(0xffffff, 0xff3355), sheen: false, castShadow: true });

test("H07 · ropa sobre la malla: camiseta, pantalón y dos zapatillas; cara y manos a la vista; la piel tapada se retira", async () => {
  const g = await gltf();
  let body: THREE.SkinnedMesh | null = null;
  g.scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (!body || m.geometry.getAttribute("position").count > body.geometry.getAttribute("position").count)) body = m; });
  const b = body as unknown as THREE.SkinnedMesh;
  const joints = b.skeleton.bones.map((x) => x.name);
  const out = tailorOutfit(athleticBuild(b.geometry, joints), joints);
  assert.deepEqual(out.pieces.map((p) => p.name), ["shirt", "pants", "shoes", "shoes"]);
  assert.ok(out.body.index!.count < b.geometry.index!.count * 0.7, "la piel bajo la ropa sale del cuerpo");
  // siguen en el cuerpo: cabeza y manos (vértices dominados por Head / hand_*)
  const idx = out.body.index!.array, si = out.body.getAttribute("skinIndex"), sw = out.body.getAttribute("skinWeight");
  const dom = (g: THREE.BufferGeometry) => {
    const ix = g.index!.array, c: Record<string, number> = {};
    for (let t = 0; t < ix.length; t++) { const v = ix[t]; let best = 0, w = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > w) { w = sw.getComponent(v, k); best = si.getComponent(v, k); } c[joints[best]] = (c[joints[best]] ?? 0) + 1; }
    return c;
  };
  void idx;
  const before = dom(b.geometry), after = dom(out.body);
  for (const j of ["Head", "hand_l", "hand_r"]) assert.equal(after[j], before[j], `${j} a la vista`);
  // bajo la ropa solo quedan los triángulos de borde (bajo puños y cuellos: sin huecos)
  for (const j of ["spine_02", "thigh_l", "calf_r", "foot_r"]) assert.ok((after[j] ?? 0) < before[j] * 0.15, `${j} tapado (${after[j] ?? 0}/${before[j]})`);
  // cada prenda va con los pesos del esqueleto (suman 1) y su tono de tela
  for (const p of out.pieces) {
    const w = p.geometry.getAttribute("skinWeight");
    for (let v = 0; v < w.count; v += 37) { let s = 0; for (let k = 0; k < 4; k++) s += w.getComponent(v, k); assert.ok(Math.abs(s - 1) < 1e-3, `${p.name}: pesos ${s}`); }
    assert.ok(p.geometry.getAttribute("color") && p.geometry.getAttribute("accent"));
  }
});

test("H08 · rig: misma pose → mismos huesos; el pie libre sube con IK lo pedido; apoyado sobre la suela (sin hundirse)", async () => {
  const rig = await rigOf();
  rig.pose({ walkTime: 0.4, walkWeight: 1, idleTime: 0 }); const a = rig.foot("l").clone();
  rig.pose({ walkTime: 1.1, walkWeight: 0.3, idleTime: 0.7 });
  rig.pose({ walkTime: 0.4, walkWeight: 1, idleTime: 0 }); assert.ok(rig.foot("l").distanceTo(a) < 1e-6, "determinista");
  const before = rig.foot("r").clone(); rig.lift("r", 0.06);
  assert.ok(Math.abs(rig.foot("r").y - before.y - 0.06) < 2e-3, "IK: el tobillo (y la punta) suben lo pedido");
  assert.ok(Math.abs(rig.foot("r").x - before.x) < 0.02 && Math.abs(rig.foot("r").z - before.z) < 0.02, "IK: sin desplazar el pie en planta");
  // zapatillas: su punto más bajo en reposo toca el suelo (y ≈ 0), ni flota ni se hunde
  rig.pose({ walkTime: 0, walkWeight: 0, idleTime: 0.5 });
  rig.root.updateMatrixWorld(true);
  let minY = Infinity; const v = new THREE.Vector3();
  for (const m of rig.meshes.filter((x) => x.name === "outfit-shoes")) for (let i = 0; i < m.geometry.getAttribute("position").count; i += 3) { m.getVertexPosition(i, v); m.localToWorld(v); minY = Math.min(minY, v.y); }
  assert.ok(minY > -0.02 && minY < 0.02, `suela a ${minY.toFixed(3)} m del suelo`);
  rig.dispose();
});

test("H09 · cuerpo de atleta: brazos más finos que el original «superhéroe»; la cabeza no se toca", async () => {
  const g = await gltf();
  let body: THREE.SkinnedMesh | null = null;
  g.scene.traverse((o) => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && (!body || m.geometry.getAttribute("position").count > body.geometry.getAttribute("position").count)) body = m; });
  const b = body as unknown as THREE.SkinnedMesh;
  const slim = athleticBuild(b.geometry, b.skeleton.bones.map((x) => x.name));
  const p0 = b.geometry.getAttribute("position"), p1 = slim.getAttribute("position");
  let arm0 = 0, arm1 = 0, head = 0;
  for (let v = 0; v < p0.count; v++) {
    const x = Math.abs(p0.getX(v)), y = p0.getY(v);
    if (x > 0.35 && x < 0.55 && Math.abs(y - 1.455) < 0.12) { arm0 += Math.abs(p0.getY(v) - 1.455); arm1 += Math.abs(p1.getY(v) - 1.455); }
    if (y > 1.72) head = Math.max(head, Math.abs(p1.getX(v) - p0.getX(v)) + Math.abs(p1.getY(v) - p0.getY(v)));
  }
  assert.ok(arm1 < arm0 * 0.9, "brazo más fino");
  assert.ok(head < 1e-6, "cabeza intacta");
});

test("H10 · carga: un fallo no se queda en caché (el siguiente intento vuelve a pedir el asset)", async () => {
  const a = loadHumanAsset("http://127.0.0.1:9/no-existe.gltf");
  await assert.rejects(a);
  const b = loadHumanAsset("http://127.0.0.1:9/no-existe.gltf");
  assert.notEqual(a, b, "tras fallar se reintenta");
  await assert.rejects(b);
});

test("H11 · limpieza: dispose libera geometrías y materiales del rig, para la animación y lo vacía (REPETIR no acumula)", async () => {
  const rig = await rigOf();
  let geos = 0, mats = 0;
  const seenG = new Set<THREE.BufferGeometry>(), seenM = new Set<THREE.Material>();
  for (const m of rig.meshes) {
    if (!seenG.has(m.geometry)) { seenG.add(m.geometry); m.geometry.addEventListener("dispose", () => geos++); }
    const mm = m.material as THREE.Material; if (!seenM.has(mm)) { seenM.add(mm); mm.addEventListener("dispose", () => mats++); }
  }
  rig.dispose();
  assert.equal(geos, seenG.size); assert.equal(mats, seenM.size);
  assert.equal(rig.root.children.length, 0);
  // un rig nuevo sobre el mismo asset sigue funcionando (la ropa cacheada se vuelve a subir a la GPU)
  const again = await rigOf();
  again.pose({ walkTime: 0.2, walkWeight: 1, idleTime: 0 });
  assert.equal(again.meshes.length, rig.meshes.length);
  again.dispose();
});

test("H12 · arquitectura: three solo en stage3d + human3d + arena3d (0.3); human3d y arena3d solo los importa stage3d; si el GLB falla, el escenario pasa a 2D", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(d, e.name)] : []);
  const files = walk(join(ROOT, "src")).map((f) => [f.replace(/\\/g, "/").replace(/^.*\/src\//, "src/"), readFileSync(f, "utf8")] as const);
  assert.deepEqual(files.filter(([, s]) => /from "three"|from "three\/|import\("three"\)/.test(s)).map(([f]) => f).sort(), ["src/components/walkout/arena3d.ts", "src/components/walkout/human3d.ts", "src/components/walkout/stage3d.ts"]);
  // (0.9: `celebrate3d` solo lo TIPA — `import type`, se borra al compilar — y solo lo importa stage3d)
  assert.deepEqual(files.filter(([, s]) => /^import (?!type )[^\n]*(from "\.\/human3d"|walkout\/human3d")/m.test(s)).map(([f]) => f), ["src/components/walkout/stage3d.ts"]);
  assert.match(read("src/components/walkout/celebrate3d.ts"), /^import type \{ HumanRig \} from "\.\/human3d";/m);
  assert.deepEqual(files.filter(([, s]) => /from "\.\/celebrate3d"|walkout\/celebrate3d"/.test(s)).map(([f]) => f), ["src/components/walkout/stage3d.ts"]);
  assert.deepEqual(files.filter(([, s]) => /from "\.\/arena3d"|walkout\/arena3d"/.test(s)).map(([f]) => f), ["src/components/walkout/stage3d.ts"], "0.3: la arena solo entra por el escenario 3D");
  const stage = read("src/components/walkout/WalkoutStage.tsx");
  // WALKOUT 0.8 · misma garantía con su código propio («model» → MODEL_LOAD_FAILED; antes el genérico «load»)
  assert.match(stage, /st\.ready\.then\([\s\S]*?\.catch\(\(\) => \{ humanSettled = true; if \(alive\) \{ canvas\.dataset\.human = "failed"; setBroken\("model"\); \} \}\)/);
  assert.match(read("src/components/walkout/stage3d.ts"), /readonly ready: Promise<void>/);
});

/* ───────── 0.4 · persona realista (Microsoft Rocketbox, MIT) ───────── */

const rbJson = () => JSON.parse(readFileSync(join(ASSET_DIR, "rocketbox-player.gltf"), "utf8"));

test("H13 · 0.4: la escena usa la persona Rocketbox por defecto; glTF con recursos externos, Biped de 80 huesos, clips de paso, frenada, reposo y los retargeteados; ≤ 2,5 MB", () => {
  assert.equal(HUMAN_ASSET_URL, HUMAN_ASSETS.rocketbox);
  assert.equal(HUMAN_ASSETS.rocketbox, "/walkout/human/rocketbox-player.gltf");
  const j = rbJson();
  const uris = [...j.buffers.map((b: { uri: string }) => b.uri), ...j.images.map((i: { uri: string }) => i.uri)];
  for (const u of uris) { assert.ok(u && !u.startsWith("data:"), `embebido: ${u}`); statSync(join(ASSET_DIR, u)); }
  assert.equal(j.skins.length, 1); assert.equal(j.skins[0].joints.length, 80);
  assert.ok(j.nodes.some((n: { name: string }) => n.name === "Bip01 Pelvis"));
  const names = j.animations.map((a: { name: string }) => a.name);
  for (const c of ["Walk_Loop", "Walk_Stop", "Idle_Loop", "Idle_FoldArms_Loop", "Jump_Start", "Jump_Land"]) assert.ok(names.includes(c), c);
  // la frenada trae su curva de raíz y la zancada medida (extras del asset)
  const spec = walkSpecFromExtras(j.asset.extras);
  assert.ok(spec && spec.stride > 1.3 && spec.stride < 1.7 && spec.cycle > 0.9 && spec.cycle < 1.3, `zancada ${spec?.stride} / ${spec?.cycle}`);
  assert.ok(spec?.stop && spec.stop.curve.length > 2 && spec.stop.distance > 0, "frenada con su curva de raíz");
  const bytes = readdirSync(ASSET_DIR).filter((f) => f.startsWith("rb-") || f.startsWith("rocketbox-")).reduce((s, f) => s + statSync(join(ASSET_DIR, f)).size, 0);
  assert.ok(bytes < 2_500_000, `peso ${bytes}`);
});

test("H14 · 0.4: licencia MIT de Microsoft Rocketbox con el aviso íntegro, la procedencia exacta y lo retargeteado", () => {
  const lic = read("public/walkout/human/LICENSE-ASSETS.txt");
  assert.ok(lic.includes("https://github.com/microsoft/Microsoft-Rocketbox"));
  assert.ok(lic.includes("Male_Adult_10"));
  assert.match(lic, /Copyright \(c\) 2020 Microsoft/);
  assert.match(lic, /The above copyright notice and this permission notice shall be included/);
  assert.match(lic, /RETARGETEADOS/);
});

let rbP: Promise<GLTF> | null = null;
function rbGltf(): Promise<GLTF> {
  if (rbP) return rbP;
  const j = rbJson();
  j.buffers[0].uri = `data:application/octet-stream;base64,${readFileSync(join(ASSET_DIR, j.buffers[0].uri)).toString("base64")}`;
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials) { delete m.normalTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  rbP = new Promise((res, rej) => new GLTFLoader().parse(JSON.stringify(j), "", res, rej));
  return rbP;
}

test("H15 · 0.4: el puño procedural NO se acumula entre fotogramas (los dedos que ningún clip anima vuelven al reposo)", async () => {
  const rig = createHumanRig(await rbGltf(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  assert.equal(rig.profile.id, "rocketbox");
  const ang = () => { const h = rig.bone("Bip01_R_Hand")!, f2 = rig.bone("Bip01_R_Finger2")!, f21 = rig.bone("Bip01_R_Finger21")!; return f21.clone().sub(f2).angleTo(f2.clone().sub(h)); };
  const frame = () => { applyCelebrationPose(rig, "SHUSH", 1.2, 2); return ang(); };
  const a = frame(), b = frame(), c = frame();
  assert.ok(Math.abs(a - b) < 1e-4 && Math.abs(b - c) < 1e-4, `${a} ${b} ${c}`);
  assert.ok(a > 0.8, `corazón doblado ${a}`);      // el resto de la mano, recogido (> 46°; SHUSH 0.9: sin apretar)
});

test("H16 · 0.4/0.9: SHUSH en la persona realista — el índice extendido y vertical delante de la boca, el resto cerrado", async () => {
  const rig = createHumanRig(await rbGltf(), { uniforms: humanUniforms(0xffffff, 0xffffff), sheen: false, castShadow: false });
  applyCelebrationPose(rig, "SHUSH", 1.2, 2);
  const head = rig.bone("Bip01_Head")!, tip = rig.bone("Bip01_R_Finger12")!, base = rig.bone("Bip01_R_Finger1")!;
  const dir = tip.clone().sub(base).normalize();
  assert.ok(dir.y > 0.8, `índice hacia arriba ${dir.y}`);
  assert.ok(tip.z > head.z + 0.04 && tip.z < head.z + 0.2, `delante de la cara ${tip.z - head.z}`);
  assert.ok(Math.abs(tip.y - head.y) < 0.07, `a la altura de la boca ${tip.y - head.y}`);
  assert.ok(Math.abs(tip.x - head.x) < 0.06, `centrado ${tip.x - head.x}`);
  const palm = rig.bone("Bip01_R_Hand")!.lerp(rig.bone("Bip01_R_Finger2")!, 0.5);
  assert.ok(rig.bone("Bip01_R_Finger22")!.distanceTo(palm) < 0.07, "corazón cerrado");
});
