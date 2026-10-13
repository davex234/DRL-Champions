/**
 * I18N · CONTENIDO EDITABLE (CMS / base de datos) — traducciones OPCIONALES con español de respaldo.
 *
 * El contenido que se escribe en el panel (nombre de un sobre nuevo, título de una misión, de un set, de una
 * temporada…) se guarda en español y así se queda: ni se reescribe ni se le añade nada. Sus traducciones, si existen,
 * son una capa aparte, con la misma forma que todo el sistema: TEXTO ESPAÑOL → traducción, por idioma.
 *
 *   contenido (BD)          «Sobre Aniversario»                     ← no se toca
 *   capa opcional           en: { "Sobre Aniversario": "Anniversary Pack" }
 *   en pantalla             td(pack.name) → "Anniversary Pack"; sin capa → «Sobre Aniversario»
 *
 * La capa se registra como un módulo más del catálogo (`content`), así que `td()` —que ya pinta todo el texto que llega
 * como dato— la encuentra sin tocar ningún componente. Reglas:
 *   · lo que está traducido en el CÓDIGO manda (la capa solo rellena lo que el código no conoce);
 *   · una traducción con variables `{n}` distintas de las de su texto fuente se descarta (se vería rota);
 *   · una entrada vacía, demasiado larga o no textual se descarta; nunca se muestra una clave.
 *
 * De dónde sale la capa: `GET /api/content/i18n?locale=<idioma>` (tabla aditiva `content_translations`, ver
 * `docs/i18n/proposals/`). Con `CONTENT_TRANSLATIONS_ENABLED = false` no se pide nada y todo queda como hoy.
 */
import { DEFAULT_LOCALE, type Locale } from "./config";
import { registerCatalog } from "./runtime";

export const CONTENT_MODULE = "content";
export const CONTENT_MAX_ENTRIES = 5000;
export const CONTENT_MAX_LENGTH = 600;

/** texto español → traducción */
export type ContentTranslations = Record<string, string>;

const varsOf = (s: string) => [...s.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(",");

/** Deja solo las entradas que se pueden pintar con seguridad. Pura. */
export function sanitizeContentTranslations(input: unknown): ContentTranslations {
  const out: ContentTranslations = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const [source, target] of Object.entries(input as Record<string, unknown>)) {
    if (n >= CONTENT_MAX_ENTRIES) break;
    if (typeof target !== "string") continue;
    const s = source.trim(), t = target.trim();
    if (!s || !t || s.length > CONTENT_MAX_LENGTH || t.length > CONTENT_MAX_LENGTH) continue;
    if (varsOf(s) !== varsOf(t)) continue;
    out[s] = t;
    n++;
  }
  return out;
}

/** Registra la capa de un idioma. Devuelve cuántas entradas han entrado. En español no hace nada. */
export function registerContentTranslations(locale: Locale, input: unknown): number {
  if (locale === DEFAULT_LOCALE) return 0;
  const clean = sanitizeContentTranslations(input);
  const count = Object.keys(clean).length;
  if (count) registerCatalog(locale, { [CONTENT_MODULE]: clean });
  return count;
}
