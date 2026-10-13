"use client";

/**
 * READOUT — la cifra competitiva.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * OVR, créditos, XP, puntos, rango, marcador y serial son el MISMO tipo de dato, y hasta ahora
 * cada pantalla los escribía con el tamaño que le venía bien: la auditoría contó **catorce
 * tamaños de letra distintos en el vestíbulo**. La clase `.nx-readout` ya fijaba familia, peso
 * y cifras tabulares —eso estaba resuelto— pero no había escala ni una forma canónica de
 * ponerle su etiqueta encima.
 *
 * Esta primitiva es la respuesta a §10 del encargo: **la cifra tiene que reconocerse incluso
 * sin color**. Lo consigue por familia condensada, cifras tabulares, interletrado apretado y
 * una etiqueta en versalitas anchas justo encima — el contraste entre las dos cosas es la
 * firma, no el tono.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No formatea. Recibe el valor ya escrito por quien sabe formatearlo (`lib/format`), porque
 * separar millares o abreviar es una decisión de dominio, no de tipografía.
 */
import { READOUT } from "@/design/tokens";
import { cn } from "@/lib/format";
import { td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

export type ReadoutSize = keyof typeof READOUT;

export function Readout({
  value,
  label,
  unit,
  size = "md",
  tone,
  align = "left",
  className,
  ...rest
}: Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & {
  /** Ya formateado. Esta primitiva no separa millares ni abrevia. */
  value: React.ReactNode;
  /** Versalitas anchas encima. Es la mitad de la firma: sin ella es solo un número grande. */
  label?: string;
  /** Sufijo pequeño y apagado: «/ 100», «XP», «pts». */
  unit?: React.ReactNode;
  size?: ReadoutSize;
  /** Color de la cifra. Sin él hereda — que es lo correcto en la mayoría de los sitios. */
  tone?: string;
  align?: "left" | "center" | "right";
}) {
  useLocale();
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        align === "center" && "items-center text-center",
        align === "right" && "items-end text-right",
        className,
      )}
      {...rest}
    >
      {label && <span className="nx-label truncate">{td(label)}</span>}
      <span className="flex items-baseline gap-1">
        <span
          className="nx-readout"
          style={{ fontSize: READOUT[size], color: tone }}
        >
          {value}
        </span>
        {unit && (
          <span className="font-display text-[0.55em] font-bold uppercase tracking-[0.1em] text-ink-faint">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
