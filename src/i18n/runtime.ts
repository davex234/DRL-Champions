/**
 * I18N · NÚCLEO (isomorfo: lo usan componentes, dominio puro y servidor).
 *
 *   import { ns } from "@/i18n/runtime";
 *   const t = ns("store");
 *   t("Comprar")                              → "Buy" / "Kaufen" / "Acquista" (o el español si falta)
 *   t("Tienes {n} sobres", { n })             → variables
 *   td(pack.name)                             → texto que llega como DATO (tablas, respuesta del servidor, BD)
 *
 * El texto español es la clave. La búsqueda es: catálogo del módulo → cualquier otro módulo → el propio español.
 * Por eso nunca se muestra una clave y un idioma a medio traducir degrada a español, no a un hueco.
 *
 * IDIOMA ACTIVO. En el navegador es un valor global que cambia `I18nProvider`. En el servidor cada petición lleva el
 * suyo (`AsyncLocalStorage`, ver `i18n/server.ts`): por eso el estado vive en `globalThis` (Next empaqueta rutas e
 * instrumentación por separado y un `let` de módulo no se compartiría).
 */
import { DEFAULT_LOCALE, LOCALE_INFO, type Locale } from "./config";
import { formatMessage, type MessageVars } from "./icu";

/** módulo → texto español → traducción */
export type Catalog = Record<string, Record<string, string>>;

interface State {
  locale: Locale;
  catalogs: Partial<Record<Locale, Catalog>>;
  flat: Partial<Record<Locale, Record<string, string>>>;
  listeners: Set<() => void>;
  resolver: (() => Locale | undefined) | null;
  version: number;
}

const G = globalThis as unknown as { __vrI18n?: State };
const S: State = (G.__vrI18n ??= { locale: DEFAULT_LOCALE, catalogs: {}, flat: {}, listeners: new Set(), resolver: null, version: 0 });

/** Idioma con el que se traduce AHORA (el de la petición en el servidor; el del jugador en el navegador). */
export function getLocale(): Locale {
  return S.resolver?.() ?? S.locale;
}

/** `es-ES`, `en-GB`… para `Intl`. */
export function getIntlLocale(): string {
  return LOCALE_INFO[getLocale()].intl;
}

export function setActiveLocale(locale: Locale): void {
  if (S.locale === locale) return;
  S.locale = locale;
  S.version++;
  for (const l of [...S.listeners]) l();
}

export function subscribeLocale(listener: () => void): () => void {
  S.listeners.add(listener);
  return () => { S.listeners.delete(listener); };
}

/** Cambia con cada cambio de idioma o de catálogos: lo que `useSyncExternalStore` necesita. */
export function i18nVersion(): number {
  return S.version;
}

/** Solo servidor: de dónde sale el idioma de la petición en curso. */
export function setLocaleResolver(resolver: (() => Locale | undefined) | null): void {
  S.resolver = resolver;
}

/** Añade (fusiona) traducciones de un idioma. Idempotente. */
export function registerCatalog(locale: Locale, catalog: Catalog): void {
  const cur = (S.catalogs[locale] ??= {});
  for (const [name, entries] of Object.entries(catalog)) cur[name] = { ...cur[name], ...entries };
  delete S.flat[locale];
  S.version++;
  for (const l of [...S.listeners]) l();
}

export function hasCatalog(locale: Locale, name?: string): boolean {
  if (locale === DEFAULT_LOCALE) return true;
  const c = S.catalogs[locale];
  return name ? !!c?.[name] : !!c;
}

function flatOf(locale: Locale): Record<string, string> {
  let f = S.flat[locale];
  if (f) return f;
  f = {};
  const c = S.catalogs[locale] ?? {};
  // `common` primero: es la traducción canónica de un texto que se repite en varios módulos.
  for (const name of ["common", ...Object.keys(c).filter((n) => n !== "common")]) {
    for (const [k, v] of Object.entries(c[name] ?? {})) if (v && !(k in f)) f[k] = v;
  }
  return (S.flat[locale] = f);
}

function lookup(locale: Locale, name: string | null, source: string): string {
  if (locale === DEFAULT_LOCALE) return source;
  const own = name ? S.catalogs[locale]?.[name]?.[source] : undefined;
  return own || flatOf(locale)[source] || source;
}

export function translate(name: string | null, source: string, vars?: MessageVars, locale: Locale = getLocale()): string {
  return formatMessage(lookup(locale, name, source), vars, LOCALE_INFO[locale].intl);
}

