"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchCardPriceDaily } from "@/lib/supabase/market";
import type { CardPriceDaily } from "@/lib/supabase/types";
import { formatCredits } from "@/lib/format";

/**
 * Gráfica de evolución de precio (cierre diario) en SVG puro, sin dependencias.
 * Incluye relleno de área, línea, guía/tooltip al pasar el ratón y ejes mín/máx.
 */
export function PriceChart({ cardId, days = 60, height = 140 }: { cardId: string; days?: number; height?: number }) {
  const [data, setData] = useState<CardPriceDaily[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    setLoading(true);
    fetchCardPriceDaily(cardId, days).then((d) => {
      if (on) { setData(d); setLoading(false); }
    });
    return () => { on = false; };
  }, [cardId, days]);

  const W = 480;
  const H = height;
  const pad = 6;

  const geo = useMemo(() => {
    if (data.length < 2) return null;
    const closes = data.map((d) => d.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const x = (i: number) => pad + (i / (data.length - 1)) * (W - 2 * pad);
    const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad);
    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.close).toFixed(1)}`).join(" ");
    const area = `${line} L${x(data.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
    const up = closes[closes.length - 1] >= closes[0];
    return { min, max, x, y, line, area, up };
  }, [data, H]);

  if (loading) {
    return <div style={{ height }} className="animate-pulse rounded-lg bg-white/5" />;
  }
  if (!geo) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-lg border border-white/10 bg-base-700/30 text-xs text-white/40">
        Sin historial de ventas suficiente para la gráfica.
      </div>
    );
  }

  const color = geo.up ? "#37e6a0" : "#ff5c8a";
  const hi = hover != null ? data[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width; // 0..1
    const idx = Math.round(rel * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  return (
    <div className="rounded-lg border border-white/10 bg-base-700/30 p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g-${cardId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={geo.area} fill={`url(#g-${cardId})`} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hi && (
          <>
            <line x1={geo.x(hover!)} y1={pad} x2={geo.x(hover!)} y2={H - pad} stroke="#ffffff" strokeOpacity={0.25} strokeDasharray="3 3" />
            <circle cx={geo.x(hover!)} cy={geo.y(hi.close)} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-white/50">
        <span>
          {hi ? (
            <>
              {hi.day} · <span className="font-semibold text-white">🪙 {formatCredits(hi.close)}</span>
              <span className="ml-1 text-white/40">({hi.trades} ventas)</span>
            </>
          ) : (
            <>Evolución ({data.length} días)</>
          )}
        </span>
        <span className="text-white/40">
          mín 🪙 {formatCredits(geo.min)} · máx 🪙 {formatCredits(geo.max)}
        </span>
      </div>
    </div>
  );
}
