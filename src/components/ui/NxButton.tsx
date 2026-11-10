"use client";

/**
 * BOTÓN NEXUS — la primitiva que no existía.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * Medido en la auditoría: **no hay ningún componente de botón compartido en el producto**, y
 * `rounded-full` —la píldora— se usa 218 veces. En total, 835 usos de `rounded-*` frente a 94
 * de chaflán: la geometría genérica le gana 9 a 1 a la de la casa, y donde más gana es en los
 * controles. El sobre sellado de la tienda es una pieza magnífica con un botón de Bootstrap
 * debajo.
 *
 * Esto no arregla las 835: arregla que a partir de ahora no haya que decidirlo otra vez.
 *
 * ────────────────────────── UNA FAMILIA, SEIS PAPELES ──────────────────────────
 *
 * Todos comparten la MISMA geometría —el chaflán de control— y el mismo ritmo. Lo que cambia
 * es el peso, y el peso es semántico:
 *
 *   primary     la acción de la pantalla. Relleno pleno. UNA por pantalla.
 *   secondary   la alternativa. Canto y superficie hundida.
 *   tertiary    acción de apoyo. Solo texto, con su filo inferior.
 *   ghost       sin superficie hasta que se apunta. Para barras y cabeceras.
 *   danger      destructiva. Canto rojo; solo se rellena al pulsar.
 *   icon        placa cuadrada. Mismo chaflán, sin texto.
 *
 * ────────────────────────── LO QUE NO ES ──────────────────────────
 *
 * No es un botón con veinte props visuales: `variant`, `size`, `block` y ya. Si hace falta un
 * aspecto nuevo, se añade un papel aquí — no una excepción en la pantalla.
 */
import { forwardRef } from "react";
import Link from "next/link";
import { ACCENT } from "@/design/tokens";
import { cn } from "@/lib/format";

export type NxButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "icon";
export type NxButtonSize = "sm" | "md" | "lg";

/**
 * Alturas. El suelo de 44 px en `md` y `lg` no es estético: es el objetivo táctil mínimo, y
 * esta primitiva es la que garantiza que ninguna pantalla lo incumpla por descuido.
 */
const SIZE: Record<NxButtonSize, string> = {
  sm: "min-h-[34px] px-3 text-[11px]",
  md: "min-h-[44px] px-5 text-[13px]",
  lg: "min-h-[52px] px-7 text-[15px]",
};

const ICON_SIZE: Record<NxButtonSize, string> = {
  sm: "h-[34px] w-[34px]",
  md: "h-[44px] w-[44px]",
  lg: "h-[52px] w-[52px]",
};

const VARIANT: Record<NxButtonVariant, string> = {
  primary:
    "bg-drl text-white shadow-glow " +
    "hover:brightness-110 active:brightness-95 " +
    "disabled:bg-white/[0.07] disabled:text-white/35 disabled:shadow-none",
  secondary:
    "text-white/85 bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),inset_0_1px_3px_rgba(0,0,0,0.55)] " +
    "hover:bg-white/[0.08] hover:text-white active:bg-white/[0.05] " +
    "disabled:text-white/25 disabled:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
  tertiary:
    "text-white/70 border-b border-white/20 bg-transparent " +
    "hover:text-white hover:border-white/50 disabled:text-white/25 disabled:border-white/10",
  ghost:
    "text-white/60 bg-transparent hover:bg-white/[0.07] hover:text-white " +
    "active:bg-white/[0.04] disabled:text-white/25 disabled:hover:bg-transparent",
  danger:
    "text-bad bg-transparent shadow-[inset_0_0_0_1px_currentColor] " +
    "hover:bg-bad/15 active:bg-bad/25 disabled:text-white/25 disabled:hover:bg-transparent",
  icon:
    "text-white/70 bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] " +
    "hover:bg-white/[0.08] hover:text-white active:bg-white/[0.05] " +
    "disabled:text-white/25",
};

/**
 * ACENTO de la acción principal. Es SEMÁNTICO, no decorativo, y por eso son tres y no una
 * paleta: el rojo de marca actúa, el oro actualiza o recompensa, el cian informa o reanuda.
 *
 * Solo tiene efecto sobre `variant="primary"` —los demás papeles se definen por su peso, no
 * por su color— así que la regla «una sola variante rellena de acento» sigue intacta.
 */
export type NxButtonAccent = "primary" | "gold" | "cyan";

const ACCENT_FILL: Record<Exclude<NxButtonAccent, "primary">, { bg: string; fg: string }> = {
  gold: { bg: ACCENT.gold, fg: "#221703" },
  cyan: { bg: ACCENT.cyan, fg: "#02202a" },
};

export interface NxButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: NxButtonVariant;
  size?: NxButtonSize;
  /** Acento de la acción principal. Ignorado en el resto de papeles. */
  accent?: NxButtonAccent;
  /** Ocupa el ancho disponible. En móvil es lo normal para la acción principal. */
  block?: boolean;
  /**
   * Destino. Con `href` la pieza se renderiza como ENLACE, no como botón.
   *
   * Media aplicación navega con un `<Link>` disfrazado de botón, y la alternativa —meter un
   * `<button>` dentro de un `<a>`— es HTML inválido y rompe el teclado. Misma acción, misma
   * geometría: lo único que cambia es si navega o si ejecuta.
   */
  href?: string;
}

export const NxButton = forwardRef<HTMLButtonElement, NxButtonProps>(function NxButton(
  { variant = "secondary", size = "md", accent = "primary", block, className, style, type, href, children, ...rest },
  ref,
) {
  const isIcon = variant === "icon";
  // El acento solo pinta la variante primaria, y lo hace por `style` para no multiplicar
  // clases: el papel sigue siendo uno, cambia de qué habla.
  const fill = variant === "primary" && accent !== "primary" ? ACCENT_FILL[accent] : null;
  const clases = cn(
    // La GEOMETRÍA de la casa. `nx-clip-sm` es el chaflán de control (10 px): el mismo
    // corte para los seis papeles, que es lo que los hace una familia.
    // F64 · `nx-press`: la pulsación de la casa (baja y encoge 70 ms; con movimiento reducido, destello).
    "nx-clip-sm nx-press relative inline-flex items-center justify-center gap-2",
    "font-display font-bold uppercase tracking-[0.14em]",
    "transition duration-fast",
    // El foco NO se borra sin sustituto: anillo de dos tonos, visible sobre cualquier
    // superficie del sistema. Solo con teclado, para no ensuciar el clic de ratón.
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl focus-visible:ring-offset-2 focus-visible:ring-offset-base-900",
    "disabled:cursor-not-allowed",
    isIcon ? ICON_SIZE[size] : SIZE[size],
    block && "w-full",
    // Con acento se retira el relleno de marca: dos rellenos superpuestos no son un botón.
    fill ? VARIANT[variant].replace("bg-drl ", "") : VARIANT[variant],
    className,
  );
  const estilo = fill ? { background: fill.bg, color: fill.fg, ...style } : style;

  if (href !== undefined) {
    const { disabled, ...anchor } = rest;
    return (
      <Link
        href={href}
        aria-disabled={disabled || undefined}
        className={clases}
        style={estilo}
        {...(anchor as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      // Sin `type` explícito, un botón dentro de un formulario lo envía. Es el fallo más
      // aburrido y más frecuente de una primitiva de botón.
      type={type ?? "button"}
      className={clases}
      style={estilo}
      {...rest}
    >
      {children}
    </button>
  );
});
