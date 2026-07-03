"use client";

import { useCallback, useEffect, useState } from "react";
import {
  makeOffer, cancelOffer, acceptOffer, fetchOffersForCard, fetchOffersForListing,
} from "@/lib/supabase/market";
import type { Offer } from "@/lib/supabase/types";
import { applyTax, taxPercent } from "@/domain/market/fees";
import { formatCredits, formatRelative } from "@/lib/format";

/**
 * Panel de ofertas/pujas. Si recibe `listingId` opera sobre ese listado
 * (contraoferta); si no, sobre el tipo de carta (orden de compra).
 * Muestra el neto que recibiría el vendedor tras el impuesto.
 */
export function OfferPanel({
  cardId,
  serial = null,
  listingId,
  currentUserId,
  canAccept = false,
  taxBps = 500,
  notify,
}: {
  cardId: string;
  serial?: number | null;
  listingId?: string;
  currentUserId: string;
  canAccept?: boolean;
  taxBps?: number;
  notify: (m: string, ok?: boolean) => void;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [price, setPrice] = useState(500);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = listingId ? await fetchOffersForListing(listingId) : await fetchOffersForCard(cardId);
    setOffers(data);
  }, [cardId, listingId]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true);
    const res = await makeOffer({
      kind: listingId ? "listing" : "card",
      cardId,
      serial,
      listingId,
      price,
    });
    setBusy(false);
    if (res.error) return notify(res.error, false);
    notify("Oferta enviada (créditos retenidos)", true);
    load();
  }

  async function accept(o: Offer) {
    setBusy(true);
    const res = await acceptOffer(o.id);
    setBusy(false);
    if (res.error) return notify(res.error, false);
    notify("Oferta aceptada · venta completada", true);
    load();
  }

  async function cancel(o: Offer) {
    setBusy(true);
    const res = await cancelOffer(o.id);
    setBusy(false);
    if (res.error) return notify(res.error, false);
    notify("Oferta cancelada · créditos reembolsados", true);
    load();
  }

  const net = applyTax(price, taxBps);

  return (
    <div className="rounded-lg border border-white/10 bg-base-700/30 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/40">
        Ofertas {listingId ? "a este listado" : "por esta carta"} ({offers.length})
      </p>

      <div className="mt-2 space-y-1.5">
        {offers.length === 0 && <p className="text-xs text-white/40">Sé el primero en ofertar.</p>}
        {offers.map((o) => {
          const mine = o.buyer_id === currentUserId;
          return (
            <div key={o.id} className="flex items-center justify-between rounded-md border border-white/10 bg-base-800/60 px-2.5 py-1.5">
              <span className="font-display text-sm text-white">
                🪙 {formatCredits(o.price)}
                <span className="ml-2 text-[11px] text-white/40">{formatRelative(new Date(o.created_at).getTime())}</span>
                {mine && <span className="ml-2 text-[10px] uppercase text-drl-cyan">tuya</span>}
              </span>
              {mine ? (
                <button disabled={busy} onClick={() => cancel(o)} className="rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] uppercase text-white transition hover:bg-white/10 disabled:opacity-50">
                  Cancelar
                </button>
              ) : canAccept ? (
                <button disabled={busy} onClick={() => accept(o)} className="rounded bg-gradient-to-r from-drl to-[#7b1733] px-2 py-1 text-[11px] font-bold uppercase text-white transition hover:brightness-110 disabled:opacity-50">
                  Aceptar
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-white/10 pt-3">
        <label className="flex-1">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Tu oferta 🪙</span>
          <input
            type="number"
            min={25}
            value={price}
            onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
            className="w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white focus:border-drl focus:outline-none"
          />
        </label>
        <button
          disabled={busy || price < 25}
          onClick={submit}
          className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-2.5 font-display text-sm font-bold uppercase text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
        >
          Ofertar
        </button>
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        El vendedor recibiría 🪙 {formatCredits(net.net)} (impuesto {taxPercent(taxBps)}% = 🪙 {formatCredits(net.tax)}).
      </p>
    </div>
  );
}
