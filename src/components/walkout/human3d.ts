/**
 * PACK WALKOUT 0.2 · LA PERSONA (three.js). Solo la importa `stage3d.ts` (que a su vez entra por import dinámico).
 *
 * Asset: `public/walkout/human/esports-player.gltf` (+ .bin y texturas .webp externas: la CSP no admite blob: en connect-src) — cuerpo humano riggeado de Quaternius «Universal Base Characters»
 * (Superhero_Male, CC0 1.0) + pelo «Hair_SimpleParted» (CC0) + clips esqueléticos `Walk_Loop` · `Idle_Loop` ·
 * `Idle_FoldArms_Loop` · `Jump_Start` · `Jump_Land` · `Punch_Cross` (solo la mano cerrada) de «Universal Animation
 * Library» 1 y 2 (CC0), todo sobre el mismo esqueleto de 65 huesos (estilo UE5).
 * Licencia y procedencia: `public/walkout/human/LICENSE-ASSETS.txt` y `docs/product/walkout-0.2-real-human.md`.
 *
 * El cuerpo de origen viene en ropa interior: la ROPA (camiseta técnica de manga larga, pantalón jogger y zapatillas) se
 * confecciona aquí sobre la propia malla (`tailorOutfit`): cada prenda es una capa desplazada sobre la piel con los MISMOS
 * pesos de esqueleto, así que se mueve con el cuerpo sin simulación; la piel que queda tapada se retira (no asoma).
 * Sin logos ni patrocinadores: un ribete del color de la edición en cuello, hombros y costuras del pantalón.
 *
 * Materiales con dos inyecciones de shader compartidas por uniforms: contraluz (fresnel del color de la edición) y
 * disolución ascendente con borde incandescente (transición persona → carta).
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { IDLE_CLIP, WALK_CLIP } from "@/domain/walkout/walk";
import { FIST_CLIP, type ArmGoal, type BodyBend, type BoneMask, type ClipLayer, type HandShape } from "@/domain/walkout/celebration";
import { walkSpecFromExtras, type WalkSpec } from "@/domain/walkout/walk";
import { clamp01 } from "@/domain/walkout/timeline";

/**
 * 0.4 · avatares disponibles. Por defecto, Rocketbox (Microsoft, MIT): humano realista con ropa fotográfica y clips de
 * captura (paso «cool», frenada real). Quaternius (CC0) se conserva para comparar (`?avatar=quaternius`).
 */
export const HUMAN_ASSETS = { rocketbox: "/walkout/human/rocketbox-player.gltf", quaternius: "/walkout/human/esports-player.gltf" } as const;
export type AvatarId = keyof typeof HUMAN_ASSETS;
export const HUMAN_ASSET_URL = HUMAN_ASSETS.rocketbox;

/** Máscara de acento del asset (Rocketbox), si la declara; nunca rechaza. */
export async function loadAccentMap(gltf: GLTF, url: string): Promise<THREE.Texture | null> {
  const name = (gltf.asset as { extras?: { walkout?: { accentMask?: string } } }).extras?.walkout?.accentMask;
  if (!name || !/^[\w.-]+$/.test(name)) return null;
  try { const t = await new THREE.TextureLoader().loadAsync(url.replace(/[^/]+$/, name)); t.flipY = false; t.colorSpace = THREE.NoColorSpace; return t; } catch { return null; }
}

/* ───────── carga (una vez por sesión de página; cada escenario clona) ───────── */

const cached = new Map<string, Promise<GLTF>>();
export function loadHumanAsset(url: string = HUMAN_ASSET_URL): Promise<GLTF> {
  let p = cached.get(url);
  if (!p) { p = new GLTFLoader().loadAsync(url).catch((e) => { cached.delete(url); throw e; }); cached.set(url, p); }
  return p;
}

/* ───────── la ropa ───────── */

export const PIECE = { SHIRT: 1, PANTS: 2, SHOES: 4 } as const;
export type PieceName = "shirt" | "pants" | "shoes";

export interface OutfitPiece { name: PieceName; geometry: THREE.BufferGeometry }
export interface Outfit { body: THREE.BufferGeometry; pieces: OutfitPiece[] }

const ARM = /^(clavicle|upperarm|lowerarm)_/;
const HAND = /^(hand|index|middle|ring|pinky|thumb)_/;
const LEG = /^(thigh|calf)_/;
const FOOT = /^(foot|ball)_/;
const TORSO = /^(spine_0\d|pelvis)$/;

/** Cortes de la ropa en el espacio de la malla (T-pose, Y arriba, metros; medidos sobre Superhero_Male). */
export const CUTS = { hem: 0.955, waist: 1.065, collar: 1.535, cuffX: 0.655, ankle: 0.095, sole: 0.026 } as const;

/** Prendas que cubren un vértice (máscara PIECE) según su hueso dominante y su posición. */
export function pieceMask(joint: string, x: number, y: number): number {
  const ax = Math.abs(x);
  if (joint === "Head" || HAND.test(joint)) return 0;
  if (joint === "neck_01") return y < CUTS.collar ? PIECE.SHIRT : 0;
  if (ARM.test(joint)) return ax > CUTS.cuffX ? 0 : PIECE.SHIRT;
  let m = 0;
  if (TORSO.test(joint) && y >= CUTS.hem) m |= PIECE.SHIRT;
  if ((TORSO.test(joint) || LEG.test(joint)) && y < CUTS.waist && y >= CUTS.ankle) m |= PIECE.PANTS;
  if (FOOT.test(joint)) m |= PIECE.SHOES;                         // la zapatilla sustituye al pie (piel fuera)
  return m;
}

/**
 * De «superhéroe» a ATLETA: el cuerpo de origen tiene proporciones de cómic (brazos, cuello, pecho y dorsales enormes).
 * Se adelgaza en la pose de reposo, ponderado por los pesos de cada hueso (sin costuras): brazos y muslos hacia su eje,
 * cuello más fino, pecho y dorsales más contenidos, trapecios más bajos. El esqueleto y los pesos no cambian.
 */
