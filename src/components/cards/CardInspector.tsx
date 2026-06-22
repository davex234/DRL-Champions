"use client";

import { motion } from "framer-motion";
import type { CardDef } from "@/domain/cards/types";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { getTeam } from "@/data/teams";
import { countryName } from "@/data/countries";
import { STAT_META, STAT_ORDER } from "@/domain/cards/ovr";
import { instanceValue } from "@/domain/economy/pricing";
import { PlayerCard } from "./PlayerCard";
import { TeamLogo } from "./layers/TeamLogo";
import { Flag } from "./layers/Flag";
import { formatCredits } from "@/lib/format";

/**
 * Vista de inspección de una carta a pantalla completa: carta grande +
 * todos los datos (jugador, equipo, región, tipo, serial, OVR y stats).
 * `children` permite inyectar acciones según el contexto (vender, comprar…).
 */
export function CardInspector({
  card,
  serial,
  onClose,
  children,
}: {
  card: CardDef;
  serial?: number;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const player = getPlayer(card.playerId);
  const variant = getVariant(card.variantId);
  if (!player) return null;
  const team = getTeam(player.team);
  const value = instanceValue(card, serial);

  return (
    <motion.div
      className="fixed inset-0 z-[75] grid place-items-center bg-black/80 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-2xl border border-white/10 bg-base-800 p-6 md:flex-row md:gap-8"
        initial={{ scale: 0.9, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Carta grande con efectos */}
        <div className="mx-auto shrink-0">
          <PlayerCard card={card} size="lg" serial={serial} effects />
        </div>

        {/* Panel de datos */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-display text-3xl font-bold uppercase leading-none text-white">
                {player.nick}
              </h2>
              {player.fullName && <p className="text-sm text-white/45">{player.fullName}</p>}
            </div>
            <button onClick={onClose} className="shrink-0 text-white/50 hover:text-white">
              ✕
            </button>
          </div>

          {/* Badges: tipo + OVR + serial */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-3 py-1 font-display text-sm font-bold uppercase tracking-wide"
              style={{ background: variant.palette.primary, color: variant.palette.text }}
            >
              {variant.label}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 font-display text-sm font-bold text-white">
              OVR {card.ovr}
            </span>
            {variant.serialized && serial != null && (
              <span className="rounded-full bg-drl/20 px-3 py-1 font-display text-sm font-bold text-drl">
                #{serial}/{variant.serialLimit}
              </span>
            )}
          </div>

          {/* Datos: equipo, región, país */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoRow label="Equipo">
              <TeamLogo team={player.team} size={20} />
              <span className="truncate">{team?.name ?? player.team}</span>
            </InfoRow>
            <InfoRow label="Región">{player.region}</InfoRow>
            <InfoRow label="País">
              <Flag iso={player.country} width={20} />
              <span className="truncate">{countryName(player.country)}</span>
            </InfoRow>
            <InfoRow label="Rol">{player.role}</InfoRow>
          </div>

          {/* Estadísticas */}
          <p className="mt-5 text-[10px] uppercase tracking-widest text-white/40">Estadísticas</p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2.5">
            {STAT_ORDER.map((key) => (
              <div key={key}>
                <div className="flex justify-between text-xs">
                  <span className="text-white/60">{STAT_META[key].full}</span>
                  <span className="font-display font-bold tabular-nums text-white">{card.stats[key]}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${card.stats[key]}%`,
                      background: variant.palette.primary,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Valor de mercado */}
          <div className="mt-5 flex items-center justify-between rounded-xl border border-drl-gold/30 bg-drl-gold/10 px-4 py-2.5">
            <span className="text-sm text-white/60">Valor de mercado</span>
            <span className="font-display text-lg font-bold text-drl-gold">🪙 {formatCredits(value)}</span>
          </div>

          {children && <div className="mt-4 space-y-2">{children}</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-base-700/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5 font-display text-sm font-semibold text-white">
        {children}
      </div>
    </div>
  );
}
