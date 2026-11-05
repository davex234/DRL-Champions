/**
 * F58 · REDACCIÓN DE SECRETOS — nada que parezca una credencial sale del servidor ni entra en el registro.
 *
 * Se aplica a los `detail` del registro de auditoría (al escribir y al leer) y a cualquier volcado de configuración
 * del panel. Por NOMBRE de clave (password, token, secret, key, authorization, cookie, service_role…) y por FORMA del
 * valor (JWT, cabeceras Bearer, cadenas de conexión postgres://).
 */
const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|service[_-]?role|authorization|cookie|jwt|private[_-]?key|refresh|access[_-]?key|connection[_-]?string|dsn)/i;
const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const BEARER = /^bearer\s+/i;
const CONN = /^(postgres(ql)?|mysql|redis|mongodb(\+srv)?):\/\//i;

export const REDACTED = "[redactado]";

export function looksSecret(value: unknown): boolean {
  return typeof value === "string" && (JWT.test(value) || BEARER.test(value) || CONN.test(value));
}

export function redactSecrets<T>(input: T, depth = 0): T {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) || looksSecret(v) ? REDACTED : redactSecrets(v, depth + 1);
    }
    return out as T;
  }
  return (looksSecret(input) ? REDACTED : input) as T;
}
