"use client";

/**
 * RESULTADO DE DUELO — LA ÚNICA PANTALLA DE RESULTADOS DE TODOS LOS DUELOS.
 *
 * Partida rápida, Road to Champions, Draft Gauntlet, clasificatoria (ranked), duelo privado/revancha y cruce de torneo
 * terminan AQUÍ, con la misma estructura y en este orden:
 *
 *   1. RESULTADO   · VICTORIA / DERROTA / EMPATE, grande, con el color del desenlace.
 *   2. MARCADOR    · grande y centrado.
 *   3. RECOMPENSAS · una sola línea compacta (créditos, XP y, en ranked, el rating). Sin nada concedido → no hay bloque.
 *   4. ACCIONES    · JUGAR OTRA (o la equivalente del modo), VER PARTIDA, VOLVER AL LOBBY.
 *
 * Las modalidades solo cambian los DATOS que pasan (qué hace la acción principal, a qué lobby se vuelve, si hay rating o
 * una nota corta como «Por abandono»); la pantalla no cambia. Los adaptadores (`QuickMatchResult`, `ResultScreen`,
 * `PvpOutcome`) traducen cada modo a estas props.
 *
 * Aquí no se calcula nada: veredicto, marcador, recompensas y rating llegan resueltos por el servidor. Lo que esta pantalla
 * ya no enseña (progreso, objetivos, temporada, carta destacada, turno a turno, escalera…) se sigue calculando y guardando
 * igual y vive en su apartado (perfil, progresión, temporada, competitivo, repetición de la partida).
 *
 * Fondo: la página monta el estadio (`ArenaEnvironment`) detrás; esta capa va por encima (`z-[1]`). Todo respeta
 * `prefers-reduced-motion` (la arena monta `MotionConfig reducedMotion="user"`).
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotionConfig } from "framer-motion";
import { playCue, playSound } from "@/lib/sound";
import { stingDuck } from "@/lib/audio/musicEngine";
import { useMusicOverride } from "@/components/audio/MusicDirector";
import { NxButton } from "@/components/ui/NxButton";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { EASE } from "@/design/motion";
import { cn } from "@/lib/format";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import { buzz } from "@/lib/haptics";
import { hasEarnings, type ResultEarnings, type ResultKind } from "@/lib/duel/resultSummary";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

/** Tono de cada desenlace: la identidad de color de la arena (victoria = cian del jugador). */
export const TONE = {
  win:  { title: "Victoria", cls: "text-[#2fe0ff]",   border: "border-[#2fe0ff]/45",   glow: "from-[#2fe0ff]/15",   rgb: "47,224,255",  rays: true },
  loss: { title: "Derrota",  cls: "text-drl",         border: "border-drl/45",         glow: "from-drl/15",         rgb: "255,46,99",   rays: false },
  draw: { title: "Empate",   cls: "text-drl-gold",    border: "border-drl-gold/45",    glow: "from-drl-gold/15",    rgb: "255,211,92",  rays: false },
} as const;

/** Una acción de la pantalla: o navega (`href`) o llama (`onClick`). */
export interface DuelResultAction {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  /**
   * Un clic basta: tras pulsar, el botón se bloquea («Preparando…»). Para acciones que CREAN partida (jugar otra, buscar
   * rival). No para las que abren algo que se puede cancelar (la revancha privada abre un diálogo).
   */
  once?: boolean;
}

/** Rating de ranked (asiento de la liquidación). `pending` mientras la liquidación no ha llegado: no se inventa un número. */
export type DuelResultRating = { pending: true } | { pending: false; delta: number };

