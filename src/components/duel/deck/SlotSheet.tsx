"use client";

/**
 * EL HUECO (Fase 32). Tocar un hueco abre esto — en móvil es LA forma de construir, sin arrastrar:
 *
 *   · hueco ocupado: la carta, sus problemas y acciones con botones reales (Quitar, Subir, Bajar,
 *     «Autocompletar puede cambiarla»);
 *   · SUGERIR CARTA: regla documentada (mayor OVR legal y poseída), con su frase;
 *   · candidatas de ese rol: las legales primero, con COMPARAR y ELEGIR; las ilegales dicen por qué.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import type { BoardSlot, BuilderCard, Candidate, Suggestion } from "@/domain/deckBuilder/builder";
import { STAT_INFO, type CombatStatKey } from "@/lib/duel/types";
import { NxButton } from "@/components/ui/NxButton";
import { DuelCard } from "../DuelCard";
import { Sheet } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("duel");

const PAGE = 30;

export interface SlotSheetProps {
  open: boolean;
  slot: BoardSlot | null;
  candidates: Candidate[];
  suggestion: Suggestion | null;
  released: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onPick: (card: BuilderCard) => void;
  onCompare: (card: BuilderCard) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleRelease: () => void;
  /** Solo arnés QA: la sugerencia ya desplegada. */
  initialSuggest?: boolean;
  /** Fase 43 · aportación de la carta y alternativas con impacto (hueco ocupado). */
  focus?: React.ReactNode;
}

