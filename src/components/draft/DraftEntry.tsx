"use client";

/**
 * F72 · DRAFT GAUNTLET — ENTRADA Y PREMIOS (presentación). Lo usan `/duelos` (tarjeta del modo) y la portada del draft.
 *
 *   · `DraftRewardLadder` — la tabla del servidor (`snapshot.economy`) como una escalera visual: 0 V … 5 V, y el gran
 *     premio con el arte REAL del sobre. Nada se calcula aquí: importes, sobre y periodicidad llegan hechos.
 *   · `DraftEntryButton`  — ENTRAR · 2.000 → CONFIRMAR · 2.000 (dos pasos, sin diálogo del navegador). El cobro lo hace
 *     el servidor al confirmar; este botón solo evita la compra accidental.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { packArtwork } from "@/data/packArtwork";
import { creditsLabel } from "@/lib/duels/selector";
import type { DraftEconomyView } from "@/domain/draft/economy";

export function DraftRewardLadder({ economy, className, reached = null }: { economy: DraftEconomyView; className?: string; reached?: number | null }) {
  const art = packArtwork(economy.jackpot.packId);
  const steps = economy.table.slice(0, -1);
  const top = economy.table[economy.table.length - 1];
  return (
    <ol aria-label="Premios por victorias" data-testid="draft-reward-ladder" className={cn("grid grid-cols-5 items-end gap-1.5", className)}>
      {steps.map((l) => (
        <li
          key={l.wins}
          data-wins={l.wins}
          data-reached={reached === l.wins || undefined}
          className={cn("flex flex-col items-center justify-end gap-1 rounded-[3px] border border-white/15 bg-black/45 px-0.5 pb-1.5 pt-1 text-center", reached === l.wins && "ring-2 ring-drl-gold")}
          style={{ minHeight: 40 + l.wins * 10 }}
        >
          <span className="font-display text-[12px] font-bold uppercase leading-none tracking-[0.06em] text-white/70">{l.wins} V</span>
          <span className="nx-readout text-[14px] leading-none tabular-nums text-white">{l.credits > 0 ? creditsLabel(l.credits) : "—"}</span>
        </li>
      ))}
      <li
        data-wins={top.wins}
        data-jackpot="true"
        data-reached={reached === top.wins || undefined}
        className={cn("col-span-5 flex min-h-[88px] items-center gap-3 rounded-[3px] border border-drl-gold/80 px-3 py-2", reached === top.wins && "ring-2 ring-drl-gold")}
        style={{ background: "radial-gradient(120% 120% at 20% 20%, rgba(255,211,92,0.28), rgba(255,211,92,0.06) 60%, rgba(0,0,0,0.4))", boxShadow: "0 0 26px -6px rgba(255,211,92,0.6)" }}
      >
        {art && <img src={art} alt="" loading="lazy" decoding="async" className="nx-draft-jackpot-art -my-4 h-[96px] w-auto shrink-0 -rotate-6 drop-shadow-[0_8px_18px_rgba(255,211,92,0.55)]" />}
        <span className="min-w-0 flex-1 leading-none">
          <span className="block font-display text-[13px] font-bold uppercase tracking-[0.12em] text-drl-gold">Gran premio · 5 V</span>
          <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="nx-readout text-[24px] tabular-nums text-white">{creditsLabel(top.credits)}</span>
            <span className="font-display text-[14px] font-bold uppercase tracking-[0.06em] text-white">+ {economy.jackpot.packName}</span>
          </span>
          <span className="mt-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-white/60">1 por semana</span>
        </span>
      </li>
    </ol>
  );
}

export function DraftEntryButton({
  fee, disabled = false, busy = false, onConfirm, testId, className, size = "lg",
}: {
  fee: number;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  testId: string;
  className?: string;
  size?: "md" | "lg";
}) {
  const [confirming, setConfirming] = useState(false);
  const amount = creditsLabel(fee);
  if (!confirming || disabled) {
    return (
      <NxButton variant="primary" size={size} block className={className} data-cta="primary" data-step="enter" data-testid={testId}
        disabled={disabled || busy} onClick={() => setConfirming(true)}>
        {busy ? "Entrando…" : `Entrar · ${amount}`}
      </NxButton>
    );
  }
  return (
    <div className={cn("space-y-1.5", className)} data-testid="draft-entry-confirm">
      <NxButton variant="primary" size={size} block data-cta="primary" data-step="confirm" data-testid={testId} disabled={busy}
        onClick={onConfirm} autoFocus>
        {busy ? "Entrando…" : `Confirmar · ${amount}`}
      </NxButton>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] uppercase tracking-[0.1em] text-white/60">Se cobra al confirmar</span>
        <button type="button" className="nx-focus min-h-[36px] px-2 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/70 hover:text-white"
          onClick={() => setConfirming(false)} disabled={busy} data-testid="draft-entry-cancel">
          Cancelar
        </button>
      </div>
    </div>
  );
}
