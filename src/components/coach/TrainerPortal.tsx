"use client";

/**
 * LA ENTRADA AL MODO — el «JUGAR» del Entrenador.
 *
 * ────────────────────────── QUÉ PROBLEMA RESUELVE ──────────────────────────
 *
 * `/entrenador` se leía como un índice. Al entrar había cabecera, una tira de cuatro pasos,
 * el equipo activo, doce mapas y, al final del todo, una tarjeta de texto llamada «Dirigir un
 * partido» del mismo tamaño que las otras cinco. Para jugar había que bajar y elegir entre
 * seis cosas que pesaban lo mismo. Un modo de juego cuyo botón de jugar compite en igualdad
 * con «Carrera» no es un modo de juego: es un panel.
 *
 * Esto no es un `NxButton` más grande. Es una PIEZA: fondo de mapa real, medallón, rótulo,
 * estado del equipo y una barrida al pasar por encima. Ocupa lo que ocupa a propósito —al
 * entrar, esto es lo único que hay que ver—.
 *
 * ────────────────────────── EL FONDO ES UN MAPA REAL ──────────────────────────
 *
 * Y es EL mapa: el simulador juega en Ascent —`src/sim/map/ascentA.ts`, sitio A—, así que el
 * fondo es `ascent.png`, el asset de verdad. No es decoración genérica ni un mapa elegido al
 * azar para rellenar: es dónde se va a jugar.
 *
 * ────────────────────────── LA PUERTA PUEDE ESTAR CERRADA ──────────────────────────
 *
 * Sin cinco titulares no se puede dirigir. En vez de esconder la entrada o dejarla llevar a
 * una pantalla que rebota, se enseña igual, apagada, diciendo qué falta y llevando al sitio
 * donde se arregla. Un hueco declarado se entiende; un botón que no responde, no.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { getTacticalMap } from "@/domain/tactics";
import { MapThumb } from "@/components/tactics/MapThumb";
import { Stage, Medallion } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { cn } from "@/lib/format";

/** El mapa del simulador. Un dato, no una preferencia visual. */
const MAPA_DEL_SIM = "ascent";

export interface TrainerPortalProps {
  /** Titulares listos. Cinco abre la puerta. */
  ready: number;
  /** Nombre del equipo activo, o `null` si todavía no hay ninguno. */
  teamName: string | null;
}

export function TrainerPortal({ ready, teamName }: TrainerPortalProps) {
  const abierto = ready === 5;
  const mapa = getTacticalMap(MAPA_DEL_SIM);
  const reduced = useReducedMotion();

  const destino = abierto ? "/entrenador/partido" : "/entrenador/equipos";
  const etiqueta = abierto
    ? "Dirigir partido"
    : teamName
      ? "Completar la alineación"
      : "Crear tu equipo";

  return (
    <Link
      href={destino}
      className="nx-focus group block"
      aria-label={abierto ? "Jugar: dirigir un partido" : `${etiqueta}. Necesitas cinco titulares.`}
    >
      <Stage
        tone={abierto ? "primary" : "neutral"}
        className="relative overflow-hidden"
      >
        {/* ── El mapa, de fondo y muy atenuado: ambiente, no información ── */}
        {mapa && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <MapThumb
              map={mapa}
              priority
              className={cn(
                "h-full w-full opacity-[0.13] transition-transform duration-slow ease-out",
                !reduced && "group-hover:scale-[1.04]",
              )}
            />
            <span
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% 40%, transparent, rgba(6,7,13,0.86) 72%)," +
                  "linear-gradient(180deg, rgba(6,7,13,0.35), rgba(6,7,13,0.9))",
              }}
            />
          </div>
        )}

        {/*
          La barrida. Es lo único que se mueve al pasar por encima, y solo cruza una vez:
          un brillo permanente deja de significar «esto responde» y pasa a ser ruido.
        */}
        {!reduced && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 opacity-0 transition-all duration-slow ease-out group-hover:left-[110%] group-hover:opacity-100"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)" }}
          />
        )}

        <div className="relative flex min-h-[300px] flex-col items-center justify-center gap-4 px-5 py-10 text-center sm:min-h-[340px] sm:px-8">
          <Medallion size={56} tone={abierto ? "primary" : "neutral"}>
            {/* Un rombo con el eje marcado: la marca del modo, dibujada, no un emoji. */}
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M12 2.6 21.4 12 12 21.4 2.6 12Z" strokeLinejoin="round" />
              <path d="M12 7.4V16.6M7.4 12h9.2" strokeLinecap="round" opacity="0.55" />
            </svg>
          </Medallion>

          <div>
            <span className="nx-label">{abierto ? "Entrar al modo" : "Antes de jugar"}</span>
            <motion.h2
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="mt-1 font-display text-[clamp(34px,7vw,64px)] font-bold uppercase leading-[0.92] tracking-[0.01em] text-white"
            >
              {abierto ? "Jugar" : etiqueta}
            </motion.h2>
            <p className="mx-auto mt-2.5 max-w-sm text-body text-ink-muted">
              {abierto
                ? "Dirige un partido a 13 rondas. El lado inicial se sortea."
                : teamName
                  ? `${teamName} tiene ${ready} de 5 titulares. Complétala para poder dirigir.`
                  : "Monta un equipo con tus cartas y vuelve aquí."}
            </p>
          </div>

          {/*
            No es un botón dentro de un enlace —eso sería un control dentro de otro— sino el
            remate visual de la pieza entera, que ES el control.
          */}
          <span
            className={cn(
              "nx-clip-sm mt-1 inline-flex min-h-[52px] items-center gap-2.5 px-7 font-display text-[15px] font-bold uppercase tracking-[0.14em] transition duration-fast",
              abierto
                ? "bg-drl text-white shadow-glow group-hover:brightness-110"
                : "border border-white/18 text-white/70 group-hover:bg-white/8",
            )}
          >
            {abierto ? "Dirigir partido" : etiqueta}
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 8h9M8.5 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>

          {/* El estado del equipo, en el sitio donde importa: junto a la puerta. */}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
            <Readout
              size="sm"
              label="Titulares"
              value={`${ready} / 5`}
              tone={abierto ? "var(--nx-ok)" : "var(--nx-gold)"}
            />
            {teamName && <Readout size="sm" label="Equipo" value={teamName} />}
            {mapa && <Readout size="sm" label="Mapa" value={mapa.name} />}
          </div>
        </div>
      </Stage>
    </Link>
  );
}
