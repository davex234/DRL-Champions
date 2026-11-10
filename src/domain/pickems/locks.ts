/**
 * F87 · EL CIERRE DE UNA PREDICCIÓN (puro) — espejo EXACTO de `pickem_match_locked` (0071).
 *
 * La autoridad es la base de datos (su `now()`, dentro de la RPC). Esto existe para PINTAR (cuenta atrás, candados)
 * y para que el servidor Node sepa qué descendientes siguen abiertos al calcular la invalidación; si discrepara de
 * la BD por un instante, la BD rechaza y el cliente recarga. Nunca se usa el reloj del navegador para decidir.
 *
 *   cerrado ⇔ ámbito no publicado · partido anulado · sin fila real · estado real ≠ «upcoming»
 *             · (política de fase y ya pasó su cierre) · ahora ≥ cierre efectivo
 *   cierre efectivo = reprogramado ? min(reprogramación, inicio real) : min(cierre congelado, inicio real)
 *
 * Una reprogramación de la fuente a MÁS TARDE no reabre (el congelado manda); a MÁS PRONTO, cierra antes.
 */
export interface LockInput {
  bracketStatus: string;
  lockPolicy: "MATCH" | "STAGE";
  stageLockAt: string | null;
  lockAt: string;
  lockOverrideAt: string | null;
  voided: boolean;
  realStatus: string | null;
  realStart: string | null;
}

const t = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
};
const least = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

/** Momento del cierre efectivo (ms) o `null` si no hay ninguno. */
export function effectiveLockAt(i: LockInput): number | null {
  const start = t(i.realStart);
  const base = i.lockOverrideAt ? least(t(i.lockOverrideAt), start) : least(t(i.lockAt), start);
  const stage = i.lockPolicy === "STAGE" ? t(i.stageLockAt) : null;
  return least(base, stage);
}

export function isLockedAt(i: LockInput, now: number): boolean {
  if (i.bracketStatus !== "PUBLISHED" || i.voided || i.realStatus === null) return true;
  if ((i.realStatus || "upcoming").toLowerCase() !== "upcoming") return true;
  const at = effectiveLockAt(i);
  return at !== null && now >= at;
}
