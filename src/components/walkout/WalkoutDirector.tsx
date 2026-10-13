"use client";

/**
 * PACK WALKOUT · EL DIRECTOR — una escena + datos dinámicos.
 *
 * Recibe QUÉ enseñar (`WalkoutInput`, derivado de la carta con `walkoutInputFromCard`) y CON QUÉ intensidad, y nada
 * más: no conoce sobres, probabilidades, economía ni servidor. Dueño de:
 *   · la timeline y su único reloj (`WalkoutController`): reproducir · saltar · repetir · congelar un instante;
 *   · el audio sintetizado (`WalkoutAudio`): un cue por beat, cortado al saltar, repetir o salir;
 *   · la precarga de los TRES assets de la escena (bandera, escudo, carta) con tope de espera: «PREPARANDO…» solo si
 *     tarda; un asset que falla NO para la escena (su pieza usa el respaldo).
 *
 * Integración futura (sin tocar la escena): `ref.current.play()` tras pasar `input={walkoutInputFromCard(hero.card,
 * player)}` y la intensidad que decida quien llama. Al desmontar no queda reloj, sonido ni contexto WebGL.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildTimeline, clamp01, frameAt, type BeatId, type WalkoutFrame, type WalkoutIntensity } from "@/domain/walkout/timeline";
import { PARTICLE_CAP, editionPreset, type WalkoutInput } from "@/domain/walkout/input";
import { footfalls, footfallsWithStop } from "@/domain/walkout/walk";
import { HYPE_TIMES, SHUSH, celebrationForIntensity, pickCelebration, type CelebrationChoice, type CelebrationId } from "@/domain/walkout/celebration";
import { WalkoutController } from "@/lib/walkout/controller";
import { CUE_OF_BEAT, WalkoutAudio } from "@/lib/walkout/audio";
import type { StageKind } from "@/lib/walkout/stageChoice";
import { isMuted } from "@/lib/sound";
import { WalkoutStage } from "./WalkoutStage";
import { CardPiece, EditionPiece, FlagPiece, NamePiece, PackPiece, RatingPiece, RolePiece, TeamPiece, WalkoutSummary, type WalkoutLayout } from "./Reveals";

export interface WalkoutHandle {
  play: () => void;
  skip: () => void;
  replay: () => void;
  seek: (t: number) => void;
}

export interface WalkoutDirectorProps {
  input: WalkoutInput;
  intensity: WalkoutIntensity;
  reduced: boolean;
  /** Arte del sobre para el beat de apertura (null → sobre genérico). */
  packArt?: string | null;
  /** Panel DEV: forzar escenario. */
  forceStage?: StageKind | null;
  audioOn?: boolean;
  /**
   * 0.3 · celebración al llegar: una concreta o RANDOM (solo visual: no toca el RNG de sobres ni recompensas). Se FIJA al
   * empezar cada reproducción, así SALTAR, REPETIR y congelar ven siempre la misma.
   */
  celebration?: CelebrationChoice;
  /** Empieza sola al estar lista (la QA); por defecto espera a `play()`. */
  autoPlay?: boolean;
  /**
   * 0.5 · empezar (y repetir) desde un beat: en la apertura real el sobre ya se rasgó en su propia escena, así que el
   * walkout entra por el apagón (`"blackout"`) en vez de volver a enseñar un sobre.
   */
  startAtBeat?: BeatId | null;
  onStatus?: (s: { status: string; t: number; stage: StageKind | null; stageWhy: string }) => void;
  onComplete?: () => void;
}

const PRELOAD_TIMEOUT_MS = 2500;
const PREPARING_AFTER_MS = 300;

/** Carga una imagen con tope: resuelve true/false, nunca rechaza (un asset roto no para la escena). */
function preload(src: string | null | undefined, signal: { dead: boolean }): Promise<boolean> {
  if (!src) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    const t = window.setTimeout(() => done(false), PRELOAD_TIMEOUT_MS);
    function done(ok: boolean) { window.clearTimeout(t); img.onload = img.onerror = null; resolve(!signal.dead && ok); }
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = src;
  });
}

/**
 * 0.4 · los pasos que se OYEN caen donde apoya la persona que se VE: Rocketbox (por defecto) con sus apoyos medidos y su
 * frenada; la de respaldo (Quaternius, solo `?avatar=quaternius` en QA) con su zancada.
 */
function stepsFor(dur: number): number[] {
  const qa = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("avatar") === "quaternius";
  return qa ? footfalls(dur) : footfallsWithStop(dur);
}

