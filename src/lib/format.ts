import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/*
 * `useGrouping: "always"` no es un adorno. Por omisión, `es-ES` NO agrupa los números de
 * cuatro dígitos: 5000 salía «5000» y 13500 salía «13.500», así que la misma moneda se
 * mostraba de dos maneras según la cifra. Con los paquetes de DRL Credits —1.000, 2.800,
 * 5.000— eso se veía en la propia tienda.
 */
const nf = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

/** Formatea DRL Credits con separador de miles: 5000 -> "5.000", 12500 -> "12.500". */
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

/**
 * «1 punto» / «2 puntos». En español el singular no es opcional, y la interfaz
 * enseñaba «1 pts» en el primer escalón de recompensa, que es el que más se ve.
 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${Math.abs(n) === 1 ? one : many}`;
}