export type Translator = (source: string, vars?: MessageVars) => string;

/** Traductor de un módulo. Se crea una vez por fichero; lee el idioma en cada llamada. */
export function ns(name: string): Translator {
  return (source, vars) => translate(name, source, vars);
}

/**
 * Texto que llega como DATO (etiqueta de una tabla, error del servidor, nombre de un sobre guardado en la BD).
 * Si está en algún catálogo se traduce; si no (nombre de jugador, de equipo, marca), se devuelve intacto.
 */
export function td<T>(source: T, vars?: MessageVars): T {
  if (typeof source !== "string" || !source) return source;
  const locale = getLocale();
  if (locale === DEFAULT_LOCALE) return (vars ? formatMessage(source, vars, LOCALE_INFO[locale].intl) : source) as T;
  if (vars) return formatMessage(flatOf(locale)[source] || source, vars, LOCALE_INFO[locale].intl) as T;
  return translateData(locale, source, 0) as T;
}

/**
 * `td` con el SENTIDO de un módulo. `td` no sabe de qué módulo viene el dato: resuelve por un índice plano en el que gana
 * `common` y después el primer módulo del catálogo (alfabético en los trozos generados), así que una etiqueta con dos sentidos («Final» = partido
 * terminado / la final; «Bloqueado» = sin desbloquear / jugador bloqueado) puede salir con el del módulo equivocado.
 * Aquí se mira primero el catálogo del módulo que DEFINE la tabla y, si no la tiene, se hace exactamente lo que `td`.
 *
 *   tdIn("social", RELATION_LABEL[r])     // la tabla vive en `domain/social` → módulo «social»
 */
export function tdIn<T>(name: string, source: T, vars?: MessageVars): T {
  if (typeof source !== "string" || !source) return source;
  const locale = getLocale();
  if (locale !== DEFAULT_LOCALE) {
    const own = S.catalogs[locale]?.[name]?.[source];
    if (own) return (vars ? formatMessage(own, vars, LOCALE_INFO[locale].intl) : own) as T;
  }
  return td(source, vars);
}

/*
 * TEXTO COMPUESTO EN EL SERVIDOR. La API responde en español canónico («Necesitas 3.000 créditos»): su contrato no
 * cambia con el idioma del jugador. El cliente reconoce el mensaje por su plantilla («Necesitas {n} créditos», que el
 * auditor extrae del código del servidor) y lo recompone traducido con los mismos valores.
 */
interface Pattern { re: RegExp; names: string[]; target: string; weight: number }
const patternLists: Partial<Record<Locale, Pattern[]>> = {};
const patternHits = new Map<string, string>();

