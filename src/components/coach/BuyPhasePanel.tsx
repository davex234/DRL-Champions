"use client";

/**
 * FASE DE COMPRA — la IA propone, el entrenador decide.
 *
 * Muestra la economía REAL de ambos equipos (Economy Engine) y deja al entrenador
 * confirmar o CAMBIAR el tipo de compra. El override se aplica sobre `plannedBuy` del
 * Economy Engine antes de que la Buy Phase construya los loadouts. No simula nada.
 */
import { useEffect, useState } from "react";
import type { BuyTier, TeamEconomyView } from "@/economy";
import type { BuyView } from "@/components/sim/useCoachMatch";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/format";

const TIERS: { id: BuyTier; label: string; desc: string }[] = [
  { id: "save", label: "Save", desc: "No comprar, guardar todo" },
  { id: "eco", label: "Eco", desc: "Pistola + escudo ligero" },
  { id: "half", label: "Half", desc: "Compra parcial / SMG" },
  { id: "force", label: "Force", desc: "Forzar con lo que haya" },
  { id: "full", label: "Full", desc: "Rifles + escudo + utilidad" },
];

function EcoSummary({ label, view, accent }: { label: string; view: TeamEconomyView; accent: string }) {
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-base-800/60 p-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-widest" style={{ color: accent }}>{label}</p>
        <span className="text-[10px] uppercase text-white/40">{String(view.status)}</span>
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">{formatCredits(Math.round(view.avg))}<span className="text-xs font-normal text-white/40"> / jug.</span></p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-white/45">
        <span>Total: <b className="text-white/70">{formatCredits(view.total)}</b></span>
        <span>Poder: <b className="text-white/70">{Math.round(view.buyingPower * 100)}%</b></span>
        <span>Bono derrota: <b className="text-white/70">{formatCredits(view.lossBonus)}</b></span>
        <span>Bonus: <b className="text-white/70">{view.bonus ? "sí" : "no"}</b></span>
      </div>
    </div>
  );
}

/**
 * La compra de la ronda.
 *
 * `onChange` publica el nivel elegido hacia arriba: la orden de empezar la ronda está anclada
 * al pie del escenario del partido, y tiene que comprar EXACTAMENTE lo que se ve marcado
 * aquí, no lo recomendado por defecto.
 *
 * F69 · F68-012: el panel tenía además su propio «Comprar y empezar ronda», que hacía LO MISMO que
 * «Jugar la ronda» del pie (`confirmBuy` con el nivel marcado): dos CTA para una acción. La orden
 * canónica es la del pie; el botón interno solo se pinta si alguien pasa `onConfirm` (uso aislado).
 */
export function BuyPhasePanel({ buy, onConfirm, onChange }: {
  buy: BuyView;
  onConfirm?: (tier: BuyTier) => void;
  onChange?: (tier: BuyTier) => void;
}) {
  const recommended = buy.recommendedTier ?? "full";
  const [tier, setTier] = useState<BuyTier>(recommended);
  useEffect(() => { onChange?.(tier); }, [tier, onChange]);
  const home = buy.economy?.home;
  const power = home?.buyingPower ?? 1;

  return (
    <div className="animate-rise mx-auto max-w-3xl space-y-4">
      <header>
        <p className="font-display text-[11px] uppercase tracking-[0.3em] text-drl">Fase de compra · Ronda {buy.roundNumber}</p>
        <h2 className="font-display text-2xl font-bold uppercase text-white">¿Qué compramos?</h2>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        {buy.economy && <EcoSummary label="Tu economía" view={buy.economy.home} accent="#37e6a0" />}
        {buy.economy && <EcoSummary label="Economía rival" view={buy.economy.away} accent="#ff4d6a" />}
      </div>

      <div className="rounded-2xl border border-white/10 bg-base-700/30 p-4">
        <p className="mb-2.5 font-display text-[11px] uppercase tracking-widest text-white/45">Tipo de compra</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TIERS.map((t) => {
            const isRec = t.id === recommended;
            const affordable = t.id === "save" || t.id === "eco" || power >= (t.id === "full" ? 1 : t.id === "force" ? 0.7 : 0.45);
            return (
              <button key={t.id} onClick={() => setTier(t.id)}
                className={cn("relative rounded-xl border px-3 py-3 text-left transition",
                  tier === t.id ? "border-drl bg-drl/15 shadow-glow" : "border-white/10 bg-white/5 hover:bg-white/10",
                  !affordable && "opacity-50")}>
                {isRec && <span className="absolute -top-2 right-2 rounded-full bg-drl px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">IA</span>}
                <p className="font-display text-sm font-bold uppercase text-white">{t.label}</p>
                <p className="mt-0.5 text-[10px] leading-tight text-white/40">{t.desc}</p>
                {!affordable && <p className="mt-1 text-[9px] text-rose-300">Ajustado</p>}
              </button>
            );
          })}
        </div>
        {tier !== recommended && (
          <p className="mt-2 text-[11px] text-amber-300">⚠ Cambias la recomendación de la IA ({recommended}). Tu palabra es la última.</p>
        )}
      </div>

      {buy.scout.rounds >= 2 && (
        <p className="text-[12px] text-white/50">
          💡 El rival va a <b className="text-white/80">{buy.scout.enemyEconomy.buy ?? "—"}</b>
          {buy.scout.enemyEconomy.buyingPower < 0.5 ? " — economía tocada, puedes presionar." : " — economía saneada, cuidado con el anti-eco."}
        </p>
      )}

      {onConfirm && (
        <button onClick={() => onConfirm(tier)}
          className="w-full rounded-2xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-4 font-display text-base font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
          Comprar y empezar ronda ▸
        </button>
      )}
    </div>
  );
}
