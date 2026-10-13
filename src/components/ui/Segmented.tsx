"use client";

/**
 * SEGMENTADO — elegir UNA opción de pocas, sin desplegar nada.
 *
 * ────────────────────────── POR QUÉ ESTÁ AQUÍ ──────────────────────────
 *
 * Nació local en la configuración del launcher y la Fase 3B la dejó allí a propósito: una
 * primitiva con un solo consumidor es una API inventada. La Fase 5 le ha dado el segundo —el
 * orden y el estado de propiedad del álbum— y con él la razón para subir al sistema.
 *
 * Es la alternativa honesta a dos cosas que el producto repetía: el `<select>` nativo (que en
 * un juego se lee como un formulario) y la fila de píldoras (que no dice cuál manda). Aquí las
 * opciones se ven todas, la elegida está rellena y la geometría es la de la casa.
 *
 * Cuando las opciones no son excluyentes o son muchas, esto NO es la pieza: eso es `Chip`.
 */
import { cn } from "@/lib/format";

export function Segmented<T extends string>({
  value, options, onChange, className, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("nx-clip-sm inline-flex gap-0.5 bg-black/40 p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              // 44 px de alto: es el objetivo táctil mínimo, y este control se usa con el
              // pulgar en el álbum. Sin esto medía 32 y no se podía pulsar con seguridad.
              "nx-clip-sm nx-focus inline-flex min-h-[44px] items-center px-3.5 font-display text-caption font-bold uppercase tracking-label transition",
              on ? "bg-white/90 text-black" : "text-ink-muted hover:bg-white/10 hover:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
