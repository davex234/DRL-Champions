"use client";

/**
 * RESULTADO FINAL DEL DUELO (Fase 8 → Fase 26).
 *
 * Tres estados: victoria, derrota y empate. El empate es un RESULTADO VÁLIDO, no un fallo, y se
 * presenta como tal (Fase 7, OPD-08).
 *
 * El motivo lo redacta el Combat Resolver y llega ya escrito en `result.reason`: aquí no se deduce
 * quién ganó ni por qué. Si hubo desempate, se enseñan las cifras que lo decidieron.
 *
 * FASE 9.6 — EL DESENLACE SE CELEBRA (o se acusa): titular con impacto, sala teñida, corona radial
 * solo en victoria. Todo respeta `prefers-reduced-motion`.
 *
 * FASE 26 — EL FINAL CUENTA LA PARTIDA. Además del marcador y la recompensa (servidor), ahora:
 *   · CARTA DESTACADA: tu carta que marcó la partida (elegida sobre el historial, no «MVP»);
 *   · cómo se decidió, SOLO cuando hubo desempate, con las cifras del resolver;
 *   · historial en miniatura turno a turno;
 *   · progreso de nivel a partir de la XP TOTAL que devuelve el servidor (si la página la trae);
 *   · acciones: REVANCHA (mismo mazo, mismo rival), cambiar de rival/mazo, ver la partida, salir.
 *
 * Aquí no se suma nada: `award`, `xp`, `result` y `history` llegan resueltos.
 */
import { useEffect } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { playCue, playSound } from "@/lib/sound";
import { stingDuck } from "@/lib/audio/musicEngine";
import { useMusicOverride } from "@/components/audio/MusicDirector";
import { cn } from "@/lib/format";
import { DailyRewardSlot } from "./DailyRewardSlot";
import { DuelCard } from "./DuelCard";
import { TurnHistory } from "./TurnHistory";
import { FeaturedCardPanel, DecisionPanel, RoundStrip, LevelProgressPanel } from "./MatchSummary";
import { NxButton } from "@/components/ui/NxButton";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { DIFFICULTY_INFO, type DuelMatchView } from "@/lib/duel/types";
import { roundTally } from "@/lib/duel/gameplayUx";
import { EASE } from "@/design/motion";
import { ResultStory } from "./experience/ResultStory";
import { trackExperience } from "@/lib/duel/experienceTelemetry";
import type { MatchMode } from "@/lib/duel/experience";
import { buzz } from "@/lib/haptics";
import { MatchStrategyPanel } from "./strategy/MatchStrategyPanel";

/** Tono de cada desenlace. Exportado: el resultado mínimo de PARTIDA RÁPIDA (`QuickMatchResult`) usa la misma identidad. */
export const TONE = {
  /* FASE 50 · la victoria es del color del jugador en la arena: cian. */
  win:  { title: "Victoria", cls: "text-[#2fe0ff]",   border: "border-[#2fe0ff]/45",   glow: "from-[#2fe0ff]/15",   rgb: "47,224,255",  rays: true },
  loss: { title: "Derrota",  cls: "text-drl",         border: "border-drl/45",         glow: "from-drl/15",         rgb: "255,46,99",   rays: false },
  draw: { title: "Empate",   cls: "text-drl-gold",    border: "border-drl-gold/45",    glow: "from-drl-gold/15",    rgb: "255,211,92",  rays: false },
} as const;

