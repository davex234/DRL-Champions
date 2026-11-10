/**
 * PACK WALKOUT · ESCENARIO 3D (three.js, imperativo). Solo se carga en la ruta del prototipo (import dinámico).
 *
 * 0.3: la ARENA de gran final (`arena3d.ts`: muros LED con la bandera y el código del país, pantalla gigante que pasa al
 * logo del equipo, estructura metálica, haces móviles, suelo LED y plataforma) + la PERSONA HUMANA riggeada (0.2:
 * `human3d.ts`) que camina hacia cámara a contraluz, se detiene en la plataforma y CELEBRA (`celebration.ts`: clips
 * esqueléticos + IK del brazo + forma de la mano). Bruma y polvo controlados; luces con los colores del país.
 *
 * Todo lo decide el fotograma de la timeline (`render(frame)`): el mismo fotograma pinta lo mismo. `dispose()` libera
 * geometrías, materiales, texturas y el contexto WebGL (REPETIR no acumula objetos).
 *
 * La persona carga en paralelo (`ready`): si el GLB falla, `ready` rechaza y el escenario pasa a 2D (WalkoutStage).
 * Paso: la fase del clip sale de la distancia recorrida (`walkAt`), así que los pies no patinan al frenar; en los cambios de
 * pose de la celebración un pie se queda clavado (la raíz compensa) y el otro va por el aire.
 */
import * as THREE from "three";
import { clamp01, easeInOutCubic, type WalkoutFrame } from "@/domain/walkout/timeline";
import type { EditionPreset } from "@/domain/walkout/input";
import { walkAt, walkAtWithStop, stopPlan, WALK_PLAN } from "@/domain/walkout/walk";
import { CELEBRATIONS, type CelebrationFraming, type CelebrationId } from "@/domain/walkout/celebration";
import { applyCelebrationPose } from "./celebrate3d";
import type { ArenaCountryInput } from "@/domain/walkout/countryTheme";
import { HUMAN_ASSETS, createHumanRig, humanUniforms, loadAccentMap, loadHumanAsset, type AvatarId, type HumanRig, type HumanUniforms } from "./human3d";
import { Arena } from "./arena3d";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface Stage3DOptions {
  preset: EditionPreset;
  /** Partículas efectivas (preset con el tope de la intensidad ya aplicado). */
  particles: number;
  /** 0..1 — luz, bruma y flash extra de MEGA. */
  drama: number;
  dprCap: number;
  /** Duración del beat de la persona (s): el paseo se reparte en ella (crucero → frenada → quieto). */
  humanDur: number;
  /** 0.3 · «walk» (entra caminando) · «stand» (ya está en la plataforma: RARE) · null (sin persona). */
  humanMode?: "walk" | "stand" | null;
  /** 0.3 · inicio (s) del beat de la celebración y cuál (null: ninguna). */
  celebrateAt?: number | null;
  celebration?: CelebrationId | null;
  /** 0.3 · el país (canónico o ajuste DEV) y el equipo que viste la arena. */
  country?: ArenaCountryInput;
  team?: { name: string; tag: string; logoSrc: string | null };
  /** 0.4 · arte de la carta (retratos de las pancartas). */
  artwork?: string | null;
  /** Escritorio: tela con sheen, sombras 1024 y reflejos. Móvil: lo mismo, más barato. */
  quality: "high" | "low";
  /** QA: cámara libre relativa a la persona `[x, y, z, lookX, lookY, lookZ]`. */
  qaCam?: readonly number[] | null;
  /** QA: comparar clips (`?walk=` / `?idle=`). */
  qaClips?: { walk?: string; idle?: string } | null;
  /** QA: la persona no se disuelve en el clímax (para revisar clips enteros). */
  qaHold?: boolean;
  /** QA: arena sin persona. */
  qaNoHuman?: boolean;
  /** QA: luz blanca de estudio (revisar clips y materiales). */
  qaLit?: boolean;
  /** 0.4 · avatar (Rocketbox por defecto; Quaternius para comparar). */
  avatar?: AvatarId;
}

export interface Stage3DStats { humanLoadMs: number | null; triangles: number; calls: number; geometries: number; textures: number }

