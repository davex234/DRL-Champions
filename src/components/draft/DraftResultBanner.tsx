"use client";

/**
 * DRAFT GAUNTLET · RESULTADO DEL COMBATE (Fase 39). Va dentro del `ResultScreen` canónico de la arena y SOLO cuenta lo
 * que dice la run ya liquidada por el servidor (`draftResultCopy`). Mientras no está liquidada, lo dice.
 */
import { NxButton } from "@/components/ui/NxButton";
import type { DraftResultCopy } from "@/lib/draft/presentation";

const TONE: Record<DraftResultCopy["tone"], string> = {
  win: "border-[#3fc07a]/60", complete: "border-drl-gold", loss: "border-drl/60", draw: "border-white/40", pending: "border-white/20",
};

export function DraftResultBanner({ copy, onBack, onRefresh }: { copy: DraftResultCopy; onBack: () => void; onRefresh?: () => void }) {
  return (
    <section role="status" aria-live="polite" data-testid="draft-result" data-tone={copy.tone} className={`nx-clip-sm mt-3 border bg-white/[0.03] px-4 py-3 ${TONE[copy.tone]}`}>
      <p className="nx-label text-drl-gold">Draft Gauntlet</p>
      <p className="font-display text-[22px] font-bold uppercase leading-tight text-white">{copy.title}</p>
      <p className="mt-1 text-caption text-ink-secondary">{copy.line}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <NxButton variant="secondary" size="md" onClick={onBack} data-testid="draft-result-back">{copy.cta}</NxButton>
        {copy.tone === "pending" && onRefresh && <NxButton variant="ghost" size="md" onClick={onRefresh}>Actualizar</NxButton>}
      </div>
    </section>
  );
}
