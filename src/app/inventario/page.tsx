"use client";

import { useMemo } from "react";
import Link from "next/link";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { useGameStore } from "@/store/useGameStore";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { duplicates } from "@/store/selectors";
import { quickSellValue } from "@/domain/economy/pricing";
import { formatCredits } from "@/lib/format";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";

export default function InventarioPage() {
  return (
    <HydrationGate>
      <Inventory />
    </HydrationGate>
  );
}

function Inventory() {
  const { toast, notify } = useToast();
  const unopenedPacks = useGameStore((s) => s.unopenedPacks);
  const ownedCards = useGameStore((s) => s.ownedCards);
  const quickSellMany = useGameStore((s) => s.quickSellMany);

  const packEntries = Object.entries(unopenedPacks).filter(([, n]) => n > 0);
  const dups = useMemo(() => duplicates(ownedCards), [ownedCards]);
  const dupsValue = useMemo(
    () =>
      dups.reduce((s, d) => {
        const def = getCard(d.cardId);
        return s + (def ? quickSellValue(def, d.serial) : 0);
      }, 0),
    [dups],
  );

  return (
    <section className="animate-rise space-y-10">
      <header>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Inventario
        </h1>
        <p className="mt-1 text-white/50">Tus sobres sin abrir y tus cartas duplicadas.</p>
      </header>

      {/* Sobres sin abrir */}
      <div>
        <h2 className="mb-4 font-display text-xl font-bold uppercase tracking-wide text-white">
          Sobres sin abrir
        </h2>
        {packEntries.length === 0 ? (
          <Empty cta>No tienes sobres sin abrir.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {packEntries.map(([packId, count]) => {
              const pack = getPack(packId);
              if (!pack) return null;
              return (
                <Link
                  key={packId}
                  href={`/abrir/${packId}`}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-4 transition hover:-translate-y-1"
                >
                  <div
                    className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-50"
                    style={{ background: pack.accent }}
                  />
                  <div
                    className="mx-auto grid h-24 w-16 place-items-center rounded-lg border font-display text-2xl font-bold text-white"
                    style={{ borderColor: pack.accent, background: `linear-gradient(160deg,#11131f,#06070d)` }}
                  >
                    D
                  </div>
                  <p className="mt-3 text-center font-display text-sm font-bold uppercase text-white">
                    {pack.name}
                  </p>
                  <p className="text-center text-xs text-white/40">x{count} · toca para abrir</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Duplicados */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
            Duplicados <span className="text-white/40">({dups.length})</span>
          </h2>
          {dups.length > 0 && (
            <button
              onClick={() => {
                quickSellMany(dups.map((d) => d.uid));
                notify(`Vendidos ${dups.length} duplicados por 🪙 ${formatCredits(dupsValue)}`, true);
              }}
              className="rounded-xl bg-gradient-to-r from-drl-gold to-[#b8860b] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-[#2a2000] shadow-glow-gold transition hover:brightness-110"
            >
              Vender todos · 🪙 {formatCredits(dupsValue)}
            </button>
          )}
        </div>
        {dups.length === 0 ? (
          <Empty>No tienes cartas duplicadas.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {dups.map((d) => {
              const def = getCard(d.cardId);
              if (!def) return null;
              return <PlayerCard key={d.uid} card={def} size="sm" interactive={false} serial={d.serial} />;
            })}
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </section>
  );
}

function Empty({ children, cta }: { children: React.ReactNode; cta?: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-10 text-center">
      <p className="text-white/50">{children}</p>
      {cta && (
        <Link
          href="/tienda"
          className="mt-3 inline-block rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm uppercase tracking-wide text-white shadow-glow"
        >
          Ir a la tienda
        </Link>
      )}
    </div>
  );
}
