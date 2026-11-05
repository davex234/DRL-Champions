/**
 * PACK WALKOUT 0.4 · LA ARENA DE GRAN FINAL (three.js). Solo la importa `stage3d.ts` (que entra por import dinámico).
 *
 * Reconstruida en geometría 3D a partir del estudio de la referencia (`puente.png`, solo referencia artística — nunca se
 * usa como fondo): un pasillo de presentación con
 *   · PASARELA de suelo negro brillante (reflejos falsos de lo que brilla), aristas LED y franjas blancas;
 *   · BARRERAS bajas a los dos lados con tira LED y barras verticales, y CABEZAS MÓVILES en el suelo cuyos haces cruzan la
 *     bruma hacia el centro;
 *   · PÚBLICO detrás de las barreras: siluetas instanciadas en gradas (filas a distintas alturas), brazos que suben y bajan
 *     en el shader, luces de móviles; a contraluz de las pantallas, nunca delante del jugador;
 *   · PANCARTAS LED altas, giradas hacia el centro y a distintas profundidades, de tres tipos que alternan: bandera + código,
 *     RETRATO (el arte real de la carta, en monocromo del color del país) y chevrones;
 *   · CERCHAS de celosía (columnas y vigas) que enmarcan el plano; FOCOS cenitales con destello;
 *   · al fondo, PORTAL de cercha con luz blanca intensa, ESCALINATA y la PANTALLA GIGANTE con la bandera (tras el impacto
 *     del escudo, el logo real del equipo);
 *   · HUMO de CO2 a los pies del portal y bruma baja.
 * Todo con los colores del `CountryArenaTheme` (píxeles de la bandera de la carta). Instanciado y con materiales
 * compartidos; `update(state)` lo pinta todo (mismo estado → misma imagen) y `dispose()` lo libera.
 */
import * as THREE from "three";
import { countryArenaTheme, flagPalette, teamAccentFromLogo, type ArenaCountryInput, type CountryArenaTheme, type FlagPalette } from "@/domain/walkout/countryTheme";

export interface ArenaOptions {
  quality: "high" | "low";
  edition: { light: string; accent: string };
  country: ArenaCountryInput;
  team: { name: string; tag: string; logoSrc: string | null };
  /** Arte de la carta (retratos de las pancartas). */
  artwork?: string | null;
  /** Z de la plataforma (marca donde se detiene la persona). */
  markZ: number;
}

export interface ArenaState {
  t: number;
  lights: number;
  screens: number;
  team: number;
  teamHit: number;
  flash: number;
  platform: number;
  reveal: number;
  drama: number;
  /** 0..1: el público se viene arriba (impacto, celebración). */
  hype: number;
}

const FONT = '"Arial Black", "Segoe UI Black", system-ui, sans-serif';
const BAN_W = 512, BAN_H = 1152, BACK_W = 1024, BACK_H = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error(`no carga ${src}`)); i.src = src; });
}
function paletteOf(img: HTMLImageElement): FlagPalette | null {
  try {
    const c = document.createElement("canvas"); c.width = 64; c.height = 48;
    const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return null;
    g.drawImage(img, 0, 0, 64, 48);
    return flagPalette(g.getImageData(0, 0, 64, 48).data, 64, 48);
  } catch { return null; }
}
function drawCover(g: CanvasRenderingContext2D, img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, x: number, y: number, w: number, h: number, contain = false, src?: [number, number, number, number]) {
  const iw = src ? src[2] : img.naturalWidth || img.width || 4, ih = src ? src[3] : img.naturalHeight || img.height || 3;
  const s = contain ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (src) g.drawImage(img, src[0], src[1], src[2], src[3], x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  else g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}
const stripes = (g: CanvasRenderingContext2D, colors: string[], x: number, y: number, w: number, h: number) => colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(x + (w / colors.length) * i, y, w / colors.length + 1, h); });

