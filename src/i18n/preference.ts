/**
 * I18N · PREFERENCIA DE IDIOMA (pura: la decisión, sin efectos).
 *
 * PRECEDENCIA — de mayor a menor:
 *   1. Preferencia guardada en ESTE dispositivo (`localStorage`).
 *   2. Idioma de la cuenta (`user_metadata.locale`), si hay sesión.
 *   3. Idioma del navegador, si es uno de los cuatro.
 *   4. Español.
 *
 * CUANDO HAY LAS DOS (dispositivo y cuenta) Y NO COINCIDEN gana la elección MÁS RECIENTE (cada una guarda su fecha):
 *   · cambias el idioma en el móvil → el PC lo adopta al abrir (sincronización entre dispositivos);
 *   · eliges un idioma como invitado y luego inicias sesión en una cuenta con otro más antiguo → se respeta lo que
 *     acabas de elegir y se sube a la cuenta.
 * Nada se sobrescribe «porque sí»: solo una elección EXPLÍCITA del jugador tiene fecha. Un idioma detectado del
 * navegador nunca se guarda en la cuenta ni pisa una preferencia existente.
 */
import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from "./config";

export interface StoredLocale { locale: Locale; at: number }

export type LocaleSource = "device" | "account" | "browser" | "default";

export interface LocaleDecision {
  locale: Locale;
  source: LocaleSource;
  /** Hay que copiar la decisión al dispositivo (viene de la cuenta). */
  writeDevice: StoredLocale | null;
  /** Hay que subir la decisión a la cuenta (el dispositivo es más reciente, o la cuenta no tenía idioma). */
  writeAccount: StoredLocale | null;
}

/** Lee `{"locale":"de","at":1730000000000}`; cualquier otra cosa (corrupta, idioma desconocido) → `null`. */
export function parseStoredLocale(raw: unknown): StoredLocale | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return isLocale(raw) ? { locale: raw, at: 0 } : null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { locale?: unknown; at?: unknown };
  if (!isLocale(o.locale)) return null;
  const at = typeof o.at === "number" && Number.isFinite(o.at) && o.at >= 0 ? o.at : 0;
  return { locale: o.locale, at };
}

/** `user_metadata` de GoTrue → preferencia de la cuenta (lo escribe el propio usuario: se valida igual). */
export function accountLocaleOf(metadata: unknown): StoredLocale | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (!isLocale(m.locale)) return null;
  const at = typeof m.locale_at === "number" && Number.isFinite(m.locale_at) && m.locale_at >= 0 ? m.locale_at : 0;
  return { locale: m.locale, at };
}

export function decideLocale(input: {
  device: StoredLocale | null;
  /** `undefined` = sin sesión (o aún no se sabe); `null` = con sesión, la cuenta no tiene idioma. */
  account: StoredLocale | null | undefined;
  browserLanguages: readonly unknown[] | null | undefined;
}): LocaleDecision {
  const { device, account } = input;
  if (device && account) {
    if (device.locale === account.locale) return { locale: device.locale, source: "device", writeDevice: null, writeAccount: null };
    return account.at > device.at
      ? { locale: account.locale, source: "account", writeDevice: account, writeAccount: null }
      : { locale: device.locale, source: "device", writeDevice: null, writeAccount: device };
  }
  if (device) return { locale: device.locale, source: "device", writeDevice: null, writeAccount: account === null ? device : null };
  if (account) return { locale: account.locale, source: "account", writeDevice: account, writeAccount: null };
  const browser = negotiateLocale(input.browserLanguages);
  const matched = (input.browserLanguages ?? []).length > 0 && (browser !== DEFAULT_LOCALE || negotiatedIsSpanish(input.browserLanguages));
  return { locale: browser, source: matched ? "browser" : "default", writeDevice: null, writeAccount: null };
}

function negotiatedIsSpanish(languages: readonly unknown[] | null | undefined): boolean {
  return (languages ?? []).some((l) => typeof l === "string" && l.trim().toLowerCase().split(/[-_]/)[0] === "es");
}
