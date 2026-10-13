"use client";

/**
 * RESULTADO DE NODO (Fase 35) — va en el hueco `extra` de `ResultScreen`, que sigue contando la partida.
 * Aquí solo se dice qué significa para el mapa: NODO COMPLETADO / INTÉNTALO DE NUEVO / EMPATE, primera victoria,
 * capítulo cerrado y el siguiente nodo. Todo sale del intento liquidado por el servidor.
 */
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import type { CampaignNodeView } from "@/domain/campaign/snapshot";
import { campaignNodeHref, campaignPlayHref, nodeCode, type ResultCopy } from "@/lib/campaign/presentation";

const TONE: Record<ResultCopy["tone"], { border: string; title: string; glyph: string }> = {
  win: { border: "border-[#3fc07a]/60", title: "text-[#6fe0a0]", glyph: "◆" },
  loss: { border: "border-drl/50", title: "text-drl-glow", glyph: "↻" },
  draw: { border: "border-drl-gold/50", title: "text-drl-gold", glyph: "=" },
  pending: { border: "border-white/20", title: "text-white/80", glyph: "…" },
};

export function CampaignResultBanner({
  copy, node, next, onRetrySync, className,
}: { copy: ResultCopy; node: CampaignNodeView; next: CampaignNodeView | null; onRetrySync?: () => void; className?: string }) {
  const t = TONE[copy.tone];
  return (
    <section role="status" aria-live="polite" data-testid="campaign-result" data-tone={copy.tone} className={cn("nx-clip-sm mt-3 border bg-white/[0.03] px-4 py-3", t.border, className)}>
      <p className="nx-label">Road to Champions · Nodo {nodeCode(node)} · {node.name}</p>
      <p className={cn("mt-1 flex items-center gap-2 font-display text-[22px] font-bold uppercase leading-none", t.title)}>
        <span aria-hidden>{t.glyph}</span>{copy.title}
      </p>
      <p className="mt-1 text-caption text-ink-secondary">{copy.detail}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {copy.tone === "pending" && onRetrySync && <NxButton variant="secondary" size="md" onClick={onRetrySync}>Actualizar progreso</NxButton>}
        {copy.tone === "win" && next && <NxButton variant="primary" size="md" href={campaignPlayHref(next.id)} data-testid="campaign-next">Siguiente nodo · {nodeCode(next)} {next.name}</NxButton>}
        <NxButton variant="ghost" size="md" href={campaignNodeHref(node.id)}>Volver al mapa</NxButton>
      </div>
    </section>
  );
}
