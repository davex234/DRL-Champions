"use client";

/**
 * REVERSO DE LA CARTA NEXUS (Fase 37). Diseño ORIGINAL: geometría del sistema (hexágono, chaflán, retícula), sin
 * logos ni arte de terceros. Solo hechos del catálogo: jugador, equipo, rol, región, edición, rareza, OVR, las tres
 * stats de combate y el identificador de la definición. Sin biografía ni historia inventada.
 */
import type { CardDef, Player } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { canonicalCardTeam } from "@/data/teamIdentities";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { BUCKET_LABEL, rarityOf } from "@/domain/collection/room";
import { cn } from "@/lib/format";

export function CardBack({ def, player, className }: { def: CardDef; player: Player; className?: string }) {
  const variant = getVariant(def.variantId);
  const rarity = rarityOf(def);
  return (
    <div
      role="img"
      aria-label={`Reverso de la carta ${player.nick}: ${variant.label}, ${BUCKET_LABEL[rarity]}, OVR ${def.ovr}`}
      data-testid="card-back"
      className={cn("nx-clip relative flex aspect-[5/7] w-full flex-col overflow-hidden border border-white/15 p-[7%] text-white shadow-card", className)}
      style={{ background: "linear-gradient(155deg, rgba(20,24,40,0.98), rgba(6,8,14,1) 70%)", ["--nx-chamfer" as string]: "18px" }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-25" />
      <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute left-1/2 top-[38%] w-[70%] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]">
        <polygon points="50,4 92,28 92,72 50,96 8,72 8,28" fill="none" stroke="white" strokeWidth="1.2" />
        <polygon points="50,18 80,35 80,65 50,82 20,65 20,35" fill="none" stroke="white" strokeWidth="0.8" />
        <path d="M20 35 L50 50 L80 35 M50 50 L50 82" fill="none" stroke="white" strokeWidth="0.8" />
      </svg>

      <div className="relative flex items-start justify-between gap-2">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">NEXUS</span>
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">{BUCKET_LABEL[rarity]}</span>
      </div>

      <div className="relative mt-auto">
        <p className="font-display text-[clamp(18px,4.2cqw,26px)] font-bold uppercase leading-none">{player.nick}</p>
        <p className="mt-1 truncate text-[12px] text-white/70">{canonicalCardTeam(def, player).label} · {def.role ?? player.role} · {player.region}</p>
        <p className="mt-0.5 truncate text-[12px] text-white/55">{variant.label}</p>

        <dl className="mt-3 grid grid-cols-4 gap-1.5 border-t border-white/15 pt-3">
          <div>
            <dt className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">OVR</dt>
            <dd className="nx-readout text-[18px] leading-tight">{def.ovr}</dd>
          </div>
          {COMBAT_STAT_ORDER.map((k) => (
            <div key={k}>
              <dt className="truncate font-display text-[10px] font-bold uppercase tracking-[0.12em] text-white/50">{COMBAT_STAT_META[k].label}</dt>
              <dd className="nx-readout text-[18px] leading-tight">{def.combat?.[k] ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 truncate font-mono text-[10px] text-white/45">{def.id}</p>
      </div>
    </div>
  );
}
