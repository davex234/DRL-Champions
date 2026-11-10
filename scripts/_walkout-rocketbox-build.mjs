/**
 * PACK WALKOUT 0.4 · construye la persona Rocketbox (instrumento local, fuera de CI y de package.json).
 *
 * Fuente: Microsoft Rocketbox Avatar Library (MIT, © 2020 Microsoft) — `Assets/Avatars/Adults/Male_Adult_10` y animaciones
 * de `Assets/Animations/all_animations_max_motextr_{static,xy}` (mismo esqueleto Biped `Bip01`), convertidas de FBX a GLB
 * con FBX2glTF v0.9.7 (facebookincubator). Este script:
 *   · une avatar + clips (renombrados a nombres canónicos) en UN glTF con recursos externos (la CSP no admite blob:);
 *   · deja el paso SIN desplazamiento (resta la velocidad media de `Bip01`) y mide su zancada; la frenada conserva su
 *     propio desplazamiento (root motion) para que los pies apoyen como en la captura;
 *   · texturas: chaqueta roja → casi negra conservando pliegues y luz; las franjas claras de las mangas → máscara de
 *     acento (el shader las tiñe con el color del país); WebP a 2048 (cuerpo y cabeza) y 1024 (normales).
 *
 * Dependencias SOLO para este script (carpeta aparte): @gltf-transform/core@4 @gltf-transform/functions@4 sharp
 *   node _walkout-rocketbox-build.mjs <avatar.glb> <dirTexturasPNG> <dirClipsGLB> <salida.gltf>
 */
import { NodeIO } from "@gltf-transform/core";
import { mergeDocuments, prune, dedup, resample, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const [avatarPath, texDir, clipsDir, out] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(avatarPath);
const root = doc.getRoot();
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));

