"use client";

/**
 * WALKOUT 0.5 · UN WALKOUT DENTRO DE LA APERTURA REAL.
 *
 * Presenta UNA carta especial ya guardada por el servidor (`PackWalkoutItem`: uid persistido + identidad derivada SOLO de
 * la carta). No pide nada a la red, no toca el inventario ni el resultado: si se salta, se repite o falla, las cartas
 * siguen siendo exactamente las mismas y ya están en la colección.
 *
 *   · empieza solo, por el apagón (el sobre ya se rasgó en su escena);
 *   · SALTAR (del propio walkout, o Enter/Espacio/→ mientras corre) va al final de ESTA carta;
 *   · al acabar: REPETIR (solo la animación) y CONTINUAR (la siguiente especial o lo que quede de la ceremonia);
 *   · SONIDO: el silencio global del juego (el mismo ajuste que el resto); sin un gesto previo no suena nada
 *     (`runningAudioContext`), y cambiar de carta corta lo que sonaba (el director para su audio al desmontarse);
 *   · cualquier fallo del walkout (el 3D lo resuelve su propio respaldo 2D; esto es lo que quede) → se registra y se
 *     CONTINÚA: una animación nunca bloquea la entrega ni la vista de las cartas.
 *
 * Se carga bajo demanda (`next/dynamic` desde la apertura) y three.js, a su vez, solo si el escenario 3D llega a montarse.
 *
 * WALKOUT 0.8 · `reduced` es lo que pide el SISTEMA; manda la preferencia «Animaciones de apertura» del jugador
 * (`lib/walkout/animationPref`): Cinemática 3D lo ignora (nunca una incompatibilidad técnica), Reducidas fuerza 2D. El
 * botón 3D/2D del reproductor cambia la preferencia y vuelve a presentar ESTA carta (solo la animación). Cada walkout
 * registra UNA vez con qué escenario salió y por qué (`walkout_stage:<3d|2d>:<código>:<preferencia>`).
 */
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { WalkoutDirector, type WalkoutHandle } from "@/components/walkout/WalkoutDirector";
import type { PackWalkoutItem } from "@/domain/walkout/packWalkout";
import { getAudioSettings, onAudioSettingsChange, primeAudio, setAudioSettings } from "@/lib/sound";
import { trackFlow } from "@/lib/telemetry/client";
import { describeOpeningMode, setOpeningAnimation, useOpeningAnimation, walkoutReduced } from "@/lib/walkout/animationPref";
import type { StageKind } from "@/lib/walkout/stageChoice";

const btn = "nx-focus inline-flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-full border px-5 font-display text-label font-bold uppercase tracking-wide2 transition";

class WalkoutBoundary extends Component<{ onFail: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { this.props.onFail(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function PackWalkout({ item, index, total, reduced, onDone }: {
  item: PackWalkoutItem;
  /** Posición de este walkout en la cola de la apertura (0…total-1). */
  index: number;
  total: number;
  reduced: boolean;
  /** Esta carta ya se presentó (o falló su animación): la ceremonia sigue. Se llama UNA vez. */
  onDone: () => void;
}) {
  const ref = useRef<WalkoutHandle>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [done, setDone] = useState(false);
  const [muted, setMuted] = useState(() => getAudioSettings().muted);
  const pref = useOpeningAnimation();
  const effReduced = walkoutReduced(pref, reduced);
  const [stage, setStage] = useState<{ kind: StageKind | null; why: string }>({ kind: null, why: "" });
  /** Cambiar 3D/2D desde el reproductor vuelve a presentar ESTA carta desde el principio (nueva clave del director). */
  const [take, setTake] = useState(0);
  // En vertical (móvil) la fila de arriba del walkout (bandera · rol · escudo) chocaba con OMITIR y CERRAR de la apertura:
  // la escena baja una franja y esa franja es de los controles.
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const m = () => setTall(window.innerHeight > window.innerWidth);
    m(); window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);
  useEffect(() => onAudioSettingsChange((s) => setMuted(s.muted)), []);

  const left = useRef(false);
  const finish = useCallback(() => {
    if (left.current) return;
    left.current = true;
    onDone();
  }, [onDone]);

  const onStatus = useCallback((s: { status: string; stage: StageKind | null; stageWhy: string }) => {
    setDone(s.status === "done");
    setStage((p) => (p.kind === s.stage && p.why === s.stageWhy ? p : { kind: s.stage, why: s.stageWhy }));
  }, []);
  // por qué salió 3D o 2D: una vez por carta y por toma (sin datos personales; el código es fijo)
  const reported = useRef("");
  useEffect(() => {
    if (!stage.kind) return;
    const why = stage.why === "REDUCED_MOTION" && pref === "reduced" ? "USER_REDUCED" : stage.why;
    const key = `${take}:${stage.kind}:${why}`;
    if (reported.current === key) return;
    reported.current = key;
    trackFlow("pack_ceremony", `walkout_stage:${stage.kind}:${why}:${pref}`);
  }, [stage, pref, take]);
  const technical2d = stage.kind === "2d" && stage.why !== "REDUCED_MOTION" && stage.why !== "FORCED";
  const switchMode = () => {
    primeAudio();
    setOpeningAnimation(stage.kind === "3d" ? "reduced" : "cinematic");
    setDone(false);
    setStage({ kind: null, why: "" });
    setTake((t) => t + 1);
  };
  useEffect(() => { if (done) continueRef.current?.focus({ preventScroll: true }); }, [done]);
  useEffect(() => { trackFlow("pack_ceremony", `walkout_shown:${item.intensity}`); }, [item.intensity]);

  // Enter / Espacio / →: mientras corre, saltar al final de ESTA carta; al acabar, continuar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowRight") return;
      // Con el foco en un botón, el navegador ya lo pulsa: no se cuenta dos veces.
      if (document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (done) finish(); else ref.current?.skip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, finish]);

