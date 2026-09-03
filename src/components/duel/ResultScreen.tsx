"use client";

/**
 * RESULTADO FINAL DEL DUELO (Fase 8).
 *
 * Tres estados: victoria, derrota y empate. El empate es un RESULTADO VÁLIDO, no un fallo, y se
 * presenta como tal (Fase 7, OPD-08).
 *
 * El motivo lo redacta el Combat Resolver y llega ya escrito en `result.reason`: aquí no se deduce
 * quién ganó ni por qué. Si hubo desempate, se enseñan las cifras que lo decidieron.
 *
 * No concede recompensas: esta fase no mueve la economía.
 *
 * FASE 9.6 — EL DESENLACE SE CELEBRA (o se acusa).
 *
 * El resultado se anunciaba con un titular sobre una caja con degradado. Ganar diez turnos
 * y perder diez turnos se veían igual salvo por el color del texto, y en un juego
 * competitivo el desenlace es la mitad del motivo por el que se vuelve a jugar.
 *
 * Ahora es un IMPACTO: el titular entra grande y se cierra sobre sí mismo, la sala se tiñe
 * del color del resultado y —solo en victoria— una corona radial se abre detrás. La derrota
 * NO recibe corona: celebrarla sería mentir, y apagar la pantalla es una respuesta más
 * honesta y también más motivadora. El empate se queda en medio, en oro, sin premio ni
 * castigo, porque es un resultado válido (Fase 7, OPD-08).
 *
 * Todo respeta `prefers-reduced-motion`: sin escala, sin corona, sin barrido.
 * El motivo del resultado lo sigue redactando el Combat Resolver.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { DuelCard } from "./DuelCard";
import { TurnHistory } from "./TurnHistory";
import { DIFFICULTY_INFO, type DuelMatchView } from "@/lib/duel/types";
import { EASE } from "@/design/motion";

const TONE = {
  win:  { title: "Victoria", cls: "text-emerald-400", border: "border-emerald-400/45", glow: "from-emerald-400/15", rgb: "63,192,122",  rays: true },
  loss: { title: "Derrota",  cls: "text-drl",         border: "border-drl/45",         glow: "from-drl/15",         rgb: "255,46,99",   rays: false },
  draw: { title: "Empate",   cls: "text-drl-gold",    border: "border-drl-gold/45",    glow: "from-drl-gold/15",    rgb: "255,211,92",  rays: false },
} as const;

export function ResultScreen({
  view, onPlayAgain, onDecks, onReplay,
}: {
  view: DuelMatchView;
  onPlayAgain: () => void;
  onDecks: () => void;
  onReplay: () => void;
}) {
  const reduced = useReducedMotion();
  const r = view.result;
  if (!r) return null;

  const kind = r.isDraw ? "draw" : r.winner === "YOU" ? "win" : "loss";
  const tone = TONE[kind];

  const wonTurns = view.history.filter((t) => t.outcome === "A").length;
  const lostTurns = view.history.filter((t) => t.outcome === "B").length;

  return (
    <div className="mx-auto max-w-4xl">
      <motion.section
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "nx-clip relative overflow-hidden border px-5 py-8 text-center sm:px-8 sm:py-12",
          tone.border,
        )}
        style={{
          background: `radial-gradient(120% 100% at 50% 0%, rgba(${tone.rgb},0.22), transparent 62%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.28))`,
        }}
      >
        {/*
          Corona radial. SOLO en victoria. Una derrota con rayos detrás felicita al jugador
          por haber perdido; el silencio dice más. Es un único elemento y no se anima en
          bucle: gira una vez con la entrada y se queda.
        */}
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

        <p className="nx-label">
          {view.yourDeckName} · dificultad {DIFFICULTY_INFO[view.difficulty].label}
        </p>

        {/*
          El titular ENTRA. Aparece un 35 % más grande y se cierra sobre su tamaño final:
          es el gesto de «impacto» del sistema de movimiento, y aquí es donde toca gastarlo.
        */}
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
          <span className="text-emerald-400">{r.scoreYou}</span>
          <span className="text-white/20">–</span>
          <span className="text-drl">{r.scoreRival}</span>
        </div>

        <p className="mx-auto mt-4 max-w-xl text-sm text-white/60">{r.reason}</p>
      </motion.section>

      {/*
        ═══ LO QUE HAS GANADO (Fase 10) ═══

        Esta banda no existía porque no había nada que enseñar: un duelo terminaba y no
        daba ni un crédito. Ahora paga, y el pago se ve en el sitio donde el jugador está
        mirando cuando ocurre — no enterrado en el libro mayor.

        Las cifras las calcula el SERVIDOR y llegan dentro del resultado (`result.award`).
        Aquí no se suma nada: enseñar una cantidad calculada en el navegador sería
        prometer algo que el servidor no tiene por qué haber concedido.
      */}
      {r.award && (r.award.points > 0 || r.award.credits > 0 || r.award.xp > 0) && (
        <section
          className="nx-clip-sm mt-5 flex flex-wrap items-center gap-x-8 gap-y-4 border px-5 py-4"
          style={{ borderColor: `rgba(${tone.rgb},0.35)`, background: `rgba(${tone.rgb},0.07)` }}
          aria-label="Lo que has ganado"
        >
          <span className="nx-label !text-white/70">Has ganado</span>

          {r.award.points > 0 ? (
            <Link href="/ranking" className="group">
              <span className="nx-label block">Puntos de rango</span>
              <span className="nx-readout mt-1 block text-[26px] text-drl-cyan">+{r.award.points}</span>
              <span className="mt-0.5 block text-[11px] text-white/40 transition-colors group-hover:text-white/60">
                Ver clasificación →
              </span>
            </Link>
          ) : (
            /*
              Perder no resta rango, pero tampoco lo sube: decirlo aquí es más honesto que
              esconder la fila, y explica en una línea por qué hay que ganar.
            */
            <div>
              <span className="nx-label block">Puntos de rango</span>
              <span className="nx-readout mt-1 block text-[26px] text-white/30">—</span>
              <span className="mt-0.5 block text-[11px] text-white/40">El rango solo sube ganando</span>
            </div>
          )}

          <div>
            <span className="nx-label block">Créditos</span>
            <span className="nx-readout mt-1 block text-[26px] text-drl-gold">+{r.award.credits}</span>
          </div>
          <div>
            <span className="nx-label block">Experiencia</span>
            <span className="nx-readout mt-1 block text-[26px] text-white">+{r.award.xp}</span>
          </div>

          <Link
            href="/logros"
            className="nx-clip-sm ml-auto inline-flex min-h-[36px] items-center border border-white/15 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Ver progreso
          </Link>
        </section>
      )}

      {/*
        ── Cifras ──
        Sin cajas. Eran cuatro tarjetas idénticas justo debajo del desenlace: el patrón de
        cuadro de mando reaparecía en el momento más cinematográfico de la partida.
      */}
      <section className="mt-6 flex flex-wrap gap-x-9 gap-y-5 border-y border-white/[0.08] px-1 py-5" aria-label="Resumen">
        <Stat label="Turnos ganados" value={`${wonTurns} / ${lostTurns}`} hint="tuyos / del rival" />
        <Stat label="Turnos empatados" value={String(r.tiedEncounters)} hint={r.tiedEncounters > 0 ? "nadie puntuó" : "ninguno"} />
        <Stat label="Estadística total" value={`${r.statTotalYou} – ${r.statTotalRival}`} hint="declarada en 10 turnos" />
        {r.sumOvrYou != null ? (
          <Stat label="Suma de medias" value={`${r.sumOvrYou} – ${r.sumOvrRival}`} hint="desempate del diseño" />
        ) : (
          <Stat label="Suma de medias" value="—" hint="no hizo falta" />
        )}
      </section>

      {/* Cómo se decidió, cuando no fue por marcador. */}
      {r.decidedBy !== "SCORE" && (
        <p className="mt-3 rounded-xl border-l-2 border-drl-gold bg-drl-gold/[0.07] px-4 py-2.5 text-xs text-white/70">
          {r.decidedBy === "OVR_TIEBREAK" && "El marcador quedó igualado y decidió la suma de las medias de los mazos."}
          {r.decidedBy === "STAT_MARGIN" && "El marcador y las medias quedaron igualados: decidió la estadística total declarada en los diez turnos."}
          {r.decidedBy === "NONE" && "Todos los criterios quedaron igualados. El empate es el resultado."}
        </p>
      )}

      {/* ── Acciones ── */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onPlayAgain}
          className="flex-1 rounded-xl bg-drl px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.14em] shadow-glow transition hover:brightness-110"
        >
          Volver a jugar
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="flex-1 rounded-xl border border-white/15 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-white/75 transition hover:bg-white/[0.07]"
        >
          Ver la partida
        </button>
        <button
          type="button"
          onClick={onDecks}
          className="flex-1 rounded-xl border border-white/15 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-white/75 transition hover:bg-white/[0.07]"
        >
          Mis mazos
        </button>
      </div>

      {/* ── Cartas usadas ── */}
      <section className="mt-6" aria-label="Cartas utilizadas">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Tus cartas</h2>
        <div className="flex flex-wrap gap-1.5">
          {view.yourUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
        </div>
        <h2 className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Cartas del rival</h2>
        <div className="flex flex-wrap gap-1.5">
          {view.rivalUsed.map((c) => <DuelCard key={c.uid} card={c} size="xs" />)}
        </div>
      </section>

      <section className="mt-6" aria-label="Historial completo">
        <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Los diez turnos</h2>
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
