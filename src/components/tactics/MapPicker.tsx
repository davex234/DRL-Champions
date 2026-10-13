"use client";

/**
 * SELECTOR DE MAPA.
 *
 * Doce tarjetas: la miniatura del asset real, el nombre y el estado. Al elegir uno **solo
 * cambia el asset del tablero**: no se toca la estrategia, ni los pasos, ni las capas.
 *
 * Es una rejilla de botones de radio de verdad (`role="radiogroup"`), no un montón de
 * `div` con `onClick`: se recorre con el tabulador y se cambia con las flechas, que es como
 * un entrenador con prisa cambia de mapa.
 */
import { availableMaps, type TacticalMap } from "@/domain/tactics";
import { MapThumb } from "./MapThumb";
import { cn } from "@/lib/format";

export function MapPicker({
  value, onChange, className, compact = false,
}: {
  value: string;
  onChange: (map: TacticalMap) => void;
  className?: string;
  /** En el editor el selector vive en una columna estrecha. */
  compact?: boolean;
}) {
  const maps = availableMaps();

  return (
    <div
      role="radiogroup"
      aria-label="Mapa"
      className={cn(
        "grid gap-2",
        compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {maps.map((m) => {
        const on = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m)}
            title={`${m.name} · ${m.identity}`}
            /*
              FASE 10 · CHAFLÁN, NO ESQUINA REDONDA. Era la última geometría prestada del
              Entrenador. El `role="radio"`, el `aria-checked` y el orden de los doce mapas
              no cambian: `trainer:verify` los cuenta y los sigue encontrando.
            */
            className={cn(
              "nx-clip-sm group relative min-h-[44px] overflow-hidden text-left transition duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-gold",
              on
                ? "bg-drl-gold/[0.07] shadow-[inset_0_0_0_1px_rgba(255,211,92,0.7)]"
                : "bg-white/[0.02] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.32)]",
            )}
          >
            <span className="block aspect-square bg-[#070a10] p-1.5">
              <MapThumb map={m} priority={on} className={cn(!on && "opacity-70 transition-opacity duration-fast group-hover:opacity-100")} />
            </span>

            <span className="flex items-baseline justify-between gap-2 px-2.5 py-2">
              <span className={cn(
                "font-display text-[13px] font-bold uppercase tracking-wide",
                on ? "text-drl-gold" : "text-white/80",
              )}>
                {m.name}
              </span>
              <span className="font-display text-[10px] uppercase tracking-widest text-white/35">
                {m.sites} sitios
              </span>
            </span>


          </button>
        );
      })}
    </div>
  );
}
