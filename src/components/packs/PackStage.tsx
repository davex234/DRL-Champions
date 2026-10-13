"use client";

/**
 * EL ESCENARIO DE LA APERTURA — Fase 38 (autoridad) + Fase 57 (Pack Opening 5.0, puesta en escena).
 *
 * Pieza de presentación con props: la usa la ceremonia real (`PackOpeningExperience`) y los arneses QA
 * (`/design-system/fase38`, `/design-system/fase57`). No abre nada y no conoce el resultado más allá de lo que recibe:
 *
 *   · `ready`      — la CÁMARA: negro profundo, foco del color del sobre, suelo con reflejo, polvo en suspensión. El
 *                    sobre REAL (`SealedPack`, arte de `packArtwork`) entra desde abajo y flota. ABRIR SOBRE.
 *   · `requesting` — ANTICIPACIÓN mientras el servidor decide (una sola petición ya salió): el sobre se eleva, recibe
 *                    luz desde detrás y tiembla muy poco. Solo el color DEL SOBRE: nada puede leerse como resultado.
 *   · `opening`    — con el resultado en mano: tensión → la solapa del propio asset se RASGA en dos mitades (borde
 *                    dentado), sale luz de dentro con un destello contenido → las cartas (tantas como trae el
 *                    resultado) suben desde la boca del sobre y se abren en abanico → el sobre baja y se apaga.
 *   · `hand`       — las cartas boca abajo, protagonistas. La señal de rareza (halo) sale de la MEJOR rareza REAL
 *                    ya recibida: nunca promete más de lo que hay.
 *
 * El abanico es el MISMO nodo en `opening` y en `hand`: las cartas que salen del sobre son las que luego se revelan.
 * Movimiento reducido: sin mitades, partículas, destello ni temblor; transiciones cortas y el mismo orden de actos.
 */
import { useEffect, useState, type PointerEventHandler, type Ref } from "react";
import { motion } from "framer-motion";
import type { PackDef } from "@/domain/packs/types";
import { NxButton } from "@/components/ui/NxButton";
import { EASE } from "@/design/motion";
import { SealedPack } from "./SealedPack";
import { packIdentity } from "./packIdentity";
import { AmbientParticles, ParticleBurst } from "./Particles";
import { PackHand, type HandSlot } from "./PackHand";

const INTRO_MS = 900;
/** Duración del acto de apertura con resultado: tensión → rasgado → cartas saliendo → sobre fuera. */
export const RUPTURE_MS = 2100;
/**
 * FASE 57.1 · Con movimiento reducido el acto SIGUE SIENDO una ceremonia (sellado → rasgado → cartas saliendo → reversos):
 * mismos actos y mismo orden, con fundidos y desplazamientos cortos en lugar de giros, zooms, temblor y destellos, y con
 * tiempo suficiente para leerse. Antes eran 420 ms: en un Windows con «efectos de animación» apagados (Chrome informa
 * `prefers-reduced-motion: reduce`) la apertura entera duraba menos de un cuarto de segundo y parecía la antigua.
 */
export const RUPTURE_REDUCED_MS = 1600;
/** Momentos del acto, en fracción de `RUPTURE_MS`. */
export const OPENING_BEATS = { tear: 0.3, emerge: 0.46, packOut: 0.78 } as const;

/** Proporción del sobre (la de la convención de arte: 13:19). */
const PACK_RATIO = 380 / 260;

/**
 * Tamaño del sobre en la ceremonia: ~50 % de la altura útil, sin salirse del ancho. Se mide al montar y al
 * redimensionar (no por fotograma). En el servidor/arnés sin ventana, 272 px como antes.
 */
export function ceremonyPackWidth(viewportW: number, viewportH: number): number {
  const byHeight = (viewportH * 0.5) / PACK_RATIO;
  const byWidth = viewportW * 0.66;
  return Math.round(Math.max(170, Math.min(360, byHeight, byWidth)));
}

