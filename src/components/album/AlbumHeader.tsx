"use client";

/**
 * ÁLBUM — LA CABECERA.
 *
 * ────────────────────────── QUÉ CONTESTA ──────────────────────────
 *
 * Las dos primeras preguntas del álbum, sin leer: **cuántas tengo** y **cuántas me faltan**.
 * Antes eran una frase corrida («42 de 772 cartas · 5% completado») y una barra dibujada a
 * mano en la esquina opuesta, a 1.100 px de distancia del número al que se refería.
 *
 * Ahora es una sola lectura: la cifra grande con su unidad, el medidor debajo y, a su lado,
 * lo que queda por descubrir — que es la cifra que de verdad mueve a un coleccionista.
 *
 * NO es un panel de estadísticas. Es una línea de estado del álbum: ocupa lo que ocupa un
 * titular y no roba sitio a las cartas, que son el motivo por el que se entra aquí.
 */
import { Meter } from "@/components/ui/Meter";
import { Readout } from "@/components/ui/Readout";
import { Badge } from "@/components/ui/Badge";

export function AlbumHeader({
  distinct, total, percent, instances, online,
}: {
  /** Cartas DISTINTAS conseguidas: la unidad de progreso del álbum. */
  distinct: number;
  total: number;
  percent: number;
  /** Copias en posesión, duplicados incluidos. Es otra cosa y se dice aparte. */
  instances: number;
  online: boolean;
}) {
  const missing = Math.max(0, total - distinct);

  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <span className="font-display text-label uppercase tracking-wide2 text-drl">Colección</span>
          <h1 className="mt-1 font-display text-[clamp(30px,5vw,46px)] font-bold uppercase leading-none text-white">
            Mi álbum
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-faint">
            <Badge tone={online ? "ok" : "muted"} dot>
              {online ? "Guardado en el servidor" : "Modo local"}
            </Badge>
            <span>
              {instances} {instances === 1 ? "copia" : "copias"} en posesión
            </span>
          </p>
        </div>

        {/*
          El progreso, pegado a su cifra. Tres datos y ni uno más: lo que tienes, lo que falta
          y la barra que los relaciona.
        */}
        <div className="w-full max-w-[420px]">
          <div className="flex items-end justify-between gap-6">
            <Readout size="lg" label="Conseguidas" value={distinct} unit={`/ ${total}`} tone="var(--nx-cyan)" />
            <Readout size="sm" label="Por descubrir" value={missing} align="right" />
          </div>
          <Meter value={percent} tone="info" height={6} label="Progreso del álbum" className="mt-2.5" />
          <p className="mt-1.5 text-right text-caption text-ink-faint">{percent}% completado</p>
        </div>
      </div>
    </header>
  );
}