export function athleticBuild(src: THREE.BufferGeometry, jointNames: readonly string[]): THREE.BufferGeometry {
  const geo = src.clone();
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight");
  const AXIS = { armY: 1.455, armZ: -0.065, legX: 0.114, legZ: -0.036, neckZ: -0.04 };
  const RADIAL: Record<string, number> = { upperarm: 0.76, lowerarm: 0.85, thigh: 0.9, calf: 0.93 };
  for (let v = 0; v < pos.count; v++) {
    let x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const w: Record<string, number> = {};
    for (let k = 0; k < 4; k++) { const nm = (jointNames[si.getComponent(v, k)] ?? "").replace(/_(l|r)$/, ""); w[nm] = (w[nm] ?? 0) + sw.getComponent(v, k); }
    const arm = (w.upperarm ?? 0) * (1 - RADIAL.upperarm) + (w.lowerarm ?? 0) * (1 - RADIAL.lowerarm);
    if (arm > 0) { const f = 1 - arm; y = AXIS.armY + (y - AXIS.armY) * f; z = AXIS.armZ + (z - AXIS.armZ) * f; }
    const leg = (w.thigh ?? 0) * (1 - RADIAL.thigh) + (w.calf ?? 0) * (1 - RADIAL.calf);
    if (leg > 0) { const f = 1 - leg; const cx = Math.sign(x) * AXIS.legX; x = cx + (x - cx) * f; z = AXIS.legZ + (z - AXIS.legZ) * f; }
    const neck = (w.neck_01 ?? 0) * 0.16;
    if (neck > 0) { x *= 1 - neck; z = AXIS.neckZ + (z - AXIS.neckZ) * (1 - neck); }
    const chest = (w.spine_03 ?? 0) + (w.clavicle ?? 0) * 0.6;
    if (chest > 0) {
      if (z > 0) z *= 1 - 0.2 * chest;                                                        // pectorales
      const ax = Math.abs(x); if (ax > 0.1) x = Math.sign(x) * (0.1 + (ax - 0.1) * (1 - 0.2 * chest));   // dorsales/hombros
      if (y > 1.47 && ax > 0.05 && ax < 0.24) y = 1.47 + (y - 1.47) * (1 - 0.35 * chest);         // trapecios
    }
    const waist = (w.spine_02 ?? 0) + (w.spine_01 ?? 0) * 0.7;
    if (waist > 0) { const ax = Math.abs(x); if (ax > 0.09) x = Math.sign(x) * (0.09 + (ax - 0.09) * (1 - 0.12 * waist)); if (z > 0) z *= 1 - 0.1 * waist; }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(out, 3));
  geo.computeBoundingSphere();
  return geo;
}

interface Tone { base: number; accent: number }
/** Gris de la tela (r=g=b) y máscara de ribete por vértice. */
function toneOf(piece: PieceName, joint: string, p: THREE.Vector3, n: THREE.Vector3): Tone {
  if (piece === "shirt") {
    if (joint === "neck_01" || (TORSO.test(joint) && p.y > 1.5)) return { base: 0.03, accent: p.y > 1.515 ? 1 : 0 };    // cuello con ribete
    if (ARM.test(joint) && Math.abs(p.x) > CUTS.cuffX - 0.03) return { base: 0.025, accent: 0 };                       // puño
    if (ARM.test(joint)) return { base: 0.12, accent: n.y > 0.82 && Math.abs(p.x) > 0.26 ? 1 : 0 };                  // manga grafito + vivo
    if (TORSO.test(joint) && p.y < CUTS.hem + 0.03) return { base: 0.025, accent: 0 };                                // bajo
    return { base: 0.05, accent: 0 };
  }
  if (piece === "pants") {
    const outward = Math.sign(p.x) * n.x;
    if (LEG.test(joint) && outward > 0.8 && p.y > CUTS.ankle + 0.06) return { base: 0.03, accent: 1 };                 // costura lateral
    if (p.y < CUTS.ankle + 0.05) return { base: 0.02, accent: 0 };                                                     // puño del jogger
    if (p.y > CUTS.waist - 0.035) return { base: 0.02, accent: 0 };                                                    // cintura
    return { base: 0.085, accent: 0 };                                                                               // jogger gris carbón
  }
  return { base: 0.08, accent: 0 };
}

const THICK: Record<PieceName, (joint: string, y: number) => number> = {
  shirt: (j, y) => (TORSO.test(j) || j === "neck_01" ? (y > 1.47 ? 0.011 : 0.017) : 0.012),
  pants: (j, y) => (y < CUTS.ankle + 0.07 ? 0.009 : LEG.test(j) && y < 0.55 ? 0.012 : 0.015),
  shoes: () => 0,
};

/**
 * Confecciona la ropa sobre la malla del cuerpo: devuelve el cuerpo SIN la piel tapada y una geometría por prenda
 * (capa desplazada por la normal suavizada, con los mismos pesos de esqueleto, UV y un tono por vértice).
 */