/** Pancarta 1: la bandera a lo alto (recortada por el centro) y el código grande abajo. */
function paintFlagBanner(c: HTMLCanvasElement, th: CountryArenaTheme, flag: HTMLImageElement | null) {
  const g = c.getContext("2d")!; g.fillStyle = th.colors[0] ?? "#111"; g.fillRect(0, 0, BAN_W, BAN_H);
  if (flag) drawCover(g, flag, 0, 0, BAN_W, BAN_H * 0.66);
  else { g.fillStyle = "#000"; g.fillRect(0, 0, BAN_W, BAN_H * 0.66); for (let i = 0; i < 7; i++) { g.strokeStyle = th.colors[i % th.colors.length]; g.lineWidth = 26; g.beginPath(); g.moveTo(40, 120 + i * 95); g.lineTo(BAN_W / 2, 220 + i * 95); g.lineTo(BAN_W - 40, 120 + i * 95); g.stroke(); } }
  const grd = g.createLinearGradient(0, BAN_H * 0.5, 0, BAN_H); grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,0.55)"); g.fillStyle = grd; g.fillRect(0, BAN_H * 0.5, BAN_W, BAN_H * 0.5);
  g.fillStyle = "#fff"; g.textAlign = "center"; const code = th.code || "VCT";
  g.font = `900 ${code.length > 4 ? 140 : 200}px ${FONT}`; g.fillText(code, BAN_W / 2, BAN_H * 0.86);
  g.font = `800 34px ${FONT}`; g.globalAlpha = 0.8; g.fillText((th.label || "").toUpperCase(), BAN_W / 2, BAN_H * 0.93); g.globalAlpha = 1;
}
/** Pancarta 2: el RETRATO del jugador sacado del arte real de su carta, en monocromo del color del país. */
function paintPortraitBanner(c: HTMLCanvasElement, th: CountryArenaTheme, art: HTMLImageElement | null) {
  const g = c.getContext("2d")!; g.fillStyle = "#050507"; g.fillRect(0, 0, BAN_W, BAN_H);
  if (art) {
    const iw = art.naturalWidth || art.width, ih = art.naturalHeight || art.height;
    // la zona del retrato en las cartas del catálogo: franja superior central de la imagen de la carta
    drawCover(g, art, 0, BAN_H * 0.04, BAN_W, BAN_H * 0.8, false, [iw * 0.16, ih * 0.1, iw * 0.68, ih * 0.52]);
    const img = g.getImageData(0, 0, BAN_W, BAN_H); const d = img.data;
    const n = parseInt((th.colors[0] ?? "#c81e2e").slice(1), 16), R = n >> 16, G = (n >> 8) & 255, Bc = n & 255;
    for (let i = 0; i < d.length; i += 4) { const l = Math.pow((0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255, 1.2); d[i] = Math.min(255, R * l * 1.25 + 20 * l); d[i + 1] = Math.min(255, G * l * 1.25 + 20 * l); d[i + 2] = Math.min(255, Bc * l * 1.25 + 20 * l); }
    g.putImageData(img, 0, 0);
  }
  for (let y = 0; y < BAN_H; y += 6) { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, y, BAN_W, 2); }
  stripes(g, th.colors, 0, BAN_H - 26, BAN_W, 26);
}
/** Pancarta 3: chevrones de la bandera con un destello y el código pequeño. */
function paintChevronBanner(c: HTMLCanvasElement, th: CountryArenaTheme) {
  const g = c.getContext("2d")!; g.fillStyle = "#08080b"; g.fillRect(0, 0, BAN_W, BAN_H);
  const cols = [th.colors[0] ?? "#c81e2e", th.colors[1] ?? "#ffffff"];
  for (let i = 0; i < 9; i++) {
    g.fillStyle = cols[i % 2]; g.globalAlpha = i % 2 ? 0.85 : 0.95;
    const y = 120 + i * 110;
    g.beginPath(); g.moveTo(40, y); g.lineTo(BAN_W / 2, y + 150); g.lineTo(BAN_W - 40, y); g.lineTo(BAN_W - 40, y + 50); g.lineTo(BAN_W / 2, y + 200); g.lineTo(40, y + 50); g.closePath(); g.fill();
  }
  g.globalAlpha = 1; g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `900 92px ${FONT}`; g.fillText(th.code || "", BAN_W / 2, 100);
}
/** Pantalla gigante: la bandera a toda pantalla y el código. */
function paintBack(c: HTMLCanvasElement, th: CountryArenaTheme, flag: HTMLImageElement | null) {
  const g = c.getContext("2d")!; g.fillStyle = th.colors[0] ?? "#111"; g.fillRect(0, 0, BACK_W, BACK_H);
  if (flag) drawCover(g, flag, 0, 0, BACK_W, BACK_H);
  else { const grd = g.createLinearGradient(0, 0, BACK_W, BACK_H); th.colors.forEach((col, i) => grd.addColorStop(i / Math.max(1, th.colors.length - 1), col)); g.fillStyle = grd; g.globalAlpha = 0.6; g.fillRect(0, 0, BACK_W, BACK_H); g.globalAlpha = 1; g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `900 180px ${FONT}`; g.fillText(th.code || "", BACK_W / 2, BACK_H * 0.62); }
}
/** Pantallas en modo equipo: el logo real (o sus siglas impresas) sobre el color del país. */
function paintTeam(c: HTMLCanvasElement, th: CountryArenaTheme, team: ArenaOptions["team"], logo: HTMLImageElement | null) {
  const W = c.width, H = c.height; const g = c.getContext("2d")!;
  g.fillStyle = "#050507"; g.fillRect(0, 0, W, H);
  stripes(g, th.colors, 0, H - 24, W, 24); stripes(g, th.colors, 0, 0, W, 12);
  if (logo) drawCover(g, logo, W * 0.12, H * 0.16, W * 0.76, H * 0.5, true);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `900 ${logo ? Math.round(Math.min(W, H) * 0.14) : Math.round(Math.min(W, H) * 0.3)}px ${FONT}`;
  g.fillText(team.tag || team.name, W / 2, logo ? H * 0.84 : H * 0.58);
}

