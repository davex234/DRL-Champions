"use client";

/**
 * SALA DE BRIEFING — el análisis entre rondas (más que "comprar"). Resumen, qué salió
 * bien/mal, qué aprendimos del rival, qué cambiamos, qué esperará el rival y qué
 * recomienda la IA — todo de cara a la siguiente decisión. Consume `RoundBriefing` (puro).
 */
import type { RoundBriefing } from "@/lib/match/briefing";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

function Col({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" | "info" | "warn" }) {
  useLocale();
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber-300" : "text-cyan-300";
  const mark = tone === "good" ? "✓" : tone === "bad" ? "✕" : "›";
  return (
    <div>
      <p className={`mb-1 text-[10px] uppercase tracking-widest ${color}`}>{td(title)}</p>
      <ul className="space-y-0.5">
        {items.map((it, i) => <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-white/70"><span className={color}>{td(mark)}</span>{td(it)}</li>)}
      </ul>
    </div>
  );
}

export function RoundBriefingPanel({ briefing }: { briefing: RoundBriefing }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <p className="font-display text-[11px] uppercase tracking-[0.3em] text-drl">{t("Briefing ·")} {td(briefing.summary)}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Col title={t("Qué salió bien")} items={briefing.wentWell} tone="good" />
        <Col title={t("Qué salió mal")} items={briefing.wentWrong} tone="bad" />
        <Col title={t("Qué aprendimos")} items={briefing.learned} tone="info" />
        <Col title={t("Qué esperará el rival")} items={briefing.rivalExpects} tone="warn" />
      </div>
      <div className="mt-3 rounded-xl border border-drl/30 bg-drl/5 p-3">
        <p className="text-[10px] uppercase tracking-widest text-drl">{t("Recomendación IA")}</p>
        <p className="mt-0.5 font-display text-sm font-bold uppercase text-white">{briefing.aiRecommends.concept}</p>
        <ul className="mt-1 space-y-0.5">
          {briefing.aiRecommends.reasons.map((r, i) => <li key={i} className="flex gap-1.5 text-[12px] text-white/65"><span className="text-drl">›</span>{td(r)}</li>)}
        </ul>
      </div>
    </div>
  );
}