export function tailorOutfit(src: THREE.BufferGeometry, jointNames: readonly string[]): Outfit {
  const geo = src.index ? src : src.clone();
  if (!geo.index) throw new Error("tailorOutfit: la malla debe ser indexada");
  const pos = geo.getAttribute("position"), nor = geo.getAttribute("normal");
  const si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight");
  const idx = geo.index.array;
  const n = pos.count;

  // hueso dominante y máscara de prendas por vértice
  const joint: string[] = new Array(n);
  const mask = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > bw) { bw = w; best = si.getComponent(v, k); } }
    joint[v] = jointNames[best] ?? "";
    mask[v] = pieceMask(joint[v], pos.getX(v), pos.getY(v));
  }

  // soldadura por posición (las costuras UV parten vértices): normal suavizada y vecinos para drapear
  const weld = new Int32Array(n); const keyOf = new Map<string, number>(); let nw = 0;
  for (let v = 0; v < n; v++) {
    const key = `${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
    let w = keyOf.get(key); if (w === undefined) { w = nw++; keyOf.set(key, w); } weld[v] = w;
  }
  const wn = new Float32Array(nw * 3);
  for (let v = 0; v < n; v++) { const w = weld[v] * 3; wn[w] += nor.getX(v); wn[w + 1] += nor.getY(v); wn[w + 2] += nor.getZ(v); }
  for (let w = 0; w < nw; w++) { const l = Math.hypot(wn[w * 3], wn[w * 3 + 1], wn[w * 3 + 2]) || 1; wn[w * 3] /= l; wn[w * 3 + 1] /= l; wn[w * 3 + 2] /= l; }

  const pieces: OutfitPiece[] = [];
  const covered = new Uint8Array(idx.length / 3);
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (const [name, bit] of [["shirt", PIECE.SHIRT], ["pants", PIECE.PANTS], ["shoes", PIECE.SHOES]] as const) {
    const tris: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (mask[a] & bit && mask[b] & bit && mask[c] & bit) { tris.push(a, b, c); covered[t / 3] = 1; }
    }
    if (!tris.length) continue;
    if (name === "shoes") { for (const side of ["l", "r"] as const) pieces.push({ name, geometry: sneaker(pos, joint, jointNames, side) }); continue; }
    // vértices usados → índices locales
    const local = new Map<number, number>(); const order: number[] = [];
    for (const v of tris) if (!local.has(v)) { local.set(v, order.length); order.push(v); }
    // posiciones desplazadas (en el espacio soldado: las costuras UV no se abren)
    const wpos = new Map<number, THREE.Vector3>();
    for (const v of order) {
      const w = weld[v]; if (wpos.has(w)) continue;
      P.fromBufferAttribute(pos, v); N.set(wn[w * 3], wn[w * 3 + 1], wn[w * 3 + 2]);
      wpos.set(w, P.clone().addScaledVector(N, THICK[name](joint[v], P.y)));
    }
    // drapeado: la tela no se pega a cada músculo (Laplaciano sobre el torso y los muslos, bordes fijos)
    {
      const nb = new Map<number, Set<number>>(); const edgeCount = new Map<string, number>();
      for (let t = 0; t < tris.length; t += 3) {
        const ws = [weld[tris[t]], weld[tris[t + 1]], weld[tris[t + 2]]];
        for (let e = 0; e < 3; e++) {
          const p = ws[e], q = ws[(e + 1) % 3]; if (p === q) continue;
          (nb.get(p) ?? nb.set(p, new Set()).get(p)!).add(q); (nb.get(q) ?? nb.set(q, new Set()).get(q)!).add(p);
          const k = p < q ? `${p}_${q}` : `${q}_${p}`; edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
        }
      }
      const border = new Set<number>();
      for (const [k, c] of edgeCount) if (c === 1) { const [p, q] = k.split("_").map(Number); border.add(p); border.add(q); }
      const drape = new Set<number>();
      for (const v of order) if (!ARM.test(joint[v]) && joint[v] !== "neck_01" && !(name === "pants" && pos.getY(v) < 0.5)) drape.add(weld[v]);
      // la tela no marca cada músculo
      for (let it = 0; it < 4; it++) {
        const next = new Map<number, THREE.Vector3>();
        for (const w of drape) {
          if (border.has(w)) continue;
          const ns = nb.get(w); if (!ns?.size) continue;
          const avg = new THREE.Vector3(); for (const q of ns) avg.add(wpos.get(q)!); avg.multiplyScalar(1 / ns.size);
          next.set(w, wpos.get(w)!.clone().lerp(avg, 0.5));
        }
        for (const [w, p] of next) wpos.get(w)!.copy(p);
      }
    }
    const count = order.length;
    const oPos = new Float32Array(count * 3), oUv = new Float32Array(count * 2), oTone = new Float32Array(count * 3), oAcc = new Float32Array(count);
    const oSi = new Uint16Array(count * 4), oSw = new Float32Array(count * 4);
    const uv = geo.getAttribute("uv");
    order.forEach((v, i) => {
      const p = wpos.get(weld[v])!; oPos.set([p.x, p.y, p.z], i * 3);
      if (uv) oUv.set([uv.getX(v), uv.getY(v)], i * 2);
      P.fromBufferAttribute(pos, v); N.set(wn[weld[v] * 3], wn[weld[v] * 3 + 1], wn[weld[v] * 3 + 2]);
      const tone = toneOf(name, joint[v], P, N); oTone.set([tone.base, tone.base, tone.base], i * 3); oAcc[i] = tone.accent;
      for (let k = 0; k < 4; k++) { oSi[i * 4 + k] = si.getComponent(v, k); oSw[i * 4 + k] = sw.getComponent(v, k); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(oPos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(oUv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(oTone, 3));
    g.setAttribute("accent", new THREE.BufferAttribute(oAcc, 1));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(oSi, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(oSw, 4));
    g.setIndex(tris.map((v) => local.get(v)!));
    g.computeVertexNormals();
    smoothSeamNormals(g);
    g.computeBoundingSphere();
    pieces.push({ name, geometry: g });
  }

  // cuerpo: fuera la piel tapada (los triángulos de borde se quedan: no hay huecos bajo los puños)
  const body = geo.clone();
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) if (!covered[t / 3]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  body.setIndex(keep);
  return { body, pieces };
}

/**
 * Zapatilla deportiva paramétrica sobre el pie de un lado (casi rígida, como una de verdad): suela plana con puntera
 * levantada, contrafuerte alto en el talón, empeine que baja hacia la puntera redondeada. Medida sobre los vértices del
 * pie; pesos: talón y empeine al hueso `foot`, puntera al `ball` (dobla al despegar).
 */
function sneaker(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, joint: string[], jointNames: readonly string[], side: "l" | "r"): THREE.BufferGeometry {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < pos.count; v++) {
    if (!FOOT.test(joint[v]) || !joint[v].endsWith(`_${side}`)) continue;
    x0 = Math.min(x0, pos.getX(v)); x1 = Math.max(x1, pos.getX(v)); z0 = Math.min(z0, pos.getZ(v)); z1 = Math.max(z1, pos.getZ(v));
  }
  const cx = (x0 + x1) / 2, W = (x1 - x0) / 2 + 0.014, zs = z0 - 0.014, L = z1 - z0 + 0.03;
  const foot = jointNames.indexOf(`foot_${side}`), ball = jointNames.indexOf(`ball_${side}`);
  const RINGS = 28, SEG = 28, P = 4;                                  // superelipse n = 4: caja redondeada
  const ps: number[] = [], tone: number[] = [], acc: number[] = [], si: number[] = [], sw: number[] = [], uv: number[] = [];
  const sgnPow = (c: number, e: number) => Math.sign(c) * Math.abs(c) ** e;
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    // extremos redondeados: la sección se cierra en talón y puntera
    const cap = Math.sin(Math.min(1, u / 0.1, (1 - u) / 0.14) * Math.PI / 2) ** 0.55;
    const half = W * cap * (u < 0.3 ? 0.84 + 0.16 * (u / 0.3) : u > 0.75 ? 1 - 0.18 * ((u - 0.75) / 0.25) : 1);
    const top = u < 0.28 ? 0.122 : u < 0.62 ? 0.122 - ((u - 0.28) / 0.34) * 0.04 : 0.082 - ((u - 0.62) / 0.38) * 0.036;
    const bottom = -0.002 + (u > 0.82 ? ((u - 0.82) / 0.18) ** 2 * 0.016 : 0);       // puntera levantada (toe spring)
    const height = (top - bottom) * (0.35 + 0.65 * cap);
    const mid = bottom + height / 2, b = height / 2, z = zs + u * L;
    const toeW = clamp01((z - 0.03) / 0.05);                           // empeine → puntera: del pie al dedo
    for (let k = 0; k <= SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      const x = cx + half * sgnPow(Math.cos(th), 2 / P), y = Math.max(bottom, mid + b * sgnPow(Math.sin(th), 2 / P));
      ps.push(x, y, z); uv.push(k / SEG, u);
      const sole = y < CUTS.sole;
      const heelTab = u < 0.18 && y > 0.06;
      const t = sole ? 0.86 : 0.07;
      tone.push(t, t, t); acc.push(heelTab || (!sole && y < CUTS.sole + 0.008) ? 1 : 0);
      si.push(foot, ball, 0, 0); sw.push(1 - toeW, toeW, 0, 0);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
    const a = r * (SEG + 1) + k, b = a + SEG + 1;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(tone, 3));
  g.setAttribute("accent", new THREE.Float32BufferAttribute(acc, 1));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  // la normal mira hacia fuera (el sentido de la tira lo decide la parametrización)
  const n = g.getAttribute("normal"), q = g.getAttribute("position");
  let out = 0; for (let v = 0; v < q.count; v++) out += (q.getX(v) - cx) * n.getX(v);
  if (out < 0) { const ix = g.index!.array; for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; } g.computeVertexNormals(); }
  smoothSeamNormals(g);
  g.computeBoundingSphere();
  return g;
}

/** Normales promediadas entre vértices que comparten posición (sin líneas en las costuras de UV). */
function smoothSeamNormals(g: THREE.BufferGeometry): void {
  const p = g.getAttribute("position"), nm = g.getAttribute("normal") as THREE.BufferAttribute;
  const acc = new Map<string, [number, number, number, number[]]>();
  for (let v = 0; v < p.count; v++) {
    const k = `${Math.round(p.getX(v) * 1e4)},${Math.round(p.getY(v) * 1e4)},${Math.round(p.getZ(v) * 1e4)}`;
    const a = acc.get(k) ?? [0, 0, 0, []]; a[0] += nm.getX(v); a[1] += nm.getY(v); a[2] += nm.getZ(v); a[3].push(v); acc.set(k, a);
  }
  for (const [x, y, z, vs] of acc.values()) { const l = Math.hypot(x, y, z) || 1; for (const v of vs) nm.setXYZ(v, x / l, y / l, z / l); }
}

/* ───────── shader compartido: contraluz + disolución ───────── */

export interface HumanUniforms {
  /** 0.4 · máscara (R) de las piezas de la ropa que toman el color de acento (null: ninguna). */
  uAccentMap?: { value: THREE.Texture | null };
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  /** 0 = entero · 1 = disuelto del todo (de los pies a la cabeza). */
  uDissolve: { value: number };
  uBurnColor: { value: THREE.Color };
}

export function humanUniforms(rim: THREE.ColorRepresentation, accent: THREE.ColorRepresentation): HumanUniforms {
  return { uRim: { value: 0 }, uRimColor: { value: new THREE.Color(rim) }, uAccent: { value: new THREE.Color(accent) }, uDissolve: { value: 0 }, uBurnColor: { value: new THREE.Color(rim) } };
}

function patch(mat: THREE.MeshStandardMaterial, u: HumanUniforms, cloth: boolean, accentMap: THREE.Texture | null = null): void {
  const masked = !!accentMap && !!mat.map;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (masked) sh.uniforms.uAccentMap = { value: accentMap };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWoLocal;\nvarying float vWoY;${cloth ? "\nattribute float accent;\nvarying float vAccent;" : ""}`)
      .replace("#include <skinning_vertex>", `#include <skinning_vertex>\nvWoLocal = transformed;\nvWoY = (modelMatrix * vec4(transformed, 1.0)).y;${cloth ? "\nvAccent = accent;" : ""}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uRim; uniform vec3 uRimColor; uniform vec3 uAccent; uniform float uDissolve; uniform vec3 uBurnColor;${masked ? "\nuniform sampler2D uAccentMap;" : ""}
varying vec3 vWoLocal; varying float vWoY;${cloth ? "\nvarying float vAccent;" : ""}
float woHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
float woEdge = -0.25 + uDissolve * 2.4;                                  // el frente sube de los pies a la cabeza
float woH = vWoY + (woHash(floor(vWoLocal * 38.0)) - 0.5) * 0.22;         // celdas: se deshace en «píxeles» de luz
if (uDissolve > 0.0 && woH < woEdge) discard;
float woBurn = uDissolve > 0.0 ? 1.0 - smoothstep(0.0, 0.07, woH - woEdge) : 0.0;`)
      .replace("#include <color_fragment>", `#include <color_fragment>${cloth ? "\ndiffuseColor.rgb = mix(diffuseColor.rgb, uAccent * 0.55, vAccent);" : ""}${masked ? "\nfloat woMask = texture2D(uAccentMap, vMapUv).r;\ndiffuseColor.rgb = mix(diffuseColor.rgb, uAccent * (0.35 + 0.5 * dot(diffuseColor.rgb, vec3(0.333))), woMask);" : ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float woFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.6);
totalEmissiveRadiance += uRimColor * woFres * uRim${cloth ? " + uAccent * vAccent * uRim * 0.35" : ""};
totalEmissiveRadiance += uBurnColor * woBurn * 6.0;`);
  };
  mat.customProgramCacheKey = () => `walkout-human-${cloth ? "cloth" : "skin"}${masked ? "-mask" : ""}`;
}

