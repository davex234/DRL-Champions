"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { PriceChart } from "./PriceChart";
import { OfferPanel } from "./OfferPanel";
import {
  fetchListingsForCard, fetchCardPriceStats, buyListingOnline,
} from "@/lib/supabase/market";
import type { Listing, CardPriceStats } from "@/lib/supabase/types";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { applyTax, dealScore } from "@/domain/market/fees";
import { marketValue } from "@/domain/economy/pricing";
import { formatCredits, formatRelative } from "@/lib/format";

/**
 * Ficha de detalle del mercado global: gráfica de evolución, estadísticas de
 * precio, listados activos (compra directa) y ofertas/pujas por la carta.
 */
export function OnlineCardDetail({
  cardId,
  currentUserId,
  ownsMatching,
  taxBps = 500,
  onClose,
  onChanged,
  notify,
}: {
  cardId: string;
  currentUserId: string;
  /** ¿El usuario posee una carta de este tipo (puede aceptar ofertas)? */
  ownsMatching: boolean;
  taxBps?: number;
  onClose: () => void;
  onChanged: () => void;
  notify: (m: string, ok?: boolean) => void;
}) {
  const def = getCard(cardId);
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<CardPriceStats | null>(null);

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([fetchListingsForCard(cardId), fetchCardPriceStats(cardId)]);
    setListings(l);
    setStats(s);
  }, [cardId]);
  useEffect(() => { load(); }, [load]);

  if (!def) return null;
  const player = getPlayer(def.playerId);
  const variant = getVariant(def.variantId);
  const fair = marketValue(def);

  async function buy(l: Listing) {
    const res = await buyListingOnline(l.id);
    if (res.error) return notify(res.error, false);
    notify("¡Carta comprada en el mercado global!", true);
    load();
    onChanged();
  }

  return (
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
    >
      <motion.div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-2xl border border-white/10 bg-base-800 p-6 md:flex-row"
        initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto shrink-0">
          <PlayerCard card={def} size="lg" serial={listings[0]?.serial ?? undefined} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-display text-2xl font-bold uppercase text-white">{player?.nick}</h3>
              <p className="text-sm" style={{ color: variant.palette.primary }}>
                {variant.label} · OVR {def.ovr} · {player?.team} · {player?.region}
              </p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
          </div>

          {/* Estadísticas de precio */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Última" value={stats?.last_price ?? undefined} />
            <Stat label="Media" value={stats?.avg_price ?? undefined} />
            <Stat label="Mín" value={stats?.min_price ?? undefined} accent="#37e6a0" />
            <Stat label="Máx" value={stats?.max_price ?? undefined} accent="#ff5c8a" />
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            Valor justo de referencia 🪙 {formatCredits(fair)}
            {stats?.trade_count ? ` · ${stats.trade_count} ventas · volumen 🪙 ${formatCredits(stats.volume)}` : ""}
          </p>

          {/* Gráfica de evolución */}
          <div className="mt-4">
            <PriceChart cardId={cardId} />
          </div>

          {/* Listados a la venta */}
          <p className="mt-5 text-[10px] uppercase tracking-widest text-white/40">A la venta ahora ({listings.length})</p>
          <div className="mt-2 space-y-2">
            {listings.length === 0 && <p className="text-sm text-white/40">Nadie vende esta carta ahora mismo.</p>}
            {listings.slice(0, 6).map((l) => {
              const deal = dealScore(l.price, fair);
              const isMine = l.seller_id === currentUserId;
              return (
                <div key={l.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-base-700/50 px-3 py-2">
                  <span className="font-display text-sm text-white">
                    {l.serial != null ? `#${l.serial}` : "Sin serie"}
                    <span className="ml-2 text-xs text-white/40">{formatRelative(new Date(l.created_at).getTime())}</span>
                    {deal != null && (
                      <span className={`ml-2 text-[11px] ${deal < 1 ? "text-drl-cyan" : "text-white/40"}`}>×{deal}</span>
                    )}
                  </span>
                  {isMine ? (
                    <span className="text-xs text-white/40">Tuya</span>
                  ) : (
                    <button onClick={() => buy(l)} className="rounded-lg bg-gradient-to-r from-drl to-[#7b1733] px-3 py-1 font-display text-xs font-bold uppercase text-white shadow-glow transition hover:brightness-110">
                      Comprar 🪙 {formatCredits(l.price)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ofertas por la carta */}
          <div className="mt-5">
            <OfferPanel
              cardId={cardId}
              currentUserId={currentUserId}
              canAccept={ownsMatching}
              taxBps={taxBps}
              notify={(m, ok) => { notify(m, ok); load(); onChanged(); }}
            />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, value, accent = "#ffffff" }: { label: string; value?: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-base-700/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="font-display text-sm font-bold" style={{ color: accent }}>
        🪙 {value != null ? formatCredits(value) : "—"}
      </p>
    </div>
  );
}
