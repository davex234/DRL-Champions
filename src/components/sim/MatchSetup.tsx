"use client";

/**
 * PREPARAR PARTIDO — elegir rival, y ver cómo cae el lado.
 *
 * ────────────────────────── QUÉ CAMBIA Y POR QUÉ ──────────────────────────
 *
 * **1. El lado ya no se elige.** Antes había dos píldoras —Ataque / Defensa— y el jugador se
 * quedaba con la que prefería. Eso no era una opción de interfaz: atacar y defender no valen
 * lo mismo con la misma composición, así que elegir era llevarse media ventaja antes de
 * empezar. Ahora sale a cara o cruz, `drawSide` lo reparte 50/50 y la pantalla lo DICE antes
 * del sorteo en vez de justificarlo después.
 *
 * **2. La acción principal está arriba.** Era el último elemento de la tarjeta: para jugar
 * había que recorrer la configuración entera. Ahora encabeza la pantalla, y lo que se
 * configura va debajo, que es el orden en el que se usa —casi siempre se entra a jugar, no a
 * cambiar el rival—.
 *
 * **3. El sorteo es un momento, no un parpadeo.** Cae, se ve caer y se anuncia. Es lo único
 * que se anima aquí, porque es lo único que ocurre.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Side } from "@/sim";
import type { RivalDifficulty } from "@/lib/match/roster";
import { drawSide, SIDE_NAME } from "@/lib/match/sideDraw";
import { Stage, Plate, Medallion } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Readout } from "@/components/ui/Readout";
import { playCue } from "@/lib/sound";
import { cn } from "@/lib/format";

const RIVALS: { id: RivalDifficulty; label: string; desc: string }[] = [
  { id: "easy", label: "Fácil", desc: "Rival de menor nivel" },
  { id: "normal", label: "Normal", desc: "Rival equilibrado" },
  { id: "hard", label: "Difícil", desc: "Los mejores jugadores" },
];

/** Cuánto dura el sorteo en pantalla. Lo justo para leerlo; no es una ceremonia. */
const SORTEO_MS = 1100;

type Fase = "listo" | "sorteando" | "resuelto";

export function MatchSetup({ onPlay, initial }: {
  onPlay: (side: Side, difficulty: RivalDifficulty) => void;
  /** `side` se ignora a propósito: ya no es una preferencia que se pueda recordar. */
  initial?: { side?: Side; difficulty: RivalDifficulty } | null;
}) {
  const [difficulty, setDifficulty] = useState<RivalDifficulty>(initial?.difficulty ?? "normal");
  const [fase, setFase] = useState<Fase>("listo");
  const [salido, setSalido] = useState<Side | null>(null);
  const reduced = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jugar = useCallback(() => {
    if (fase !== "listo") return;
    const lado = drawSide();
    setSalido(lado);
    setFase("sorteando");
    playCue("whoosh");
    /*
     * Con `prefers-reduced-motion` el sorteo no se «juega»: se resuelve y se entra. Quien pide
     * menos movimiento no está pidiendo esperar más rato a lo mismo.
     */
    const espera = reduced ? 260 : SORTEO_MS;
    timer.current = setTimeout(() => {
      setFase("resuelto");
      onPlay(lado, difficulty);
    }, espera);
  }, [fase, difficulty, onPlay, reduced]);

  // El temporizador del sorteo no puede sobrevivir a la pantalla: si el jugador se va antes
  // de que caiga la moneda, lanzaría el partido sobre un componente que ya no está.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const sorteando = fase !== "listo";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {/*
        ═══ LA ACCIÓN, PRIMERO ═══
        Antes cerraba la tarjeta. Un jugador que entra a `/entrenador/partido` entra a jugar:
        el rival es un ajuste, no un paso obligatorio del recorrido.
      */}
      <Stage tone="primary" grid className="px-5 py-6 text-center sm:px-8">
        <span className="nx-label">Preparar partido</span>
        <h2 className="mt-1 font-display text-[clamp(24px,4vw,36px)] font-bold uppercase leading-none text-white">
          Dirigir partido
        </h2>
        <p className="mx-auto mt-2 max-w-md text-body text-ink-muted">
          A 13 rondas, con cambio de lado. Tú no disparas: decides.
        </p>

        <div className="mt-5">
          <NxButton
            variant="primary"
            size="lg"
            onClick={jugar}
            disabled={sorteando}
            className="w-full sm:w-auto sm:min-w-[280px]"
          >
            {sorteando ? "Sorteando lado…" : "Sortear lado y jugar"}
          </NxButton>
        </div>
      </Stage>

      {/*
        ═══ EL SORTEO ═══
        Se enseña ANTES de pulsar, no después: la pantalla avisa de que el lado no se elige,
        en vez de que el jugador lo descubra cuando ya no puede hacer nada.
      */}
      <Plate className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="nx-label">Lado inicial</span>
            <p className="mt-0.5 text-caption text-ink-muted">
              No se elige. Se sortea a partes iguales, como en una moneda.
            </p>
          </div>
          <Readout size="sm" label="Reparto" value="50 / 50" tone="var(--nx-gold)" />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5" role="status" aria-live="polite">
          {(["ATK", "DEF"] as Side[]).map((sd) => {
            const ganador = salido === sd;
            const perdedor = salido != null && !ganador;
            return (
              <motion.div
                key={sd}
                animate={
                  reduced || !sorteando
                    ? {}
                    : ganador
                      ? { scale: [1, 1.06, 1] }
                      : perdedor
                        ? { opacity: [1, 0.35] }
                        : {}
                }
                transition={{ duration: 0.45, delay: reduced ? 0 : 0.5 }}
              >
                <Plate
                  tone={ganador ? "success" : "neutral"}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition duration-slow",
                    perdedor && "opacity-40",
                  )}
                >
                  <Medallion size={34} tone={ganador ? "success" : "neutral"}>
                    <span className="nx-readout text-[13px]">{sd}</span>
                  </Medallion>
                  <span className="min-w-0">
                    <b className="block font-display text-[14px] font-bold uppercase tracking-[0.06em] text-white">
                      {SIDE_NAME[sd]}
                    </b>
                    <span className="block text-caption text-ink-faint">
                      {ganador ? "Te toca" : salido ? "—" : "Posible"}
                    </span>
                  </span>
                </Plate>
              </motion.div>
            );
          })}
        </div>

        {/* El resultado en palabras, para quien no ve el color ni la animación. */}
        {salido && (
          <p className="mt-2.5 text-center text-caption text-ok">
            Sale <b className="text-white">{SIDE_NAME[salido]}</b>. Empiezas la primera mitad ahí.
          </p>
        )}
      </Plate>

      {/* ═══ RIVAL ═══ */}
      <Plate className="px-5 py-4">
        <span className="nx-label">Rival</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {RIVALS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setDifficulty(r.id)}
              disabled={sorteando}
              aria-pressed={difficulty === r.id}
              className={cn(
                "nx-focus min-h-[52px] rounded-card border px-3 py-2.5 text-left transition duration-fast",
                difficulty === r.id
                  ? "border-drl/50 bg-drl/10"
                  : "border-white/10 bg-white/5 hover:bg-white/10",
                sorteando && "opacity-50",
              )}
            >
              <p className="font-display text-[13px] font-bold uppercase tracking-wide text-white">{r.label}</p>
              <p className="text-caption text-ink-faint">{r.desc}</p>
            </button>
          ))}
        </div>
      </Plate>
    </div>
  );
}