/** Normal de punto técnico (canalé fino + grano) generada en un lienzo: sin texturas de terceros. */
function knitNormal(): THREE.CanvasTexture {
  const S = 128; const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!; const img = g.createImageData(S, S);
  const h = (x: number, y: number) => Math.sin((x / S) * Math.PI * 2 * 16) * 0.6 + Math.sin(((x + y * 0.5) / S) * Math.PI * 2 * 48) * 0.15 + (((x * 73856093) ^ (y * 19349663)) % 7) / 40;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h((x + 1) % S, y) - h((x + S - 1) % S, y), dy = h(x, (y + 1) % S) - h(x, (y + S - 1) % S);
    const nx = -dx * 0.5, ny = -dy * 0.5, l = Math.hypot(nx, ny, 1);
    const i = (y * S + x) * 4; img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 22); return t;
}

/* ───────── el rig listo para la escena ───────── */

export interface HumanPose { walkTime: number; walkWeight: number; idleTime: number }

export interface HumanRig {
  /** Perfil del esqueleto (nombres de huesos de la IK, los pies y las manos). */
  profile: SkeletonProfile;
  /** El paso que declara el asset (zancada medida y frenada capturada), o null (Quaternius: el de `walk.ts`). */
  walkSpec: WalkSpec | null;
  /** Grupo a colocar en la escena (pies en y = 0, mirando a +Z). */
  root: THREE.Group;
  uniforms: HumanUniforms;
  /** Mallas (para sombras / visibilidad). */
  meshes: THREE.SkinnedMesh[];
  pose: (p: HumanPose) => void;
  /** Bola del pie de ese lado en el espacio de `root` tras la última `pose` (para clavar el pie de apoyo). */
  foot: (side: "l" | "r") => THREE.Vector3;
  /**
   * Levanta el tobillo de ese lado `dy` metros con IK de dos huesos (cadera–rodilla–tobillo), manteniendo la rodilla en
   * su plano y el pie con la orientación que traía: al pasar del paso al reposo, el pie libre DA UN PASO en vez de
   * arrastrarse hasta su sitio.
   */
  lift: (side: "l" | "r", dy: number) => void;
  /** 0.3 · pose por capas de clips (cualquier clip del asset; uno que no exista se ignora y el resto se renormaliza). */
  layers: (ls: readonly ClipLayer[]) => void;
  /**
   * 0.9 · IK de PRECISIÓN del brazo sobre la pose que ya trae (capturada): conserva el plano del codo de la captura y solo
   * corrige lo que falta para la meta (mano sobre la cabeza con ~30° de codo · falange media del índice, vertical, delante
   * de los labios). Mezclada por `weight`.
   */
  reach: (side: "l" | "r", goal: ArmGoal, weight: number) => void;
  /** 0.9 · forma de la mano con los dedos de DATOS capturados (el puño de `Cheer_04` en Rocketbox; de `Punch_Cross` en Quaternius). */
  hand: (side: "l" | "r", shape: HandShape, weight: number) => void;
  /** 0.9 · un clip aplicado SOLO a un grupo de huesos (brazo, tronco…), mezclado sobre la pose actual. */
  masked: (clip: string, time: number, mask: BoneMask, weight: number) => void;
  /** 0.9 · acompañamiento del tronco o de la cabeza (giro en ejes del cuerpo, repartido entre sus huesos). */
  bend: (b: BodyBend) => void;
  /** ¿Están estos clips en el asset? (si no, la celebración usa una pose segura). */
  hasClips: (names: readonly string[]) => boolean;
  /** Posición de un hueso en el espacio de `root` (QA / encuadre). */
  bone: (name: string) => THREE.Vector3 | null;
  dispose: () => void;
}

/** Huesos de los dedos de una mano (Quaternius). */
const FINGERS = ["index", "middle", "ring", "pinky", "thumb"].flatMap((f) => ["01", "02", "03"].map((k) => `${f}_${k}`));

type Side = "l" | "r";
type FingerName = "index" | "middle" | "ring" | "pinky" | "thumb";
/**
 * 0.4 · PERFIL DE ESQUELETO: los nombres de los huesos que usan la IK, los pies y las manos. Quaternius (UE5, `thigh_l`…)
 * o Rocketbox (3ds Max Biped, `Bip01 L Thigh`…; GLTFLoader cambia los espacios por «_»: `Bip01_L_Thigh`). Lo demás (clips, capas, sombras, disolución) es común.
 */
