"use client";

/**
 * F82 · INSIGNIA. Un escudo con el lenguaje visual de Valorosters (chaflán, borde y halo del acento) alrededor del
 * LOGO REAL del equipo, que se pinta tal cual: sin recolorear, sin recortar, sin filtros sobre él. Las insignias de
 * edición y de maestría (sin logo oficial) llevan un glifo propio — nunca un logo inventado.
 *
 * Bloqueada = borde apagado + logo atenuado + candado + la palabra «Bloqueada» (no se depende solo del color). Ningún
 * `filter` en la cadena del <img>: el halo es un hermano detrás del escudo, así el logo no cambia de color.
 */
import { cn } from "@/lib/format";
import type { BadgeFact } from "@/domain/collectionSets/badges";
import { regionOfBadgeId } from "@/domain/teamCollections/model";
import { RegionEmblem } from "./RegionEmblem";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("trophies");

const SIZE = { sm: 44, md: 72, lg: 128, xl: 176 } as const;
export type BadgeSize = keyof typeof SIZE;

const SHIELD = "polygon(50% 0, 100% 14%, 100% 64%, 50% 100%, 0 64%, 0 14%)";

export function TrophyBadge({ badge, size = "md", locked = false, className, showLabel = false, monogram }: {
  badge: Pick<BadgeFact, "id" | "label" | "logo" | "color" | "kind" | "caption">;
  size?: BadgeSize;
  locked?: boolean;
  className?: string;
  showLabel?: boolean;
  /** Equipo sin logo en el producto: su etiqueta corta en vez del glifo. Nunca un logo inventado. */
  monogram?: string;
}) {
  useLocale();
  const px = SIZE[size];
  // F86 · el trofeo de campeón de torneo lleva corona; el resto, su glifo de siempre.
  const glyph = badge.kind === "EDITION" ? "★" : badge.kind === "TOURNAMENT" ? "♛" : "◆";
  // Insignia regional: su emblema (silueta propia de la región), igual que en Colecciones.
  const region = badge.kind === "REGION" ? regionOfBadgeId(badge.id) : null;
  return (
    <figure className={cn("m-0 inline-flex flex-col items-center gap-1.5", className)} data-testid="trophy-badge" data-badge={badge.id} data-locked={locked ? "1" : "0"}>
      <div className="relative grid place-items-center" style={{ width: px, height: px * 1.12 }}>
        {!locked && <div aria-hidden className="absolute -inset-[18%]" style={{ background: `radial-gradient(50% 50% at 50% 50%, ${badge.color}55, transparent 70%)` }} />}
        {/* Borde: el acento por fuera, el fondo oscuro por dentro (el logo siempre sobre neutro, legible). */}
        <div aria-hidden className="absolute inset-0" style={{ clipPath: SHIELD, background: locked ? "rgba(255,255,255,0.18)" : `linear-gradient(160deg, ${badge.color}, rgba(255,255,255,0.25) 45%, ${badge.color}aa)` }} />
        <div aria-hidden className="absolute" style={{ inset: Math.max(2, Math.round(px / 28)), clipPath: SHIELD, background: "radial-gradient(70% 60% at 50% 35%, rgba(255,255,255,0.10), rgba(7,8,14,0.96) 70%)" }} />
        {badge.logo ? (
          <img src={badge.logo} alt={t("Escudo de {label}", { label: td(badge.label) })} width={Math.round(px * 0.58)} height={Math.round(px * 0.58)}
            className="relative object-contain" style={{ width: px * 0.58, height: px * 0.58, opacity: locked ? 0.45 : 1 }} draggable={false} />
        ) : region ? (
          <span className="relative" style={{ opacity: locked ? 0.5 : 1, marginTop: -px * 0.06 }}><RegionEmblem region={region} size={Math.round(px * 0.6)} color={locked ? "#c9d1e0" : badge.color} /></span>
        ) : (
          <span aria-hidden className="relative font-display font-black uppercase" style={{ fontSize: monogram ? px * Math.min(0.3, 0.92 / Math.max(3, monogram.length)) : px * 0.36, color: locked ? "rgba(255,255,255,0.4)" : badge.color }}>{monogram ?? glyph}</span>
        )}
        {locked && (
          <span aria-hidden className="absolute -bottom-0.5 -right-1 grid place-items-center rounded-full bg-black/85 text-white/80 ring-1 ring-white/25" style={{ width: Math.max(16, px / 4), height: Math.max(16, px / 4), fontSize: Math.max(9, px / 8) }}>🔒</span>
        )}
      </div>
      {showLabel && (
        <figcaption className="max-w-[10rem] text-center leading-tight">
          <span className="block truncate font-display text-[13px] font-bold uppercase tracking-wide text-white">{td(badge.label)}</span>
          <span className="block text-[11px] text-white/55">{locked ? t("Bloqueada") : td(badge.caption)}</span>
        </figcaption>
      )}
      {!showLabel && <figcaption className="sr-only">{td(badge.label)}{locked ? (" " + t("(bloqueada)")) : ""}</figcaption>}
    </figure>
  );
}
