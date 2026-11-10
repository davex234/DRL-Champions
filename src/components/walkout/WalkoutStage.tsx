"use client";

/**
 * PACK WALKOUT · EL ESCENARIO — elige 3D o 2D (`chooseStage`) y pinta el fotograma que le da el director.
 *
 * three.js se importa SOLO aquí y de forma dinámica (no entra en ningún otro bundle). Si el import falla, la persona 3D
 * (GLB) no carga o el contexto WebGL se pierde, el escenario pasa a 2D sin parar la timeline. Al desmontar o cambiar de edición: `dispose()`
 * (geometrías, materiales, texturas y contexto) — REPETIR no acumula escenas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { WalkoutFrame } from "@/domain/walkout/timeline";
import type { EditionPreset } from "@/domain/walkout/input";
import { chooseStage, dprCapFor, isLowEnd, stageReason, HUMAN_READY_TIMEOUT_MS, type StageBreak, type StageKind } from "@/lib/walkout/stageChoice";
import { Stage2D } from "./Stage2D";
import type { WalkoutStage3D } from "./stage3d";
import type { CelebrationId } from "@/domain/walkout/celebration";
import type { ArenaCountryInput } from "@/domain/walkout/countryTheme";

/** QA: `?cam=x,y,z,lx,ly,lz` (solo en la ruta del prototipo, que es la única que monta este escenario). */
function qaCamFromUrl(): number[] | null {
  const v = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
  return v && v.length === 6 && v.every(Number.isFinite) ? v : null;
}

function qaClipsFromUrl(): { walk?: string; idle?: string } | null {
  const q = new URLSearchParams(window.location.search);
  const ok = (v: string | null) => (v && /^[A-Za-z_]+$/.test(v) ? v : undefined);
  return q.has("walk") || q.has("idle") ? { walk: ok(q.get("walk")), idle: ok(q.get("idle")) } : null;
}