/** LCG determinista (posiciones de polvo/bruma estables entre repeticiones). */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; }

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Encuadres de la celebración (distancia de cámara, altura de cámara, altura del punto de mira), escritorio. */
const FRAMING: Readonly<Record<CelebrationFraming, { dist: number; camY: number; lookY: number }>> = {
  close: { dist: 2.45, camY: 1.5, lookY: 1.42 },      // SHUSH: torso y cara, sin cortar la mano
  medium: { dist: 3.5, camY: 1.28, lookY: 1.16 },     // brazos cruzados / señalar: plano medio frontal
  wide: { dist: 5.0, camY: 1.2, lookY: 1.18 },        // salto: el salto entero con el puño arriba
};

export class WalkoutStage3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 80);
  private arena: Arena;
  private haze: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; drift: number }[] = [];
  private dust: THREE.Points;
  private dustMat: THREE.PointsMaterial;
  private rig: HumanRig | null = null;
  private mirror: HumanRig | null = null;
  private humanU: HumanUniforms;
  private rimL: THREE.SpotLight;
  private rimR: THREE.SpotLight;
  private fill: THREE.HemisphereLight;
  private lastFrame: { f: WalkoutFrame; walk: boolean } | null = null;
  private disposed = false;
  private humanLoadMs: number | null = null;
  /** Resuelve con la persona en escena; rechaza si el GLB no carga (el escenario pasa a 2D). */
  readonly ready: Promise<void>;
  private back: THREE.SpotLight;
  private key: THREE.SpotLight;
  private sideL: THREE.PointLight;
  private sideR: THREE.PointLight;
  private portrait = false;
  private textures: THREE.Texture[] = [];
  private lostHandler: ((e: Event) => void) | null = null;
  /** ¿Están los clips de la celebración? Si no: pose segura (reposo) y la escena sigue. */
  private celebrationOk = true;
  /** 0.4 · posproceso: resplandor (bloom) de LED, focos y portal. */
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  /** Contraluz blanco del portal (el recorte fuerte de la referencia). */
  private portalLight: THREE.SpotLight;

  constructor(private canvas: HTMLCanvasElement, private opts: Stage3DOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.dprCap <= 1.5, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.dprCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // three ≥ 0.182 retiró PCFSoftShadowMap (avisaba y usaba PCFShadowMap igualmente): misma sombra, sin el aviso.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x030409);
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.045);

    const light = new THREE.Color(opts.preset.light);
    const accent = new THREE.Color(opts.preset.accent);

    // ── la arena (muros LED, pantalla gigante, estructura, haces, suelo y plataforma) ──
    this.arena = new Arena({
      quality: opts.quality, edition: { light: opts.preset.light, accent: opts.preset.accent }, markZ: WALK_PLAN.markZ,
      country: opts.country ?? { flag: null, region: null }, team: opts.team ?? { name: "", tag: "", logoSrc: null }, artwork: opts.artwork ?? null,
    });
    this.scene.add(this.arena.group);
    this.scene.fog = new THREE.FogExp2(0x06060a, 0.028);

    // ── resplandor: los LED, los focos y el portal «queman» un poco (con la persona fuera del umbral) ──
    // el compositor hace varias pasadas: el contador se reinicia a mano por fotograma (si no, solo mide la última)
    this.renderer.info.autoReset = false;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), opts.quality === "high" ? 0.5 : 0.4, 0.42, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // ── bruma (capas blandas) ──
    const hazeTex = radialTexture("rgba(255,255,255,0.35)", "rgba(255,255,255,0)"); this.textures.push(hazeTex);
    const r = rng(7);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: hazeTex, color: light.clone(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), mat); m.position.set((r() - 0.5) * 4, 1 + r() * 1.5, -3 - i * 4); this.scene.add(m);
      this.haze.push({ mesh: m, mat, drift: 0.15 + r() * 0.25 });
    }

    // ── polvo (determinista, con tope) ──
    const n = Math.max(0, Math.floor(opts.particles));
    const pos = new Float32Array(n * 3); const pr = rng(42);
    for (let i = 0; i < n; i++) { pos[i * 3] = (pr() - 0.5) * 7; pos[i * 3 + 1] = pr() * 4.5; pos[i * 3 + 2] = -pr() * 22 + 2; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({ color: accent.clone(), size: 0.035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dust = new THREE.Points(g, this.dustMat); this.scene.add(this.dust);

    // ── luces: contraluz que sigue a la persona (perfila y proyecta su sombra hacia cámara), dos recortes traseros a ras
    //    de hombro, laterales del pasillo (todas con los colores del país), relleno mínimo y frontal (clímax) ──
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.03));
    this.fill = new THREE.HemisphereLight(0x8090b0, 0x050505, 0); this.scene.add(this.fill);
    this.back = new THREE.SpotLight(light.clone(), 0, 16, 0.55, 0.55, 1.3); this.back.position.set(0, 4.6, -10);
    this.back.castShadow = true; this.back.shadow.mapSize.set(opts.quality === "high" ? 1024 : 512, opts.quality === "high" ? 1024 : 512);
    this.back.shadow.camera.near = 1; this.back.shadow.camera.far = 16; this.back.shadow.bias = -0.0004; this.back.shadow.normalBias = 0.02;
    this.scene.add(this.back, this.back.target);
    this.rimL = new THREE.SpotLight(light.clone(), 0, 9, 0.5, 0.7, 1.5); this.rimL.position.set(-2.4, 1.9, -9); this.scene.add(this.rimL, this.rimL.target);
    this.rimR = new THREE.SpotLight(accent.clone(), 0, 9, 0.5, 0.7, 1.5); this.rimR.position.set(2.4, 1.9, -9); this.scene.add(this.rimR, this.rimR.target);
    this.key = new THREE.SpotLight(0xffffff, 0, 14, 0.42, 0.8, 1.4); this.key.position.set(0.6, 4.4, 5); this.scene.add(this.key, this.key.target);
    this.sideL = new THREE.PointLight(light.clone(), 0, 12, 1.6); this.sideL.position.set(-3.2, 4.2, -5); this.scene.add(this.sideL);
    this.sideR = new THREE.PointLight(accent.clone(), 0, 12, 1.6); this.sideR.position.set(3.2, 4.2, -5); this.scene.add(this.sideR);
    this.portalLight = new THREE.SpotLight(0xffffff, 0, 3.6, 0.42, 0.6, 1); this.portalLight.position.set(0, 2.6, -13.6); this.scene.add(this.portalLight, this.portalLight.target);

    // ── la persona (GLB riggeado, carga diferida) + su reflejo en el suelo ──
    this.humanU = humanUniforms(light, accent);
    const t0 = performance.now();
    const url = HUMAN_ASSETS[opts.avatar ?? "rocketbox"] ?? HUMAN_ASSETS.rocketbox;
    this.ready = loadHumanAsset(url).then(async (gltf) => {
      if (this.disposed) return;
      const accentMap = await loadAccentMap(gltf, url);
      if (accentMap) this.textures.push(accentMap);
      if (this.disposed) return;
      const clips = { walkClip: opts.qaClips?.walk, idleClip: opts.qaClips?.idle, accentMap };
      this.rig = createHumanRig(gltf, { uniforms: this.humanU, sheen: opts.quality === "high", castShadow: true, ...clips });
      this.rig.root.visible = false; this.scene.add(this.rig.root);
      this.mirror = createHumanRig(gltf, { uniforms: this.humanU, sheen: false, castShadow: false, ...clips });
      this.mirror.root.scale.y = -1; this.mirror.root.visible = false; this.scene.add(this.mirror.root);
      this.celebrationOk = !opts.celebration || this.rig.hasClips(CELEBRATIONS[opts.celebration].clips);
      this.humanLoadMs = Math.round(performance.now() - t0);
      if (this.lastFrame) this.render(this.lastFrame.f, this.lastFrame.walk);
    });
    // cuando la bandera se rasteriza llegan los colores reales del país: repintar
    this.arena.ready.then(() => {
      if (this.disposed) return;
      (this.scene.fog as THREE.FogExp2 | null)?.color.copy(this.arena.atmosphere());
      if (this.lastFrame) this.render(this.lastFrame.f, this.lastFrame.walk);
    });

    this.lostHandler = (e: Event) => { e.preventDefault(); };
    canvas.addEventListener("webglcontextlost", this.lostHandler);
  }

  /** Avisar si el contexto WebGL se pierde (el director cambia al escenario 2D). */
  onContextLost(cb: () => void): void { this.canvas.addEventListener("webglcontextlost", cb, { once: true }); }

  /** 0.3 · la celebración elegida al empezar la reproducción (cambiarla no recrea el contexto WebGL). */
  setCelebration(id: CelebrationId | null): void {
    this.opts.celebration = id;
    this.celebrationOk = !id || !this.rig || this.rig.hasClips(CELEBRATIONS[id].clips);
    if (this.lastFrame) this.render(this.lastFrame.f, this.lastFrame.walk);
  }

  /** La arena con su bandera ya rasterizada (colores reales del país). */
  get arenaReady(): Promise<void> { return this.arena.ready; }

  /** El tema del país que viste la arena (QA y piezas). */
  get theme() { return this.arena.theme; }

  resize(w: number, h: number): void {
    this.portrait = h > w;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.max(256, w / 2), Math.max(256, h / 2));
    this.camera.aspect = w / Math.max(1, h);
    // Encuadre móvil: más campo y la persona más centrada (no un escenario de escritorio encogido).
    this.camera.fov = this.portrait ? 54 : 40;
    this.camera.updateProjectionMatrix();
  }

  render(f: WalkoutFrame, walk: boolean): void {
    const p = (id: keyof WalkoutFrame["p"]) => f.p[id] ?? 0;
    const drama = this.opts.drama;
    const lights = p("lights");
    const flash = p("flash");
    const flashPulse = flash > 0 && flash < 1 ? Math.sin(flash * Math.PI) : 0;
    const reveal = Math.max(p("name"), p("card"));
    const tt = f.t;
    const mode = this.opts.humanMode ?? (walk ? "walk" : null);
    const teamHit = p("team") > 0.55 && p("team") < 1 ? Math.sin(((p("team") - 0.55) / 0.45) * Math.PI) : 0;

    // ── persona: paseo (o ya en la plataforma) → se detiene → celebra → se disuelve en luz ──
    const hp = mode ? p("human") : 0;
    // 0.4 · si el asset trae frenada capturada (Rocketbox), el paseo la usa: crucero atado a la distancia → `Walk_Stop`
    // con su propio avance → reposo. Si no (Quaternius), el paseo de 0.2 (frenada sintética + pie clavado + IK).
    const spec = this.rig?.walkSpec?.stop ? this.rig.walkSpec : null;
    const stw = spec && mode === "walk" ? walkAtWithStop(hp * this.opts.humanDur, this.opts.humanDur, spec) : null;
    const st = stw ?? (mode === "walk" ? walkAt(hp * this.opts.humanDur, this.opts.humanDur)
      : { ...walkAt(this.opts.humanDur, this.opts.humanDur), idleTime: hp * this.opts.humanDur });   // «stand»: quieto en la marca
    let hz = st.z, hx = 0;
    let swing: { side: "l" | "r"; dy: number } | null = null;
    // Frenada (Quaternius): mientras el reposo sustituye al paso, el pie de apoyo se queda CLAVADO donde estaba (la raíz se
    // mueve lo que haga falta). Sin esto los dos clips, con la pelvis en sitios distintos, arrastrarían los pies al detenerse.
    if (this.rig && !stw && mode === "walk" && st.walkWeight < 1) {
      const s0 = walkAt(st.blendStart, this.opts.humanDur);
      this.rig.pose(s0);
      const fl = this.rig.foot("l"), fr = this.rig.foot("r");
      const side = fl.y <= fr.y ? "l" : "r";
      const planted = (side === "l" ? fl : fr).z;
      this.rig.pose(st);
      hz = s0.z + planted - this.rig.foot(side).z;
      // el otro pie va del paso a su sitio del reposo POR EL AIRE (arco), no a rastras
      if (st.walkWeight > 0) swing = { side: side === "l" ? "r" : "l", dy: Math.sin(Math.PI * (1 - st.walkWeight)) ** 0.45 * 0.07 };
    }
    // Celebración: tiempo desde su beat; sus cambios de pose clavan un pie (la raíz compensa en planta)
    const ca = this.opts.celebrateAt ?? null;
    // (QA: con `?idle=<clip>` no hay celebración: se revisa el clip tal cual)
    const cid = this.opts.celebration && this.celebrationOk && ca !== null && tt >= ca && mode && !this.opts.qaClips?.idle ? this.opts.celebration : null;
    const ct = cid ? tt - (ca ?? 0) : 0;
    const total = spec ? (() => { const P = stopPlan(this.opts.humanDur, spec); return P.markZ - P.startZ; })() : WALK_PLAN.markZ - WALK_PLAN.startZ;
    const w = mode === "walk" ? clamp01(st.distance / total) : 1;
    const ovr = p("ovrFull");
    const dissolve = this.opts.qaHold ? 0 : clamp01(0.22 * clamp01((flash - 0.45) / 0.55) + 0.78 * easeInOutCubic(p("card")));
    const visible = !!mode && !this.opts.qaNoHuman && lights > 0 && dissolve < 1;
    let lift = 0;
    for (const r of [this.rig, this.mirror]) {
      if (!r) continue;
      r.root.visible = visible;
      if (!visible) continue;
      let ox = 0, oz = 0;
      if (cid) {
        // 0.9 · la MISMA puerta que el laboratorio de QA (celebrate3d): pies clavados, capas, captura enmascarada, manos, IK
        const res = applyCelebrationPose(r, cid, ct, st.idleTime);
        lift = res.lift; ox = res.offset.x; oz = res.offset.z;
      } else if (stw) {
        r.layers([
          { clip: "Walk_Loop", time: stw.walkTime, weight: stw.walkWeight },
          { clip: "Walk_Stop", time: stw.stopTime ?? 0, weight: stw.stopWeight },
          { clip: this.opts.qaClips?.idle ?? "Idle_Loop", time: stw.idleTime, weight: stw.idleWeight },
        ]);
      } else {
        r.pose({ walkTime: st.walkTime, walkWeight: st.walkWeight, idleTime: st.idleTime });
        if (swing) r.lift(swing.side, swing.dy);
      }
      r.root.position.set(hx + ox, r === this.mirror ? -lift : lift, hz + oz);
    }
    if (this.rig) for (const m of this.rig.meshes) m.castShadow = dissolve === 0;
    // contraluz del color de la edición: casi silueta al fondo, borde vivo al acercarse, estalla en el clímax
    this.humanU.uRim.value = lights * (0.28 + 0.22 * drama) + ovr * 0.25 + flashPulse * 2.6 + clamp01(flash) * 0.6;
    this.humanU.uDissolve.value = dissolve;

    // ── la arena: pantallas que se encienden (de la plataforma al fondo), país → equipo → país en la celebración ──
    const celebrating = cid ? clamp01(ct / 0.6) : 0;
    const stopped = mode === "stand" ? 1 : mode === "walk" ? clamp01((w - 0.9) / 0.1) : 0;
    this.arena.update({
      t: tt, lights, drama, reveal,
      screens: clamp01(lights * 0.65 + (f.p.flag ?? lights) * 0.35),
      team: clamp01((p("team") - 0.55) / 0.45) * (1 - celebrating),
      teamHit, flash: flashPulse, platform: Math.max(stopped * 0.6, celebrating),
      hype: Math.max(teamHit, celebrating * (1 - p("card")), flashPulse),
    });
    for (const h of this.haze) { h.mat.opacity = lights * (0.03 + 0.02 * drama); h.mesh.position.x += Math.sin(tt * h.drift) * 0.002; }
    this.dustMat.opacity = lights * 0.7;
    this.dust.rotation.y = Math.sin(tt * 0.05) * 0.05;
    this.dust.position.y = (tt * 0.04) % 0.5;

    // ── luces reales con los colores del país (siguen a la persona: el contraluz la recorta y proyecta su sombra) ──
    const [c0, c1] = this.arena.lightColors();
    if (c0) { this.back.color.copy(c0); this.rimL.color.copy(c0); this.sideL.color.copy(c0); this.dustMat.color.copy(c1 ?? c0); for (const h of this.haze) h.mat.color.copy(c0); }
    if (c1) { this.rimR.color.copy(c1); this.sideR.color.copy(c1); }
    const hitBoost = this.arena.teamAccent ? 1.2 : 1;
    this.back.position.set(hx, 4.6, hz - 4.2); this.back.target.position.set(hx, 1.0, hz);
    this.back.intensity = lights * (36 + 24 * drama) + teamHit * 34 * hitBoost + flashPulse * 36 + celebrating * 10 * drama;
    this.rimL.position.set(hx - 2.3, 1.9, hz - 2.6); this.rimL.target.position.set(hx, 1.15, hz);
    this.rimR.position.set(hx + 2.3, 1.9, hz - 2.6); this.rimR.target.position.set(hx, 1.15, hz);
    this.rimL.intensity = this.rimR.intensity = lights * (16 + 10 * drama) + teamHit * 10 + flashPulse * 20;
    this.sideL.intensity = lights * (3 + 2 * drama) + teamHit * 8;
    this.sideR.intensity = lights * (3 + 2 * drama) + teamHit * 8;
    // 0.4 · contraluz BLANCO del portal (el recorte de la referencia) y una luz de escenario frontal-lateral fría que
    // modela la cara y la ropa sin aplanar: el cuerpo se lee, el fondo de color lo separa.
    const realistic = this.rig?.profile.id === "rocketbox";
    // (sigue a la persona por detrás, casi horizontal y con alcance corto: su cono NUNCA llega al suelo brillante de
    // delante, que si no lo devolvía a cámara como una mancha blanca)
    this.portalLight.position.set(hx, 1.7, hz - 2.6); this.portalLight.target.position.set(hx, 1.45, hz);
    this.portalLight.intensity = lights * (realistic ? 7 : 5) * (1 - reveal * 0.5) + flashPulse * 8;
    // relleno: sube con la celebración y la media («las luces aumentan»)
    this.fill.intensity = lights * (realistic ? 0.3 : 0.12) + celebrating * 0.15 + ovr * 0.15 + flashPulse * 0.08;
    // frontal alto y lateral: ilumina cuerpo y cara dejando sombra bajo la frente; en el clímax NO se enciende de frente
    this.key.color.set(0xeef2ff);
    this.key.position.set(hx + 1.6, 4.8, hz + 3.0); this.key.target.position.set(hx, 1.0, hz);
    this.key.intensity = (lights * (realistic ? 7 : 0) + celebrating * 4 + ovr * 3) * (1 - clamp01(flash));

    // ── cámara (0.4) ──
    // 1 plano general del túnel (luces) → 2 la figura al fondo → 3 cámara baja que acompaña de frente y un poco de lado
    // (se leen piernas, pancartas y pantallas) con un leve giro hacia las banderas en su beat → 4–5 bandera y escudo →
    // 6 llega: se centra → 7 plano de la celebración (SHUSH cerca, salto abierto, brazos plano medio) → 8 OVR → 9 reveal.
    const centre = easeInOutCubic(Math.max(flash, p("name")));
    const ew = easeInOutCubic(w);
    const tall = this.portrait;
    const fr = FRAMING[cid ? CELEBRATIONS[cid].framing : "medium"];
    const k = mode === "stand" ? 1 : cid ? easeInOutCubic(clamp01((ct + 0.25) / 1.1)) : 0;
    const scale = tall ? 1.32 : 1;
    const est = 1 - easeInOutCubic(clamp01((hp * this.opts.humanDur - 0.2) / 1.6));   // plano general al principio
    const flagPan = Math.sin(Math.PI * clamp01(p("flag") * 1.2)) * (tall ? 0.25 : 0.55);       // mirada a las banderas
    let camX = (tall ? 0.35 : 0.85) - ew * (tall ? 0.15 : 0.45);
    let camY = (tall ? 0.95 : 0.78) + ew * 0.2 + est * (tall ? 0.6 : 0.7);
    let camZ = hz + (tall ? 7.2 : 6.0) - ew * (tall ? 2.2 : 2.1) + est * 2.5 - easeInOutCubic(ovr) * 0.2;
    let lookY = (tall ? 1.75 : 1.45) + est * 0.9 - ew * 0.15 + easeInOutCubic(ovr) * 0.05;
    if (mode) {
      const orbit = cid && drama > 0.8 ? Math.sin(ct * 0.7) * 0.6 : 0;                   // MEGA: un leve giro
      camX = camX * (1 - k) + orbit * k;
      camY = camY * (1 - k) + (fr.camY + (tall ? 0.08 : 0)) * k;
      camZ = camZ * (1 - k) + (hz + fr.dist * scale) * k;
      // móvil: el punto de mira más alto (más pantalla gigante y menos suelo en la mitad de abajo)
      lookY = lookY * (1 - k) + (fr.lookY + (tall ? 0.32 : 0)) * k;
      camZ -= centre * 0.45;
      this.camera.position.set(camX * (1 - centre), camY, camZ);
      this.camera.lookAt((hx + flagPan * (1 - k)) * (1 - centre), lookY, hz - est * 6);
    } else {
      this.camera.position.set(0, tall ? 1.45 : 1.25, (tall ? 10.6 : 9.4) - easeInOutCubic(lights) * 0.4);
      this.camera.lookAt(0, tall ? 2.4 : 2.0, -6);
    }

    if (this.opts.qaLit) { this.key.color.set(0xffffff); this.key.intensity = 40; this.key.position.set(hx + 1.2, 3.2, hz + 3.5); this.key.target.position.set(hx, 1.1, hz); this.fill.intensity = 1.6; }
    // QA: cámara libre (`?cam=x,y,z,lx,ly,lz`, relativa a la persona) para revisar pies, manos y proporciones de cerca.
    if (this.opts.qaCam) { const [x, y, z, lx, ly, lz] = this.opts.qaCam; this.camera.position.set(hx + x, y, hz + z); this.camera.lookAt(hx + lx, ly, hz + lz); }

    this.lastFrame = { f, walk };
    // el resplandor sube con el impacto y el clímax
    this.bloom.strength = (this.opts.quality === "high" ? 0.5 : 0.4) + teamHit * 0.25 + flashPulse * 0.5;
    this.renderer.info.reset();
    this.composer.render();
  }

  /** QA: posición en el mundo de pies (bola y talón), pelvis, cabeza y manos en el último fotograma pintado. */
  qaProbe(): Record<string, [number, number, number]> | null {
    if (!this.rig) return null;
    const out: Record<string, [number, number, number]> = {};
    const v = new THREE.Vector3();
    this.rig.root.updateMatrixWorld(true);
    this.rig.root.traverse((o) => {
      if (["ball_l", "ball_r", "foot_l", "foot_r", "pelvis", "Head", "hand_r", "index_03_r", "Bip01_Head", "Bip01_R_Hand", "Bip01_R_Finger12", "Bip01_R_Finger22", "Bip01_R_Finger2", "Bip01_R_Finger21"].includes(o.name)) { o.getWorldPosition(v); out[o.name] = [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; }
    });
    return out;
  }

  /** Para la QA (runtime): tiempo de carga de la persona y lo que cuesta un fotograma. */
  stats(): Stage3DStats {
    const i = this.renderer.info;
    return { humanLoadMs: this.humanLoadMs, triangles: i.render.triangles, calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.dispose(); this.mirror?.dispose(); this.rig = this.mirror = null;
    this.arena.dispose();
    this.bloom.dispose(); this.composer.dispose();
    if (this.lostHandler) this.canvas.removeEventListener("webglcontextlost", this.lostHandler);
    const geos = new Set<THREE.BufferGeometry>(); const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => mats.add(x)); else if (mat) mats.add(mat);
    });
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); this.textures.forEach((t) => t.dispose());
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** ¿Hay WebGL en este navegador? (sin crear un contexto que se quede vivo). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    const ok = !!gl;
    (gl?.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
    return ok;
  } catch { return false; }
}