function patternsOf(locale: Locale): Pattern[] {
  const cached = patternLists[locale];
  if (cached && (cached as Pattern[] & { v?: number }).v === S.version) return cached;
  const list: Pattern[] & { v?: number } = [];
  for (const [source, target] of Object.entries(flatOf(locale))) {
    if (!source.includes("{") || source.includes(", plural,")) continue;
    const names: string[] = [];
    let literal = 0;
    const body = source.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/).map((part) => {
      const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(part);
      if (m) { names.push(m[1]); return "([\\s\\S]+?)"; }
      literal += part.trim().length;
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    if (literal < 6 || !names.length) continue;
    list.push({ re: new RegExp(`^${body}$`), names, target, weight: literal });
  }
  list.sort((a, b) => b.weight - a.weight);
  list.v = S.version;
  patternHits.clear();
  return (patternLists[locale] = list);
}

const lowerIndex: Partial<Record<Locale, Record<string, string> & { __v?: string }>> = {};
function lowerOf(locale: Locale): Record<string, string> {
  const cur = lowerIndex[locale];
  if (cur && cur.__v === String(S.version)) return cur;
  const out: Record<string, string> & { __v?: string } = {};
  for (const [k, v] of Object.entries(flatOf(locale))) { const l = k.toLowerCase(); if (!(l in out)) out[l] = v; }
  out.__v = String(S.version);
  return (lowerIndex[locale] = out);
}

const NUMERIC = /^[\d\s.,:%+\-−×x#/]+$/;

/**
 * Traduce un texto-dato: exacto → (misma frase con otra capitalización) → plantilla (sus valores se traducen a su vez)
 * → por tramos separados con « · ». Lo que no se reconoce se devuelve intacto.
 */
function translateData(locale: Locale, source: string, depth: number): string {
  const exact = flatOf(locale)[source];
  if (exact) return exact;
  if (depth > 2 || source.length > 400 || source.length < 4 || !/\p{L}{3,}/u.test(source)) return source;
  const key = `${locale}\u0000${source}`;
  const hit = patternHits.get(key);
  if (hit !== undefined) return hit;
  let out = source;
  const relaxed = /\s/.test(source) ? lowerOf(locale)[source.toLowerCase()] : undefined;
  if (relaxed && !relaxed.includes("{")) out = relaxed;
  else if (/\S\s+\S/.test(source)) {
    for (const p of patternsOf(locale)) {
      const m = p.re.exec(source);
      if (!m) continue;
      // una plantilla con poco texto fijo («{n} créditos») solo vale para cifras: «Tus créditos» no es «{n} créditos»
      if (p.weight < 12 && !m.slice(1).every((x) => NUMERIC.test(x))) continue;
      const vars: MessageVars = {};
      p.names.forEach((n, i) => { if (!(n in vars)) vars[n] = translateData(locale, m[i + 1], depth + 1); });
      out = formatMessage(p.target, vars, LOCALE_INFO[locale].intl);
      break;
    }
    if (out === source && source.includes(" · ")) {
      const parts = source.split(" · ");
      const done = parts.map((x) => translateData(locale, x, depth + 1));
      if (done.some((x, i) => x !== parts[i])) out = done.join(" · ");
    }
  }
  if (patternHits.size > 3000) patternHits.clear();
  patternHits.set(key, out);
  return out;
}

/* ─────────────────────────── números y fechas por idioma ─────────────────────────── */

const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

/** `useGrouping: "always"`: `es-ES` no agrupa los números de cuatro cifras por omisión (5000 salía «5000»). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions, locale: Locale = getLocale()): string {
  const key = `${locale}|${options ? JSON.stringify(options) : ""}`;
  let f = numberCache.get(key);
  if (!f) numberCache.set(key, (f = new Intl.NumberFormat(LOCALE_INFO[locale].intl, { useGrouping: "always", ...options } as Intl.NumberFormatOptions)));
  return f.format(n);
}

/** 0.175 → «17,5 %» (es/de/it) o «17.5%» (en): el mismo valor, con el formato de cada idioma. */
export function formatPercent(fraction: number, maximumFractionDigits = 1, locale: Locale = getLocale()): string {
  return formatNumber(fraction, { style: "percent", maximumFractionDigits }, locale);
}

export function formatDate(value: Date | number | string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }, locale: Locale = getLocale()): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateCache.get(key);
  if (!f) dateCache.set(key, (f = new Intl.DateTimeFormat(LOCALE_INFO[locale].intl, options)));
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : f.format(d);
}

/** Solo para tests: deja el estado como al arrancar. */
export function __resetI18nForTests(): void {
  S.locale = DEFAULT_LOCALE;
  S.catalogs = {};
  S.flat = {};
  S.resolver = null;
  S.version++;
}

/**
 * Formateadores para constantes de MÓDULO (`const nf = lazyNumberFormat(opts)`): un `new Intl.NumberFormat(...)` de
 * módulo se crea una sola vez, antes de conocer el idioma del jugador; estos eligen el idioma en cada llamada.
 */
export function lazyNumberFormat(options?: Intl.NumberFormatOptions): Pick<Intl.NumberFormat, "format" | "formatToParts"> {
  const pick = () => {
    const key = `lazy|${getLocale()}|${options ? JSON.stringify(options) : ""}`;
    let f = numberCache.get(key);
    if (!f) numberCache.set(key, (f = new Intl.NumberFormat(getIntlLocale(), options)));
    return f;
  };
  return { format: (n: number | bigint) => pick().format(n), formatToParts: (n?: number | bigint) => pick().formatToParts(n) } as Pick<Intl.NumberFormat, "format" | "formatToParts">;
}

export function lazyDateTimeFormat(options?: Intl.DateTimeFormatOptions): Pick<Intl.DateTimeFormat, "format" | "formatToParts"> {
  const pick = () => {
    const key = `lazy|${getLocale()}|${options ? JSON.stringify(options) : ""}`;
    let f = dateCache.get(key);
    if (!f) dateCache.set(key, (f = new Intl.DateTimeFormat(getIntlLocale(), options)));
    return f;
  };
  return { format: (d?: Date | number) => pick().format(d), formatToParts: (d?: Date | number) => pick().formatToParts(d) };
}
