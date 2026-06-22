"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { PackDef, RarityBucket } from "@/domain/packs/types";
import { BUCKET_LABEL } from "@/domain/packs/types";
import { useGameStore } from "@/store/useGameStore";
import { formatCredits } from "@/lib/format";

const BUCKET_COLOR: Record<RarityBucket, string> = {
  common: "#8b96a3",
  uncommon: "#ffce4f",
  rare: "#19e3ff",
  epic: "#ff2e63",
  legendary: "#ffd35c",
};

const BUCKET_ORDER: RarityBucket[] = ["common", "uncommon", "rare", "epic", "legendary"];

export function PackStoreCard({
  pack,
  onNotify,
}: {
  pack: PackDef;
  onNotify: (msg: string, ok: boolean) => void;
}) {
  const router = useRouter();
  const credits = useGameStore((s) => s.credits);
  const owned = useGameStore((s) => s.unopenedPacks[pack.id] ?? 0);
  const buyPack = useGameStore((s) => s.buyPack);

  const totalWeight = BUCKET_ORDER.reduce((s, b) => s + pack.weights[b], 0);
  const canAfford = credits >= pack.price;

  function handleBuy() {
    const res = buyPack(pack.id);
    if (!res.ok) onNotify(res.error ?? "Error", false);
    else onNotify(`${pack.name} comprado`, true);
  }

  function handleBuyAndOpen() {
    if (owned > 0) {
      router.push(`/abrir/${pack.id}`);
      return;
    }
    const res = buyPack(pack.id);
    if (!res.ok) {
      onNotify(res.error ?? "Error", false);
      return;
    }
    router.push(`/abrir/${pack.id}`);
  }

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-base-700/50 p-5"
    >
      {/* Resplandor */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
        style={{ background: pack.accent }}
      />

      <div className="flex items-start justify-between">
        <div>
          {pack.tag && (
            <span
              className="rounded-full px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider"
              style={{ background: `${pack.accent}22`, color: pack.accent }}
            >
              {pack.tag}
            </span>
          )}
          <h3 className="mt-2 font-display text-xl font-bold uppercase tracking-wide text-white">
            {pack.name}
          </h3>
        </div>
        {owned > 0 && (
          <span className="rounded-full bg-drl-cyan/20 px-2 py-1 font-display text-xs font-bold text-drl-cyan">
            x{owned}
          </span>
        )}
      </div>

      <p className="mt-2 min-h-[40px] text-sm text-white/55">{pack.description}</p>

      {/* Mini-arte del sobre */}
      <div
        className="relative my-4 grid h-28 place-items-center overflow-hidden rounded-xl border"
        style={{ borderColor: `${pack.accent}55`, background: `linear-gradient(160deg, #11131f, #06070d)` }}
      >
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div
          className="grid h-12 w-12 place-items-center rounded-lg font-display text-2xl font-bold text-white"
          style={{ background: `linear-gradient(135deg, ${pack.accent}, #7b1733)` }}
        >
          D
        </div>
        <span className="absolute bottom-2 text-[10px] uppercase tracking-widest text-white/40">
          {pack.cardCount} cartas
        </span>
      </div>

      {/* Probabilidades */}
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
        <span>Probabilidades</span>
        {pack.guaranteedMin && (
          <span style={{ color: BUCKET_COLOR[pack.guaranteedMin] }}>
            {BUCKET_LABEL[pack.guaranteedMin]}+ garantizada
          </span>
        )}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {BUCKET_ORDER.map((b) =>
          pack.weights[b] > 0 ? (
            <div
              key={b}
              title={`${BUCKET_LABEL[b]}: ${((pack.weights[b] / totalWeight) * 100).toFixed(1)}%`}
              style={{ width: `${(pack.weights[b] / totalWeight) * 100}%`, background: BUCKET_COLOR[b] }}
            />
          ) : null,
        )}
      </div>

      {/* Acciones */}
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={handleBuyAndOpen}
          disabled={owned === 0 && !canAfford}
          className="flex-1 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {owned > 0 ? "Abrir" : pack.price === 0 ? "Conseguir y abrir" : "Comprar y abrir"}
        </button>
        {pack.price > 0 && (
          <button
            onClick={handleBuy}
            disabled={!canAfford}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-display text-sm uppercase tracking-wide text-white transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        )}
      </div>
      <p className="mt-2 text-center font-display text-sm font-bold text-drl-gold">
        {pack.price === 0 ? "GRATIS" : `🪙 ${formatCredits(pack.price)}`}
      </p>
    </motion.div>
  );
}
