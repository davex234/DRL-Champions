/**
 * F58 · AJUSTE ADMINISTRATIVO DE CRÉDITOS — reglas puras.
 *
 * El panel NO escribe un saldo: pide una OPERACIÓN explícita (añadir / retirar, cantidad, motivo). La ejecuta
 * `app_admin_adjust_credits` (0055), que pasa por la ÚNICA puerta que mueve saldo (`_ledger_apply`, 0019) —asiento en
 * `credit_transactions` con `balance_after`— y deja el rastro en `content_audit_log` en la MISMA transacción.
 *
 * Tres protecciones que viven aquí y en la RPC a la vez:
 *   · tope por operación (un error de tecleo no puede crear un millón de créditos);
 *   · saldo esperado: si otro admin (o el propio jugador) movió el saldo entre la vista previa y la confirmación, se
 *     rechaza en vez de aplicar sobre un número que el admin no vio;
 *   · clave de idempotencia por gesto: un doble clic o un reintento de red no aplica dos veces.
 */
import { cleanReason, isUuid, type Parsed, REASON_MIN, REASON_MAX } from "./sanctions";

export const CREDIT_ADJUST_MAX = 100_000;
export type CreditDirection = "add" | "remove";

export interface CreditAdjustInput {
  userId: string;
  direction: CreditDirection;
  amount: number;
  reason: string;
  expectedBalance: number;
  ref: string;
}

const REF = /^[A-Za-z0-9_-]{8,80}$/;

export function parseCreditAdjust(body: Record<string, unknown>): Parsed<CreditAdjustInput> {
  if (!isUuid(body.userId)) return { ok: false, error: "Usuario inválido" };
  const direction = body.direction;
  if (direction !== "add" && direction !== "remove") return { ok: false, error: "Operación inválida (añadir o retirar)" };
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > CREDIT_ADJUST_MAX) return { ok: false, error: `Cantidad inválida (1–${CREDIT_ADJUST_MAX.toLocaleString("es-ES")})` };
  const reason = cleanReason(body.reason);
  if (!reason) return { ok: false, error: `El motivo es obligatorio (${REASON_MIN}–${REASON_MAX} caracteres)` };
  const expectedBalance = Number(body.expectedBalance);
  if (!Number.isSafeInteger(expectedBalance) || expectedBalance < 0) return { ok: false, error: "Falta el saldo que se revisó" };
  if (typeof body.ref !== "string" || !REF.test(body.ref)) return { ok: false, error: "Falta la clave de la operación" };
  return { ok: true, value: { userId: body.userId, direction, amount, reason, expectedBalance, ref: body.ref } };
}

export const signedDelta = (i: Pick<CreditAdjustInput, "direction" | "amount">): number => (i.direction === "add" ? i.amount : -i.amount);

/** Vista previa: saldo actual → cambio → saldo final. `ok:false` si dejaría el saldo en negativo. */
export function previewAdjust(balance: number, i: Pick<CreditAdjustInput, "direction" | "amount">): { before: number; delta: number; after: number; ok: boolean } {
  const delta = signedDelta(i);
  return { before: balance, delta, after: balance + delta, ok: balance + delta >= 0 };
}

/** La clave que llega a la RPC: con prefijo propio, para que nunca choque con un `ref` del juego. */
export const adminCreditRef = (ref: string): string => `admin:credits:${ref}`;
