"use client";

/**
 * MINIATURA DE MAPA (Fase 9.5).
 *
 * El vestíbulo del entrenador enseñaba los cuatro trazados como cuatro párrafos de texto.
 * En una herramienta táctica, no ver ni un mapa es el equivalente a una tienda sin
 * escaparate: existen cuatro mapas dibujados y no se veía ninguno.
 *
 * NO es `StrategyBoard` en pequeño. La pizarra es un EDITOR: rejilla, etiquetas de zona,
 * fichas arrastrables, tiradores de flecha y manejo de puntero. Nada de eso sirve a 120 px
 * ni debe pagarse cuatro veces solo para enseñar una forma. Esto dibuja el trazado y para.
 */
import { ZONE_COLOR, type TacticalMap } from "@/domain/tactics";
import { cn } from "@/lib/format";

export function MapThumb({
  map,
  className,
}: {
  map: TacticalMap;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("block h-full w-full", className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="0" y="0" width="100" height="100" fill="#080a12" />

      {map.zones.map((z) => {
        const color = ZONE_COLOR[z.kind];
        return (
          <polygon
            key={z.id}
            points={z.polygon.map(([x, y]) => `${x},${y}`).join(" ")}
            fill={color}
            // Los sitios de plantado son el punto de referencia del mapa: destacan.
            fillOpacity={z.kind === "site" ? 0.34 : z.kind === "choke" ? 0.24 : 0.1}
            stroke={color}
            strokeOpacity={0.55}
            strokeWidth="0.6"
          />
        );
      })}
    </svg>
  );
}
