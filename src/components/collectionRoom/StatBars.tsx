"use client";

/**
 * STATS DE COMBATE (Fase 37). Las tres del catálogo (`CardDef.combat`, autoridad `domain/cards/combat.ts`) y el OVR.
 * Barras DOM accesibles con su número al lado: nada de canvas, nada de recalcular.
 */
import type { CardDef } from "@/domain/cards/types";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { Meter } from "@/components/ui/Meter";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("collectionRoom");

export function StatBars({ def }: { def: CardDef }) {
  useLocale();
  if (!def.combat) return <p className="text-caption text-ink-muted">{t("Esta carta no tiene stats de combate en el catálogo.")}</p>;
  return (
    <dl className="space-y-2.5" data-testid="stat-bars">
      {COMBAT_STAT_ORDER.map((k) => {
        const value = def.combat![k];
        return (
          <div key={k}>
            <dt className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-white">{td(COMBAT_STAT_META[k].label)}</span>
              <span className="text-caption text-ink-muted">{td(COMBAT_STAT_META[k].full)}</span>
            </dt>
            <dd className="mt-1 flex items-center gap-3">
              <Meter value={Math.max(0, Math.min(100, value))} tone="info" height={8} label={`${COMBAT_STAT_META[k].full} (${COMBAT_STAT_META[k].label}): ${value}`} className="flex-1" />
              <span className="nx-readout w-8 text-right text-[16px] text-white">{value}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
