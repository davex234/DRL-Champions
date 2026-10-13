"use client";

/**
 * TRACK GRATUITO (Fase 27). Los 30 niveles del carril LIBRE de la temporada real, como recorrido:
 * en escritorio una fila con desplazamiento y snap; en móvil lo mismo, más compacto. Estados según
 * la autoridad real: BLOQUEADO (nivel no alcanzado) · DISPONIBLE (alcanzado, sin reclamar) ·
 * CONSEGUIDO (reclamado). Contenido = `CURRENT_SEASON.free`, nada inventado.
 *
 * Sin reclamar aquí: el reclamo es manual y vive en «Logros y pase».
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { describeReward } from "./PassRail";
import type { PassTrackLevelView } from "@/server/services/progression";
import { cn } from "@/lib/format";

export type TrackState = "BLOQUEADO" | "DISPONIBLE" | "CONSEGUIDO";

export function trackState(l: Pick<PassTrackLevelView, "claimed" | "claimable">): TrackState {
  if (l.claimed) return "CONSEGUIDO";
  if (l.claimable) return "DISPONIBLE";
  return "BLOQUEADO";
}

export function FreeTrack({ levels, currentLevel, maxLevel, className }: { levels: PassTrackLevelView[]; currentLevel: number; maxLevel: number; className?: string }) {
  const scroller = useRef<HTMLOListElement>(null);
  const available = levels.filter((l) => l.claimable).length;

  /*
   * Al montar, centrar el nivel actual: el recorrido empieza donde está el jugador. Se mueve SOLO
   * el desplazamiento horizontal de la fila (`scrollLeft`), nunca la página: `scrollIntoView` saltaba
   * el hub entero hasta el track al abrir `/progresion` (lo enseñó la captura QA).
   */
  useEffect(() => {
    const list = scroller.current;
    const el = list?.querySelector<HTMLElement>(`[data-level="${Math.max(1, currentLevel)}"]`);
    if (!list || !el) return;
    list.scrollLeft = Math.max(0, el.offsetLeft - list.clientWidth / 2 + el.clientWidth / 2);
  }, [currentLevel]);

  return (
    <section aria-label="Carril libre del pase" className={className} data-track-available={available}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-caption text-ink-muted">
          Nivel <b className="nx-readout text-white">{currentLevel}</b> / {maxLevel} del pase ·{" "}
          {available > 0 ? <span className="text-drl-gold">{available} {available === 1 ? "recompensa disponible" : "recompensas disponibles"}</span> : "recompensas de cada nivel"}
        </p>
        <Link href="/logros" className="nx-action">Ver el pase completo →</Link>
      </div>
      <ol
        ref={scroller}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]"
        aria-label="Niveles"
      >
        {levels.map((l) => {
          const state = trackState(l);
          const reached = l.level <= currentLevel;
          return (
            <li
              key={l.level}
              data-level={l.level}
              data-state={state}
              className={cn(
                "nx-clip-sm flex w-[132px] shrink-0 snap-center flex-col gap-1 border px-3 py-2.5",
                state === "CONSEGUIDO" ? "border-ok/40 bg-ok/[0.06]"
                  : state === "DISPONIBLE" ? "border-drl-gold/60 bg-drl-gold/[0.10]"
                    : reached ? "border-white/20 bg-white/[0.04]" : "border-white/[0.08] bg-white/[0.02] opacity-70",
              )}
              title={`Nivel ${l.level}: ${describeReward(l.reward)}`}
            >
              <span className="flex items-center justify-between">
                <span className="nx-readout text-[16px] text-white">{l.level}</span>
                <span aria-hidden className={cn("h-2 w-2 rounded-full", state === "CONSEGUIDO" ? "bg-ok" : state === "DISPONIBLE" ? "bg-drl-gold" : "bg-white/20")} />
              </span>
              <span className="text-[11.5px] leading-snug text-white/70">{describeReward(l.reward)}</span>
              <span className="nx-label !text-[9px]">
                {state === "CONSEGUIDO" ? "Conseguido" : state === "DISPONIBLE" ? "Disponible" : "Bloqueado"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
