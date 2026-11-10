"use client";

/**
 * MINIATURA DE MAPA.
 *
 * Es el asset real, en pequeño. **El navegador lo redimensiona para verlo; el fichero no se
 * toca.** No hay miniaturas derivadas, ni recortes, ni conversiones: la carpeta `public/maps`
 * contiene exactamente los doce maestros y nada más.
 *
 * TRES DECISIONES
 *
 *  1. **`object-contain`, nunca `cover`.** Los doce mapas tienen proporciones distintas
 *     (0,922 a 1,113). `cover` llenaría la tarjeta recortando el mapa, y un mapa recortado
 *     en un selector es un mapa que no se reconoce. `contain` deja margen y respeta el
 *     ratio original.
 *  2. **`loading="lazy"`.** Doce PNG son 13 MB. Sin esto, abrir el selector se los descarga
 *     todos de golpe aunque solo se vean tres. Con esto, baja lo que entra en pantalla.
 *  3. **`aria-hidden`.** La tarjeta ya dice el nombre del mapa en texto; que un lector de
 *     pantalla lo repita como imagen no aporta nada.
 */
import { type TacticalMap, aspectRatio } from "@/domain/tactics";
import { mapImageSrc, mapThumbSrc } from "@/lib/assets";
import { cn } from "@/lib/format";

export function MapThumb({
  map,
  className,
  /** `eager` solo para el mapa ya seleccionado, que se ve sí o sí. */
  priority = false,
  full = false,
}: {
  map: TacticalMap;
  className?: string;
  priority?: boolean;
  /** FASE 51 · el PNG original en vez de la miniatura WebP (solo donde se ve grande). */
  full?: boolean;
}) {
  return (
    <img
      src={full ? mapImageSrc(map.asset) : mapThumbSrc(map.asset)}
      alt=""
      aria-hidden
      width={map.width}
      height={map.height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      style={{ aspectRatio: String(aspectRatio(map)) }}
      className={cn("block h-full w-full object-contain", className)}
    />
  );
}
