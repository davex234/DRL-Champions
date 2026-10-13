/**
 * I18N · CONFIGURACIÓN (pura: sin React, sin navegador, sin servidor).
 *
 * Ocho idiomas (2026-10-12: + francés, portugués de Portugal, portugués de Brasil y japonés). El español es el idioma de ORIGEN: el texto español escrito en el código es la clave de cada
 * mensaje (`t("Abrir sobre")`), así que nunca puede verse una clave en pantalla — si falta una traducción, se ve
 * el español. Añadir un idioma = añadirlo a `LOCALES` y traducir `src/i18n/messages/<idioma>/*.json`.
 */
export const LOCALES = ["es", "en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

/** Cómo se presenta cada idioma en el selector (en su propio idioma: no se traduce). */
export const LOCALE_INFO: Record<Locale, { flag: string; flagFile: string; name: string; intl: string; og: string }> = {
  es: { flag: "🇪🇸", flagFile: "/walkout/flags/es.svg", name: "Español", intl: "es-ES", og: "es_ES" },
  en: { flag: "🇬🇧", flagFile: "/flags/gb.svg", name: "English", intl: "en-GB", og: "en_GB" },
  de: { flag: "🇩🇪", flagFile: "/flags/de.svg", name: "Deutsch", intl: "de-DE", og: "de_DE" },
  it: { flag: "🇮🇹", flagFile: "/flags/it.svg", name: "Italiano", intl: "it-IT", og: "it_IT" },
  fr: { flag: "🇫🇷", flagFile: "/flags/fr.svg", name: "Français", intl: "fr-FR", og: "fr_FR" },
  // `pt.svg` vive en `/walkout/flags/` como `es.svg`: `/flags` es el registro de países de las cartas (test A4).
  "pt-PT": { flag: "🇵🇹", flagFile: "/walkout/flags/pt.svg", name: "Português (PT)", intl: "pt-PT", og: "pt_PT" },
  "pt-BR": { flag: "🇧🇷", flagFile: "/flags/br.svg", name: "Português (BR)", intl: "pt-BR", og: "pt_BR" },
  ja: { flag: "🇯🇵", flagFile: "/flags/jp.svg", name: "日本語", intl: "ja-JP", og: "ja_JP" },
};

/** Preferencia local del dispositivo (`localStorage`). */
export const LOCALE_STORAGE_KEY = "vr.locale";
/** Copia en cookie: es lo único que el servidor ve de la preferencia (la sesión vive en localStorage). */
export const LOCALE_COOKIE = "vr_locale";
/** Claves en `user_metadata` de la cuenta (GoTrue): sin migración. */
export const ACCOUNT_LOCALE_KEY = "locale";
export const ACCOUNT_LOCALE_AT_KEY = "locale_at";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * `de-AT` → `de`; `EN_us` → `en`; lo que no sea uno de los ocho → `null`.
 * El portugués es el único con variante regional: `pt-BR` (cualquier etiqueta con la región BR) → `pt-BR`; `pt`,
 * `pt-PT` y el resto de regiones (`pt-AO`, `pt-MZ`…) → `pt-PT`.
 */
export function matchLocale(tag: unknown): Locale | null {
  if (typeof tag !== "string") return null;
  const parts = tag.trim().toLowerCase().split(/[-_]/);
  const base = parts[0];
  if (base === "pt") return parts.slice(1).includes("br") ? "pt-BR" : "pt-PT";
  return isLocale(base) ? base : null;
}

/** Primer idioma soportado de la lista del navegador (en su orden de preferencia); si ninguno, español. */
export function negotiateLocale(languages: readonly unknown[] | null | undefined): Locale {
  for (const l of languages ?? []) {
    const m = matchLocale(l);
    if (m) return m;
  }
  return DEFAULT_LOCALE;
}

/** Cabecera `Accept-Language` → lista ordenada por `q` (para el servidor). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const w = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), w: Number.isFinite(w) ? w : 0, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.tag);
}

/** Valor de la cookie de idioma dentro de una cabecera `Cookie` (validado contra la lista). */
export function localeFromCookieHeader(cookie: string | null | undefined): Locale | null {
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === LOCALE_COOKIE) return matchLocale(part.slice(eq + 1).trim());
  }
  return null;
}