export function ResultScreen({
  view, onPlayAgain, onChange, onDecks, onReplay, xp = null, extra = null, progress = null, playAgainLabel = "Revancha", mode = "PVE", deckId = null,
}: {
  view: DuelMatchView;
  /** Fase 39 · el final de un combate de Draft Gauntlet dice que el modo no da recompensa (no «no disponible»). */
  mode?: MatchMode;
  /** Revancha: mismo mazo, mismo rival. */
  onPlayAgain: () => void;
  /** Fase 39 · en Draft Gauntlet la acción principal no es una revancha: vuelve al gauntlet. */
  playAgainLabel?: string;
  /** Volver a la pre-partida para cambiar de mazo o de rival. */
  onChange?: () => void;
  onDecks: () => void;
  onReplay: () => void;
  /** XP TOTAL de la cuenta tras la partida, tal y como la devuelve el servidor. `null` si no se pidió. */
  xp?: number | null;
  /**
   * Fase 27 · hueco para el progreso del meta (objetivos que avanzaron, subida de nivel). Lo
   * compone la página con dos lecturas del servidor; el resultado no sabe nada de misiones.
   */
  extra?: React.ReactNode;
  /**
   * FASE 62 · el progreso de la partida (cuenta, objetivos, temporada, logros) va JUSTO DESPUÉS de las recompensas:
   * RESULTADO → RECOMPENSAS → PROGRESO → acciones. Lo compone la página (dos lecturas del servidor); el resultado no sabe
   * nada de él. Con progreso, el panel de nivel suelto no se repite.
   */
  progress?: React.ReactNode;
  /** Fase 43 · equipo propio usado (para «Ajustar equipo»). En Draft no hay equipo propio: `null`. */
  deckId?: string | null;
}) {
  const reduced = useReducedMotion();
  const r = view.result;
  const kind = r ? (r.isDraw ? "draw" : r.winner === "YOU" ? "win" : "loss") : null;

  /*
   * EL DESENLACE SUENA. Un cue sintetizado al montar, sin assets. Va ANTES del retorno temprano:
   * un hook condicional reventaría la partida (react-hooks/rules-of-hooks).
   */
  /* Fase 44.1 · la música pasa al tema de resultado y se agacha bajo el stinger. */
  useMusicOverride(kind ? "RESULT" : null);
  useEffect(() => {
    if (!kind) return;
    stingDuck();
    playCue(kind === "win" ? "victory" : kind === "loss" ? "defeat" : "ui");
    if (kind === "draw") playSound("match.draw");
    buzz("match");
    trackExperience("match_result_view");
  }, [kind]);

  if (!r || !kind) return null;
  const tone = TONE[kind];
  const tally = roundTally(view.history);
  const hasAward = Boolean(r.award && (r.award.points > 0 || r.award.credits > 0 || r.award.xp > 0));

  return (
    <div className="mx-auto max-w-4xl" data-scene="result" data-kind={kind} data-motion-level={kind === "draw" ? 2 : 3}>
      <motion.section
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          /*
           * FASE 50 · EL RESULTADO EN EL ESTADIO. Ya no es una tarjeta con borde sobre una página: el
           * veredicto se levanta sobre el recinto de la partida (la página monta `ArenaEnvironment`
           * detrás), con un foco del color del desenlace y un filo de luz debajo, como un podio.
           */
          "relative overflow-hidden px-5 py-8 text-center sm:px-8 sm:py-12",
        )}
        style={{
          background: `radial-gradient(70% 90% at 50% 0%, rgba(${tone.rgb},0.30), transparent 66%), radial-gradient(60% 60% at 50% 100%, rgba(3,4,10,0.55), transparent 80%)`,
          boxShadow: `inset 0 -1px 0 rgba(${tone.rgb},0.55), 0 1px 24px -6px rgba(${tone.rgb},0.6)`,
        }}
      >
        {/* Corona radial. SOLO en victoria. Un único elemento, gira una vez con la entrada. */}
        {tone.rays && !reduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130vmin] w-[130vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, rgb(${tone.rgb}) 5deg, transparent 11deg, transparent 28deg, rgb(${tone.rgb}) 34deg, transparent 40deg)`,
            }}
            initial={{ rotate: -14, scale: 0.85, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 0.18 }}
            transition={{ duration: 1.1, ease: EASE.out }}
          />
        )}

        {/* Fase 44 · barrido de luz UNA vez al entrar (nivel 3). En derrota no hay barrido: el resultado se lee, no se celebra. */}
        {kind !== "loss" && !reduced && <span aria-hidden className="nx-result-sweep" style={{ ["--sweep-rgb" as string]: tone.rgb }} />}

        <p className="nx-label">
          {view.yourDeckName} · {view.rivalLabel ? view.rivalLabel : `dificultad ${DIFFICULTY_INFO[view.difficulty].label}`}
        </p>

        <motion.h1
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: EASE.out, delay: 0.05 }}
          className={cn(
            "mt-2 font-display text-[clamp(44px,11vw,86px)] font-bold uppercase leading-none tracking-[0.02em]",
            tone.cls,
          )}
          style={{ textShadow: `0 0 46px rgba(${tone.rgb},0.55)` }}
        >
          {tone.title}
        </motion.h1>

        <div className="nx-readout mt-4 flex items-center justify-center gap-5 text-[clamp(46px,12vw,88px)]">
          <span className="text-[#2fe0ff]" style={{ textShadow: "0 0 30px rgba(47,224,255,0.55)" }}>{r.scoreYou}</span>
          <span className="text-white/20">–</span>
          <span className="text-drl" style={{ textShadow: "0 0 30px rgba(255,46,99,0.55)" }}>{r.scoreRival}</span>
        </div>

        <p className="mx-auto mt-4 max-w-xl text-sm text-white/60">{r.reason}</p>
      </motion.section>

      {/* Cómo se decidió, SOLO cuando no fue por marcador. Con las cifras del resolver. */}
      <DecisionPanel result={r} className="mt-3" />


      {/*
        ═══ LO QUE HAS GANADO (Fase 10) ═══
        Las cifras las calcula el SERVIDOR y llegan dentro del resultado (`result.award`).
        Aquí no se suma nada.
      */}
      {hasAward && r.award && (
        <motion.section
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.55, duration: 0.32, ease: EASE.out }}
          /*
           * FASE 61 · LAS RECOMPENSAS SON FICHAS, NO UNA FILA DE FORMULARIO. Sin caja con borde alrededor: cada cifra es
           * una ficha propia que entra a su turno (`Premio`) sobre el estadio. Las MISMAS cifras del servidor.
           */
          className="nx-f61-rewards mt-4 flex flex-wrap items-stretch justify-center gap-3 px-1 py-2"
          style={{ ["--reward-rgb" as string]: tone.rgb }}
          aria-label="Recompensa del duelo"
        >
          <span className="nx-label basis-full text-center !text-white/70">Recompensa</span>

          {/*
            FASE 45 · LAS RECOMPENSAS SE REVELAN UNA DETRÁS DE OTRA (90 ms), no aparecen todas de golpe. Son las MISMAS
            cifras del servidor: solo cambia el ritmo con el que se leen. Con movimiento reducido salen ya puestas.
          */}
          {r.award.points > 0 ? (
            <Premio delay={0} reduced={reduced}>
            <Link href="/ranking" className="group">
              <span className="nx-label block">Puntos de rango</span>
              <span className="nx-readout mt-1 block text-[26px] text-drl-cyan">+{r.award.points}</span>
              <span className="mt-0.5 block text-[11px] text-white/40 transition-colors group-hover:text-white/60">
                Ver clasificación →
              </span>
            </Link>
            </Premio>
          ) : (
            <Premio delay={0} reduced={reduced}>
              <span className="nx-label block">Puntos de rango</span>
              <span className="nx-readout mt-1 block text-[26px] text-white/30">—</span>
              <span className="mt-0.5 block text-[11px] text-white/40">El rango solo sube ganando</span>
            </Premio>
          )}

          <Premio delay={0.09} reduced={reduced}>
            <span className="nx-label block">Créditos</span>
            <span className="nx-readout mt-1 block text-[26px] text-drl-gold">+{r.award.credits}</span>
          </Premio>
          <Premio delay={0.18} reduced={reduced}>
            {/* F62 · con su nombre: es XP de CUENTA (la de temporada se gana reclamando objetivos). */}
            <span className="nx-label block">XP de cuenta</span>
            <span className="nx-readout mt-1 block text-[26px] text-white">+{r.award.xp}</span>
          </Premio>

          <Link
            href="/logros"
            className="nx-clip-sm inline-flex min-h-[44px] items-center self-center border border-white/15 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Ver progreso
          </Link>
        </motion.section>
      )}

      {/* CORE GAME LOOP · el cupo diario que ocupó esta partida (o el tope), dato del servidor. */}
      <DailyRewardSlot receipt={r.rewards} className="mt-2" />

      {/* F62 · el progreso de la partida, en la secuencia. */}
      {progress}

      {/* Nivel de cuenta: XP total del servidor + curva del dominio de progresión (solo si la página no trae el progreso). */}
      {xp !== null && !progress && <LevelProgressPanel xp={xp} gained={r.award?.xp ?? 0} className="mt-3" />}

      {/*
        ── Acciones ──
        UNA sola acción rellena: la revancha, que es lo que un modo competitivo quiere que hagas.
        Y hay salida: esta ruta es INMERSIVA y desde aquí tiene que poder volverse a `/duelos`.
        Fase 44 · suben al primer pantallazo (antes quedaban bajo la historia de la partida): después de ganar o
        perder, lo siguiente es JUGAR OTRA o volver al lobby, no hacer scroll.
      */}
      <motion.div
        data-testid="result-actions"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduced ? 0 : 0.7, duration: 0.25, ease: EASE.out }}
        className="mt-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <NxButton variant="primary" size="lg" className="flex-[1.4] !text-[17px]" data-cta="primary" onClick={() => { trackExperience("rematch_click"); onPlayAgain(); }}>
            {/*
              FASE 61 · JUGAR OTRA. Contra el bot la «revancha» ES jugar otra: el servidor crea una partida NUEVA con el
              mismo equipo y la misma dificultad (no hay backend de revancha que finja otra cosa). Se dice las dos cosas.
            */}
            {playAgainLabel === "Revancha" ? (
              <span className="flex flex-col items-center leading-tight">
                <span>Jugar otra</span>
                <span className="text-[10px] font-bold tracking-[0.14em] opacity-80">Revancha · mismo equipo y rival</span>
              </span>
            ) : playAgainLabel}
          </NxButton>
          {onChange && (
            <NxButton variant="secondary" size="lg" className="flex-1" onClick={onChange}>
              Cambiar rival o equipo
            </NxButton>
          )}
          <NxButton variant="secondary" size="lg" className="flex-1" onClick={onReplay}>
            Ver la partida
          </NxButton>
          <NxButton variant="secondary" size="lg" className="flex-1" onClick={onDecks}>
            Mis equipos
          </NxButton>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <NxButton variant="ghost" size="md" href="/">
            Volver al lobby
          </NxButton>
          <NxButton variant="ghost" size="md" href="/duelos">
            Salir a Duelos
          </NxButton>
        </div>
      </motion.div>

      {/* CARTA DESTACADA · tu carta que marcó la partida. */}
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduced ? 0 : 0.4, duration: 0.3, ease: EASE.out }}
      >
        <FeaturedCardPanel history={view.history} cards={[...view.yourUsed, ...view.yourHand]} className="mt-4" />
      </motion.div>

      {/* Fase 27 · el meta: objetivos que esta partida ha movido (lo compone la página). */}
      {extra}

      {/* FASE 33 · la partida contada: cómo se decidió paso a paso, los diez turnos y la recompensa real. */}
      <ResultStory view={view} mode={mode} className="mt-4" />

      {/* FASE 43 · lectura estratégica: hechos de los turnos guardados, sin causas. */}
      <MatchStrategyPanel history={view.history} result={r} deckId={mode === "DRAFT_GAUNTLET" ? null : deckId} className="mt-4" />

      {/* ── Cifras ── */}
      <section className="mt-6 flex flex-wrap gap-x-9 gap-y-5 border-y border-white/[0.08] px-1 py-5" aria-label="Resumen">
        <Stat label="Turnos ganados" value={`${tally.won} / ${tally.lost}`} hint="tuyos / del rival" />
        <Stat label="Turnos empatados" value={String(r.tiedEncounters)} hint={r.tiedEncounters > 0 ? "nadie puntuó" : "ninguno"} />
        <Stat label="Estadística total" value={`${r.statTotalYou} – ${r.statTotalRival}`} hint="declarada en 10 turnos" />
        {r.sumOvrYou != null ? (
          <Stat label="Suma de OVR" value={`${r.sumOvrYou} – ${r.sumOvrRival}`} hint="desempate del diseño" />
        ) : (
          <Stat label="Suma de OVR" value="—" hint="no hizo falta" />
        )}
      </section>

      {/* ── Historial en miniatura ── */}
      <section className="mt-6" aria-label="Turno a turno">
        <SectionTitle as="h2">Turno a turno</SectionTitle>
        <RoundStrip history={view.history} yours={[...view.yourUsed, ...view.yourHand]} theirs={view.rivalUsed} />
      </section>

      {/* ── Cartas usadas ── */}
      <section className="mt-6" aria-label="Cartas utilizadas">
        <SectionTitle as="h2">Tus cartas</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {view.yourUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
        </div>
        <div className="mt-4"><SectionTitle as="h2">Cartas del rival</SectionTitle></div>
        <div className="flex flex-wrap gap-1.5">
          {view.rivalUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
        </div>
      </section>

      <section className="mt-6" aria-label="Historial completo">
        <SectionTitle as="h2">Los diez turnos</SectionTitle>
        <TurnHistory turns={view.history} />
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[108px]">
      <span className="nx-label block">{label}</span>
      <b className="nx-readout mt-1 block text-[24px]">{value}</b>
      {hint && <span className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </div>
  );
}

/**
 * FASE 45 · una recompensa que entra a su turno. Solo `opacity`/`transform`; el número ya está escrito cuando aparece
 * (nada de contadores que suban solos: la cifra la decidió el servidor y no se «gana» mientras se mira).
 */
function Premio({ children, delay, reduced }: { children: React.ReactNode; delay: number; reduced: boolean | null }) {
  return (
    <motion.div
      data-reward-item
      className="nx-f61-reward-token"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: reduced ? 0 : 0.62 + delay, duration: 0.26, ease: EASE.out }}
    >
      {children}
    </motion.div>
  );
}
