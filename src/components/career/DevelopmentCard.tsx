"use client";

/**
 * FICHA DE DESARROLLO — la evolución de un jugador de un vistazo: edad/banda, rating vs
 * potencial (techo alcanzado), forma/fatiga/burnout/motivación, mejores habilidades y el
 * informe de scouting (fuertes/débiles/riesgos). Consume datos PUROS del Development Engine.
 */
import type { DevelopmentInfo, ScoutReport } from "@/development";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("career");

const BAND_LABEL: Record<DevelopmentInfo["ageBand"], string> = {
  joven: "Joven", prime: "Prime", veterano: "Veterano", declive: "Declive",
};
const BAND_COLOR: Record<DevelopmentInfo["ageBand"], string> = {
  joven: "#37e6a0", prime: "#19e3ff", veterano: "#ffd35c", declive: "#ff4d6a",
};

function Bar({ label, value, invert = false, ceiling }: { label: string; value: number; invert?: boolean; ceiling?: number }) {
  useLocale();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const good = invert ? 100 - v : v;
  const color = good >= 66 ? "#37e6a0" : good >= 33 ? "#ffd35c" : "#ff4d6a";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 text-[10px] uppercase tracking-wide text-white/45">{td(label)}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
        {ceiling != null && <div className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${ceiling}%` }} title={t("potencial")} />}
      </div>
      <span className="w-6 text-right text-[10px] tabular-nums text-white/45">{v}</span>
    </div>
  );
}

export function DevelopmentCard({ name, info, scout, selected, onToggle }: {
  name: string; info: DevelopmentInfo | null; scout: ScoutReport; selected?: boolean; onToggle?: () => void;
}) {
  useLocale();
  const trendUp = (info?.trend ?? 0) >= 0;
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border bg-base-800/70 p-3 transition", selected ? "border-drl shadow-glow" : "border-white/10")}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-bold uppercase tracking-wide text-white">{name}</p>
          <p className="text-[10px] text-white/45">
            <span style={{ color: BAND_COLOR[scout.ageBand] }}>{td(BAND_LABEL[scout.ageBand])}</span> · {scout.age} {t("años ·")} {td(scout.personality)}
          </p>
        </div>
        {onToggle && (
          <button onClick={onToggle}
            className={cn("rounded-md border px-2 py-0.5 font-display text-[10px] uppercase tracking-wide transition",
              selected ? "border-drl bg-drl/20 text-drl" : "border-white/15 text-white/50 hover:bg-white/10")}>
            {selected ? "✓" : "+"}
          </button>
        )}
      </div>

      {/* Rating vs potencial */}
      {info ? (
        <>
          <Bar label={t("Nivel")} value={info.rating} ceiling={Math.min(100, info.potential)} />
          <div className="flex items-center justify-between text-[10px] text-white/45">
            <span>{fill(t("Potencial {potential} · techo {ceiling}%", { ...slots("potential"), ceiling: info.ceilingReached }), { potential: <b className="text-white/70">{scout.potential}</b> })}</span>
            <span className={trendUp ? "text-emerald-300" : "text-rose-300"}>{trendUp ? "▲" : "▼"} {info.trend}</span>
          </div>
          <div className="space-y-1 border-t border-white/5 pt-1.5">
            <Bar label={t("Forma")} value={info.form} />
            <Bar label={t("Fatiga")} value={info.fatigue} invert />
            <Bar label={t("Burnout")} value={info.burnout} invert />
            <Bar label={t("Motiv.")} value={info.motivation} />
          </div>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {info.topSkills.map((s) => (
              <span key={s.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/60">{s.id} {s.value}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="py-1 text-[11px] text-white/35">{t("Sin partidos aún — entrena para empezar a desarrollarlo.")}</p>
      )}

      {/* Scouting */}
      <div className="grid grid-cols-2 gap-1.5 border-t border-white/5 pt-1.5">
        <div>
          <p className="text-[9px] uppercase tracking-widest text-emerald-300/70">{t("Fuertes")}</p>
          {scout.strengths.slice(0, 2).map((s, i) => <p key={i} className="text-[10px] text-white/60">{td(s)}</p>)}
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-widest text-rose-300/70">{t("Riesgos")}</p>
          {scout.risks.slice(0, 2).map((s, i) => <p key={i} className="text-[10px] text-white/60">{td(s)}</p>)}
        </div>
      </div>
      <p className="text-[10px] italic text-white/40">{td(scout.recommendation)}</p>
    </div>
  );
}
