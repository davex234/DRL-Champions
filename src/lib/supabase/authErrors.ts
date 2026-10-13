/**
 * FASE 68 · ERRORES DE AUTH EN LENGUAJE DE JUGADOR.
 *
 * La beta cerrada encontró que el formulario de /cuenta enseñaba el texto crudo de GoTrue, en inglés («Invalid login
 * credentials», «User already registered»). Aquí se traduce por `code` (supabase-js ≥ 2.6x lo trae) y, como respaldo, por
 * el mensaje conocido. Nada nuevo se revela: «correo o contraseña incorrectos» es el mismo texto exista o no la cuenta, y
 * un mensaje desconocido NO se reenvía tal cual (podría ser técnico): sale uno neutro.
 */
export interface AuthErrorLike { message?: string; code?: string | null; status?: number | null }

const BY_CODE: Record<string, string> = {
  invalid_credentials: "Correo o contraseña incorrectos.",
  user_already_exists: "Ya hay una cuenta con ese correo. Entra con tu contraseña o recupérala desde «Recuperar».",
  email_exists: "Ya hay una cuenta con ese correo. Entra con tu contraseña o recupérala desde «Recuperar».",
  email_not_confirmed: "Tienes que confirmar tu correo antes de entrar.",
  weak_password: "Esa contraseña es demasiado débil: usa al menos 8 caracteres.",
  same_password: "La contraseña nueva tiene que ser distinta de la actual.",
  email_address_invalid: "Ese correo no es válido.",
  validation_failed: "Revisa el correo y la contraseña.",
  over_email_send_rate_limit: "Has pedido demasiados correos. Espera un poco e inténtalo de nuevo.",
  over_request_rate_limit: "Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo.",
  signup_disabled: "Ahora mismo no se pueden crear cuentas nuevas.",
  user_banned: "Esta cuenta no puede entrar ahora mismo.",
  session_expired: "Tu sesión ha caducado. Vuelve a entrar.",
  reauthentication_needed: "Vuelve a entrar para cambiar la contraseña.",
};

const BY_MESSAGE: [RegExp, string][] = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/user already registered|already been registered/i, BY_CODE.user_already_exists],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/password should be at least|password is too weak/i, BY_CODE.weak_password],
  [/should be different from the old password/i, BY_CODE.same_password],
  [/unable to validate email address|invalid format|email address .* is invalid/i, BY_CODE.email_address_invalid],
  [/rate limit|too many requests|security purposes/i, BY_CODE.over_request_rate_limit],
  [/failed to fetch|network|fetch failed/i, "No hay conexión con el servidor. Inténtalo de nuevo."],
];

export const AUTH_FALLBACK = "No se pudo completar. Inténtalo de nuevo.";

/** Mensaje en español para un error de Supabase Auth. Nunca devuelve el texto crudo del proveedor. */
export function authErrorMessage(err: AuthErrorLike | null | undefined): string {
  if (!err) return AUTH_FALLBACK;
  if (err.code && BY_CODE[err.code]) return BY_CODE[err.code];
  const msg = err.message ?? "";
  for (const [re, text] of BY_MESSAGE) if (re.test(msg)) return text;
  if (err.status === 429) return BY_CODE.over_request_rate_limit;
  return AUTH_FALLBACK;
}

/**
 * F68 · ENLACES DE CORREO QUE NO SIRVEN. GoTrue devuelve al jugador a /cuenta con el error en la URL
 * (`#error=access_denied&error_code=otp_expired&error_description=…`) cuando el enlace de recuperación o confirmación ha
 * caducado o ya se usó. Antes la pantalla enseñaba el formulario normal sin decir nada. Devuelve el aviso, o null.
 */
export function authLinkError(fragment: string): string | null {
  const raw = fragment.replace(/^[#?]/, "");
  if (!raw) return null;
  const q = new URLSearchParams(raw);
  const error = q.get("error"), code = q.get("error_code");
  if (!error && !code) return null;
  if (code === "otp_expired" || /expired/i.test(q.get("error_description") ?? "")) {
    return "El enlace ha caducado o ya se usó. Pide uno nuevo desde «Recuperar».";
  }
  return "El enlace no es válido. Pide uno nuevo desde «Recuperar».";
}