/** Clip canónico ← fichero de Rocketbox. */
const CLIPS = JSON.parse(process.env.CLIPS ?? JSON.stringify(process.env.FULL ? {
  Walk_Loop: "m_walk_cool_02__xy", Walk_Stop: "m_walk_stop__xy", Idle_Loop: "m_idle_neutral_01__static",
  Crouch_In: "m_crouch_in__xy", Crouch_Out: "m_crouch_out__xy",
  Cheer_01: "m_cheer_01__static", Cheer_02: "m_cheer_02__xy", Cheer_03: "m_cheer_03__static", Cheer_04: "m_cheer_04__static", Cheer_05: "m_cheer_05__static",
  Angry_01: "m_idle_angry_01__static", Angry_02: "m_idle_angry_02__static", Listen_01: "m_gestic_listen_neutral_01__static", Listen_02: "m_gestic_listen_relaxed_01__static",
  Waiting_01: "m_idle_waiting_01__static", Idle_02: "m_idle_neutral_02__static", Clap_01: "m_claphands_01__static", Walk_Cool_01: "m_walk_cool_01__xy",
} : {
  // los que usa la escena: paso «cool», frenada real, reposo; 0.9: brazo arriba con puño real (Cheer_04: POINT, HYPE,
  // puño de datos), mano a la cara (TouchFace_01: SHUSH); Cheer_05 se conserva (puño corto, sin uso aún)
  Walk_Loop: "m_walk_cool_02__xy", Walk_Stop: "m_walk_stop__xy", Idle_Loop: "m_idle_neutral_01__static",
  Cheer_04: "m_cheer_04__static", Cheer_05: "m_cheer_05__static", TouchFace_01: "m_idle_touch_face_01__static",
}));
const IN_PLACE = new Set(["Walk_Loop", "Walk_Cool_01", "Walk_Stop"]);
const info = {};
for (const [canon, file] of Object.entries(CLIPS)) {
  const src = await io.read(path.join(clipsDir, `${file}.glb`));
  const before = new Set(root.listNodes()), beforeScenes = new Set(root.listScenes()), beforeAnims = new Set(root.listAnimations());
  mergeDocuments(doc, src);
  const added = root.listNodes().filter((n) => !before.has(n));
  for (const a of root.listAnimations()) {
    if (beforeAnims.has(a)) continue;
    a.setName(canon);
    for (const c of a.listChannels()) { const t = c.getTargetNode(); const keep = t && nodes.get(t.getName()); if (keep) c.setTargetNode(keep); else { c.dispose(); } }
    // raíz: medir y, si es un paso, quitar el avance medio (queda en el sitio; la escena lo desplaza por distancia)
    for (const c of a.listChannels()) {
      if (c.getTargetNode()?.getName() !== "Bip01" || c.getTargetPath() !== "translation") continue;
      const s = c.getSampler(); const inp = s.getInput().getArray(); const acc = s.getOutput(); const o = acc.getArray().slice();
      const n = inp.length, dur = inp[n - 1];
      const dz = o[(n - 1) * 3 + 2] - o[2], dx = o[(n - 1) * 3] - o[0];
      info[canon] = { duration: +dur.toFixed(4), rootDelta: [+dx.toFixed(4), +(o[(n - 1) * 3 + 1] - o[1]).toFixed(4), +dz.toFixed(4)] };
      // la frenada: su avance real (z) a 30 Hz, para que la escena lo reaplique y el pie apoye como en la captura
      if (canon === "Walk_Stop") {
        const curve = []; let j = 0;
        for (let t = 0; t <= dur + 1e-6; t += 1 / 30) { while (j < n - 2 && inp[j + 1] < t) j++; const u = Math.min(1, Math.max(0, (t - inp[j]) / ((inp[j + 1] - inp[j]) || 1))); curve.push(+((o[j * 3 + 2] + (o[(j + 1) * 3 + 2] - o[j * 3 + 2]) * u) - o[2]).toFixed(4)); }
        info[canon].curve = curve;
      }
      if (IN_PLACE.has(canon)) { for (let i = 0; i < n; i++) { const k = inp[i] / dur; o[i * 3 + 2] -= o[2] + dz * k; o[i * 3] -= o[0] + dx * k; } acc.setArray(o); }
    }
  }
  for (const s of root.listScenes()) if (!beforeScenes.has(s)) s.dispose();
  for (const n of added) n.dispose();
  for (const sk of root.listSkins().slice(1)) sk.dispose();
}
// clips de Quaternius (CC0) redirigidos al Biped por `_walkout-retarget.ts`: se hornean con su nombre canónico
if (process.env.RETARGET) {
  const rt = JSON.parse(fs.readFileSync(process.env.RETARGET, "utf8"));
  const buf = root.listBuffers()[0];
  for (const [name, c] of Object.entries(rt)) {
    const anim = doc.createAnimation(name);
    const input = doc.createAccessor().setType("SCALAR").setArray(new Float32Array(c.times)).setBuffer(buf);
    for (const [bone, q] of Object.entries(c.rot)) {
      const node = nodes.get(bone.replace(/_/g, " ")); if (!node) { console.log("sin hueso", bone); continue; }
      const out = doc.createAccessor().setType("VEC4").setArray(new Float32Array(q)).setBuffer(buf);
      const smp = doc.createAnimationSampler().setInput(input).setOutput(out).setInterpolation("LINEAR");
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(smp));
    }
    const bip = nodes.get("Bip01");
    const tout = doc.createAccessor().setType("VEC3").setArray(new Float32Array(c.bipPos)).setBuffer(buf);
    const ts = doc.createAnimationSampler().setInput(input).setOutput(tout).setInterpolation("LINEAR");
    anim.addSampler(ts).addChannel(doc.createAnimationChannel().setTargetNode(bip).setTargetPath("translation").setSampler(ts));
    info[name] = { duration: c.duration, retargetedFrom: "Quaternius UAL (CC0)" };
  }
}
for (const a of root.listAnimations()) if (!Object.keys(CLIPS).includes(a.getName()) && !(info[a.getName()]?.retargetedFrom)) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => s.dispose()); a.dispose(); }
console.log("CLIPS", JSON.stringify(info));

