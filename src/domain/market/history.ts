import type { PriceRecord, Trend } from "./types";

const MAX_RECENT = 24;

/** Registro vacío inicializado a partir de un precio base. */
export function emptyRecord(base: number): PriceRecord {
  return { lastSale: base, avg: base, min: base, max: base, recent: [] };
}

/** Recalcula avg/min/max a partir del array de ventas recientes. */
function recompute(record: PriceRecord): PriceRecord {
  const prices = record.recent.map((r) => r.price);
  if (prices.length === 0) return record;
  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    ...record,
    lastSale: prices[prices.length - 1],
    avg: Math.round(sum / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

/** Añade una venta al historial y actualiza las estadísticas. */
export function pushSale(record: PriceRecord, price: number, at: number): PriceRecord {
  const recent = [...record.recent, { price, at }].slice(-MAX_RECENT);
  return recompute({ ...record, recent });
}

/**
 * Calcula la tendencia comparando la media de las ventas recientes con las
 * anteriores. Umbral del 3 % para considerar "subiendo"/"bajando".
 */
export function computeTrend(record: PriceRecord): Trend {
  const r = record.recent;
  if (r.length < 4) return "stable";
  const half = Math.floor(r.length / 2);
  const older = r.slice(0, half).map((x) => x.price);
  const newer = r.slice(half).map((x) => x.price);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const o = mean(older);
  const n = mean(newer);
  if (n > o * 1.03) return "up";
  if (n < o * 0.97) return "down";
  return "stable";
}

export const TREND_META: Record<Trend, { icon: string; label: string; color: string }> = {
  up: { icon: "📈", label: "Subiendo", color: "#37e6a0" },
  down: { icon: "📉", label: "Bajando", color: "#ff5c8a" },
  stable: { icon: "➖", label: "Estable", color: "#8b96a3" },
};
