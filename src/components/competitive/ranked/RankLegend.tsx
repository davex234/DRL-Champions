"use client";

/**
 * F84 · CÓMO FUNCIONAN LOS RANGOS. Los siete tiers con sus fronteras REALES de la versión de la temporada
 * (`rank-v1`), de abajo arriba, y el escalón actual marcado. Plegable (cerrado por defecto) para no cargar el centro.
 * Sin promesas: el rango es una lectura del rating; ni probabilidades de subir ni recompensas que no existen.
 */
import { cn } from "@/lib/format";
import { rankConfig, rankLadder, rankChip, deriveRank } from "@/domain/ranked/config";
import { CompetitiveEmblem } from "./CompetitiveEmblem";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("competitive");

export function RankLegend({ version, current, className, open = false }: { version: string | null; current: number | null; className?: string; open?: boolean }) {
  useLocale();
  const cfg = rankConfig(version);
  const steps = rankLadder(cfg.version);
  return (
    <details open={open} className={cn("nx-clip-sm group border border-white/10 bg-white/[0.02] px-4 py-3", className)} data-testid="rank-legend">
      <summary className="nx-focus flex cursor-pointer list-none items-center justify-between gap-2 font-display text-[15px] font-bold uppercase tracking-wide text-white">
        {tr("Cómo funcionan los rangos")}
        <span aria-hidden className="text-white/45 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-3 space-y-3 text-[13px] text-white/70">
        <p>{fill(tr("Tu rango sale de tu {rating}: cada partida ranked lo sube o lo baja (el servidor lo calcula). Las {divisiones} (I es la más alta) y cada una ocupa {n} puntos. Al empezar una temporada competitiva juegas tus partidas de colocación y entonces se revela tu rango. La Cumbre no tiene divisiones: por encima, tu puesto en el Top.", { ...slots("rating", "divisiones"), n: cfg.divisionWidth }), {
          rating: <b className="text-white">{tr("rating")}</b>,
          divisiones: <b className="text-white">{tr("divisiones van de III a I")}</b>,
        })}</p>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {cfg.tiers.map((t) => {
            const first = steps.find((s) => s.tierId === t.id)!;
            const last = [...steps].reverse().find((s) => s.tierId === t.id)!;
            const mine = current !== null && steps.some((s, i) => s.tierId === t.id && i === current);
            const chip = rankChip(deriveRank(first.floor === 0 ? last.floor : first.floor, cfg.version));
            return (
              <li key={t.id} className={cn("nx-clip-sm flex flex-col items-center gap-1 border px-2 py-2 text-center", mine ? "border-white/50 bg-white/[0.06]" : "border-white/[0.07]")} data-tier={t.id} aria-current={mine ? "true" : undefined}>
                <CompetitiveEmblem rank={{ ...chip, division: null }} state="RANKED" size="sm" animate={false} />
                <span className="font-display text-[13px] font-bold uppercase tracking-wide" style={{ color: t.color }}>{t.name}</span>
                <span className="nx-readout text-[11.5px] text-white/55">{t.divisions === null ? `≥ ${t.floor}` : first.floor === 0 ? `< ${last.ceil}` : `${first.floor}–${(last.ceil ?? 0) - 1}`}</span>
                {mine && <span className="nx-label !text-[9px] !text-white">{tr("Tú")}</span>}
              </li>
            );
          })}
        </ol>
        <p className="text-[11.5px] text-white/45">{tr("Fronteras de la versión {version}. Si cambian algún día, será con una versión nueva en una temporada nueva: nunca a mitad.", { version: td(cfg.version) })}</p>
      </div>
    </details>
  );
}