export interface SkeletonProfile {
  id: "quaternius" | "rocketbox";
  head: string;
  thigh: (s: Side) => string; calf: (s: Side) => string; foot: (s: Side) => string; ball: (s: Side) => string;
  clavicle: (s: Side) => string; upperarm: (s: Side) => string; lowerarm: (s: Side) => string; hand: (s: Side) => string;
  /** Tronco (sin el hueso del que cuelgan las piernas) y cuello. */
  spine: readonly string[]; neck: string;
  /** Labios (huesos de la cara), si el rig los trae. */
  lips: readonly string[] | null;
  /** Falange `k` (0 = base) del dedo. */
  finger: (f: FingerName, k: 0 | 1 | 2, s: Side) => string;
  /** ¿Confeccionar ropa y adelgazar? (solo el cuerpo base de Quaternius, que viene en ropa interior). */
  tailor: boolean;
}
export const QUATERNIUS_PROFILE: SkeletonProfile = {
  id: "quaternius", head: "Head", tailor: true,
  thigh: (s) => `thigh_${s}`, calf: (s) => `calf_${s}`, foot: (s) => `foot_${s}`, ball: (s) => `ball_${s}`,
  clavicle: (s) => `clavicle_${s}`, upperarm: (s) => `upperarm_${s}`, lowerarm: (s) => `lowerarm_${s}`, hand: (s) => `hand_${s}`,
  finger: (f, k, s) => `${f}_0${k + 1}_${s}`,
  spine: ["spine_01", "spine_02", "spine_03"], neck: "neck_01", lips: null,
};
const BIPED_FINGER: Record<FingerName, number> = { thumb: 0, index: 1, middle: 2, ring: 3, pinky: 4 };
const B = (s: Side) => (s === "l" ? "L" : "R");
export const ROCKETBOX_PROFILE: SkeletonProfile = {
  id: "rocketbox", head: "Bip01_Head", tailor: false,
  thigh: (s) => `Bip01_${B(s)}_Thigh`, calf: (s) => `Bip01_${B(s)}_Calf`, foot: (s) => `Bip01_${B(s)}_Foot`, ball: (s) => `Bip01_${B(s)}_Toe0`,
  clavicle: (s) => `Bip01_${B(s)}_Clavicle`, upperarm: (s) => `Bip01_${B(s)}_UpperArm`, lowerarm: (s) => `Bip01_${B(s)}_Forearm`, hand: (s) => `Bip01_${B(s)}_Hand`,
  finger: (f, k, s) => `Bip01_${B(s)}_Finger${BIPED_FINGER[f]}${k ? k : ""}`,
  // (Biped: los MUSLOS cuelgan de `Bip01 Spine` — girarlo arrastraría los pies — y las CLAVÍCULAS de `Bip01 Neck`)
  spine: ["Bip01_Spine1", "Bip01_Spine2"], neck: "Bip01_Neck", lips: ["Bip01_MUpperLip", "Bip01_MBottomLip"],
};
/** El perfil sale del propio asset (un Biped tiene `Bip01 Pelvis`). */
export const profileOf = (root: THREE.Object3D): SkeletonProfile => (root.getObjectByName("Bip01_Pelvis") ? ROCKETBOX_PROFILE : QUATERNIUS_PROFILE);
const FINGER_NAMES: FingerName[] = ["index", "middle", "ring", "pinky", "thumb"];
/**
 * El puño sale de DATOS capturados: Quaternius, la guardia de `Punch_Cross` (medio cerrada: se prolonga ×1,8);
 * Rocketbox (0.9), el puño de `Cheer_04` con el brazo arriba (cerrado de verdad: tal cual).
 */
export const FIST_FROM = { clip: "Punch_Cross", time: 0.0 } as const;
export const FIST_FROM_ROCKETBOX = { clip: FIST_CLIP, time: 2.4 } as const;
/** Distancia (m) delante de los huesos de los labios a la que apoya el índice en el SHUSH (piel + medio dedo). */
export const LIPS_CONTACT = 0.021;
/** Los huesos `MUpperLip`/`MBottomLip` quedan algo por encima de la línea de la boca: el contacto baja esto (m). */
export const LIPS_DROP = 0.032;

const outfitCache = new WeakMap<GLTF, { outfit: Outfit; bodyName: string }>();

export interface HumanOptions {
  uniforms: HumanUniforms;
  /** Tela con brillo de terciopelo (MeshPhysicalMaterial.sheen) — más caro: solo escritorio. */
  sheen: boolean;
  castShadow: boolean;
  /** Clip de paso (`Walk_Loop` por defecto) y de reposo (`IDLE_CLIP`). */
  walkClip?: string;
  idleClip?: string;
  /** 0.4 · máscara de acento de la ropa (Rocketbox), ya cargada. */
  accentMap?: THREE.Texture | null;
}

