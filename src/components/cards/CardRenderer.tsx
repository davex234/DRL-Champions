"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { Player, PlayerStats, VariantDef } from "@/domain/cards/types";
import { STAT_META, STAT_ORDER } from "@/domain/cards/ovr";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { PlayerPhoto } from "./layers/PlayerPhoto";
import { TeamLogo } from "./layers/TeamLogo";
import { Flag } from "./layers/Flag";
import { SerialBadge } from "./layers/SerialBadge";
import { CardEffects } from "./CardEffects";

export type CardSize = "sm" | "md" | "lg" | "xl";

const SIZE_W: Record<CardSize, string> = {
  sm: "w-[150px]",
  md: "w-[230px]",
  lg: "w-[300px]",
  xl: "w-[360px]",
};

const OVR_SIZE: Record<CardSize, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
  xl: "text-6xl",
};

const NAME_SIZE: Record<CardSize, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
  xl: "text-3xl",
};

/**
 * Renderizador de cartas por CAPAS (el motor visual del juego):
 * Plantilla + Foto jugador + Logo equipo + Bandera + OVR + Stats + Serial + Nombre.
 * Construye la carta dinámicamente a partir de jugador + variante + stats + serial.
 */
export function CardRenderer({
  player,
  variant,
  stats,
  ovr,
  serial,
  size = "md",
  interactive = true,
  showStats = true,
  effects,
  className,
}: {
  player: Player;
  variant: VariantDef;
  stats: PlayerStats;
  ovr: number;
  serial?: number;
  size?: CardSize;
  interactive?: boolean;
  showStats?: boolean;
  /** Activa efectos caros (partículas/rayos). Por defecto en tamaños grandes. */
  effects?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const palette = variant.palette;
  const rich = effects ?? (size === "lg" || size === "xl");
  const showLogo = size !== "sm";
  const showCardStats = showStats && size !== "sm";

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotX = useSpring(useTransform(my, [-0.5, 0.5], [11, -11]), { stiffness: 200, damping: 18 });
  const rotY = useSpring(useTransform(mx, [-0.5, 0.5], [-13, 13]), { stiffness: 200, damping: 18 });
  const shineX = useTransform(mx, [-0.5, 0.5], ["0%", "100%"]);
  const shineY = useTransform(my, [-0.5, 0.5], ["0%", "100%"]);
  const shineBg = useTransform(
    [shineX, shineY],
    ([x, y]: string[]) =>
      `radial-gradient(circle at ${x} ${y}, rgba(255,255,255,0.4), transparent 45%)`,
  );

  function onMove(e: React.PointerEvent) {
    if (!interactive || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
  }

  const isHolo = variant.rank >= 6;

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={interactive ? { rotateX: rotX, rotateY: rotY, transformPerspective: 900 } : undefined}
      className={cn("relative select-none", SIZE_W[size], className)}
    >
      {/* Halo exterior para alta rareza */}
      {isHolo && (
        <div
          className="absolute -inset-2 -z-10 rounded-3xl opacity-60 blur-xl"
          style={{ background: palette.primary }}
        />
      )}

      <div
        className="relative aspect-[5/7] overflow-hidden rounded-2xl border-2 shadow-card"
        style={{ borderColor: palette.primary, background: palette.background, color: palette.text }}
      >
        {/* CAPA: foto del jugador */}
        <div className="absolute inset-x-0 bottom-[30%] top-[6%]">
          <div className="relative mx-auto h-full w-[88%]">
            <PlayerPhoto player={player} palette={palette} />
          </div>
        </div>

        {/* Degradado inferior para legibilidad del texto */}
        <div
          className="absolute inset-x-0 bottom-0 h-[46%]"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.15) 55%, transparent)" }}
        />

        {/* CAPA: efectos por rareza */}
        <CardEffects variant={variant} rich={rich} />

        {/* CAPA: brillo dinámico que sigue al puntero */}
        {interactive && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{ background: shineBg }}
          />
        )}

        {/* CAPA: columna izquierda — OVR · rol · bandera · logo */}
        <div className="absolute left-0 top-0 z-10 flex flex-col items-center gap-1 px-2.5 py-2">
          <span className={cn("font-display font-bold leading-none", OVR_SIZE[size])}>{ovr}</span>
          <span className="font-display text-[10px] font-semibold uppercase tracking-wider opacity-85">
            {ROLE_ABBR[player.role] ?? player.role}
          </span>
          <Flag iso={player.country} width={size === "sm" ? 18 : 24} />
          {showLogo && <TeamLogo team={player.team} size={size === "lg" || size === "xl" ? 30 : 24} />}
        </div>

        {/* CAPA: número de serie */}
        {variant.serialized && serial != null && (
          <div className="absolute right-2 top-2 z-10">
            <SerialBadge
              serial={serial}
              limit={variant.serialLimit ?? 0}
              palette={palette}
              size={size === "sm" ? "sm" : "md"}
            />
          </div>
        )}

        {/* CAPA: nombre + variante + stats */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2.5 pt-4">
          <div className="mb-1 h-px w-full opacity-40" style={{ background: palette.text }} />
          <p
            className={cn(
              "truncate text-center font-display font-bold uppercase leading-none tracking-wide text-white",
              NAME_SIZE[size],
            )}
            style={{ textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}
          >
            {player.nick}
          </p>
          <p className="mt-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-white/80">
            {variant.label}
          </p>

          {showCardStats && (
            <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
              {STAT_ORDER.map((key) => (
                <div key={key} className="flex items-center justify-between text-[11px] text-white">
                  <span className="font-semibold opacity-75">{STAT_META[key].label}</span>
                  <span className="font-display font-bold tabular-nums">{stats[key]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
