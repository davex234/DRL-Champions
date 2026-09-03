"use client";

/**
 * CARTA EN VISTA DE DUELO (Fase 8).
 *
 * Reutiliza la identidad visual que ya existe —la paleta de la variante (`getVariant`) y la capa de
 * retrato con sigilo de reserva (`PlayerPhoto`)— y cambia solo lo que el duelo necesita: en vez de las
 * seis estadísticas de colección, el TRÍO DE COMBATE, que es lo único que se compara.
 *
 * Los números vienen del servidor dentro del DTO. Aquí no se calcula ni se ajusta ninguno.
 */
import { memo } from "react";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";
import { PlayerPhoto } from "@/components/cards/layers/PlayerPhoto";
import { STAT_INFO, type CombatStatKey, type DuelDeckCardDTO } from "@/lib/duel/types";

export type DuelCardSize = "xs" | "sm" | "md" | "lg";

const WIDTH: Record<DuelCardSize, string> = {
  xs: "w-[54px]",
  sm: "w-[84px]",
  md: "w-[116px]",
  lg: "w-[168px]",
};
const OVR_SIZE: Record<DuelCardSize, string> = {
  xs: "text-[13px]",
  sm: "text-xl",
  md: "text-[26px]",
  lg: "text-4xl",
};
const NAME_SIZE: Record<DuelCardSize, string> = {
  xs: "text-[7px]",
  sm: "text-[10px]",
  md: "text-[13px]",
  lg: "text-lg",
};

export interface DuelCardProps {
  card: DuelDeckCardDTO;
  size?: DuelCardSize;
  /** Resalta la estadística declarada en este enfrentamiento. */
  highlightStat?: CombatStatKey | null;
  selected?: boolean;
  /** Ya jugada: se apaga y deja de ser elegible. */
  used?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

function DuelCardBase({
  card, size = "md", highlightStat = null, selected = false, used = false, disabled = false,
  onClick, className,
}: DuelCardProps) {
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  const palette = variant.palette;
  const showStats = size !== "xs";
  const interactive = Boolean(onClick) && !disabled && !used;

  const body = (
    <div
      className={cn(
        "relative aspect-[5/7] overflow-hidden rounded-xl border-2 transition",
        used && "grayscale-[0.85] brightness-[0.55]",
        selected && "ring-2 ring-drl ring-offset-2 ring-offset-base-900",
      )}
      style={{ borderColor: palette.primary, background: palette.background, color: palette.text }}
    >
      {/* Capa de foto: la misma del resto del juego, con su silueta de reserva. */}
      <div className="absolute inset-x-[6%] bottom-[30%] top-[6%]">
        {player ? (
          <PlayerPhoto player={player} palette={palette} rank={variant.rank} />
        ) : (
          <div className="grid h-full place-items-center font-display text-xl font-bold opacity-80">
            {card.nick.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-[48%]"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.18) 55%, transparent)" }}
      />

      {/* OVR · rol · país */}
      <div className="absolute left-0 top-0 z-10 flex flex-col items-center gap-0.5 px-1.5 py-1">
        <span className={cn("font-display font-bold leading-none", OVR_SIZE[size])}>{card.ovr}</span>
        {size !== "xs" && (
          <span className="font-display text-[8px] font-bold uppercase tracking-wider opacity-85">
            {ROLE_ABBR[card.role] ?? card.role}
          </span>
        )}
        {size !== "xs" && card.country && (
          <span className="rounded border border-current px-1 text-[7px] font-bold uppercase opacity-75">
            {card.country}
          </span>
        )}
      </div>

      {card.serial != null && size !== "xs" && (
        <span className="absolute right-1 top-1 z-10 rounded bg-black/50 px-1 text-[8px] font-bold text-white">
          #{card.serial}
        </span>
      )}

      {used && (
        <span className="absolute inset-0 z-20 grid place-items-center bg-base-900/55 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-white/80">
          Usada
        </span>
      )}

      {/* Nombre · variante · trío de combate */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-1.5 pb-1.5 pt-3">
        <div className="mb-0.5 h-px w-full opacity-40" style={{ background: palette.text }} />
        <p
          className={cn(
            "truncate text-center font-display font-bold uppercase leading-none text-white",
            NAME_SIZE[size],
          )}
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}
        >
          {card.nick}
        </p>
        {size !== "xs" && (
          <p className="mt-0.5 truncate text-center text-[7px] font-bold uppercase tracking-[0.14em] text-white/75">
            {variant.label}
          </p>
        )}
        {showStats && (
          <div className="mt-1 grid grid-cols-3 gap-x-1">
            {(Object.keys(STAT_INFO) as CombatStatKey[]).map((k) => {
              const on = highlightStat === k;
              return (
                <div
                  key={k}
                  className={cn(
                    "flex items-center justify-center gap-0.5 rounded-[3px] px-0.5 transition",
                    on && "bg-white/20 ring-1 ring-white/40",
                  )}
                >
                  <span
                    className="text-[7px] font-extrabold leading-none"
                    style={{ color: STAT_INFO[k].color }}
                  >
                    {STAT_INFO[k].abbr}
                  </span>
                  <span className="font-display text-[11px] font-bold leading-none text-white">
                    {card.combat[k]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (!interactive) {
    return <div className={cn(WIDTH[size], "shrink-0", disabled && "opacity-50", className)}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${card.nick}, ${card.role}, OVR ${card.ovr}`}
      className={cn(
        WIDTH[size],
        "shrink-0 rounded-xl transition hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl",
        "motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {body}
    </button>
  );
}

export const DuelCard = memo(DuelCardBase);

/** Reverso: lo que ves de una carta del rival que todavía no ha jugado. */
export function DuelCardBack({ size = "md", className }: { size?: DuelCardSize; className?: string }) {
  return (
    <div className={cn(WIDTH[size], "shrink-0", className)}>
      <div className="relative aspect-[5/7] overflow-hidden rounded-xl border-2 border-drl/30 bg-gradient-to-br from-base-600 to-base-900">
        <div className="absolute inset-2 rounded-md border border-drl/25" />
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-lg font-bold text-drl/50">?</span>
        </div>
      </div>
    </div>
  );
}
