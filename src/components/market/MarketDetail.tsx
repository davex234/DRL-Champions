"use client";

import { motion } from "framer-motion";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { TrendBadge } from "./TrendBadge";
import { useMarketStore } from "@/store/useMarketStore";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { formatCredits, formatRelative } from "@/lib/format";

export function MarketDetail({
  cardId,
  onClose,
  onBuy,
}: {
  cardId: string;
  onClose: () => void;
  onBuy: (listingId: string) => void;
}) {
  const listings = useMarketStore((s) => s.listings);
  const record = useMarketStore((s) => s.priceHistory[cardId]);
  const def = getCard(cardId);
  if (!def) return null;
  const player = getPlayer(def.playerId);
  const variant = getVariant(def.variantId);

  const forSale = listings
    .filter((l) => l.cardId === cardId && l.seller === "bot")
    .sort((a, b) => a.price - b.price);

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-6 overflow-y-auto rounded-2xl border border-white/10 bg-base-800 p-6 md:flex-row"
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto shrink-0">
          <PlayerCard card={def} size="lg" serial={forSale[0]?.serial} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-display text-2xl font-bold uppercase text-white">{player?.nick}</h3>
              <p className="text-sm" style={{ color: variant.palette.primary }}>
                {variant.label} · OVR {def.ovr} · {player?.team} · {player?.region}
              </p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white">
              ✕
            </button>
          </div>

          {/* Estadísticas de precio */}
          <div className="mt-4 flex items-center gap-2">
            <TrendBadge record={record} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <PriceStat label="Última venta" value={record?.lastSale} />
            <PriceStat label="Precio medio" value={record?.avg} />
            <PriceStat label="Mínimo" value={record?.min} accent="#37e6a0" />
            <PriceStat label="Máximo" value={record?.max} accent="#ff5c8a" />
          </div>

          {/* Listados a la venta */}
          <p className="mt-5 text-[10px] uppercase tracking-widest text-white/40">
            A la venta ahora ({forSale.length})
          </p>
          <div className="mt-2 space-y-2">
            {forSale.length === 0 && (
              <p className="text-sm text-white/40">Nadie vende esta carta ahora mismo.</p>
            )}
            {forSale.slice(0, 6).map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-base-700/50 px-3 py-2"
              >
                <span className="font-display text-sm text-white">
                  {l.serial != null ? `#${l.serial}/${variant.serialLimit}` : "Sin serie"}
                  <span className="ml-2 text-xs text-white/40">{formatRelative(l.listedAt)}</span>
                </span>
                <button
                  onClick={() => onBuy(l.id)}
                  className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1 font-display text-xs font-bold uppercase text-white shadow-glow transition hover:brightness-110"
                >
                  Comprar 🪙 {formatCredits(l.price)}
                </button>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PriceStat({ label, value, accent = "#ffffff" }: { label: string; value?: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-base-700/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="font-display text-lg font-bold" style={{ color: accent }}>
        🪙 {value != null ? formatCredits(value) : "—"}
      </p>
    </div>
  );
}
