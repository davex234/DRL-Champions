"use client";

/**
 * ESTADÍSTICAS EN VIVO — el scoreboard pro por jugador (ACS/ADR/KAST/K-D-A/HS%/impacto).
 * Consume `LiveStatLine[]` (datos puros derivados de cstat + eventos). Solo muestra.
 */
import type { LiveStatLine } from "@/broadcast";
import { cn } from "@/lib/format";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

function Row({ s, max }: { s: LiveStatLine; max: number }) {
  const atk = s.side === "ATK";
  return (
    <tr className="border-b border-white/5">
      <td className="py-1 pl-2">
        <span className={cn("mr-1 inline-block h-2 w-2 rounded-full", atk ? "bg-rose-400" : "bg-cyan-400")} />
        <span className="font-display text-[11px] font-bold text-white">{s.name}</span>
      </td>
      <td className="text-right font-display text-[11px] tabular-nums text-white">{s.acs}</td>
      <td className="text-right text-[11px] tabular-nums text-white/70">{s.kills}/{s.deaths}/{s.assists}</td>
      <td className="text-right text-[11px] tabular-nums text-white/55">{s.adr}</td>
      <td className="text-right text-[11px] tabular-nums text-white/55">{s.kast}%</td>
      <td className="text-right text-[11px] tabular-nums text-white/55">{s.hsPct}%</td>
      <td className="py-1 pr-2">
        <div className="ml-auto h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-drl" style={{ width: `${Math.round((s.impact / Math.max(1, max)) * 100)}%` }} />
        </div>
      </td>
    </tr>
  );
}

export function LiveStatsPanel({ stats }: { stats: LiveStatLine[] }) {
  useLocale();
  if (stats.length === 0) return null;
  const maxImpact = Math.max(...stats.map((s) => s.impact), 1);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-base-800/60">
      <div className="flex items-center justify-between px-3 py-1.5">
        <p className="font-display text-[10px] uppercase tracking-[0.3em] text-drl">{t("Estadísticas en vivo")}</p>
        <span className="text-[9px] uppercase tracking-widest text-white/35">{t("ACS · K/D/A · ADR · KAST · HS · impacto")}</span>
      </div>
      <table className="w-full">
        <tbody>{stats.map((s) => <Row key={s.id} s={s} max={maxImpact} />)}</tbody>
      </table>
    </div>
  );
}
