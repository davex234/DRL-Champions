/**
 * RETRY ENGINE (Fase 6/7) — decide reintentos de forma DETERMINISTA: backoff exponencial,
 * máximo de intentos y cancelación. No conoce providers ni red: envuelve cualquier thunk.
 *
 * Determinista: `sleep` y `now` se inyectan (no-op en tests) → mismos intentos/retardos siempre.
 */

/** Retardo (ms) del intento `attempt` (1-based) con backoff exponencial acotado. */
export function backoffDelay(attempt, { base = 200, factor = 2, maxDelay = 30000 } = {}) {
  return Math.min(maxDelay, Math.round(base * Math.pow(factor, Math.max(0, attempt - 1))));
}

export function shouldRetry(attempt, max) {
  return attempt < max;
}

/**
 * Ejecuta `fn(attempt)` con reintentos. Considera fallo si lanza o si el resultado trae
 * `ready===false` u `ok===false`. Devuelve { ok, attempts, retries, result, delays, error }.
 */
export async function withRetry(fn, { max = 3, base = 200, factor = 2, maxDelay = 30000, sleep = async () => {}, onAttempt = () => {} } = {}) {
  const delays = [];
  let attempt = 0, lastError = null, result = null;
  while (attempt < max) {
    attempt++;
    onAttempt(attempt);
    try {
      result = await fn(attempt);
      const ok = !!result && result.ready !== false && result.ok !== false;
      if (ok) return { ok: true, attempts: attempt, retries: attempt - 1, result, delays, error: null };
      lastError = (result && result.error) || "resultado no satisfactorio";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      result = null;
    }
    if (shouldRetry(attempt, max)) {
      const d = backoffDelay(attempt, { base, factor, maxDelay });
      delays.push(d);
      await sleep(d);
    }
  }
  return { ok: false, attempts: attempt, retries: attempt - 1, result, delays, error: lastError };
}

export const RetryEngine = { backoffDelay, shouldRetry, withRetry };
export default RetryEngine;
