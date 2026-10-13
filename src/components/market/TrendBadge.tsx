"use client";

import type { PriceRecord } from "@/domain/market/types";
import { computeTrend, TREND_META } from "@/domain/market/history";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("market");

export function TrendBadge({ record }: { record?: PriceRecord }) {
  useLocale();
  if (!record) return null;
  const trend = computeTrend(record);
  const meta = TREND_META[trend];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `${meta.color}22`, color: meta.color }}
      title={t("Tendencia: {label}", { label: td(meta.label) })}
    >
      <span>{meta.icon}</span>
      {td(meta.label)}
    </span>
  );
}
