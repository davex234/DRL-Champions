"use client";

/**
 * COMPARADOR (Fase 32) — ACTUAL vs CANDIDATA, a pantalla completa en móvil.
 *
 * Filas: OVR, Stronghold, Gamesense, Entryfrag y rareza, con la diferencia en TEXTO («▲ +4», «▼ −2»).
 * Impacto: cómo cambian las medias del equipo si se confirma. Todo sale de `compareForSlot` (dominio);
 * si el cambio no es legal se dice por qué y no se puede confirmar. Nada de probabilidades.
 */
import { getVariant } from "@/domain/cards/variants";
import type { CompareView } from "@/domain/deckBuilder/builder";
import { Card3D } from "@/components/visual/Card3D";
import { NxButton } from "@/components/ui/NxButton";
import { DuelCard } from "../DuelCard";
import { DeltaText, Sheet } from "./bits";
import type { SwapImpact } from "@/domain/deckStrategy";
import { StrategyImpact } from "../strategy/StrategyImpact";
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

export interface ComparePanelProps {
  open: boolean;
  view: CompareView | null;
  slotLabel: string;
  onClose: () => void;
  onConfirm: (nextUids: string[]) => void;
  /** Fase 43 · identidad, balance, encaje y medias exactas antes → después. */
  strategy?: SwapImpact | null;
}

export function ComparePanel({ open, view, slotLabel, onClose, onConfirm, strategy = null }: ComparePanelProps) {
  useLocale();
  if (!view) return null;
  const { current, candidate } = view;
  const rankLabel = (variantId: string) => i18nTd(getVariant(variantId as Parameters<typeof getVariant>[0]).label);

  return (
    <Sheet
      open={open}
      size="full"
      scene="compare"
      eyebrow={i18nTd(slotLabel)}
      title={current ? t("Comparar y cambiar") : t("Añadir al hueco")}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2">
          <NxButton variant="primary" size="md" onClick={() => view.nextUids && onConfirm(view.nextUids)} disabled={!view.legal} data-testid="compare-confirm">
            {current ? t("Confirmar cambio") : t("Añadir al equipo")}
          </NxButton>
          <NxButton variant="ghost" size="md" onClick={onClose}>{t("Cancelar")}</NxButton>
        </div>
      }
    >
      <div data-testid="compare-view" data-legal={view.legal}>
        {!view.legal && view.reason && (
          <p role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bad/[0.08] px-3 py-2 text-[13px] text-white">{i18nTd(view.reason)}</p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:gap-8">
          <figure className="flex flex-col items-center gap-2">
            <figcaption className="nx-label">{t("Actual")}</figcaption>
            {current ? (
              <Card3D mode="hover" tilt={8} glow={getVariant(current.variantId).palette.primary} className="w-full max-w-[168px]">
                <DuelCard card={current} size="lg" className="!w-full" />
              </Card3D>
            ) : (
              <div className="grid aspect-[5/7] w-full max-w-[168px] place-items-center rounded-xl border-2 border-dashed border-white/15 bg-black/25 px-2 text-center text-caption text-ink-faint">
                {t("Hueco vacío")}
              </div>
            )}
            <p className="text-center font-display text-[14px] font-bold uppercase text-white">{current?.nick ?? "—"}</p>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            <figcaption className="nx-label !text-drl-cyan">{t("Candidata")}</figcaption>
            <Card3D mode="hover" tilt={8} glow={getVariant(candidate.variantId).palette.primary} className="w-full max-w-[168px]">
              <DuelCard card={candidate} size="lg" className="!w-full" />
            </Card3D>
            <p className="text-center font-display text-[14px] font-bold uppercase text-white">{candidate.nick}</p>
          </figure>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-[13px]">
            <caption className="nx-label mb-1 text-left">{t("Cifras de la carta")}</caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-faint">
                <th scope="col" className="py-1.5 font-semibold">{t("Estadística")}</th>
                <th scope="col" className="py-1.5 text-right font-semibold">{t("Actual")}</th>
                <th scope="col" className="py-1.5 text-right font-semibold">{t("Candidata")}</th>
                <th scope="col" className="py-1.5 text-right font-semibold">{t("Diferencia")}</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.key} className="border-t border-white/5" data-row={r.key}>
                  <th scope="row" className="py-1.5 font-medium text-white/85">{i18nTd(r.label)}</th>
                  <td className="py-1.5 text-right tabular-nums text-white/70">
                    {r.current === null ? "—" : r.key === "rank" && current ? rankLabel(current.variantId) : r.current}
                  </td>
                  <td className="py-1.5 text-right nx-readout tabular-nums text-white">
                    {r.key === "rank" ? rankLabel(candidate.variantId) : r.candidate}
                  </td>
                  {/* Fase 43 · la rareza es colección, no poder: sin «▲ +10» que sugiera una mejora. */}
                  <td className="py-1.5 text-right">{r.key === "rank" ? <span className="text-[11px] text-ink-faint">{t("solo colección")}</span> : <DeltaText value={r.delta} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {strategy && view.legal && <StrategyImpact impact={strategy} />}

        {!strategy && view.impact.length > 0 && (
          <div className="mt-5 overflow-x-auto" data-testid="team-impact">
            <table className="w-full min-w-[320px] text-left text-[13px]">
              <caption className="nx-label mb-1 text-left">{t("Medias del equipo si confirmas")}</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="py-1.5 font-semibold">{t("Media")}</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">{t("Antes")}</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">{t("Después")}</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">{t("Diferencia")}</th>
                </tr>
              </thead>
              <tbody>
                {view.impact.map((r) => (
                  <tr key={r.key} className="border-t border-white/5">
                    <th scope="row" className="py-1.5 font-medium text-white/85">{i18nTd(r.label)}</th>
                    <td className="py-1.5 text-right tabular-nums text-white/70">{r.before ?? "—"}</td>
                    <td className="py-1.5 text-right nx-readout tabular-nums text-white">{r.after ?? "—"}</td>
                    <td className="py-1.5 text-right"><DeltaText value={r.delta} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[11px] text-ink-faint">{t("Comparación de las cifras de las cartas y de las medias del equipo. No es una predicción de resultado. El número de serie no cambia ninguna cifra.")}</p>
      </div>
    </Sheet>
  );
}
