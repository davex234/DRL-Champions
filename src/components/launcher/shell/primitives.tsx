"use client";

/**
 * LAUNCHER — PRIMITIVAS **LOCALES**.
 *
 * ────────────────────────── QUÉ QUEDA AQUÍ Y POR QUÉ ──────────────────────────
 *
 * Este fichero tenía trece piezas y era, de hecho, un segundo sistema de diseño: repetía la
 * placa, el botón y la insignia que ya existían, con sus propios hexadecimales y sus propios
 * tamaños de letra. La Fase 3B lo deshace. Ahora solo quedan CUATRO piezas, y cada una está
 * aquí por una razón concreta:
 *
 *   Toggle · Slider               controles de formulario que HOY solo usa la pantalla de
 *                                 configuración del cliente. Son candidatos a subir al sistema,
 *                                 pero promoverlos sin un segundo consumidor sería inventarse
 *                                 una API con un solo caso de uso.
 *   Avatar                        identidad visual de una persona; el producto todavía no
 *                                 tiene concepto de avatar fuera del launcher.
 *
 * Lo que se fue, y adónde:
 *
 *   Panel        → `Plate`        (@/components/ui/Surface)
 *   Cta          → `NxButton`     (@/components/ui/NxButton, con `accent`)
 *   StateBadge   → `Badge`        (@/components/ui/Badge)
 *   Tag          → `Badge`
 *   StateDot     → `StatusDot`    (@/components/ui/Badge)
 *   Meter        → `Meter`        (@/components/ui/Meter)
 *   SectionTitle → `SectionTitle` (@/components/ui/SectionTitle)
 *   Fact         → `Readout`      (@/components/ui/Readout) — era un Readout con etiqueta
 *   TONE_COLOR   → `TONE`         (@/components/ui/tone)
 *   Segmented    → `Segmented`    (@/components/ui/Segmented) — la Fase 5 le dio su segundo
 *                                 consumidor (el orden y la propiedad del álbum), que era la
 *                                 condición para promoverla.
 *
 * REGLA para lo que queda: ni un hexadecimal ni un `text-[Npx]` que tenga equivalente en el
 * sistema. Los colores salen de los tokens; los tamaños, de la escala tipográfica.
 */
import { ACCENT } from "@/design/tokens";
import { cn } from "@/lib/format";
import { Readout } from "@/components/ui/Readout";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

/** Avatar generado: monograma sobre placa con el color de la persona. Cero peticiones de red. */
export function Avatar({ name, color, size = 34, ring }: { name: string; color: string; size?: number; ring?: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <span
      className="nx-clip-sm relative grid shrink-0 place-items-center font-display font-black text-white"
      style={{
        width: size,
        height: size,
        // El tamaño de un monograma es proporcional a su placa, no un paso de la escala
        // tipográfica: es un dibujo, no un texto que se lea en una frase.
        fontSize: size * 0.38,
        background: `linear-gradient(150deg, ${color}, ${color}22)`,
        boxShadow: `inset 0 0 0 1px ${color}66, inset 0 1px 0 rgba(255,255,255,0.25)${ring ? `, 0 0 0 2px ${ring}` : ""}`,
        ["--nx-chamfer-sm" as string]: `${Math.round(size * 0.24)}px`,
      }}
    >
      {initials}
    </span>
  );
}

/** Interruptor. Sin librería: un botón con estado y una pastilla que se desliza. */
export function Toggle({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  useLocale();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "nx-focus group flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors",
        "hover:bg-white/[0.035] disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-body font-semibold text-ink-secondary">{td(label)}</span>
        {hint && <span className="mt-0.5 block truncate text-caption text-ink-muted">{td(hint)}</span>}
      </span>
      <span
        className={cn(
          "relative h-[22px] w-[42px] shrink-0 rounded-full transition-colors duration-fast",
          checked ? "bg-drl shadow-glow" : "bg-white/10 shadow-recessed-sm",
        )}
      >
        <span
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-e1 transition-transform duration-fast ease-out"
          style={{ transform: `translateX(${checked ? 23 : 3}px)` }}
        />
      </span>
    </button>
  );
}

/** Deslizador numérico con su lectura. El valor se escribe con la cifra del sistema. */
export function Slider({
  value, min, max, step = 1, onChange, label, format,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; label: string; format?: (v: number) => string;
}) {
  useLocale();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body font-semibold text-ink-secondary">{td(label)}</span>
        <Readout size="xs" tone={ACCENT.primary} value={format ? format(value) : value} align="right" />
      </div>
      <input
        type="range"
        aria-label={td(label)}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nx-focus mt-2 h-1 w-full cursor-pointer appearance-none rounded-full accent-drl"
        style={{ background: `linear-gradient(90deg, ${ACCENT.primary} ${pct}%, rgba(255,255,255,0.10) ${pct}%)` }}
      />
    </div>
  );
}
