/**
 * PACK WALKOUT 0.2 · construye la persona (instrumento local, fuera de CI y de package.json).
 *
 * Fusiona Quaternius «Universal Base Characters» (CC0: Superhero_Male + Hair_SimpleParted) con los clips de
 * «Universal Animation Library» 1 y 2 (CC0) — mismo esqueleto de 65 huesos — en UN glTF con recursos externos
 * (.bin + .webp: la CSP de la app no admite blob: en connect-src, que es como GLTFLoader decodifica texturas embebidas).
 * Mide la zancada del paso con la variante root motion (`*_RM.glb`). Procedencia: public/walkout/human/LICENSE-ASSETS.txt
 *
 * Dependencias SOLO para este script (no van al proyecto), en una carpeta aparte:
 *   npm i --prefix <tmp> @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp
 *   NODE_PATH=<tmp>/node_modules (o copiar el script a <tmp>) ·
 *   UAL2=<UAL2 Standard> CLIPS=Walk_Loop,Idle_Loop,Idle_FoldArms_Loop,Jump_Start,Jump_Land,Punch_Cross  *     node _walkout-human-build.mjs <UBC Standard (normales «Unity - Godot» renombradas *_png.png)> <UAL1 Standard> public/walkout/human/esports-player.gltf
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mergeDocuments, prune, dedup, textureCompress, resample, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";
import path from "node:path";

const [ubc, ual, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const killAnim = (a) => { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); };
const KEEP = (process.env.CLIPS ?? "Walk_Loop,Idle_Loop").split(",");

const body = await io.read(path.join(ubc, "Base Characters/Godot - UE/Superhero_Male_FullBody.gltf"));
const root = body.getRoot();
const bodyNodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const bodySkin = root.listSkins()[0];
const bodyScene = root.listScenes()[0];

function graft(srcDoc, { meshes, anims }) {
  const before = new Set(root.listNodes());
  const beforeScenes = new Set(root.listScenes());
  mergeDocuments(body, srcDoc);
  const added = root.listNodes().filter((n) => !before.has(n));
  const byName = new Map(added.map((n) => [n.getName(), n]));
  // meshes: re-parent onto body armature, skin -> body skin
  for (const n of added) {
    if (n.getMesh() && meshes) {
      n.setSkin(bodySkin);
      bodyNodes.get("root").getParentNode()?.addChild(n);
    }
  }
  for (const a of root.listAnimations()) {
    let foreign = false;
    for (const c of a.listChannels()) {
      const t = c.getTargetNode();
      if (t && !bodyNodes.has(t.getName())) continue;
      if (t && added.includes(t)) { foreign = true; c.setTargetNode(bodyNodes.get(t.getName())); }
    }
    if (foreign && anims && !KEEP.includes(a.getName())) killAnim(a);
  }
  for (const s of root.listScenes()) if (!beforeScenes.has(s)) s.dispose();
  for (const n of added) if (!(n.getMesh() && meshes)) n.dispose();
  for (const s of root.listSkins()) if (s !== bodySkin) s.dispose();
  return byName;
}

const hairName = process.env.HAIR ?? "Hair_SimpleParted";
graft(await io.read(path.join(ubc, `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/${hairName}.gltf`)), { meshes: true });
graft(await io.read(path.join(ual, "Unreal-Godot/UAL1_Standard.glb")), { anims: true });
if (process.env.UAL2) graft(await io.read(path.join(process.env.UAL2, "Unreal-Godot/UAL2_Standard.glb")), { anims: true });
for (const a of root.listAnimations()) if (!KEEP.includes(a.getName())) killAnim(a);

// stride measurement from the root-motion variant
const rm = await io.read(path.join(ual, "Unreal-Godot/UAL1_Standard_RM.glb"));
const info = {};
for (const a of rm.getRoot().listAnimations()) {
  if (!KEEP.includes(a.getName())) continue;
  for (const c of a.listChannels()) {
    if (c.getTargetPath() !== "translation") continue;
    const nm = c.getTargetNode().getName();
    if (nm !== "root" && nm !== "pelvis") continue;
    const s = c.getSampler(); const inp = s.getInput().getArray(); const o = s.getOutput().getArray();
    const n = inp.length; const d = [o[(n - 1) * 3] - o[0], o[(n - 1) * 3 + 1] - o[1], o[(n - 1) * 3 + 2] - o[2]];
    info[`${a.getName()}:${nm}`] = { duration: inp[n - 1], delta: d.map((x) => +x.toFixed(4)) };
  }
}
console.log("ROOT MOTION", JSON.stringify(info));

for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const c = p.getAttribute("COLOR_0"); if (c) p.setAttribute("COLOR_0", null); }
await body.transform(
  resample(), prune(), dedup(), unpartition(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }),
);
{ const orphan = root.listAccessors().filter((a) => a.listParents().every((p) => p.propertyType === "Root")); console.log("orphans", orphan.length, root.listAnimations().map((a) => a.listSamplers().length)); orphan.forEach((a) => a.dispose()); }
for (const m of root.listMeshes()) console.log("mesh", m.getName());
for (const a of root.listAnimations()) console.log("anim", a.getName(), a.listChannels().length);
// recursos externos con nombres estables (mismo origen: la CSP de la app no admite blob: en connect-src)
const names = { T_Superhero_Male_Dark: "body-albedo", T_Superhero_Male_Normal: "body-normal", T_Superhero_Male_Roughness: "body-orm", T_Hair_1_BaseColor: "hair-albedo", "T_Hair_1_Normal.png": "hair-normal", T_Eye_Brown: "eye-albedo", "T_Eye_Normal.png": "eye-normal" };
for (const t of root.listTextures()) { const n = names[t.getName()] ?? t.getName().replace(/\W+/g, "-"); t.setURI(`${n}.webp`); }
root.listBuffers()[0].setURI("esports-player.bin");
await io.write(out, body);