export function WalkoutStage({ frame, walk, humanDur = 0, humanMode = null, celebrateAt = null, celebration = null, country, team, artwork = null, preset, particles, drama, reduced, forced, onKind }: {
  frame: WalkoutFrame;
  walk: boolean;
  /** Duración del beat de la persona (s). */
  humanDur?: number;
  /** 0.3 · persona que entra caminando o que ya está en la plataforma (RARE). */
  humanMode?: "walk" | "stand" | null;
  /** 0.3 · celebración: inicio de su beat y la elegida (fijada al empezar la reproducción). */
  celebrateAt?: number | null;
  celebration?: CelebrationId | null;
  /** 0.3 · país y equipo que visten la arena. */
  country?: ArenaCountryInput;
  team?: { name: string; tag: string; logoSrc: string | null };
  /** 0.4 · arte de la carta (retratos de las pancartas). */
  artwork?: string | null;
  preset: EditionPreset;
  particles: number;
  drama: number;
  reduced: boolean;
  forced: StageKind | null;
  onKind?: (k: StageKind, why: string) => void;
}) {
  const [env, setEnv] = useState<{ webgl: boolean; lowEnd: boolean } | null>(null);
  const [broken, setBroken] = useState<StageBreak | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<WalkoutStage3D | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const walkRef = useRef(walk);
  walkRef.current = walk;
  const celebrationRef = useRef(celebration);
  celebrationRef.current = celebration;

  /*
   * WALKOUT 0.8 · ¿hace falta sondear WebGL? Con movimiento reducido (sin 3D forzado) el escenario va a ser 2D pase lo
   * que pase: entonces NO se descarga el chunk de three.js para preguntar (antes se descargaba siempre).
   */
  const probe = !(reduced && forced !== "3d");
  useEffect(() => {
    const lowEnd = isLowEnd(navigator as Navigator & { deviceMemory?: number });
    if (!probe) { setEnv({ webgl: true, lowEnd }); return; }   // sin sondear: `reduced` ya decide 2D en chooseStage
    let alive = true;
    let webgl = false;
    import("./stage3d").then((m) => { webgl = m.webglAvailable(); }).catch(() => { if (alive) setBroken("asset"); })
      .finally(() => { if (alive) setEnv({ webgl, lowEnd }); });
    return () => { alive = false; };
  }, [probe]);

  const kind: StageKind | null = env ? chooseStage({ webgl: env.webgl, lowEnd: env.lowEnd, reduced, forced, contextLost: broken === "context", loadFailed: !!broken && broken !== "context" }) : null;

  useEffect(() => {
    if (!kind || !env) return;
    onKind?.(kind, stageReason(kind, { webgl: env.webgl, reduced, lowEnd: env.lowEnd, forced, broken }));
  }, [kind, env, broken, forced, reduced, onKind]);

  // Monta/desmonta la escena 3D (una por edición y por partículas: lo que cambia materiales y geometrías).
  useEffect(() => {
    if (kind !== "3d" || !canvasRef.current) return;
    let alive = true;
    let ro: ResizeObserver | null = null;
    const canvas = canvasRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    import("./stage3d").then(({ WalkoutStage3D }) => {
      if (!alive) return;
      const w = canvas.clientWidth || window.innerWidth;
      const q = new URLSearchParams(window.location.search);
      let st: WalkoutStage3D;
      try {
        st = new WalkoutStage3D(canvas, {
        preset, particles, drama, dprCap: dprCapFor(w), humanDur, humanMode, celebrateAt, celebration: celebrationRef.current, country, team, artwork,
        quality: w < 640 ? "low" : "high", qaCam: qaCamFromUrl(), qaClips: qaClipsFromUrl(), qaHold: q.get("qaHold") === "1", qaNoHuman: q.get("qaNoHuman") === "1", avatar: q.get("avatar") === "quaternius" ? "quaternius" : "rocketbox", qaLit: q.get("qaLit") === "1",
        });
      } catch (e) {
        // la escena no se pudo crear (p. ej. WebGL presente pero inutilizable): 2D, un aviso y nada más
        console.warn("[walkout] escena 3D no disponible, se usa 2D:", e instanceof Error ? e.message : e);
        setBroken("runtime");
        return;
      }
      stageRef.current = st;
      // QA (la ruta del prototipo es la única que monta este escenario): sondas de pies y coste por fotograma.
      (window as unknown as { __walkoutStage?: WalkoutStage3D }).__walkoutStage = st;
      canvas.dataset.human = "loading";
      // QA de identidad: el código y el tipo de tema que la arena está pintando (deben coincidir con la carta)
      const markTheme = () => { canvas.dataset.arenaCode = st.theme.code; canvas.dataset.arenaKind = st.theme.kind; };
      markTheme(); st.arenaReady.then(() => { if (alive) markTheme(); });
      let humanSettled = false;
      st.ready.then(() => { humanSettled = true; if (!alive) return; canvas.dataset.human = "ready"; canvas.dataset.humanMs = String(st.stats().humanLoadMs ?? ""); })
        .catch(() => { humanSettled = true; if (alive) { canvas.dataset.human = "failed"; setBroken("model"); } });
      // la persona no puede quedarse colgada: pasado el plazo, 2D (la carta se presenta igual)
      if (q.get("qaNoHuman") !== "1") timer = setTimeout(() => { if (alive && !humanSettled) { canvas.dataset.human = "timeout"; setBroken("timeout"); } }, HUMAN_READY_TIMEOUT_MS);
      st.onContextLost(() => { if (alive) setBroken("context"); });
      const fit = () => {
        try { st.resize(canvas.clientWidth || 1, canvas.clientHeight || 1); st.render(frameRef.current, walkRef.current); }
        catch (e) { if (alive) { console.warn("[walkout] fallo al pintar la escena 3D, se usa 2D:", e instanceof Error ? e.message : e); setBroken("runtime"); } }
      };
      fit();
      ro = new ResizeObserver(fit); ro.observe(canvas);
    }).catch(() => { if (alive) setBroken("asset"); });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ro?.disconnect();
      const w = window as unknown as { __walkoutStage?: WalkoutStage3D };
      if (w.__walkoutStage === stageRef.current) delete w.__walkoutStage;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, [kind, preset, particles, drama, humanDur, humanMode, celebrateAt, country, team, artwork]);

  // La celebración cambia al empezar cada reproducción (RANDOM): se le dice a la escena, sin recrearla.
  useEffect(() => { stageRef.current?.setCelebration(celebration); }, [celebration]);

  // Un render por fotograma de la timeline (sin RAF propio: cuando la timeline para, el lienzo para).
  useEffect(() => {
    if (!stageRef.current) return;
    try { stageRef.current.render(frame, walk); }
    catch (e) { console.warn("[walkout] fallo al pintar la escena 3D, se usa 2D:", e instanceof Error ? e.message : e); stageRef.current.dispose(); stageRef.current = null; setBroken("runtime"); }
  }, [frame, walk]);

  // Un lienzo NUEVO por escena: `dispose` fuerza la pérdida del contexto WebGL y un lienzo con el contexto perdido ya no
  // da otro (getContext → null). Cambiar solo de país, equipo o arte (misma pieza, otra carta) recrea la escena: sin
  // esta clave caía al 2D. Misma lista que las dependencias del efecto de arriba.
  const sceneKey = useMemo(() => JSON.stringify([kind, preset, particles, drama, humanDur, humanMode, celebrateAt, country, team, artwork]), [kind, preset, particles, drama, humanDur, humanMode, celebrateAt, country, team, artwork]);

  if (!kind) return <div className="absolute inset-0" style={{ background: "#030409" }} />;
  if (kind === "2d") return <Stage2D frame={frame} walk={walk} preset={preset} reduced={reduced} />;
  return <canvas key={sceneKey} ref={canvasRef} className="absolute inset-0 h-full w-full" data-testid="walkout-stage-3d" aria-hidden />;
}
