"use client";

/** Mini-gráfica SVG inline (sin dependencias) para una serie de precios. */
export function PriceSparkline({
  values,
  width = 88,
  height = 28,
  color = "#37e6a0",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!values || values.length < 2) {
    return <div style={{ width, height }} className="rounded bg-white/5" aria-hidden />;
  }
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const stroke = color ?? (up ? "#37e6a0" : "#ff5c8a");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} fill={stroke} />
    </svg>
  );
}