export function SlotSheet(p: SlotSheetProps) {
  useLocale();
  const [shown, setShown] = useState(PAGE);
  const [suggest, setSuggest] = useState(!!p.initialSuggest);
  useEffect(() => { setShown(PAGE); setSuggest(!!p.initialSuggest); }, [p.slot?.key, p.initialSuggest]);
  if (!p.slot) return null;
  const slot = p.slot;
  const legal = p.candidates.filter((c) => c.ok).length;
  const list = p.candidates.slice(0, shown);

  return (
    <Sheet open={p.open} size="lg" scene="slot-sheet" eyebrow={slot.card ? t("Hueco ocupado") : t("Hueco vacío")} title={td(slot.label)} onClose={p.onClose}>
      <div data-testid="slot-sheet" data-slot={slot.key}>
        {slot.card && (
          <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <DuelCard card={slot.card} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-h3 font-bold uppercase text-white">{slot.card.nick}</p>
              <p className="text-caption text-ink-muted">{slot.card.team} {t("· OVR")} <span className="nx-readout text-white">{slot.card.ovr}</span>{slot.card.serial != null && t(" · Nº {serial}", { serial: slot.card.serial })}</p>
              {slot.issue && <p className="mt-1 text-[12px] text-bad" role="alert">{td(slot.issue)}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <NxButton variant="danger" size="sm" onClick={p.onRemove} data-testid="slot-remove">{t("Quitar")}</NxButton>
                <NxButton variant="ghost" size="sm" onClick={() => p.onMove(-1)} disabled={!p.canMoveUp} aria-label={t("Mover arriba dentro del rol")}>{t("↑ Subir")}</NxButton>
                <NxButton variant="ghost" size="sm" onClick={() => p.onMove(1)} disabled={!p.canMoveDown} aria-label={t("Mover abajo dentro del rol")}>{t("↓ Bajar")}</NxButton>
              </div>
              <label className="mt-2 flex min-h-[44px] items-center gap-2 text-[12px] text-ink-secondary">
                <input type="checkbox" checked={p.released} onChange={p.onToggleRelease} className="h-4 w-4 accent-[var(--nx-key)]" />
                {t("Autocompletar puede cambiar esta carta")}
              </label>
            </div>
          </div>
        )}

        {slot.card && p.focus}

        <div className="mt-3 rounded-xl border border-drl-cyan/25 bg-drl-cyan/[0.05] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="nx-label !text-drl-cyan">{t("Sugerir carta")}</p>
            {!suggest && <NxButton variant="secondary" size="sm" onClick={() => setSuggest(true)} data-testid="suggest">{t("Sugerir carta")}</NxButton>}
          </div>
          {suggest && p.suggestion && (
            <div className="mt-2" role="status" data-testid="suggestion">
              {p.suggestion.card ? (
                <div className="flex items-center gap-3">
                  <DuelCard card={p.suggestion.card} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-body font-bold uppercase text-white">{p.suggestion.card.nick} {t("· OVR")} {p.suggestion.card.ovr}</p>
                    <p className="text-caption text-ink-secondary">{td(p.suggestion.reason)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <NxButton variant="primary" size="sm" onClick={() => p.onPick(p.suggestion!.card!)}>{slot.card ? t("Cambiar") : t("Elegir")}</NxButton>
                    <NxButton variant="ghost" size="sm" onClick={() => p.onCompare(p.suggestion!.card!)}>{t("Comparar")}</NxButton>
                  </div>
                </div>
              ) : (
                <p className="text-caption text-ink-secondary">{td(p.suggestion.reason)}</p>
              )}
            </div>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">{t("Regla: la carta tuya de mayor OVR que puede ir en este hueco sin romper las reglas.")}</p>
        </div>

        <h3 className="mt-4 font-display text-body font-bold uppercase tracking-wide text-white">
          {fill(t("Tus cartas de {rol} {nota}", { rol: td(slot.role), ...slots("nota") }), { nota: <span className="text-ink-faint">{t("· {n} {n, plural, one {compatible} other {compatibles}}", { n: legal })}</span> })}
        </h3>
        {p.candidates.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-white/15 p-4 text-center" data-empty="no-candidates">
            <p className="text-sm text-white">{t("No tienes más cartas de {rol}.", { rol: td(slot.role) })}</p>
            <Link href="/tienda" className="nx-action mt-1 inline-flex min-h-[44px] items-center">{t("Conseguir cartas →")}</Link>
          </div>
        ) : (
          <ul className="mt-2 space-y-2" aria-label={t("Candidatas para {label}", { label: td(slot.label) })}>
            {list.map((c) => (
              <li
                key={c.card.uid}
                data-candidate={c.card.uid}
                data-ok={c.ok}
                className={cn("flex items-center gap-3 rounded-xl border p-2", c.ok ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-transparent opacity-60")}
              >
                <DuelCard card={c.card} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[13px] font-bold uppercase text-white">{c.card.nick} <span className="nx-readout text-white/80">· {c.card.ovr}</span></p>
                  <p className="truncate text-[11px] text-ink-muted">
                    {c.card.team}
                    {(Object.keys(STAT_INFO) as CombatStatKey[]).map((k) => ` · ${STAT_INFO[k].abbr} ${c.card.combat[k]}`).join("")}
                  </p>
                  {!c.ok && c.reason && <p className="text-[11px] text-drl-gold">{td(c.reason)}</p>}
                </div>
                {c.ok && (
                  <div className="flex shrink-0 gap-1">
                    <NxButton variant="ghost" size="sm" onClick={() => p.onCompare(c.card)} aria-label={t("Comparar {nick}", { nick: c.card.nick })}>{t("Comparar")}</NxButton>
                    <NxButton variant="primary" size="sm" onClick={() => p.onPick(c.card)} aria-label={`${slot.card ? t("Cambiar por") : t("Elegir")} ${c.card.nick}`}>{slot.card ? t("Cambiar") : t("Elegir")}</NxButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {p.candidates.length > shown && (
          <button type="button" onClick={() => setShown((s) => s + PAGE)} className="nx-focus mt-2 min-h-[44px] w-full rounded-control border border-white/12 text-[12px] font-bold uppercase text-white/70 hover:bg-white/5">
            {t("Ver más ({n})", { n: p.candidates.length - shown })}
          </button>
        )}
      </div>
    </Sheet>
  );
}
