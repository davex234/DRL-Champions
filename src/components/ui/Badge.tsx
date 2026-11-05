"use client";

/**
 * INSIGNIA Y PUNTO DE ESTADO — la pieza que dice EN QUÉ ESTÁ algo.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * `Chip` existía, pero un chip es un CONTROL: se pulsa, filtra y tiene estado activo. Decir
 * «En directo», «Completado» o «No instalado» es otra cosa —no se pulsa— y por eso cada
 * pantalla se dibujaba su propia píldora: la auditoría encontró la misma insignia reescrita en
 * eventos, en logros, en el inventario y en el launcher, con cuatro geometrías distintas.
 *
 * Una sola pieza, dos formatos:
 *
 *   Badge      la insignia con su punto, para un estado
 *   StatusDot  el punto solo, para cuando la etiqueta ya está escrita al lado
 *
 * Ninguna es una píldora: llevan el chaflán de control, como el resto del sistema.
 */
import { CHAMFER } from "@/design/tokens";
import { cn } from "@/lib/format";
import { TONE, type Tone } from "./tone";

export type { Tone };

/**
 * PUNTO DE ESTADO.
 *
 * `pulse` NO es decorativo: marca lo que está VIVO ahora mismo (en directo, descargando, en
 * cola). Un punto que late sin que nada esté ocurriendo es ruido, y además cuesta un
 * repintado permanente.
 */
export function StatusDot({
  tone = "muted", pulse, size = 7, className,
}: { tone?: Tone; pulse?: boolean; size?: number; className?: string }) {
  const color = TONE[tone];
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {pulse && (
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: color, animationDuration: "2.2s" }}
        />
      )}
      <span
        aria-hidden
        className="relative inline-block h-full w-full rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  );
}

export function Badge({
  tone = "muted", dot, pulse, solid, className, children, ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  /** Añade el punto de estado delante. */
  dot?: boolean;
  pulse?: boolean;
  /** Relleno pleno con el texto en negativo. Para la categoría o el destacado. */
  solid?: boolean;
}) {
  const color = TONE[tone];
  return (
    <span
      className={cn(
        "nx-clip-sm inline-flex items-center gap-1.5 px-2.5 py-1 font-display text-label font-bold uppercase",
        className,
      )}
      style={{
        ["--nx-chamfer-sm" as string]: CHAMFER.medallion,
        color: solid ? "#06070d" : color,
        background: solid ? color : `${color}14`,
        boxShadow: solid ? undefined : `inset 0 0 0 1px ${color}40`,
      }}
      {...rest}
    >
      {dot && <StatusDot tone={tone} pulse={pulse} size={6} />}
      {children}
    </span>
  );
}