/** Celosía de cercha (canal alfa): tubos y diagonales en X. */
function latticeTexture(): THREE.CanvasTexture {
  const S = 128; const c = document.createElement("canvas"); c.width = S; c.height = S; const g = c.getContext("2d")!;
  g.clearRect(0, 0, S, S); g.strokeStyle = "#fff"; g.lineCap = "square";
  g.lineWidth = 14; g.strokeRect(7, -10, S - 14, S + 20);
  g.lineWidth = 7; g.beginPath(); g.moveTo(10, 0); g.lineTo(S - 10, S); g.moveTo(S - 10, 0); g.lineTo(10, S); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** Atlas del público: 4 siluetas × 2 fotogramas (brazos abajo / arriba); canal R = silueta, G = borde de contraluz. */
function crowdAtlas(): THREE.CanvasTexture {
  const FW = 128, FH = 256, c = document.createElement("canvas"); c.width = FW * 4; c.height = FH * 2; const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  for (let pose = 0; pose < 4; pose++) for (let f = 0; f < 2; f++) {
    const ox = pose * FW, oy = f * FH, cx = ox + FW / 2;
    const draw = (col: string, grow: number) => {
      g.fillStyle = col; g.strokeStyle = col; g.lineCap = "round";
      g.beginPath(); g.ellipse(cx, oy + 70, 20 + grow, 24 + grow, 0, 0, Math.PI * 2); g.fill();                 // cabeza
      g.beginPath(); g.moveTo(cx - 40 - grow, oy + FH); g.lineTo(cx - 36 - grow, oy + 120); g.quadraticCurveTo(cx, oy + 96 - grow, cx + 36 + grow, oy + 120); g.lineTo(cx + 40 + grow, oy + FH); g.fill();   // torso
      g.lineWidth = 16 + grow * 2;
      const up = f === 1;
      const arm = (side: number, raised: boolean, bend: number) => { g.beginPath(); g.moveTo(cx + side * 30, oy + 122); if (raised) { g.lineTo(cx + side * (44 + bend), oy + 64); g.lineTo(cx + side * (38 + bend), oy + 8); } else { g.lineTo(cx + side * 46, oy + 170); g.lineTo(cx + side * 42, oy + 215); } g.stroke(); };
      if (pose === 0) { arm(-1, up, 6); arm(1, up, 10); }              // los dos brazos
      if (pose === 1) { arm(-1, false, 0); arm(1, up, 4); }            // un brazo
      if (pose === 2) { arm(-1, up, -8); arm(1, false, 0); }           // un brazo (móvil en alto)
      if (pose === 3) { arm(-1, false, 0); arm(1, false, 0); }         // mirando
    };
    draw("#00ff00", 1.5); draw("#ff0000", 0);     // G = halo de borde (fino), R = cuerpo
    if (pose === 2 && f === 1) { g.fillStyle = "#0000ff"; g.fillRect(cx - 56, oy + 4, 16, 22); }   // B = luz de móvil
  }
  const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; return t;
}

function ledMaterial(inst: boolean, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: inst ? { INST: 1 } : {},
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: `
#include <common>
#include <fog_pars_vertex>
attribute float aIdx;
varying vec2 vUv; varying float vIdx;
void main() {
  vUv = uv;
#ifdef INST
  vIdx = aIdx;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vIdx = 0.0;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
#endif
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap; uniform sampler2D uMap2;
uniform float uMix, uOn, uTime, uBright, uWave, uHit;
uniform vec2 uRes;
varying vec2 vUv; varying float vIdx;
void main() {
  float on = clamp((uOn - vIdx * 0.45) * 2.0, 0.0, 1.0);
  float front = on * 1.12 - 0.06;
  float lit = 1.0 - smoothstep(front - 0.02, front, vUv.y);
  float edge = (1.0 - smoothstep(0.0, 0.035, abs(vUv.y - front))) * step(0.001, on) * (1.0 - on);
  vec2 uv = vUv;
  uv.y += sin(uv.x * 7.0 + uTime * 2.1 + vIdx * 4.0) * 0.008 * uWave;
  uv.x += sin(uv.y * 5.0 + uTime * 1.4) * 0.004 * uWave;
  vec3 c = mix(texture2D(uMap, uv).rgb, texture2D(uMap2, vUv).rgb, uMix);
  // rodilla en las luces: el BLANCO de una bandera (Japón, Corea…) no quema la pantalla entera bajo el resplandor; los
  // colores saturados (luma baja) quedan intactos
  c *= mix(1.0, 0.6, smoothstep(0.55, 0.95, dot(c, vec3(0.2126, 0.7152, 0.0722))));
  vec2 cell = fract(vUv * uRes) - 0.5;
  float led = 1.0 - smoothstep(0.3, 0.5, length(cell));
  float scan = 0.94 + 0.06 * sin(vUv.y * uRes.y * 0.5 - uTime * 10.0);
  vec3 col = c * (0.35 + 0.9 * led) * scan * uBright * lit + vec3(edge) * 0.9 * uBright + c * uHit * 0.6 * lit;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  });
}

interface BannerSet { mesh: THREE.InstancedMesh; mirror: THREE.InstancedMesh | null; u: Record<string, THREE.IUniform>; mu: Record<string, THREE.IUniform> | null }

export class Arena {
  readonly group = new THREE.Group();
  theme: CountryArenaTheme;
  teamAccent: string | null = null;
  readonly ready: Promise<void>;
  private disposables: { dispose: () => void }[] = [];
  private canvases = { flag: document.createElement("canvas"), portrait: document.createElement("canvas"), chevron: document.createElement("canvas"), team: document.createElement("canvas"), back: document.createElement("canvas"), teamBack: document.createElement("canvas") };
  private tex: Record<keyof Arena["canvases"], THREE.CanvasTexture>;
  private banners: BannerSet[] = [];
  private backU: Record<string, THREE.IUniform>;
  private ledLines: THREE.MeshBasicMaterial[] = [];
  private whiteLines: THREE.MeshBasicMaterial;
  private ringMats: THREE.MeshBasicMaterial[] = [];
  private beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; i: number; side: number }[] = [];
  private topBeams: THREE.MeshBasicMaterial[] = [];
  private flares: THREE.SpriteMaterial[] = [];
  private fixtureLens: THREE.MeshBasicMaterial;
  private portalMat: THREE.MeshBasicMaterial;
  private portalGlow: THREE.SpriteMaterial;
  private crowdU: Record<string, THREE.IUniform>;
  private smoke: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; x: number; z: number; phase: number; speed: number }[] = [];
  private floorMat: THREE.MeshStandardMaterial;
  private colors: THREE.Color[] = [];

  constructor(private opts: ArenaOptions) {
    this.theme = countryArenaTheme(opts.country, null, opts.edition);
    const low = opts.quality === "low";
    const mk = (c: HTMLCanvasElement, w: number, h: number) => { c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.disposables.push(t); return t; };
    this.tex = {
      flag: mk(this.canvases.flag, BAN_W, BAN_H), portrait: mk(this.canvases.portrait, BAN_W, BAN_H), chevron: mk(this.canvases.chevron, BAN_W, BAN_H),
      team: mk(this.canvases.team, BAN_W, BAN_H), back: mk(this.canvases.back, BACK_W, BACK_H), teamBack: mk(this.canvases.teamBack, BACK_W, BACK_H),
    };
    this.repaint(null, null, null);
    const box = new THREE.BoxGeometry(1, 1, 1); this.disposables.push(box);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    const own = <T extends { dispose: () => void }>(x: T) => { this.disposables.push(x); return x; };

    // ── PASARELA: suelo negro brillante, aristas LED del color del país y franjas blancas ──
    this.floorMat = own(new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 0.36, metalness: 0.55, transparent: true, opacity: 0.86 }));
    const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(24, 46)), this.floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.001, -14); floor.receiveShadow = true; this.group.add(floor);
    for (const x of [-2.32, 2.32]) { const mat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); this.ledLines.push(mat); const s = new THREE.Mesh(box, mat); s.position.set(x, 0.006, -6.5); s.scale.set(0.05, 0.01, 21); this.group.add(s); }
    this.whiteLines = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(box, this.whiteLines); s.position.set(0, 0.006, 3.2 - i * 2.4); s.scale.set(i % 2 ? 1.6 : 3.4, 0.008, 0.035); this.group.add(s); }

    // ── BARRERAS bajas con tira LED superior y barras verticales; FOCOS MÓVILES en el suelo ──
    const metal = own(new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.38, metalness: 0.85 }));
    const segs: THREE.Matrix4[] = [], ledTop: THREE.Matrix4[] = [], ledBars: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) for (let z = 3; z > -13; z -= 2.05) {
      segs.push(new THREE.Matrix4().compose(new THREE.Vector3(side * 2.6, 0.52, z), qq.identity(), new THREE.Vector3(0.22, 1.04, 1.95)));
      ledTop.push(new THREE.Matrix4().compose(new THREE.Vector3(side * 2.48, 1.02, z), qq.identity(), new THREE.Vector3(0.03, 0.04, 1.95)));
      for (const dz of [-0.82, 0.82]) ledBars.push(new THREE.Matrix4().compose(new THREE.Vector3(side * 2.48, 0.52, z + dz), qq.identity(), new THREE.Vector3(0.03, 0.85, 0.05)));
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[]) => { const im = new THREE.InstancedMesh(geo, mat, ms.length); ms.forEach((m, i) => im.setMatrixAt(i, m)); im.frustumCulled = false; this.group.add(im); return im; };
    inst(box, metal, segs);
    const ledTopMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); this.ledLines.push(ledTopMat);
    inst(box, ledTopMat, ledTop); inst(box, ledTopMat, ledBars);
    // cabezas móviles: cuerpo, lente y haz que barre hacia arriba y al centro
    this.fixtureLens = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const headGeo = own(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 14)); const lensGeo = own(new THREE.CircleGeometry(0.13, 16));
    const beamTex = (() => { const c = document.createElement("canvas"); c.width = 4; c.height = 128; const g = c.getContext("2d")!; const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grd; g.fillRect(0, 0, 4, 128); return own(new THREE.CanvasTexture(c)); })();
    const beamGeo = own(new THREE.ConeGeometry(0.55, 7, 18, 1, true)); beamGeo.translate(0, -3.5, 0); beamGeo.rotateX(Math.PI);   // apunta hacia arriba
    const moverZ = low ? [-2.2, -6.4, -10.4] : [-1.8, -4.6, -7.4, -10.2, -12.6];   // nunca bajo la cámara
    moverZ.forEach((z, i) => {
      for (const side of [-1, 1]) {
        const h = new THREE.Mesh(headGeo, metal); h.position.set(side * 2.15, 0.16, z); this.group.add(h);
        const lens = new THREE.Mesh(lensGeo, this.fixtureLens); lens.position.set(side * 2.15, 0.32, z); lens.rotation.x = -Math.PI / 2; this.group.add(lens);
        const mat = own(new THREE.MeshBasicMaterial({ map: beamTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const mesh = new THREE.Mesh(beamGeo, mat); mesh.position.set(side * 2.15, 0.3, z); this.group.add(mesh);
        this.beams.push({ mesh, mat, i: i * 2 + (side > 0 ? 1 : 0), side });
      }
    });

    // ── PÚBLICO: siluetas instanciadas en gradas, detrás de las barreras ──
    const atlas = own(crowdAtlas());
    this.crowdU = { uAtlas: { value: atlas }, uTime: { value: 0 }, uLit: { value: 0 }, uHype: { value: 0 }, uRim: { value: new THREE.Color(0xff3344) }, uRim2: { value: new THREE.Color(0xffffff) } };
    const crowdMat = own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...this.crowdU },
      vertexShader: `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aCrowd; // x: fase, y: pose (0..3), z: brillo, w: tamaño
uniform float uTime, uHype;
varying vec2 vUv; varying float vBright; varying float vPose; varying float vUp;
void main() {
  float ph = aCrowd.x;
  // los brazos suben y bajan (más a menudo con el «hype»); el cuerpo bota un poco
  float cycle = sin(uTime * (2.2 + ph * 1.7) + ph * 30.0);
  vUp = step(0.15 - uHype * 0.9, cycle);
  vPose = aCrowd.y; vBright = aCrowd.z;
  vec3 p = position * aCrowd.w;
  p.y += abs(sin(uTime * 3.1 + ph * 20.0)) * 0.05 * (0.4 + uHype);
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas; uniform float uLit, uTime; uniform vec3 uRim, uRim2;
varying vec2 vUv; varying float vBright; varying float vPose; varying float vUp;
void main() {
  vec2 a = vec2((vUv.x + vPose) / 4.0, (vUv.y + (1.0 - vUp)) / 2.0);
  vec4 s = texture2D(uAtlas, a);
  float body = s.r, halo = max(0.0, s.g - s.r);
  float alpha = max(body, halo * 0.8);
  if (alpha < 0.06) discard;
  // a contraluz: cuerpo casi negro, borde del color de las pantallas; algún móvil encendido
  vec3 col = vec3(0.008) * body + mix(uRim, uRim2, step(0.8, fract(vBright * 7.0))) * halo * (0.18 + 0.25 * vBright) * uLit;
  col += vec3(1.0, 0.98, 0.9) * s.b * (0.6 + 0.4 * sin(uTime * 6.0 + vBright * 40.0)) * uLit;
  gl_FragColor = vec4(col, max(body, halo * 0.6) * (0.75 + 0.25 * uLit));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
    }));
    const crowdGeo = own(new THREE.PlaneGeometry(0.62, 1.24)); crowdGeo.translate(0, 0.62, 0);
    const cms: THREE.Matrix4[] = [], cattr: number[] = [];
    let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const rows = low ? 3 : 5;
    for (const side of [-1, 1]) for (let r = 0; r < rows; r++) for (let z = 2.6; z > -12.5; z -= 0.5 + rnd() * 0.15) {
      const x = side * (3.05 + r * 0.75 + rnd() * 0.2), y = 0.35 + r * 0.42;
      qq.setFromAxisAngle(Y, side > 0 ? -Math.PI / 2 + 0.55 : Math.PI / 2 - 0.55);                  // miran a la pasarela y a cámara
      cms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), qq.clone(), new THREE.Vector3(1, 1, 1)));
      cattr.push(rnd(), Math.floor(rnd() * 4), rnd(), 0.85 + rnd() * 0.3);
    }
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, cms.length);
    cms.forEach((m, i) => crowd.setMatrixAt(i, m));
    crowdGeo.setAttribute("aCrowd", new THREE.InstancedBufferAttribute(new Float32Array(cattr), 4));
    crowd.frustumCulled = false; crowd.renderOrder = 2; this.group.add(crowd);
    // gradas (escalones oscuros bajo el público)
    const stands = new THREE.Mesh(box, own(new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.9 })));
    for (const side of [-1, 1]) for (let r = 0; r < rows; r++) { const s = stands.clone(); s.position.set(side * (3.1 + r * 0.75), 0.17 + r * 0.42 - 0.17, -5); s.scale.set(0.75, 0.34 + r * 0.84, 16); this.group.add(s); }

    // ── PANCARTAS LED altas, giradas hacia el centro, a varias profundidades (bandera · retrato · chevrones) ──
    const banGeo = own(new THREE.PlaneGeometry(2.3, 5.2)); banGeo.translate(0, 2.6, 0);
    const SLOTS: { kind: 0 | 1 | 2; x: number; z: number; y: number; s: number }[] = [];
    const zs = low ? [1.4, -4.0, -9.0] : [1.4, -1.8, -5.0, -8.2, -11.4];
    zs.forEach((z, i) => { for (const side of [-1, 1]) SLOTS.push({ kind: ((i + (side > 0 ? 1 : 0)) % 3) as 0 | 1 | 2, x: side * (6.3 - i * 0.18), z, y: 1.9 + (i % 2) * 0.5, s: i === 0 ? 1.25 : 1 }); });
    // las dos más cercanas al plano, grandes: bandera y código (como el encuadre de la referencia)
    SLOTS[0].kind = 0; SLOTS[1].kind = 0;
    const kinds: [THREE.CanvasTexture, THREE.CanvasTexture][] = [[this.tex.flag, this.tex.team], [this.tex.portrait, this.tex.portrait], [this.tex.chevron, this.tex.team]];
    for (let k = 0 as 0 | 1 | 2; k < 3; k = (k + 1) as 0 | 1 | 2) {
      const slots = SLOTS.filter((s) => s.kind === k); if (!slots.length) continue;
      const u = { uMap: { value: kinds[k][0] }, uMap2: { value: kinds[k][1] }, uMix: { value: 0 }, uOn: { value: 0 }, uTime: { value: 0 }, uBright: { value: 1 }, uWave: { value: k === 0 ? 1 : 0.3 }, uHit: { value: 0 }, uRes: { value: new THREE.Vector2(70, 160) } };
      const mat = own(ledMaterial(true, u));
      const g = banGeo.clone(); this.disposables.push(g);
      const mesh = new THREE.InstancedMesh(g, mat, slots.length);
      const idx = new Float32Array(slots.length);
      slots.forEach((sl, i) => {
        qq.setFromAxisAngle(Y, sl.x < 0 ? 0.62 : -0.62);
        m4.compose(new THREE.Vector3(sl.x, sl.y, sl.z), qq, new THREE.Vector3(sl.s, sl.s, 1)); mesh.setMatrixAt(i, m4.clone());
        idx[i] = Math.min(1, Math.max(0, (1.4 - sl.z) / 13));
      });
      g.setAttribute("aIdx", new THREE.InstancedBufferAttribute(idx, 1));
      mesh.frustumCulled = false; this.group.add(mesh);
      let mirror: THREE.InstancedMesh | null = null, mu: Record<string, THREE.IUniform> | null = null;
      if (!low) {
        mu = { ...u, uBright: { value: 0.3 } }; const mm = own(ledMaterial(true, mu));
        mirror = new THREE.InstancedMesh(g, mm, slots.length);
        for (let i = 0; i < slots.length; i++) { mesh.getMatrixAt(i, m4); const p = new THREE.Vector3(), r = new THREE.Quaternion(), sc = new THREE.Vector3(); m4.decompose(p, r, sc); p.y = -p.y; sc.y = -sc.y; m4.compose(p, r, sc); mirror.setMatrixAt(i, m4.clone()); }
        mirror.frustumCulled = false; this.group.add(mirror);
      }
      this.banners.push({ mesh, mirror, u, mu });
    }

    // ── CERCHAS de celosía: torres a los lados y vigas que cruzan; enmarcan el plano ──
    const lattice = own(latticeTexture());
    const trussMat = own(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.9, alphaMap: lattice, alphaTest: 0.5, side: THREE.DoubleSide }));
    const trussGeo = own(new THREE.BoxGeometry(1, 1, 1));
    const tms: THREE.Matrix4[] = [];
    const towerZ = low ? [3.2, -6] : [3.2, -3.4, -9.8];
    for (const z of towerZ) {
      for (const side of [-1, 1]) tms.push(new THREE.Matrix4().compose(new THREE.Vector3(side * 4.7, 4.5, z), qq.identity(), new THREE.Vector3(0.45, 9, 0.45)));
      tms.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 8.6, z), qq.identity(), new THREE.Vector3(9.8, 0.45, 0.45)));
    }
    const truss = inst(trussGeo, trussMat, tms);
    // la celosía se repite a lo largo (las UV de la caja se escalan por cara)
    lattice.repeat.set(1, 12);
    void truss;
    // focos cenitales: destellos y haces hacia la pasarela
    const flareTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!; const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.12, "rgba(255,255,255,0.85)"); grd.addColorStop(0.35, "rgba(255,255,255,0.18)"); grd.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grd; g.fillRect(0, 0, 128, 128); g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(0, 62, 128, 4); g.fillRect(62, 0, 4, 128); return own(new THREE.CanvasTexture(c)); })();
    const topGeo = own(new THREE.ConeGeometry(0.9, 8.4, 18, 1, true)); topGeo.translate(0, -4.2, 0);
    for (const z of towerZ) for (const x of [-3.2, -1.1, 1.1, 3.2]) {
      const fm = own(new THREE.SpriteMaterial({ map: flareTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const fl = new THREE.Sprite(fm); fl.position.set(x, 8.3, z + 0.3); fl.scale.set(1.6, 1.6, 1); this.group.add(fl); this.flares.push(fm);
      const bm = own(new THREE.MeshBasicMaterial({ map: beamTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const b = new THREE.Mesh(topGeo, bm); b.position.set(x, 8.3, z + 0.3); b.rotation.z = x * 0.07; b.rotation.x = -0.18; this.group.add(b); this.topBeams.push(bm);
    }

    // ── FONDO: portal de cercha con luz blanca, escalinata y la pantalla gigante ──
    const PZ = -14.5;
    const portal = new THREE.Group();
    for (const side of [-1, 1]) { const t = new THREE.Mesh(trussGeo, trussMat); t.position.set(side * 3.1, 2.8, PZ); t.scale.set(0.42, 5.6, 0.42); portal.add(t); }
    const top = new THREE.Mesh(trussGeo, trussMat); top.position.set(0, 5.6, PZ); top.scale.set(6.6, 0.42, 0.42); portal.add(top);
    // la boca del portal NO es un rectángulo blanco: un fondo gris claro (por debajo del umbral del resplandor) con
    // listones LED verticales, un marco más vivo y la luz cayendo desde arriba; solo los listones «queman»
    const portalTex = (() => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256; const g = c.getContext("2d")!;
      const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, "#9aa0ab"); v.addColorStop(0.55, "#6c717b"); v.addColorStop(1, "#3a3d44");
      g.fillStyle = v; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9; i++) { const x = 18 + i * 27.5; const s = g.createLinearGradient(0, 0, 0, 256); s.addColorStop(0, "rgba(255,255,255,1)"); s.addColorStop(0.7, "rgba(255,255,255,0.75)"); s.addColorStop(1, "rgba(255,255,255,0.2)"); g.fillStyle = s; g.fillRect(x, 8, 5, 240); }
      g.fillStyle = "rgba(255,255,255,0.95)"; g.fillRect(0, 0, 256, 6); g.fillRect(0, 0, 6, 256); g.fillRect(250, 0, 6, 256);
      g.fillStyle = "rgba(10,10,14,0.55)"; for (let y = 40; y < 256; y += 46) g.fillRect(0, y, 256, 3);   // travesaños de la cercha a contraluz
      return own(new THREE.CanvasTexture(c));
    })(); portalTex.colorSpace = THREE.SRGBColorSpace;
    this.portalMat = own(new THREE.MeshBasicMaterial({ map: portalTex, color: 0xffffff, transparent: true, opacity: 0 }));
    const glowPlane = new THREE.Mesh(own(new THREE.PlaneGeometry(5.8, 5.2)), this.portalMat); glowPlane.position.set(0, 2.7, PZ - 0.6); portal.add(glowPlane);
    this.portalGlow = own(new THREE.SpriteMaterial({ map: flareTex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pg = new THREE.Sprite(this.portalGlow); pg.position.set(0, 2.4, PZ - 0.3); pg.scale.set(5.5, 4.5, 1); portal.add(pg);
    const stepMat = own(new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.25, metalness: 0.6 }));
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(box, stepMat); st.position.set(0, 0.11 + i * 0.22, PZ + 2.4 - i * 0.55); st.scale.set(5.6, 0.22 + i * 0.44, 0.6); st.position.y = (0.22 + i * 0.44) / 2; portal.add(st);
      const edge = new THREE.Mesh(box, this.whiteLines); edge.position.set(0, 0.22 + i * 0.44 + 0.006, PZ + 2.4 - i * 0.55 + 0.3); edge.scale.set(5.6, 0.012, 0.03); portal.add(edge);
    }
    this.group.add(portal);
    this.backU = { uMap: { value: this.tex.back }, uMap2: { value: this.tex.teamBack }, uMix: { value: 0 }, uOn: { value: 0 }, uTime: { value: 0 }, uBright: { value: 1 }, uWave: { value: 1 }, uHit: { value: 0 }, uRes: { value: new THREE.Vector2(240, 120) } };
    const back = new THREE.Mesh(own(new THREE.PlaneGeometry(13, 6.5)), own(ledMaterial(false, this.backU))); back.position.set(0, 9.2, PZ - 1.2); this.group.add(back);

    // ── HUMO de CO2 a los pies del portal y bruma baja ──
    const smokeTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!; const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64); grd.addColorStop(0, "rgba(255,255,255,0.55)"); grd.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grd; g.fillRect(0, 0, 128, 128); return own(new THREE.CanvasTexture(c)); })();
    const nSmoke = low ? 14 : 30;
    for (let i = 0; i < nSmoke; i++) {
      const mat = own(new THREE.SpriteMaterial({ map: smokeTex, color: 0x9aa0aa, transparent: true, opacity: 0, depthWrite: false }));
      const sp = new THREE.Sprite(mat); this.group.add(sp);
      const left = i % 2 === 0;
      this.smoke.push({ sprite: sp, mat, x: (left ? -1 : 1) * (2.3 + rnd() * 0.6), z: PZ + 1.6 + rnd() * 1.2, phase: rnd(), speed: 0.35 + rnd() * 0.3 });
    }

    // ── PLATAFORMA: anillos LED al ras del suelo donde se detiene ──
    for (const [r0, r1] of [[1.24, 1.3], [1.4, 1.43]] as const) {
      const mat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })); this.ringMats.push(mat);
      const ring = new THREE.Mesh(own(new THREE.RingGeometry(r0, r1, 96)), mat); ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.006, opts.markZ); this.group.add(ring);
    }

    this.applyColors();
    this.ready = this.load();
  }

  /** Bandera, logo y arte de la carta (mismo origen): paleta real y pantallas repintadas. Nunca rechaza. */
  private async load(): Promise<void> {
    const src = this.theme.flagSrc;
    const [flag, logo, art] = await Promise.all([
      src ? loadImage(src).catch(() => null) : Promise.resolve(null),
      this.opts.team.logoSrc ? loadImage(this.opts.team.logoSrc).catch(() => null) : Promise.resolve(null),
      this.opts.artwork ? loadImage(this.opts.artwork).catch(() => null) : Promise.resolve(null),
    ]);
    if (flag) this.theme = countryArenaTheme(this.opts.country, paletteOf(flag), this.opts.edition);
    else if (src) this.theme = countryArenaTheme({ ...this.opts.country, flag: null }, null, this.opts.edition);
    this.teamAccent = logo ? teamAccentFromLogo(paletteOf(logo)) : null;
    this.repaint(flag, logo, art);
    this.applyColors();
  }

  private repaint(flag: HTMLImageElement | null, logo: HTMLImageElement | null, art: HTMLImageElement | null) {
    paintFlagBanner(this.canvases.flag, this.theme, flag); paintPortraitBanner(this.canvases.portrait, this.theme, art); paintChevronBanner(this.canvases.chevron, this.theme);
    paintTeam(this.canvases.team, this.theme, this.opts.team, logo); paintBack(this.canvases.back, this.theme, flag); paintTeam(this.canvases.teamBack, this.theme, this.opts.team, logo);
    for (const t of Object.values(this.tex)) t.needsUpdate = true;
  }

  private applyColors() {
    this.colors = this.theme.colors.map((c) => new THREE.Color(c));
    const L = this.lightColors(); const c0 = L[0], c1 = L[1] ?? L[0];
    this.ledLines.forEach((m) => m.color.copy(c0));
    this.ringMats[0]?.color.copy(c0); this.ringMats[1]?.color.copy(c1);
    this.beams.forEach((b) => b.mat.color.copy(b.i % 3 === 0 ? c0 : new THREE.Color(0xffffff)));
    (this.crowdU.uRim.value as THREE.Color).copy(c0); (this.crowdU.uRim2.value as THREE.Color).copy(c1);
    // el humo de CO2 se tiñe de la luz del país que lo atraviesa (rojo en Turquía, como en la referencia), sin saturar
    const smoke = c0.clone().lerp(new THREE.Color(0xd8dce4), 0.45);
    for (const p of this.smoke) p.mat.color.copy(smoke);
  }

  /** Color de la bruma del recinto: casi negro con un poso del color del país (profundidad sin lavar el contraste). */
  atmosphere(): THREE.Color {
    return new THREE.Color(0x06060a).lerp(this.lightColors()[0] ?? new THREE.Color(0x06060a), 0.07);
  }

  /** Colores del país para las LUCES: primero los más saturados (un foco blanco plano no da carácter). */
  lightColors(): THREE.Color[] {
    const sat = (c: THREE.Color) => { const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); return hsl.s * (hsl.l > 0.92 ? 0.2 : 1); };
    return [...this.colors].sort((a, b) => sat(b) - sat(a));
  }

  update(s: ArenaState): void {
    const dim = 1 - s.reveal * 0.5;
    const lit = Math.min(1, s.lights * 1.4);
    for (const b of this.banners) {
      for (const u of [b.u, ...(b.mu ? [b.mu] : [])]) { u.uOn.value = s.screens; u.uTime.value = s.t; u.uMix.value = s.team; u.uHit.value = s.teamHit * 0.8 + s.flash * 0.5; }
      b.u.uBright.value = (1.0 + 0.3 * s.drama) * dim; if (b.mu) b.mu.uBright.value = 0.28 * dim;
    }
    this.backU.uOn.value = s.screens; this.backU.uTime.value = s.t; this.backU.uMix.value = s.team; this.backU.uHit.value = s.teamHit * 0.6 + s.flash * 0.5; this.backU.uBright.value = (1.05 + 0.3 * s.drama) * dim;
    for (const m of this.ledLines) m.opacity = Math.min(1, lit * 0.95 + s.teamHit * 0.3) * dim;
    this.whiteLines.opacity = lit * 0.75 * dim;
    const pulse = s.platform > 0 ? 0.55 + 0.45 * Math.sin(s.t * 5.2) ** 2 : 0;
    this.ringMats.forEach((m, i) => { m.opacity = Math.min(1, lit * (i ? 0.25 : 0.45) + s.platform * pulse * (i ? 0.5 : 0.8) + s.flash * 0.6) * dim; });
    this.fixtureLens.color.setScalar(0.1 + lit * 2.2);
    for (const b of this.beams) {
      const ph = b.i * 1.3;
      b.mesh.rotation.z = -b.side * (0.35 + 0.25 * Math.sin(s.t * 0.6 + ph));          // hacia el centro, barriendo
      b.mesh.rotation.x = Math.sin(s.t * 0.42 + ph * 0.7) * 0.3 - 0.15;
      b.mat.opacity = (lit * (0.045 + 0.025 * s.drama) + s.teamHit * 0.06 + s.flash * 0.08 + s.hype * 0.03) * dim;
    }
    for (const f of this.flares) f.opacity = Math.min(1, lit * 0.95 + s.flash * 0.6) * dim;
    for (const b of this.topBeams) b.opacity = (lit * 0.035 + s.flash * 0.06) * dim;
    this.portalMat.opacity = Math.min(1, lit * 0.9) * dim; this.portalGlow.opacity = Math.min(1, lit * 0.16 + s.flash * 0.3) * dim;
    this.crowdU.uTime.value = s.t; this.crowdU.uLit.value = lit; this.crowdU.uHype.value = s.hype;
    // humo: sube y se abre en bucle; empuja más con el impacto y el clímax
    const push = 0.35 + 0.65 * Math.max(s.teamHit, s.hype, s.flash);
    for (const p of this.smoke) {
      const k = (s.t * p.speed + p.phase) % 1;
      p.sprite.position.set(p.x + Math.sign(p.x) * -k * 0.6, 0.3 + k * 3.2, p.z + k * 0.8);
      const sc = 1.2 + k * 3.4; p.sprite.scale.set(sc, sc, 1);
      p.mat.opacity = lit * Math.sin(k * Math.PI) * 0.055 * push * dim;
    }
    this.floorMat.opacity = 0.86;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.group.clear();
  }
}