  const onFail = useCallback((e: unknown) => {
    console.error("[pack-walkout] el walkout falló; la apertura sigue:", e);
    trackFlow("pack_ceremony", "walkout_failed");
    finish();
  }, [finish]);

  const toggleSound = () => { primeAudio(); setAudioSettings({ muted: !muted }); };
  const replay = () => { primeAudio(); trackFlow("pack_ceremony", "walkout_replay"); ref.current?.replay(); };

  return (
    // Capa propia (isolate): el walkout queda POR DEBAJO de «Omitir» y «Cerrar» de la apertura. `translateZ(0)` hace que el
    // director (fixed) se coloque dentro de ESTA caja, así puede dejar libre la franja de arriba en vertical.
    <div className="absolute inset-x-0 bottom-0 z-surface isolate bg-[#030409]" style={{ top: tall ? "calc(60px + env(safe-area-inset-top))" : 0, transform: "translateZ(0)" }} data-testid="pack-walkout" data-walkout-uid={item.uid} data-walkout-card={item.cardId} data-walkout-intensity={item.intensity} data-walkout-index={index} data-walkout-done={done ? "1" : "0"} data-walkout-stage={stage.kind ?? ""} data-walkout-stage-why={stage.why} data-walkout-pref={pref}>
      <WalkoutBoundary onFail={onFail}>
        <WalkoutDirector key={take} ref={ref} input={item.identity} intensity={item.intensity} reduced={effReduced} audioOn={!muted} autoPlay startAtBeat="blackout" onStatus={onStatus} />
      </WalkoutBoundary>

      {total > 1 && (
        <p className="pointer-events-none absolute left-1/2 z-[80] -translate-x-1/2 rounded-full border border-white/15 bg-black/45 px-3 py-1 font-display text-caption font-bold uppercase tracking-wide2 text-white/75" style={{ top: tall ? -46 : 16, marginTop: tall ? 0 : "env(safe-area-inset-top)" }}>
          Especial {index + 1} de {total}
        </p>
      )}

      <button
        type="button" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? "Activar el sonido" : "Silenciar el sonido"} data-testid="pack-walkout-sound"
        className={`${btn} absolute bottom-5 left-5 z-[80] border-white/20 bg-black/50 px-4 text-white/80 hover:bg-black/70`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {muted ? "🔇" : "🔊"}<span className="sr-only">{muted ? "Sonido apagado" : "Sonido encendido"}</span>
      </button>

      {/* WALKOUT 0.8 · modo de animación desde el propio reproductor (si el 2D es por un fallo técnico, no se ofrece) */}
      {stage.kind && !technical2d && (
        <button
          type="button" onClick={switchMode} data-testid="pack-walkout-mode" data-mode={stage.kind} data-pref={pref} data-stage-why={stage.why}
          aria-label={stage.kind === "3d" ? "Ver la versión 2D reducida" : "Ver la cinemática 3D"} title={describeOpeningMode(pref, reduced)}
          className={`${btn} absolute bottom-[76px] left-5 z-[80] border-white/20 bg-black/50 px-4 text-white/80 hover:bg-black/70`}
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          {stage.kind === "3d" ? "Ver en 2D" : "Ver en 3D"}
        </button>
      )}

      {done && (
        // en la esquina (donde estaba SALTAR): el nombre del jugador ocupa el centro de abajo
        <div className="absolute bottom-5 right-5 z-[80] flex gap-3" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          <button type="button" onClick={replay} className={`${btn} border-white/25 bg-black/55 text-white/85 hover:bg-black/75`} data-testid="pack-walkout-replay">
            Repetir
          </button>
          <button ref={continueRef} type="button" onClick={finish} className={`${btn} border-white/40 bg-white text-[#05060b] hover:bg-white/90`} data-testid="pack-walkout-continue">
            {index + 1 < total ? "Siguiente" : "Continuar"} →
          </button>
        </div>
      )}
    </div>
  );
}

export default PackWalkout;