/* ── texturas ── */
const tga = (n) => path.join(texDir, n);
async function raw(file) { const { data, info: i } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: i.width, h: i.height }; }
const body = await raw(tga("m024_body_color.png"));
const mask = Buffer.alloc(body.w * body.h);
const W = body.w, H = body.h;
const inRect = (x, y, r) => x >= r[0] * W && x < r[2] * W && y >= r[1] * H && y < r[3] * H;
// zonas del atlas (fracciones del lado): mangas izq/dcha y torso (medidas sobre m024_body_color)
const SLEEVES = [[0, 0.43, 0.31, 0.84], [0.69, 0.43, 1, 0.84]], TORSO = [[0.32, 0.02, 0.68, 1]];
const SHOES = [[0.2, 0.82, 0.33, 1], [0.64, 0.82, 0.8, 1]];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4; const r = body.data[i], g = body.data[i + 1], b = body.data[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, val = mx / 255;
  const jacket = (SLEEVES.some((q) => inRect(x, y, q)) || TORSO.some((q) => inRect(x, y, q))) && !SHOES.some((q) => inRect(x, y, q));
  if (!jacket) continue;
  if (sat > 0.32 && r > g * 1.35 && r > b * 1.35) {
    // rojo de la chaqueta → grafito casi negro con los pliegues (luminancia) de la foto
    const L = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const v = Math.round(255 * (0.035 + L * 0.42));
    body.data[i] = v; body.data[i + 1] = v; body.data[i + 2] = Math.min(255, v + 3);
  } else if (sat < 0.22 && val > 0.5 && SLEEVES.some((q) => inRect(x, y, q))) {
    mask[y * W + x] = 255;                                        // franja de la manga → acento
  }
}
const outDir = path.dirname(out); fs.mkdirSync(outDir, { recursive: true });
const webp = async (img, file, size, q = 86) => { await sharp(img.data ?? img, img.data ? { raw: { width: img.w, height: img.h, channels: 4 } } : undefined).resize(size, size).webp({ quality: q }).toFile(path.join(outDir, file)); return file; };
const files = {
  bodyColor: await webp(body, "rb-body-albedo.webp", 2048),
  bodyNormal: await webp(await raw(tga("m024_body_normal.png")), "rb-body-normal.webp", 1024),
  headColor: await webp(await raw(tga("m024_head_color.png")), "rb-head-albedo.webp", 2048),
  headNormal: await webp(await raw(tga("m024_head_normal.png")), "rb-head-normal.webp", 1024),
  opacity: await webp(await raw(tga("m024_opacity_color.png")), "rb-hair-alpha.webp", 1024, 90),
};
await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).resize(512, 512).blur(0.6).png().toFile(path.join(outDir, "rb-accent-mask.png"));
files.accent = "rb-accent-mask.png";
// especular → rugosidad (glTF: G = rugosidad): la tela mate, la piel algo satinada
const spec = await raw(tga("m024_body_specular.png"));
for (let i = 0; i < spec.data.length; i += 4) { const s = spec.data[i] / 255; const rough = Math.round(255 * (0.95 - s * 0.55)); spec.data[i] = 0; spec.data[i + 1] = rough; spec.data[i + 2] = 0; }
files.bodyRough = await webp(spec, "rb-body-orm.webp", 1024, 80);
console.log("TEX", JSON.stringify(files));

// materiales del glTF → texturas reales
const tex = (file, mime) => { const t = doc.createTexture(file).setURI(file).setMimeType(mime); t.setImage(fs.readFileSync(path.join(outDir, file))); return t; };
const T = { bc: tex(files.bodyColor, "image/webp"), bn: tex(files.bodyNormal, "image/webp"), br: tex(files.bodyRough, "image/webp"), hc: tex(files.headColor, "image/webp"), hn: tex(files.headNormal, "image/webp"), op: tex(files.opacity, "image/webp") };
for (const m of root.listMaterials()) {
  const n = m.getName();
  m.setMetallicFactor(0).setDoubleSided(n.includes("opacity"));
  if (n.endsWith("_body")) m.setBaseColorTexture(T.bc).setNormalTexture(T.bn).setMetallicRoughnessTexture(T.br).setRoughnessFactor(1);
  else if (n.endsWith("_head")) m.setBaseColorTexture(T.hc).setNormalTexture(T.hn).setRoughnessFactor(0.62);
  else if (n.includes("opacity")) m.setBaseColorTexture(T.op).setAlphaMode("MASK").setAlphaCutoff(0.42).setRoughnessFactor(0.75);
}
for (const t of root.listTextures()) if (!Object.values(T).includes(t)) t.dispose();
await doc.transform(resample(), prune(), dedup(), unpartition());
root.listBuffers()[0].setURI("rocketbox-player.bin");
root.listAsset?.();
doc.getRoot().getAsset().extras = { walkout: { clips: info, accentMask: files.accent } };
await io.write(out, doc);
for (const t of root.listTextures()) console.log("tex", t.getURI());
console.log("ok", out);
