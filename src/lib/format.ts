import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const nf = new Intl.NumberFormat("es-ES");

/** Formatea créditos con separador de miles: 12500 -> "12.500". */
export function formatCredits(n: number): string {
  return nf.format(Math.round(n));
}

/** Tiempo relativo desde un timestamp: "hace 3 h", "hace 2 d". */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

/** Formatea grandes números de forma compacta: 12500 -> "12,5 K". */
export function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(".", ",")} K`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
}
