"use client";

/**
 * RÓTULO DE SECCIÓN — el encabezado que separa dos bloques de una pantalla.
 *
 * El patrón «versalitas anchas + filo que se desvanece + acción a la derecha» aparece en casi
 * todas las pantallas del producto, escrito a mano cada vez con un tamaño distinto (la
 * auditoría contó 39 tamaños tipográficos en el producto, y buena parte son estos rótulos).
 *
 * Usa el papel `label` de la escala tipográfica, no un `text-[10px]` elegido a ojo.
 */
import { cn } from "@/lib/format";

export function SectionTitle({
  children, action, as: Tag = "h2", className,
}: {
  children: React.ReactNode;
  /** Acción secundaria alineada a la derecha («Ver todas», un filtro). */
  action?: React.ReactNode;
  /** Nivel real del encabezado. El aspecto no decide la semántica del documento. */
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-3", className)}>
      <Tag className="font-display text-label font-bold uppercase tracking-wide2 text-ink-muted">
        {children}
      </Tag>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-edge to-transparent" />
      {action}
    </div>
  );
}