export function createHumanRig(gltf: GLTF, opts: HumanOptions): HumanRig {
  const scene = cloneSkinned(gltf.scene) as THREE.Group;
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
  const body = skinned.reduce((a, b) => (b.geometry.getAttribute("position").count > a.geometry.getAttribute("position").count ? b : a));
  const prof = profileOf(scene);

  // Quaternius viene en ropa interior: ropa confeccionada sobre la malla. Rocketbox ya trae su ropa (fotográfica).
  let cache = outfitCache.get(gltf);
  if (!cache && prof.tailor) {
    const joints = body.skeleton.bones.map((b) => b.name);
    cache = { outfit: tailorOutfit(athleticBuild(body.geometry, joints), joints), bodyName: body.name };
    outfitCache.set(gltf, cache);
  }
  if (cache) body.geometry = cache.outfit.body;

  const owned: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  for (const m of skinned) {
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = src.clone();
    if (m === body && prof.tailor) { mat.roughness = 1; mat.envMapIntensity = 0.6; }
    if (mat.alphaTest > 0) mat.alphaToCoverage = true;           // pelo y pestañas (Rocketbox): borde suave
    patch(mat, opts.uniforms, false, m === body ? opts.accentMap ?? null : null);
    m.material = mat; owned.push(mat);
    for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap"] as const) { const t = src[k]; if (t) textures.push(t); }
  }

  const knit = knitNormal(); textures.push(knit);
  const clothMat = opts.sheen
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, normalMap: knit, normalScale: new THREE.Vector2(0.3, 0.3), sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x9aa0aa), side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, normalMap: knit, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide });
  patch(clothMat, opts.uniforms, true); owned.push(clothMat);
  const soleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  patch(soleMat, opts.uniforms, true); owned.push(soleMat);

  for (const piece of cache?.outfit.pieces ?? []) {
    const mesh = new THREE.SkinnedMesh(piece.geometry, piece.name === "shoes" ? soleMat : clothMat);
    mesh.name = `outfit-${piece.name}`;
    mesh.bind(body.skeleton, body.bindMatrix);
    body.parent!.add(mesh);
    skinned.push(mesh);
  }
  for (const m of skinned) { m.castShadow = opts.castShadow; m.receiveShadow = false; m.frustumCulled = false; }

  // las zapatillas añaden suela: la persona se apoya sobre ella (sin hundirse en el suelo)
  const shoes = cache?.outfit.pieces.find((p) => p.name === "shoes");
  let minY = 0;
  if (shoes) { const a = shoes.geometry.getAttribute("position"); minY = Infinity; for (let i = 0; i < a.count; i++) minY = Math.min(minY, a.getY(i)); }
  const root = new THREE.Group(); root.name = "walkout-human"; root.add(scene); scene.position.y = -minY - 0.004;

  const mixer = new THREE.AnimationMixer(scene);
  const clip = (name: string) => gltf.animations.find((a) => a.name === name);
  const walkClip = clip(opts.walkClip ?? WALK_CLIP.name) ?? clip(WALK_CLIP.name);
  const idleClip = clip(opts.idleClip ?? IDLE_CLIP.name) ?? clip(IDLE_CLIP.name);
  if (!walkClip || !idleClip) throw new Error("walkout human: faltan los clips de paso o reposo");
  const walk = mixer.clipAction(walkClip); const idle = mixer.clipAction(idleClip);
  walk.play(); idle.play();
  // acciones extra (celebraciones), creadas al pedirlas; todas con peso 0 salvo las de la capa actual
  const actions = new Map<string, THREE.AnimationAction>([[walkClip.name, walk], [idleClip.name, idle]]);
  const action = (name: string) => {
    let a = actions.get(name);
    if (!a) { const c = clip(name); if (!c) return null; a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); actions.set(name, a); }
    return a;
  };
  let restBones: (readonly [THREE.Object3D, THREE.Quaternion])[] | null = null;
  // three (PropertyMixer.apply) solo escribe un hueso si su valor cambió desde la última aplicación: con el tiempo quieto
  // (pausa, seek, qaHold) se quedaría la IK del fotograma anterior y el puño se acumularía. Se reescribe la pose del clip
  // de todos los huesos ligados, siempre (three 0.186: búfer [entrada, acu0, acu1, …], `_accuIndex` es el recién aplicado).
  const forceApply = (m: THREE.AnimationMixer) => {
    const mm = m as unknown as { _bindings: { buffer: ArrayLike<number>; valueSize: number; binding: { setValue(b: ArrayLike<number>, o: number): void } }[]; _nActiveBindings: number; _accuIndex: number };
    if (!Array.isArray(mm._bindings) || typeof mm._accuIndex !== "number") return;
    for (let i = 0; i < mm._nActiveBindings; i++) { const pm = mm._bindings[i]; pm.binding.setValue(pm.buffer, (mm._accuIndex + 1) * pm.valueSize); }
  };
  const setLayers = (ls: readonly ClipLayer[]) => {
    const live = ls.map((l) => ({ l, a: action(l.clip) })).filter((x): x is { l: ClipLayer; a: THREE.AnimationAction } => !!x.a && x.l.weight > 0);
    const sum = live.reduce((t, x) => t + x.l.weight, 0);
    for (const a of actions.values()) a.setEffectiveWeight(0);
    if (!sum) idle.setEffectiveWeight(1);
    for (const { l, a } of live) {
      const d = a.getClip().duration;
      // un clip que no se repite (salto, aterrizaje, mano a la boca) se queda en su último fotograma
      a.time = /_Loop$/.test(l.clip) ? ((l.time % d) + d) % d : Math.min(Math.max(0, l.time), d - 1e-4);
      a.setEffectiveWeight(l.weight / sum);
    }
    // los dedos que ningún clip anima vuelven a su reposo: el puño procedural gira desde ahí y no se acumula fotograma a fotograma
    restBones ??= [...rest].map(([name, q]) => [scene.getObjectByName(name), q] as const).filter((x): x is readonly [THREE.Object3D, THREE.Quaternion] => !!x[0]);
    for (const [bone, q] of restBones) bone.quaternion.copy(q);
    mixer.update(0);
    forceApply(mixer);
  };
  // pose de reposo (T-pose del asset) de los dedos y el puño sacado de datos de animación
  const rest = new Map<string, THREE.Quaternion>();
  scene.traverse((o) => { if (FINGERS.some((f) => o.name.startsWith(f))) rest.set(o.name, o.quaternion.clone()); });
  const fistClip = clip(FIST_FROM.clip);
  const fistQ = new Map<string, THREE.Quaternion>();
  if (fistClip) for (const tr of fistClip.tracks) {
    if (!tr.name.endsWith(".quaternion")) continue;
    const name = tr.name.slice(0, -".quaternion".length);
    if (!FINGERS.some((f) => name.startsWith(f))) continue;
    // fotograma clave más cercano a FIST_FROM.time (el puño es una pose sostenida: no hace falta interpolar)
    let k = 0; for (let i = 1; i < tr.times.length; i++) if (Math.abs(tr.times[i] - FIST_FROM.time) < Math.abs(tr.times[k] - FIST_FROM.time)) k = i;
    const v = tr.values;
    fistQ.set(name, new THREE.Quaternion(v[k * 4], v[k * 4 + 1], v[k * 4 + 2], v[k * 4 + 3]));
  }
  // Medido: las manos de estos clips comparten un mismo «medio cerrado»; para un PUÑO de verdad se prolonga ese giro
  // desde la pose de reposo (×1,8 en los dedos, ×1,2 en el pulgar). Sigue siendo la curva de los datos, más cerrada.
  for (const [name, q] of fistQ) {
    const r0 = rest.get(name); if (!r0) continue;
    const delta = r0.clone().invert().multiply(q);
    const ang = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));
    if (ang < 1e-4) continue;
    const ax = new THREE.Vector3(delta.x, delta.y, delta.z).normalize();
    const k = name.startsWith("thumb") ? 1.2 : 1.8;
    fistQ.set(name, r0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, Math.min(ang * k, Math.PI * 0.62))));
  }
  const balls = { l: scene.getObjectByName(prof.ball("l"))!, r: scene.getObjectByName(prof.ball("r"))! };
  const legs = (["l", "r"] as const).reduce((m, s) => ({ ...m, [s]: { hip: scene.getObjectByName(prof.thigh(s))!, knee: scene.getObjectByName(prof.calf(s))!, ankle: scene.getObjectByName(prof.foot(s))! } }), {} as Record<"l" | "r", { hip: THREE.Object3D; knee: THREE.Object3D; ankle: THREE.Object3D }>);
  // reposo de los dedos según el perfil (para el índice extendido y el puño procedural)
  for (const s of ["l", "r"] as const) for (const f of FINGER_NAMES) for (const k of [0, 1, 2] as const) {
    const b = scene.getObjectByName(prof.finger(f, k, s)); if (b && !rest.has(b.name)) rest.set(b.name, b.quaternion.clone());
  }

  /* ── 0.9 · clips enmascarados: muestreo directo de las pistas de rotación (interpolante de three, sin mixer) ── */
  const fingerNames = (s: Side) => FINGER_NAMES.flatMap((f) => ([0, 1, 2] as const).map((k) => prof.finger(f, k, s)));
  const armBones = (s: Side) => [prof.clavicle(s), prof.upperarm(s), prof.lowerarm(s), prof.hand(s)];
  const MASKS: Record<BoneMask | "fingers", ReadonlySet<string>> = {
    armR: new Set(armBones("r")), armL: new Set(armBones("l")), spine: new Set(prof.spine), neck: new Set([prof.neck, prof.head]),
    upper: new Set([...prof.spine, prof.neck, prof.head, ...armBones("r"), ...armBones("l")]),
    fingers: new Set([...fingerNames("l"), ...fingerNames("r")]),
  };
  const sampled = new Map<string, { bone: THREE.Object3D; it: THREE.Interpolant }[]>();
  const tracksOf = (clipName: string, mask: BoneMask | "fingers") => {
    const key = `${clipName}|${mask}`;
    let list = sampled.get(key);
    if (!list) {
      list = [];
      const c = clip(clipName);
      if (c) for (const tr of c.tracks) {
        if (!tr.name.endsWith(".quaternion")) continue;
        const name = tr.name.slice(0, -".quaternion".length);
        const bone = MASKS[mask].has(name) ? scene.getObjectByName(name) : undefined;
        if (bone) list.push({ bone, it: (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() });
      }
      sampled.set(key, list);
    }
    return list;
  };
  const qs = new THREE.Quaternion();
  const sampleQ = (it: THREE.Interpolant, t: number) => { const v = it.evaluate(t); return qs.set(v[0], v[1], v[2], v[3]).normalize(); };
  // Rocketbox: el puño de una captura real con el brazo arriba (los dedos cerrados de verdad, tal cual)
  if (prof.id === "rocketbox") {
    const c = clip(FIST_FROM_ROCKETBOX.clip);
    if (c) for (const { bone, it } of tracksOf(FIST_FROM_ROCKETBOX.clip, "fingers")) fistQ.set(bone.name, sampleQ(it, Math.min(FIST_FROM_ROCKETBOX.time, c.duration)).clone());
  }
  /** Objetivo de cada falange según la forma de la mano (entre el reposo extendido y el puño capturado). */
  const shapeTarget = (shape: HandShape, f: FingerName, r0: THREE.Quaternion, fq: THREE.Quaternion) => {
    const mix = (k: number) => r0.clone().slerp(fq, k);
    switch (shape) {
      case "fist": return fq;
      case "point": return f === "index" ? mix(0.06) : fq;                                      // índice estirado, puño cerrado
      case "shush": return f === "index" ? mix(0.03) : f === "thumb" ? mix(0.9) : mix(0.8);    // índice recto, resto recogido sin apretar
      case "relaxed": return mix(f === "thumb" ? 0.35 : 0.5);
    }
  };
  /** Ejes del cuerpo en el mundo. */
  const bodyAxes = (side: Side) => {
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    return { rq, out: new THREE.Vector3(side === "l" ? 1 : -1, 0, 0).applyQuaternion(rq), fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(rq), up: new THREE.Vector3(0, 1, 0).applyQuaternion(rq) };
  };
  const H = new THREE.Vector3(), K = new THREE.Vector3(), A = new THREE.Vector3(), T = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3();
  const q = new THREE.Quaternion(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(), footW = new THREE.Quaternion();
  /** Gira `bone` (en el mundo) lo que lleva `from` a `to`. */
  const turn = (bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) => {
    q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    bone.getWorldQuaternion(qw); bone.parent!.getWorldQuaternion(qp);
    bone.quaternion.copy(qp.invert().multiply(q.multiply(qw)));
    bone.updateMatrixWorld(true);
  };
  /** Pone `bone` con esta orientación en el MUNDO. */
  const setWorldQ = (bone: THREE.Object3D, w: THREE.Quaternion) => { bone.parent!.getWorldQuaternion(qp); bone.quaternion.copy(qp.invert().multiply(w)); bone.updateMatrixWorld(true); };
  /** IK de dos huesos hacia `target` conservando el plano que forman AHORA hombro, codo y muñeca (los de la captura). */
  const solveArm = (sh: THREE.Object3D, el: THREE.Object3D, wr: THREE.Object3D, target: THREE.Vector3, fallbackPole: THREE.Vector3) => {
    sh.getWorldPosition(H); el.getWorldPosition(K); wr.getWorldPosition(A);
    const a = H.distanceTo(K), b = K.distanceTo(A);
    const c = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, H.distanceTo(target)));
    const ht = target.clone().sub(H).normalize();
    n.copy(ht).cross(K.clone().sub(H));
    if (n.lengthSq() < 1e-8) n.copy(ht).cross(fallbackPole);
    n.normalize();
    const alpha = Math.acos(THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1));
    turn(sh, K.clone().sub(H), ht.clone().applyAxisAngle(n, alpha));
    el.getWorldPosition(K); wr.getWorldPosition(A);
    turn(el, A.clone().sub(K), d.copy(target).sub(K));
  };

  return {
    profile: prof,
    walkSpec: walkSpecFromExtras((gltf.asset as { extras?: unknown }).extras),
    root,
    uniforms: opts.uniforms,
    meshes: skinned,
    pose({ walkTime, walkWeight, idleTime }) {
      setLayers([{ clip: walkClip.name, time: walkTime, weight: walkWeight }, { clip: idleClip.name, time: idleTime, weight: 1 - walkWeight }]);
    },
    layers: setLayers,
    hasClips: (names) => names.every((nm) => !!clip(nm)),
    bone(name) {
      const b = scene.getObjectByName(name); if (!b) return null;
      root.updateMatrixWorld(true);
      return root.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
    },
    reach(side, goal, weight) {
      if (weight <= 0) return;
      const sh = scene.getObjectByName(prof.upperarm(side)), el = scene.getObjectByName(prof.lowerarm(side)), wr = scene.getObjectByName(prof.hand(side));
      if (!sh || !el || !wr) return;
      root.updateMatrixWorld(true);
      const q0 = sh.quaternion.clone(), q1 = el.quaternion.clone(), q2 = wr.quaternion.clone();
      const { out, fwd, up } = bodyAxes(side);
      sh.getWorldPosition(H); el.getWorldPosition(K); wr.getWorldPosition(A);
      const L = H.distanceTo(K) + K.distanceTo(A);
      let handW: THREE.Quaternion | null = null;
      const target = new THREE.Vector3();
      if (goal === "sky") {
        // mano sobre la cabeza, un poco hacia fuera y delante; 0,92·L ⇒ el codo se queda en ~45° (nunca recto)
        target.copy(H).addScaledVector(up.clone().addScaledVector(out, 0.15).addScaledVector(fwd, 0.2).normalize(), 0.92 * L);
      } else {
        // 1) la mano gira lo justo para que el índice quede vertical (un pelo hacia la cara); giro mínimo y topado
        const i0 = scene.getObjectByName(prof.finger("index", 0, side)), i1 = scene.getObjectByName(prof.finger("index", 1, side)), i2 = scene.getObjectByName(prof.finger("index", 2, side));
        if (!i0 || !i1 || !i2) return;
        const idx = i2.getWorldPosition(new THREE.Vector3()).sub(i0.getWorldPosition(new THREE.Vector3())).normalize();
        const want = up.clone().addScaledVector(fwd, 0.12).addScaledVector(out, 0.04).normalize();   // la punta, un pelo hacia delante: libra la nariz
        const qa = new THREE.Quaternion().setFromUnitVectors(idx, want);
        const ang = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(qa.w), 0, 1));
        if (ang > 1.4) qa.slerp(new THREE.Quaternion(), 1 - 1.4 / ang);
        handW = qa.multiply(wr.getWorldQuaternion(new THREE.Quaternion()));
        setWorldQ(wr, handW);
        // 2) dónde tiene que estar la muñeca para que la falange media del índice quede delante de los labios
        const contact = i1.getWorldPosition(new THREE.Vector3()).lerp(i2.getWorldPosition(new THREE.Vector3()), 0.25);
        const lips = new THREE.Vector3();
        const lb = (prof.lips ?? []).map((nm) => scene.getObjectByName(nm)).filter((x): x is THREE.Object3D => !!x);
        if (lb.length) { for (const o of lb) lips.add(o.getWorldPosition(new THREE.Vector3())); lips.multiplyScalar(1 / lb.length); }
        else scene.getObjectByName(prof.head)!.getWorldPosition(lips).addScaledVector(up, -0.07);
        lips.addScaledVector(fwd, LIPS_CONTACT).addScaledVector(up, -LIPS_DROP);
        target.copy(wr.getWorldPosition(new THREE.Vector3())).add(lips.sub(contact));
      }
      solveArm(sh, el, wr, target, out);
      if (handW) setWorldQ(wr, handW);
      // mezcla con la pose que traía (la captura): con weight < 1 la corrección entra y sale suave
      const s1 = sh.quaternion.clone(), e1 = el.quaternion.clone(), h1 = wr.quaternion.clone();
      sh.quaternion.copy(q0).slerp(s1, weight); el.quaternion.copy(q1).slerp(e1, weight); wr.quaternion.copy(q2).slerp(h1, weight);
      sh.updateMatrixWorld(true);
    },
    hand(side, shape, weight) {
      if (weight <= 0) return;
      if (fistQ.size) {
        for (const f of FINGER_NAMES) for (const k of [0, 1, 2] as const) {
          const bone = scene.getObjectByName(prof.finger(f, k, side)); if (!bone) continue;
          const r0 = rest.get(bone.name), fq = fistQ.get(bone.name);
          if (!r0 || !fq) continue;
          bone.quaternion.slerp(shapeTarget(shape, f, r0, fq), weight);
        }
        return;
      }
      // Sin puño de datos (un asset sin el clip): puño procedural — cada falange gira hacia la palma sobre UNA bisagra por
      // dedo (medida en la 1.ª falange; por falange degenera y dobla hacia atrás); el índice extendido vuelve a su reposo.
      root.updateMatrixWorld(true);
      const wrist = scene.getObjectByName(prof.hand(side)); if (!wrist) return;
      const W = wrist.getWorldPosition(new THREE.Vector3());
      const ix = scene.getObjectByName(prof.finger("index", 0, side))!.getWorldPosition(new THREE.Vector3());
      const pk = scene.getObjectByName(prof.finger("pinky", 0, side))!.getWorldPosition(new THREE.Vector3());
      const md = scene.getObjectByName(prof.finger("middle", 0, side))!.getWorldPosition(new THREE.Vector3());
      const fdir = md.clone().sub(W).normalize();
      const palm = ix.clone().sub(pk).cross(fdir).normalize().multiplyScalar(side === "l" ? -1 : 1);
      const curl = shape === "relaxed" ? 0.5 : shape === "shush" ? 0.8 : 1;
      for (const f of FINGER_NAMES) {
        const point = (shape === "point" || shape === "shush") && f === "index";
        let hinge: THREE.Vector3 | null = null;
        for (const k of [0, 1, 2] as const) {
          const bone = scene.getObjectByName(prof.finger(f, k, side)); if (!bone) continue;
          const r0 = rest.get(bone.name);
          if (point) { if (r0) bone.quaternion.slerp(r0, weight); continue; }
          const child = bone.children[0]; if (!child) continue;
          bone.updateMatrixWorld(true);
          const b0 = bone.getWorldPosition(new THREE.Vector3()), c0 = child.getWorldPosition(new THREE.Vector3());
          const dir = c0.sub(b0).normalize();
          hinge ??= dir.clone().cross(palm).normalize();
          if (hinge.lengthSq() < 0.5) continue;
          const ang = (f === "thumb" ? [0.35, 0.6, 0.6] : [1.4, 1.55, 1.0])[k] * weight * curl;
          setWorldQ(bone, new THREE.Quaternion().setFromAxisAngle(hinge, ang).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
        }
      }
    },
    masked(clipName, time, mask, weight) {
      if (weight <= 0) return;
      const c = clip(clipName); if (!c) return;
      const t = Math.min(Math.max(0, time), c.duration - 1e-4);
      for (const { bone, it } of tracksOf(clipName, mask)) bone.quaternion.slerp(sampleQ(it, t), Math.min(1, weight));
      root.updateMatrixWorld(true);
    },
    bend({ part, pitch, yaw, roll }) {
      if (!pitch && !yaw && !roll) return;
      const bones: readonly (readonly [string, number])[] = part === "spine" ? prof.spine.map((nm) => [nm, 1 / prof.spine.length] as const) : [[prof.neck, 0.4], [prof.head, 0.6]];
      root.updateMatrixWorld(true);
      const { rq } = bodyAxes("r");
      const rqi = rq.clone().invert();
      // lo que cuelga del cuello y no es la cabeza (las clavículas del Biped) se queda donde estaba: asentir no mueve hombros
      const keep = part === "neck" ? (scene.getObjectByName(prof.neck)?.children ?? []).filter((c) => c.name !== prof.head).map((c) => [c, c.getWorldQuaternion(new THREE.Quaternion())] as const) : [];
      for (const [nm, share] of bones) {
        const bone = scene.getObjectByName(nm); if (!bone) continue;
        // ejes del cuerpo: X = su izquierda (pitch + mira abajo), Y = arriba (yaw + a su izquierda), Z = delante (roll + inclina a su derecha)
        const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * share, yaw * share, roll * share, "YXZ"));
        setWorldQ(bone, rq.clone().multiply(local).multiply(rqi).multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
      }
      for (const [c, w] of keep) setWorldQ(c, w);
    },
    lift(side, dy) {
      if (dy <= 0) return;
      const { hip, knee, ankle } = legs[side];
      root.updateMatrixWorld(true);
      hip.getWorldPosition(H); knee.getWorldPosition(K); ankle.getWorldPosition(A); ankle.getWorldQuaternion(footW);
      T.copy(A).y += dy;
      const a = H.distanceTo(K), b = K.distanceTo(A);
      const c = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, H.distanceTo(T)));
      const dir = T.clone().sub(H).normalize();
      n.copy(dir).cross(K.clone().sub(H)).normalize();
      if (n.lengthSq() < 0.5) return;                                    // pierna recta: sin plano (no se toca)
      const alpha = Math.acos(THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1));
      const kneeTo = dir.clone().applyAxisAngle(n, alpha).multiplyScalar(a);
      turn(hip, K.clone().sub(H), kneeTo);
      knee.getWorldPosition(K); ankle.getWorldPosition(A);
      turn(knee, A.clone().sub(K), d.copy(T).sub(K));
      // el pie conserva la orientación que traía (aterriza plano)
      knee.getWorldQuaternion(qp); ankle.quaternion.copy(qp.invert().multiply(footW)); ankle.updateMatrixWorld(true);
    },
    foot(side) {
      root.updateMatrixWorld(true);
      return root.worldToLocal(balls[side].getWorldPosition(new THREE.Vector3()));
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(scene);
      owned.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      for (const m of skinned) m.geometry.dispose();
      root.clear();
    },
  };
}