function usePackWidth(): number {
  const [w, setW] = useState(272);
  useEffect(() => {
    const on = () => setW(ceremonyPackWidth(window.innerWidth, window.innerHeight));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/**
 * LA CÁMARA. Negro profundo, foco cenital del color del sobre, suelo con reflejo y horizonte, viñeta. Estático salvo
 * el polvo en suspensión (≤ 16 motas, y ninguna con movimiento reducido).
 */
export function PackBackdrop({ accent, ambient, reduced, intensity = 1 }: { accent: string; ambient: boolean; reduced: boolean; intensity?: number }) {
  return (
    <>
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 40%, #0b0d18 0%, #03040a 70%)" }} />
      {/* Foco cenital: un cono de luz del color del sobre que cae sobre el centro. */}
      <div
        aria-hidden
        className="absolute inset-0 transition-opacity duration-slow"
        data-chamber-light
        style={{
          opacity: 0.55 + 0.45 * intensity,
          background: `radial-gradient(38% 60% at 50% 30%, ${accent}40, transparent 70%), conic-gradient(from 180deg at 50% -10%, transparent 160deg, ${accent}22 175deg, ${accent}33 180deg, ${accent}22 185deg, transparent 200deg)`,
        }}
      />
      {/* Suelo: reflejo del foco y una rejilla muy tenue en perspectiva. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[42%]" style={{ background: `radial-gradient(46% 55% at 50% 0%, ${accent}2e, transparent 70%), linear-gradient(to bottom, rgba(10,12,22,0.2), #020308)` }} />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[42%]"
        style={{
          backgroundImage: `linear-gradient(${accent}33 1px, transparent 1px), linear-gradient(90deg, ${accent}33 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          transform: "perspective(300px) rotateX(62deg)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 70%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 70%)",
        }}
      />
      <div aria-hidden className="absolute inset-x-0 h-px" style={{ bottom: "42%", background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.45 }} />
      {ambient && !reduced && <AmbientParticles color={accent} count={16} />}
      <div aria-hidden className="absolute inset-0" style={{ boxShadow: "inset 0 0 260px 90px rgba(2,3,8,0.95)" }} />
    </>
  );
}

export interface PackTease {
  /** Color de la variante de la MEJOR carta real del sobre. */
  color: string;
  level: "low" | "mid" | "high";
  /** Corona solo si la mejor carta es legendaria. */
  rays: boolean;
}

export type StageKind = "ready" | "requesting" | "opening" | "hand";

/** Solo arnés QA: un instante CONGELADO del acto de apertura (una captura de una animación de 2 s llega tarde). */
export type FrozenBeat = "tension" | "tear" | "emerge";

export function PackStage({
  pack, stage, count, cutProgress = 0, slots, tease, reduced,
  onOpen, onStartReveal, onRevealAll, pointer, headingRef, freeze = false, frozenBeat = "tear",
}: {
  /** Solo arnés QA: el acto de apertura quieto en `frozenBeat` para poder capturarlo. */
  freeze?: boolean;
  frozenBeat?: FrozenBeat;
  pack: PackDef;
  stage: StageKind;
  /** Cartas del sobre: del catálogo antes de abrir, del resultado después. */
  count: number;
  cutProgress?: number;
  slots: HandSlot[];
  tease: PackTease | null;
  reduced: boolean;
  onOpen?: () => void;
  onStartReveal?: () => void;
  onRevealAll?: () => void;
  pointer?: { onPointerDown: PointerEventHandler; onPointerMove: PointerEventHandler; onPointerUp: PointerEventHandler };
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const accent = pack.accent ?? "#ff2e63";
  const art = packIdentity(pack).artwork;
  const width = usePackWidth();
  const height = Math.round(width * PACK_RATIO);
  const flap = Math.round(height * 0.175);
  const sealed = stage === "ready" || stage === "requesting";
  const total = reduced ? RUPTURE_REDUCED_MS : RUPTURE_MS;

  /* Los momentos del acto: rasgado y salida de las cartas. Temporizadores de PRESENTACIÓN, no de juego. */
  const [torn, setTorn] = useState(false);
  const [fanOn, setFanOn] = useState(stage === "hand");
  useEffect(() => {
    if (stage === "hand") { setTorn(true); setFanOn(true); return; }
    if (stage !== "opening") { setTorn(false); setFanOn(false); return; }
    if (freeze) { setTorn(frozenBeat !== "tension"); setFanOn(frozenBeat === "emerge"); return; }
    const t1 = setTimeout(() => setTorn(true), total * OPENING_BEATS.tear);
    const t2 = setTimeout(() => setFanOn(true), total * OPENING_BEATS.emerge);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [stage, total, freeze, frozenBeat]);

  const lifted = stage === "requesting" || stage === "opening";
  const packGone = stage === "hand";

  /* El sobre: flota sellado, se eleva en la anticipación, tiembla en la tensión y baja al final del acto. */
  const packAnimate = reduced
    // Reducido: sin escalas ni temblor; el sobre se eleva un poco al esperar y se desvanece al final del acto.
    ? stage === "opening" && !freeze
      ? { opacity: [1, 1, 1, 0], y: [-10, -10, -10, 30], scale: 1 }
      : { opacity: packGone ? 0 : 1, y: stage === "requesting" || stage === "opening" ? -10 : 0, scale: 1 }
    : stage === "ready"
      ? { opacity: 1, scale: 1, y: [0, -12, 0], rotateX: 0 }
      : stage === "requesting"
        ? { opacity: 1, scale: 1.06, y: -22, rotateX: 0, x: [0, -1.2, 1.2, -0.8, 0.8, 0] }
        : stage === "opening" && !freeze
          ? { opacity: [1, 1, 1, 0], scale: [1.06, 1.1, 1.08, 0.9], y: [-22, -28, -26, 150], x: [0, -2, 2, 0] }
          : stage === "opening"
            ? { opacity: frozenBeat === "emerge" ? 0.85 : 1, scale: 1.08, y: frozenBeat === "emerge" ? 40 : -26 }
            : { opacity: 0, y: 150, scale: 0.9 };
  const packTransition = reduced
    ? stage === "opening" && !freeze
      ? { duration: total / 1000, times: [0, OPENING_BEATS.tear, OPENING_BEATS.packOut - 0.08, 1], ease: "easeInOut" }
      : { duration: 0.45, ease: EASE.out }
    : stage === "ready"
      ? { opacity: { duration: 0.5 }, scale: { duration: INTRO_MS / 1000, ease: EASE.out }, y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: INTRO_MS / 1000 } }
      : stage === "requesting"
        ? { scale: { duration: 0.7, ease: EASE.out }, y: { duration: 0.7, ease: EASE.out }, x: { duration: 0.5, repeat: Infinity, ease: "linear" } }
        : stage === "opening" && !freeze
          ? { duration: total / 1000, times: [0, OPENING_BEATS.tear, OPENING_BEATS.packOut - 0.08, 1], ease: "easeInOut" }
          : { duration: 0.3 };

  return (
    <div className="absolute inset-0" data-testid="pack-stage" data-stage={stage} data-torn={torn} data-fan={fanOn}>
      {/* Luz desde DETRÁS del sobre: crece en la anticipación y estalla al rasgar (color del sobre). */}
      {!packGone && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          data-backlight
          style={{ width: width * 2.4, height: width * 2.4, background: `radial-gradient(closest-side, ${accent}88, ${accent}22 55%, transparent)` }}
          initial={{ opacity: 0.25, scale: 0.8 }}
          animate={{ opacity: stage === "ready" ? 0.35 : torn ? 0.95 : 0.7, scale: stage === "ready" ? 0.85 : torn ? 1.25 : 1.05 }}
          transition={{ duration: reduced ? 0.15 : 0.6, ease: "easeOut" }}
        />
      )}

      {/* ── EL ABANICO: sale del sobre en `opening` y se queda en `hand` (el mismo nodo). ── */}
      <div className="absolute inset-0 isolate z-0 flex flex-col items-center justify-center gap-7 px-4" data-testid={stage === "hand" ? "pack-hand" : undefined} data-tease={stage === "hand" ? tease?.level ?? "none" : undefined}>
        {stage === "hand" && tease && (
          <motion.div
            aria-hidden
            data-tease-level={tease.level}
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(560px 380px at 50% 46%, ${tease.color}${tease.level === "high" ? "66" : tease.level === "mid" ? "3d" : "22"}, transparent 72%)` }}
            initial={{ opacity: reduced ? 0.8 : 0 }}
            animate={reduced ? { opacity: 0.8 } : { opacity: [0.35, 1, 0.55, 1] }}
            transition={reduced ? { duration: 0 } : { duration: tease.level === "high" ? 1.8 : 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {stage === "hand" && tease?.rays && !reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-30"
            style={{ background: `repeating-conic-gradient(from 0deg, ${tease.color}33 0deg 6deg, transparent 6deg 18deg)`, maskImage: "radial-gradient(circle, rgba(0,0,0,0.8), transparent 60%)", WebkitMaskImage: "radial-gradient(circle, rgba(0,0,0,0.8), transparent 60%)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          />
        )}
        <motion.div className="flex flex-col items-center gap-1 text-center" initial={false} animate={{ opacity: stage === "hand" ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.35 }}>
          <span className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">{pack.name}</span>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-[clamp(24px,5.5vw,40px)] font-bold uppercase leading-none text-white outline-none">
            {count === 1 ? "1 carta" : `${count} cartas`}
          </h2>
        </motion.div>

        <div className="flex w-full justify-center" data-testid="pack-fan" style={{ minHeight: 10 }}>
          {fanOn && <PackHand slots={slots} accent={accent} mode="hand" />}
        </div>

        <motion.div
          className="flex flex-col items-center gap-2"
          initial={false}
          animate={{ opacity: stage === "hand" ? 1 : 0, y: stage === "hand" || reduced ? 0 : 12 }}
          transition={{ delay: stage === "hand" && !reduced ? 0.35 : 0, duration: 0.35, ease: EASE.out }}
          style={{ pointerEvents: stage === "hand" ? "auto" : "none" }}
        >
          <NxButton variant="primary" size="lg" onClick={onStartReveal} data-testid="pack-reveal" tabIndex={stage === "hand" ? 0 : -1}>
            Revelar
          </NxButton>
          {/* Fase 57.3 · con UNA carta (Sobre Icon) no hay «una a una» ni «todas»: solo Revelar. */}
          {count > 1 && <div className="flex items-center gap-3">
            <p className="text-caption text-ink-faint">Una a una · Espacio</p>
            <button type="button" onClick={onRevealAll} tabIndex={stage === "hand" ? 0 : -1} className="nx-focus min-h-[44px] px-2 text-caption text-ink-secondary underline-offset-2 hover:text-white hover:underline" data-testid="pack-reveal-all">
              Revelar todas
            </button>
          </div>}
        </motion.div>
      </div>

      {/* ── EL SOBRE REAL ── */}
      {stage !== "hand" && (
        <div
          className="absolute inset-0 z-10 grid touch-none place-items-center"
          onPointerDown={stage === "ready" ? pointer?.onPointerDown : undefined}
          onPointerMove={stage === "ready" ? pointer?.onPointerMove : undefined}
          onPointerUp={pointer?.onPointerUp}
          onPointerCancel={pointer?.onPointerUp}
        >
          {sealed && (
            <div className="absolute flex flex-col items-center gap-1 px-6 text-center" style={{ top: "max(3.5rem, calc(env(safe-area-inset-top) + 3rem))" }}>
              <span className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">Nexus</span>
              <h1 className="font-display text-h3 font-bold uppercase leading-none" style={{ color: accent }} data-testid="pack-name">
                {pack.name}
              </h1>
              <p className="font-display text-label uppercase tracking-wide2 text-ink-muted" data-testid="pack-count">{count === 1 ? "1 carta" : `${count} cartas`}</p>
            </div>
          )}

          <motion.div
            className="relative"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 70, rotateX: 22 }}
            animate={packAnimate}
            transition={packTransition}
            style={{ transformPerspective: 1000 }}
            data-testid="ceremony-pack"
          >
            <SealedPack pack={pack} cutProgress={lifted ? 0 : cutProgress} width={width} ceremony torn={torn} />

            {/* LAS DOS MITADES de la solapa: la franja superior del PROPIO arte, rota por un borde dentado, que sale despedida. */}
            {/* Reducido: las mitades se separan un poco y se desvanecen en su sitio, sin volar ni girar. */}
            {stage === "opening" && torn && (<>{[-1, 1].map((dir) => (
              <motion.span
                key={dir}
                aria-hidden
                data-tear-half={dir}
                className="pointer-events-none absolute top-0"
                style={{
                  left: dir < 0 ? 0 : "50%",
                  width: "50%",
                  height: flap + 6,
                  backgroundImage: art ? `url(${art})` : `linear-gradient(160deg, #1e2233, #0a0c16)`,
                  backgroundSize: art ? `${width}px ${height}px` : undefined,
                  backgroundPosition: dir < 0 ? "left top" : "right top",
                  backgroundRepeat: "no-repeat",
                  clipPath: dir < 0
                    ? "polygon(0 0, 100% 0, 100% 72%, 86% 88%, 70% 76%, 52% 94%, 34% 80%, 18% 96%, 0 84%)"
                    : "polygon(0 0, 100% 0, 100% 84%, 82% 96%, 66% 80%, 48% 94%, 30% 76%, 14% 88%, 0 72%)",
                  filter: `drop-shadow(0 0 10px ${accent})`,
                }}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                animate={freeze ? { x: dir * 60, y: -46, rotate: reduced ? 0 : dir * 18, opacity: 0.9 } : reduced ? { x: dir * 14, y: -10, rotate: 0, opacity: 0 } : { x: dir * 220, y: -170, rotate: dir * 48, opacity: 0 }}
                transition={{ duration: freeze ? 0 : reduced ? 0.7 : 0.9, ease: "easeOut" }}
              />
            ))}</>)}
          </motion.div>

          {/* Columna de luz desde la boca del sobre y onda: una vez, al rasgar. */}
          {stage === "opening" && torn && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center" data-testid="pack-rupture" data-frozen={freeze || undefined}>
              <motion.span
                aria-hidden
                className="absolute w-[3px] origin-bottom"
                style={{ height: "60vh", bottom: "50%", background: `linear-gradient(to top, ${accent}, #fff, transparent)` }}
                initial={{ scaleY: 0, scaleX: 1, opacity: 0 }}
                animate={freeze ? { scaleY: 1, scaleX: 18, opacity: 0.5 } : reduced ? { scaleY: 1, scaleX: 16, opacity: [0, 0.5, 0] } : { scaleY: [0, 1, 1], scaleX: [1, 26, 44], opacity: [0, 0.9, 0] }}
                transition={{ duration: freeze ? 0 : reduced ? 0.22 : 1.1, times: reduced || freeze ? undefined : [0, 0.3, 1], ease: "easeOut" }}
              />
              {!reduced && (
                <motion.span
                  aria-hidden
                  className="absolute rounded-full border-2"
                  style={{ borderColor: accent, width: 220, height: 220 }}
                  initial={{ scale: 0.2, opacity: 1 }}
                  animate={freeze ? { scale: 2.4, opacity: 0.35 } : { scale: 8, opacity: 0 }}
                  transition={{ duration: freeze ? 0 : 1.1, ease: "easeOut" }}
                />
              )}
              {!reduced && <ParticleBurst color={accent} big count={36} />}
              {/* Un único destello, contenido y lento (sin estroboscopio). Con movimiento reducido, nada. */}
              {!reduced && (
                <motion.div aria-hidden className="absolute inset-0 bg-white" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.22, 0] }} transition={{ duration: 0.7, times: [0, 0.3, 1] }} />
              )}
            </div>
          )}

          {stage === "ready" && (
            <div className="absolute flex flex-col items-center gap-3 px-6 text-center" style={{ bottom: "max(2.5rem, calc(env(safe-area-inset-bottom) + 1.5rem))" }}>
              <NxButton variant="primary" size="lg" onClick={onOpen} data-testid="pack-open">
                Abrir sobre
              </NxButton>
              <p className="text-caption text-ink-faint">Toca · Espacio · Enter — o arrastra sobre la costura →</p>
              <div className="h-1 w-52 max-w-[70vw] overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className="h-full rounded-full transition-[width] duration-instant" style={{ width: `${cutProgress * 100}%`, background: accent }} />
              </div>
            </div>
          )}

          {stage === "requesting" && (
            <div role="status" aria-live="polite" className="absolute flex flex-col items-center gap-2 px-6 text-center" style={{ bottom: "max(3rem, calc(env(safe-area-inset-bottom) + 2rem))" }} data-testid="pack-requesting">
              <p className="font-display text-caption uppercase tracking-[0.4em] text-white/85">Abriendo tu sobre</p>
              <p className="max-w-xs text-caption text-ink-faint">El servidor decide y guarda tus cartas. No se revela nada hasta que lo confirme.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
