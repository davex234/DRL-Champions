"use client";

/**
 * MAPAS — los cuatro trazados de NEXUS (Fase 9I).
 *
 * Una ficha por mapa: el trazado a tamaño grande, su identidad en una línea y el desglose
 * de sus zonas. Es una pantalla de ESTUDIO, no un editor: no se arrastra nada y no se
 * guarda nada. Para dibujar está la pizarra.
 *
 * Los mapas son PROPIOS. Ni el trazado, ni los nombres, ni las zonas vienen de VALORANT ni
 * de ningún otro juego: lo que se reproduce es la gramática del género —dos bases, sitios
 * de plantado, un centro y sus cuellos de botella—, que no es de nadie.
 */
import { useState } from "react";
import Link from "next/link";
import {
  TACTICAL_MAPS, ZONE_COLOR, ZONE_LABEL, emptyStrat,
  type TacticalMap, type ZoneKind,
} from "@/domain/tactics";
import { StrategyBoard } from "@/components/tactics/StrategyBoard";
import { cn } from "@/lib/format";

export default function MapasPage() {
  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/entrenador"
          className="-ml-2 inline-flex min-h-[36px] items-center rounded-control px-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 transition duration-fast hover:bg-white/[0.06] hover:text-white"
        >
          ‹ Entrenador
        </Link>
        <h1 className="font-display text-[clamp(26px,4.5vw,42px)] font-bold uppercase leading-none text-white">
          Mapas
        </h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-white/55">
          Cuatro trazados con problemas distintos. No son variaciones del mismo mapa: lo que
          cambia entre ellos es qué error se paga caro.
        </p>
      </header>

      <div className="space-y-5">
        {TACTICAL_MAPS.map((m) => <MapCard key={m.id} map={m} />)}
      </div>
    </div>
  );
}

function MapCard({ map }: { map: TacticalMap }) {
  /*
   * Se reutiliza la pizarra en modo lectura: una estrategia vacía coloca los cinco roles en
   * la base y así se ve la escala real del mapa —un sitio grande se nota cuando hay una
   * ficha al lado—. `onMove` no hace nada: aquí no se edita.
   */
  const [side] = useState<"attack" | "defense">("attack");
  const preview = emptyStrat(`preview-${map.id}`, map.id, side, map.name);

  const byKind = map.zones.reduce<Record<string, string[]>>((acc, z) => {
    (acc[z.kind] ??= []).push(z.label);
    return acc;
  }, {});

  return (
    <section id={map.id} className="nx-panel scroll-mt-24 p-4 sm:p-5" aria-label={map.name}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <StrategyBoard
          map={map}
          strat={preview}
          step={0}
          selectedId={null}
          onSelect={() => {}}
          onMove={() => {}}
          className="h-fit"
        />

        <div className="min-w-0">
          <span className="nx-label">{map.sites === 1 ? "Un sitio" : `${map.sites} sitios`}</span>
          <h2 className="mt-0.5 font-display text-3xl font-bold uppercase leading-none text-white">
            {map.name}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-white/60">{map.identity}</p>

          <h3 className="nx-label mt-5 mb-2">Zonas</h3>
          <div className="space-y-2">
            {(Object.keys(ZONE_LABEL) as ZoneKind[]).map((kind) => {
              const labels = byKind[kind];
              if (!labels?.length) return null;
              return (
                <div key={kind} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className="flex shrink-0 items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-label"
                    style={{ color: ZONE_COLOR[kind] }}
                  >
                    <i className="h-2 w-2 rounded-sm" style={{ background: ZONE_COLOR[kind] }} aria-hidden />
                    {ZONE_LABEL[kind]}
                  </span>
                  <span className="text-[13px] text-white/55">{labels.join(" · ")}</span>
                </div>
              );
            })}
          </div>

          <Link
            href="/entrenador/strats"
            className={cn(
              "mt-5 inline-block rounded-control border border-white/15 px-5 py-2.5",
              "font-display text-sm font-bold uppercase tracking-[0.12em] text-white/80",
              "transition duration-fast hover:bg-white/[0.07]",
            )}
          >
            Dibujar una jugada aquí
          </Link>
        </div>
      </div>
    </section>
  );
}
