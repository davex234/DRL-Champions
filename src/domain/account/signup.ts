import { ns } from "@/i18n/runtime";

const t = ns("account");

/**
 * F86.2 · REGISTRO: lo que el formulario comprueba ANTES de llamar a GoTrue.
 *
 * El alta (`handle_new_user`) guarda `coalesce(username, parte local del correo) || '_' || 4 del id`. Un nombre vacío
 * convertiría la parte local del CORREO en el nombre público: por eso el nombre es obligatorio aquí y nunca puede
 * parecer un correo. El servidor añade un sufijo corto (`_3f2a`) para que sea único; la pantalla lo dice.
 * La contraseña pide 8 (lo mismo que el formulario de recuperación y que el mensaje de «contraseña débil»; GoTrue
 * acepta desde 6, así que el cliente es más estricto, nunca menos).
 */
export const SIGNUP_NAME_MIN = 3;
export const SIGNUP_NAME_MAX = 16;
export const SIGNUP_PASSWORD_MIN = 8;

const NAME_RE = /^[\p{L}\p{N}_.-]+$/u;

/** Error en castellano o `null` si el nombre vale. */
export function signupNameError(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return t("Elige un nombre de jugador: así te verán los demás.");
  if (name.includes("@")) return t("El nombre de jugador no puede ser un correo.");
  if (name.length < SIGNUP_NAME_MIN) return t("El nombre de jugador necesita al menos {SIGNUP_NAME_MIN} caracteres.", { SIGNUP_NAME_MIN });
  if (name.length > SIGNUP_NAME_MAX) return t("El nombre de jugador puede tener como mucho {SIGNUP_NAME_MAX} caracteres.", { SIGNUP_NAME_MAX });
  if (!NAME_RE.test(name)) return t("Usa solo letras, números, guion, punto o guion bajo (sin espacios).");
  return null;
}

export function signupPasswordError(password: string): string | null {
  return password.length < SIGNUP_PASSWORD_MIN ? t("La contraseña necesita al menos {SIGNUP_PASSWORD_MIN} caracteres.", { SIGNUP_PASSWORD_MIN }) : null;
}

/** El nombre que se envía (sin espacios alrededor). */
export const signupName = (raw: string): string => raw.trim();