export interface DuelResultProps {
  kind: ResultKind;
  /** Marcador final (o al cierre, si se abandonó). `null` si no hay marcador que enseñar. */
  score: { you: number; rival: number } | null;
  /** Lo concedido por el servidor. Vacío → sin bloque de recompensas. */
  earnings?: ResultEarnings | null;
  /** Solo ranked. */
  rating?: DuelResultRating | null;
  /** Una nota de una línea cuando el modo la necesita para entender el resultado («Por abandono», el cruce del torneo). */
  note?: string | null;
  /** Una línea pequeña bajo las recompensas, solo cuando explica su AUSENCIA (tope diario agotado). */
  footnote?: React.ReactNode;
  /** JUGAR OTRA (o la del modo: Revancha, Volver al torneo…). `null` = el modo no tiene acción principal. */
  primary: DuelResultAction | null;
  /** VER PARTIDA. `null` si no hay partida que ver. */
  replayHref: string | null;
  /** VOLVER AL LOBBY. */
  lobby: DuelResultAction;
  /** Modo, solo para pruebas y estilos (`data-mode`). */
  mode: "QUICK" | "CAMPAIGN" | "DRAFT" | "PVE" | "PVP" | "PVP_PRIVATE" | "CUP";
}

export function DuelResult({ kind, score, earnings = null, rating = null, note = null, footnote = null, primary, replayHref, lobby, mode }: DuelResultProps) {
  useLocale();
  const reduced = useReducedMotionConfig();
  const tone = TONE[kind];
  /* Un clic basta: la acción principal se bloquea al pulsarla (crear otra partida no puede salir dos veces). */
  const [starting, setStarting] = useState(false);

  /* El desenlace suena: la música pasa al tema de resultado y se agacha bajo el cue. Una vez por desenlace. */
  useMusicOverride("RESULT");
  useEffect(() => {
    stingDuck();
    playCue(kind === "win" ? "victory" : kind === "loss" ? "defeat" : "ui");
    if (kind === "draw") playSound("match.draw");
    buzz("match");
    trackExperience("match_result_view");
  }, [kind]);

  const showEarnings = !!earnings && hasEarnings(earnings);
  const showRewards = showEarnings || !!rating;
  const step = (d: number) => (reduced ? { duration: 0 } : { delay: d, duration: 0.3, ease: EASE.out });

  return (
    <div
      className="relative z-[1] mx-auto flex min-h-[calc(100svh-96px)] w-full max-w-3xl flex-col items-center justify-center px-1 py-8 sm:py-10"
      data-scene="result" data-result="duel" data-kind={kind} data-motion-level={kind === "draw" ? 2 : 3} data-mode={mode}
    >
      <motion.section
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.3 }}
        className="relative w-full overflow-hidden px-5 py-10 text-center sm:px-10 sm:py-14"
        style={{
          background: `radial-gradient(72% 92% at 50% 0%, rgba(${tone.rgb},0.32), transparent 68%), radial-gradient(60% 60% at 50% 100%, rgba(3,4,10,0.55), transparent 80%)`,
          boxShadow: `inset 0 -1px 0 rgba(${tone.rgb},0.55), 0 1px 28px -6px rgba(${tone.rgb},0.6)`,
        }}
        aria-labelledby="duel-result-title"
      >
        {/* Corona radial: SOLO en victoria, gira una vez con la entrada. */}
        {tone.rays && !reduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130vmin] w-[130vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]"
            style={{ background: `conic-gradient(from 0deg, transparent 0deg, rgb(${tone.rgb}) 5deg, transparent 11deg, transparent 28deg, rgb(${tone.rgb}) 34deg, transparent 40deg)` }}
            initial={{ rotate: -14, scale: 0.85, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 0.18 }}
            transition={{ duration: 1.1, ease: EASE.out }}
          />
        )}
        {/* Barrido de luz una vez. En derrota no: el resultado se lee, no se celebra. */}
        {kind !== "loss" && !reduced && <span aria-hidden className="nx-result-sweep" style={{ ["--sweep-rgb" as string]: tone.rgb }} />}

        {/* 1 · RESULTADO */}
        <motion.h1
          id="duel-result-title"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduced ? 0 : 0.6, ease: EASE.out, delay: reduced ? 0 : 0.05 }}
          className={cn("font-display text-[clamp(52px,14vw,112px)] font-bold uppercase leading-none tracking-[0.02em]", tone.cls)}
          style={{ textShadow: `0 0 52px rgba(${tone.rgb},0.55)` }}
          data-testid="duel-result-verdict"
        >
          {td(tone.title)}
        </motion.h1>

        {note && (
          <p className="mt-3 font-display text-[12px] font-bold uppercase tracking-[0.2em] text-white/60" data-testid="duel-result-note">
            {note}
          </p>
        )}

        {/* 2 · MARCADOR */}
        {score && (
          <div
            className="nx-readout mt-5 flex items-center justify-center gap-5 text-[clamp(56px,15vw,112px)] leading-none sm:gap-7"
            aria-label={t("Marcador final: tú {scoreYou}, rival {scoreRival}", { scoreYou: score.you, scoreRival: score.rival })}
            data-testid="duel-result-score"
          >
            <span className="text-[#2fe0ff]" style={{ textShadow: "0 0 30px rgba(47,224,255,0.55)" }}>{score.you}</span>
            <span aria-hidden className="text-white/20">–</span>
            <span className="text-drl" style={{ textShadow: "0 0 30px rgba(255,46,99,0.55)" }}>{score.rival}</span>
          </div>
        )}

        {/* 3 · RECOMPENSAS: una línea; sin nada concedido no hay bloque. */}
        {showRewards && (
          <motion.ul
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={step(0.45)}
            className="mx-auto mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
            aria-label={t("Recompensa del duelo")}
            data-testid="duel-result-rewards"
          >
            {earnings && earnings.credits > 0 && (
              <Earned value={`+${earnings.credits}`} label={t("Créditos")} cls="text-drl-gold" field="credits" />
            )}
            {earnings && earnings.xp > 0 && <Earned value={`+${earnings.xp}`} label={t("XP")} cls="text-white" field="xp" />}
            {earnings?.other.map((o, i) => (
              <li key={`other-${i}`} data-field="other"><RewardDisplay reward={o} size="sm" /></li>
            ))}
            {rating && (rating.pending
              ? <Earned value="…" label={t("Rating")} cls="text-white/40" field="rating-pending" />
              : <Earned
                  value={`${rating.delta > 0 ? "+" : ""}${rating.delta}`}
                  label={t("Rating")}
                  cls={rating.delta > 0 ? "text-drl-cyan" : rating.delta < 0 ? "text-drl" : "text-white/70"}
                  field="rating"
                />)}
          </motion.ul>
        )}
        {footnote}
      </motion.section>

      {/* 4 · ACCIONES */}
      <motion.div
        data-testid="result-actions"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={step(0.55)}
        className="mt-7 flex w-full max-w-2xl flex-col gap-3 sm:flex-row"
      >
        {primary && (
          <NxButton
            variant="primary" size="lg" className="flex-[1.4] !text-[17px]" data-cta="primary" data-action="primary"
            data-testid={primary.testId}
            href={primary.href}
            disabled={primary.disabled || starting}
            onClick={primary.onClick ? () => {
              if (starting) return;
              if (primary.once) setStarting(true);
              trackExperience("rematch_click");
              primary.onClick!();
            } : undefined}
          >
            {starting ? t("Preparando…") : primary.label}
          </NxButton>
        )}
        {replayHref && (
          <NxButton variant="secondary" size="lg" className="flex-1" href={replayHref} data-action="replay">
            {t("Ver partida")}
          </NxButton>
        )}
        <NxButton
          variant="secondary" size="lg" className="flex-1" data-action="lobby" data-testid={lobby.testId}
          href={lobby.href} onClick={lobby.onClick} disabled={lobby.disabled}
        >
          {lobby.label}
        </NxButton>
      </motion.div>
    </div>
  );
}

function Earned({ value, label, cls, field }: { value: string; label: string; cls: string; field: string }) {
  return (
    <li className="flex items-baseline gap-2" data-field={field}>
      <b className={cn("nx-readout text-[28px] leading-none tabular-nums", cls)}>{value}</b>
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/65">{label}</span>
    </li>
  );
}