/**
 * Los parámetros con que suena cada cue de una reproducción. Exportado para la QA de audio (render sin altavoces de la
 * página interna): suena EXACTAMENTE lo mismo que en la escena.
 */
export function walkoutCueOptions(tl: ReturnType<typeof buildTimeline>, cel: CelebrationId | null, intensity: number) {
  const human = tl.beats.find((b) => b.id === "human");
  return {
    intensity, stepTimes: human ? stepsFor(human.dur) : [],
    crowd: crowdEnvelope(tl, cel), celebration: cel ?? undefined, landAt: cel === "HYPE_JUMP" ? HYPE_TIMES.landAt : cel === "SHUSH" ? SHUSH.reach : undefined,
  };
}

/**
 * 0.3 · el rumor del público siguiendo la escena (s desde que se encienden las luces): crece al entrar, sube con el
 * impacto del escudo, calla con el SHUSH o ruge con la celebración y el clímax, y se apaga tras la carta.
 */
function crowdEnvelope(tl: ReturnType<typeof buildTimeline>, cel: CelebrationId | null): [number, number][] {
  const at = (id: string) => tl.beats.find((b) => b.id === id)?.at;
  const t0 = at("lights") ?? 0;
  const rel = (x: number | undefined) => Math.max(0.01, (x ?? t0) - t0);
  const env: [number, number][] = [[0.01, 0.35], [1.6, 0.8]];
  const team = at("team"); if (team !== undefined) env.push([rel(team) + 0.3, 0.85], [rel(team) + 0.6, 1.5], [rel(team) + 1.8, 0.95]);
  const c = at("celebrate");
  if (c !== undefined && cel) {
    if (cel === "SHUSH") env.push([rel(c) + 0.3, 0.9], [rel(c) + SHUSH.reach + 0.2, 0.18], [rel(c) + 2.2, 0.25]);
    else { const peak = cel === "HYPE_JUMP" ? HYPE_TIMES.landAt : 0.6; env.push([rel(c) + 0.2, 1.0], [rel(c) + peak + 0.1, 1.9], [rel(c) + peak + 1.4, 1.2]); }
  }
  const flash = at("flash"); if (flash !== undefined) env.push([rel(flash), 1.3], [rel(flash) + 0.4, 1.8]);
  env.push([rel(tl.duration) + 1.2, 0.6], [rel(tl.duration) + 3.0, 0.0001]);
  return env.sort((a, b) => a[0] - b[0]);
}

