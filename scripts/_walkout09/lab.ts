/**
 * WALKOUT 0.9 · laboratorio de celebraciones (instrumento local, fuera de CI). Página mínima con three + el rig REAL
 * (`human3d.ts`) y la pose REAL (`applyCelebrationPose`), sin arena ni Next: luz neutra, fondo gris, cámaras fijas
 * relativas a la persona. La maneja `shots.ts` por CDP con `window.lab`.
 *
 *   npx esbuild scripts/_walkout09/lab.ts --bundle --format=esm --outfile=<dir>/lab.js   (lo hace `serve.mjs`)
 */
import * as THREE from "three";
import { createHumanRig, humanUniforms, loadAccentMap, loadHumanAsset, HUMAN_ASSETS, type HumanRig } from "@/components/walkout/human3d";
import { applyCelebrationPose } from "@/components/walkout/celebrate3d";
import { CELEBRATIONS, type CelebrationId } from "@/domain/walkout/celebration";

const W = 900, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f47);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 4, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2); rim.position.set(-3, 3, -2); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
const grid = new THREE.GridHelper(8, 32, 0x555555, 0x333333); (grid.material as THREE.Material).opacity = 0.5; (grid.material as THREE.Material).transparent = true; scene.add(grid);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.02, 50);

let rig: HumanRig | null = null;
const v = new THREE.Vector3();

/** Cámaras: [posición relativa a la persona] mirando a un hueso (o a un punto). */
const CAMS: Record<string, { pos: [number, number, number]; look: string | [number, number, number]; fov?: number }> = {
  front: { pos: [0, 1.25, 4.6], look: [0, 1.05, 0] },
  // la persona mira a +Z: su brazo DERECHO está en −X
  side: { pos: [-4.6, 1.25, 0], look: [0, 1.05, 0] },         // perfil derecho (el brazo del gesto)
  sideL: { pos: [4.6, 1.25, 0], look: [0, 1.05, 0] },
  threeq: { pos: [-3.2, 1.35, 3.3], look: [0, 1.1, 0] },      // tres cuartos del lado del gesto
  threeqL: { pos: [3.2, 1.35, 3.3], look: [0, 1.1, 0] },
  back: { pos: [-1.5, 1.4, -4.2], look: [0, 1.2, 0] },
  upper: { pos: [-0.9, 1.75, 2.6], look: [0, 1.5, 0] },       // torso, hombro y brazo
  upperSide: { pos: [-2.7, 1.75, 0.4], look: [0, 1.5, 0] },
  face: { pos: [-0.3, 1.68, 0.95], look: "Bip01_Head", fov: 26 },
  faceSide: { pos: [-0.95, 1.66, 0.25], look: "Bip01_Head", fov: 26 },
  hand: { pos: [-0.35, 0.05, 0.75], look: "Bip01_R_Hand", fov: 24 },  // relativa a la mano
  handSide: { pos: [-0.8, 0.05, 0.1], look: "Bip01_R_Hand", fov: 24 },
};

function place(name: string) {
  const c = CAMS[name]; if (!c || !rig) return;
  rig.root.updateMatrixWorld(true);
  const target = typeof c.look === "string" ? rig.root.localToWorld(rig.bone(c.look)!) : new THREE.Vector3(...c.look).add(rig.root.position);
  const base = typeof c.look === "string" && name.startsWith("hand") ? target.clone() : rig.root.position.clone();
  camera.position.set(base.x + c.pos[0], (name.startsWith("hand") ? base.y : 0) + c.pos[1], base.z + c.pos[2]);
  camera.fov = c.fov ?? 32; camera.updateProjectionMatrix();
  camera.lookAt(target);
}

const lab = {
  ready: false,
  error: "",
  async init(avatar: keyof typeof HUMAN_ASSETS = "rocketbox") {
    const url = new URLSearchParams(location.search).get("asset") ?? HUMAN_ASSETS[avatar];
    const gltf = await loadHumanAsset(url);
    const accentMap = await loadAccentMap(gltf, url);
    rig = createHumanRig(gltf, { uniforms: humanUniforms(0x66ccff, 0x3fa9ff), sheen: false, castShadow: false, accentMap });
    scene.add(rig.root);
    lab.ready = true;
  },
  /** La celebración a `t` s de su inicio (el reposo base corre con `idle0 + t`). */
  pose(id: CelebrationId | "IDLE", t: number, idle0 = 2) {
    if (!rig) return;
    rig.root.position.set(0, 0, 0);
    if (id === "IDLE") { rig.layers([{ clip: "Idle_Loop", time: idle0 + t, weight: 1 }]); return; }
    const r = applyCelebrationPose(rig, id, t, idle0 + t);
    rig.root.position.set(r.offset.x, r.lift, r.offset.z);
  },
  clip(name: string, t: number) { rig?.layers([{ clip: name, time: t, weight: 1 }]); rig?.root.position.set(0, 0, 0); },
  cam(name: string) { place(name); renderer.render(scene, camera); },
  render() { renderer.render(scene, camera); },
  duration: (id: CelebrationId) => CELEBRATIONS[id].duration,
  /** Posiciones de huesos en el espacio de la persona (QA numérica). */
  bones(names: string[]) { const o: Record<string, number[]> = {}; for (const n of names) { const b = rig?.bone(n); if (b) o[n] = b.toArray().map((x) => +x.toFixed(4)); } return o; },
  boneNames() { const o: string[] = []; rig?.root.traverse((x) => { if ((x as any).isBone) o.push(x.name); }); return o; },
};
(window as any).lab = lab;
lab.init().catch((e) => { lab.error = String(e?.stack ?? e); });
void v;
