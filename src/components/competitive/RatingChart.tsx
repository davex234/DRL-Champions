"use client";

/**
 * EVOLUCIÓN DEL RATING (Fase 28). SVG puro sobre los asientos reales (`new_rating` tras cada
 * partida liquidada): sin librería, sin reconstrucción, sin animación en bucle. Con resumen
 * textual para lectores de pantalla y para quien no distingue el trazo.
 */
import { useReducedMotion } from "framer-motion";
import { seriesSummary, type RatingPoint } from "@/domain/pvpLadder/ladder";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("competitive");

export function RatingChart({ points, className, height = 120 }: { points: RatingPoint[]; className?: string; height?: number }) {
  useLocale();
  const reduced = useReducedMotion();
  const summary = seriesSummary(points);
  if (points.length < 2) {
    return (
      <figure className={className} data-chart={points.length}>
        <p className="nx-clip-sm border-l-2 border-l-drl/60 bg-white/[0.03] px-4 text-left !text-[14px] !text-white/70 py-4 text-center text-caption text-ink-muted">
          {points.length === 0 ? t("Sin partidas liquidadas todavía.") : t("Con una segunda partida liquidada aparecerá tu evolución.")}
        </p>
        <figcaption className="sr-only">{td(summary)}</figcaption>
      </figure>
    );
  }
  const W = 600, H = height, pad = 10;
  const first = points[0].rating - points[0].delta;
  const values = [first, ...points.map((p) => p.rating)];
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const up = last.rating >= first;

  return (
    <figure className={className} data-chart={points.length}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("Evolución del rating. {summary}", { summary: td(summary) })}>
        <defs>
          <linearGradient id="rating-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? "#19e3ff" : "#ff2e63"} stopOpacity="0.28" />
            <stop offset="1" stopColor={up ? "#19e3ff" : "#ff2e63"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${x(values.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`} fill="url(#rating-fill)" />
        <path d={d} fill="none" stroke={up ? "#19e3ff" : "#ff2e63"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
          style={reduced ? undefined : { strokeDasharray: 2000, strokeDashoffset: 0, transition: "stroke-dashoffset 0.6s ease-out" }} />
        {points.map((p, i) => (
          <circle key={p.matchId} cx={x(i + 1)} cy={y(p.rating)} r="3.5" fill={p.delta >= 0 ? "#3fc07a" : "#ff2e63"} stroke="#05070c" strokeWidth="1.5">
            <title>{t("Partida {v}: {rating} ({v2}{delta})", { v: i + 1, rating: p.rating, v2: p.delta >= 0 ? "+" : "", delta: p.delta })}</title>
          </circle>
        ))}
        <text x={pad} y={pad + 4} className="fill-white/45" fontSize="11">{max}</text>
        <text x={pad} y={H - 2} className="fill-white/45" fontSize="11">{min}</text>
      </svg>
      <figcaption className="mt-1 text-caption text-ink-secondary">{td(summary)}</figcaption>
    </figure>
  );
}