function useLayout(): WalkoutLayout {
  const [l, setL] = useState<WalkoutLayout>({ tall: false, w: 1440, h: 900 });
  useEffect(() => {
    const m = () => setL({ tall: window.innerHeight > window.innerWidth, w: window.innerWidth, h: window.innerHeight });
    m();
    window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, []);
  return l;
}

export const WalkoutDirector = forwardRef<WalkoutHandle, WalkoutDirectorProps>(function WalkoutDirector(
  { input, intensity, reduced, packArt = null, forceStage = null, audioOn = true, celebration = "RANDOM", autoPlay = false, startAtBeat = null, onStatus, onComplete }, ref,
) {
  const tl = useMemo(() => buildTimeline(intensity, { reduced }), [intensity, reduced]);
  const from = startAtBeat ? tl.beats.find((b) => b.id === startAtBeat)?.at ?? 0 : 0;
  const preset = editionPreset(input.edition.id);
  const particles = Math.min(preset.particles, PARTICLE_CAP[intensity] ?? 60);
  const drama = intensity === "MEGA_WALKOUT" ? 1 : intensity === "WALKOUT" ? 0.6 : 0.3;
  const layout = useLayout();
  const humanDur = tl.beats.find((b) => b.id === "human")?.dur ?? 0;
  const celebrateAt = tl.beats.find((b) => b.id === "celebrate")?.at ?? null;
  // La celebración de ESTA reproducción (RANDOM se resuelve aquí, con azar visual; nunca el de los sobres).
  const [chosen, setChosen] = useState<CelebrationId>(() => pickCelebration(celebration, Math.random));
  useEffect(() => { if (celebration !== "RANDOM") setChosen(pickCelebration(celebration, Math.random)); }, [celebration]);
  const effective = tl.human ? celebrationForIntensity(intensity, chosen) : null;
  const chosenRef = useRef(effective);
  chosenRef.current = effective;
  const reroll = useCallback(() => { if (celebration === "RANDOM") setChosen(pickCelebration("RANDOM", Math.random)); }, [celebration]);
  // El país y el equipo que visten la arena (estables: cambiarlos recrea la escena).
  const country = useMemo(() => ({ flag: input.flag, region: input.region, nationality: input.nationality }), [input.flag, input.region, input.nationality]);
  const arenaTeam = input.team;

  const [frame, setFrame] = useState<WalkoutFrame>(() => frameAt(tl, 0));
  const [status, setStatus] = useState("idle");
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState<{ flag: boolean; team: boolean }>({ flag: false, team: false });
  const [stage, setStage] = useState<{ kind: StageKind | null; why: string }>({ kind: null, why: "" });

  const audio = useMemo(() => new WalkoutAudio(), []);
  const ctlRef = useRef<WalkoutController | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => { audio.setEnabled(audioOn && !isMuted()); }, [audio, audioOn]);

  // Un controlador por timeline. Desmontar/cambiar: reloj cortado y sonido cortado (nada sigue después).
  useEffect(() => {
    const human = tl.beats.find((b) => b.id === "human");
    const ctl = new WalkoutController(tl, {
      onFrame: setFrame,
      onCue: (b) => {
        const cue = CUE_OF_BEAT[b];
        if (!cue) return;
        const cel = chosenRef.current;
        audio.play(cue, walkoutCueOptions(tl, cel, preset.revealIntensity));
      },
      onDone: () => { setStatus("done"); onCompleteRef.current?.(); },
    });
    ctlRef.current = ctl;
    setFrame(frameAt(tl, 0));
    setStatus("idle");
    return () => { ctl.dispose(); audio.stopAll(); if (ctlRef.current === ctl) ctlRef.current = null; };
  }, [tl, audio, preset.revealIntensity]);

  // Precarga SOLO lo de esta escena (bandera, escudo, carta).
  useEffect(() => {
    const signal = { dead: false };
    setReady(false);
    const slow = window.setTimeout(() => { if (!signal.dead) setPreparing(true); }, PREPARING_AFTER_MS);
    Promise.all([preload(input.flag?.src, signal), preload(input.team.logoSrc, signal), preload(input.card.image, signal)]).then(([f, t]) => {
      if (signal.dead) return;
      window.clearTimeout(slow);
      setFailed({ flag: !!input.flag && !f, team: !!input.team.logoSrc && !t });
      setPreparing(false);
      setReady(true);
    });
    return () => { signal.dead = true; window.clearTimeout(slow); };
  }, [input]);

  const play = useCallback(() => { audio.stopAll(); reroll(); ctlRef.current?.play(from); setStatus("playing"); }, [audio, reroll, from]);
  const skip = useCallback(() => { audio.stopAll(); ctlRef.current?.skip(); }, [audio]);
  const replay = useCallback(() => { audio.stopAll(); reroll(); ctlRef.current?.reset(); ctlRef.current?.play(from); setStatus("playing"); }, [audio, reroll, from]);
  const seek = useCallback((t: number) => { audio.stopAll(); ctlRef.current?.seek(t); setStatus(t >= tl.duration ? "done" : "paused"); }, [audio, tl.duration]);
  useImperativeHandle(ref, () => ({ play, skip, replay, seek }), [play, skip, replay, seek]);

  useEffect(() => { if (autoPlay && ready && status === "idle") play(); }, [autoPlay, ready, status, play]);
  useEffect(() => { onStatus?.({ status, t: frame.t, stage: stage.kind, stageWhy: stage.why }); }, [status, frame.t, stage, onStatus]);

  // SALTAR también con Escape.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && status === "playing") skip(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [status, skip]);

  const onKind = useCallback((kind: StageKind, why: string) => setStage({ kind, why }), []);

  // Reacciones de cámara/luz globales: golpe del equipo (temblor mínimo) y el flash del clímax.
  const team = frame.p.team ?? 0;
  const teamHit = !reduced && team > 0.55 && team < 1 ? Math.sin(((team - 0.55) / 0.45) * Math.PI) : 0;
  const flash = frame.p.flash ?? 0;
  const flashPulse = !reduced && flash > 0 && flash < 1 ? Math.sin(flash * Math.PI) : 0;
  const shake = teamHit * (layout.tall ? 4 : 6);
  const blackout = frame.p.blackout ?? 0;
  const lights = frame.p.lights ?? (reduced ? 1 : 0);
  const done = status === "done" || frame.done;
  // Con la persona en escena el escudo no se queda delante de ella: tras el impacto (y una pausa) se retira al carril.
  const teamBeat = tl.human ? tl.beats.find((b) => b.id === "team") : undefined;
  const teamRetreat = teamBeat ? clamp01((frame.t - teamBeat.at - teamBeat.dur - 0.35) / 0.8) : 0;

  return (
    <div className="fixed inset-0 z-modal overflow-hidden bg-[#030409] text-white" data-testid="walkout" data-status={done ? "done" : status} data-intensity={intensity} data-reduced={reduced ? "1" : "0"} data-stage={stage.kind ?? ""} data-t={frame.t.toFixed(2)} data-celebration={effective ?? ""} data-identity-card={input.cardId} data-identity-country={input.nationality.iso ?? ""} data-identity-code={input.nationality.code ?? ""} data-identity-team={input.team.tag}>
      <div className="absolute inset-0" style={{ transform: shake ? `translate(${Math.sin(frame.t * 97) * shake}px, ${Math.cos(frame.t * 83) * shake * 0.6}px)` : undefined }}>
        <WalkoutStage frame={frame} walk={tl.walk} humanDur={humanDur} humanMode={tl.human} celebrateAt={celebrateAt} celebration={effective} country={country} team={arenaTeam} artwork={input.artwork} preset={preset} particles={particles} drama={drama} reduced={reduced} forced={forceStage} onKind={onKind} />
        {/* 0.3 · carriles laterales legibles sobre los muros LED (escritorio): un velo oscuro bajo las pistas, nunca en el centro */}
        {tl.human && !layout.tall && !reduced && (
          <div className="pointer-events-none absolute inset-0 z-[15]" aria-hidden style={{ opacity: Math.min(1, (frame.p.flag ?? 0) * 1.5) * 0.85, background: "linear-gradient(90deg, rgba(3,4,9,0.92) 0%, rgba(3,4,9,0.55) 17%, rgba(3,4,9,0) 27%, rgba(3,4,9,0) 73%, rgba(3,4,9,0.55) 83%, rgba(3,4,9,0.9) 100%)" }} />
        )}
        {/* apagón antes de encender el escenario */}
        {!reduced && <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: blackout * (1 - lights) * 0.9 }} />}
        <PackPiece frame={frame} art={packArt} preset={preset} />
        <FlagPiece frame={frame} input={input} layout={layout} reduced={reduced} failed={failed.flag} walk={!!tl.human} />
        <RolePiece frame={frame} input={input} layout={layout} reduced={reduced} accent={preset.accent} walk={!!tl.human} />
        <TeamPiece frame={frame} input={input} layout={layout} reduced={reduced} failed={failed.team} walk={!!tl.human} retreat={teamRetreat} />
        <EditionPiece frame={frame} input={input} layout={layout} reduced={reduced} preset={preset} />
        <RatingPiece frame={frame} input={input} layout={layout} reduced={reduced} preset={preset} walk={!!tl.human} />
        <CardPiece enter={frame.p.card ?? 0} input={input} layout={layout} reduced={reduced} preset={preset} />
        <NamePiece frame={frame} input={input} layout={layout} reduced={reduced} />
        {/* destellos: impacto del equipo y clímax (sin destellos con movimiento reducido) */}
        <div className="pointer-events-none absolute inset-0 z-50" style={{ background: `radial-gradient(circle at 50% 45%, #ffffff, ${preset.light} 35%, transparent 70%)`, opacity: Math.min(1, flashPulse * (0.75 + 0.25 * preset.revealIntensity) + teamHit * 0.22), mixBlendMode: "screen" }} />
        {/* viñeta de cine */}
        <div className="pointer-events-none absolute inset-0 z-40" style={{ background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,0.75))" }} />
      </div>

      {/* 0.4 · en modo normal la carta manda; si el panel DEV fuerza algo, se dice (nunca pasa por la identidad real) */}
      {input.overrides.length > 0 && (
        <p className="pointer-events-none absolute left-1/2 top-2 z-[75] -translate-x-1/2 rounded-sm border border-amber-300/60 bg-amber-500/20 px-3 py-1 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-amber-200" data-testid="walkout-dev-forced">
          DEV · forzado: {input.overrides.map((o) => o.label).join(" · ")}
        </p>
      )}
      {preparing && !ready && <p className="absolute inset-0 z-[60] flex items-center justify-center font-display text-sm font-bold uppercase tracking-[0.4em] text-white/70" role="status">Preparando…</p>}

      {!done && status === "playing" && (
        <button type="button" onClick={skip} data-testid="walkout-skip" className="absolute bottom-5 right-5 z-[70] rounded-sm border border-white/30 bg-black/50 px-4 py-2 font-display text-xs font-bold uppercase tracking-[0.3em] text-white/85 backdrop-blur hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          Saltar
        </button>
      )}

      {/* Resumen accesible del estado final (también lo leen la QA y los lectores de pantalla). */}
      {done && <WalkoutSummary input={input} />}
    </div>
  );
});
