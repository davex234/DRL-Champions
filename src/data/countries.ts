/**
 * Mapa de código ISO (2 letras) → nombre del país en español.
 * Usado en la vista de inspección y para banderas reales.
 */
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getIntlLocale, getLocale } from "@/i18n/runtime";

export const COUNTRIES: Record<string, string> = {
  GB: "Reino Unido",
  ES: "España",
  TR: "Turquía",
  US: "Estados Unidos",
  KR: "Corea del Sur",
  CN: "China",
  BR: "Brasil",
  FI: "Finlandia",
  SE: "Suecia",
  RU: "Rusia",
  MA: "Marruecos",
  CA: "Canadá",
  BE: "Bélgica",
  DK: "Dinamarca",
  FR: "Francia",
  DE: "Alemania",
  JP: "Japón",
};

export function countryName(iso: string): string {
  return localizedCountryName(iso) ?? COUNTRIES[iso?.toUpperCase()] ?? iso;
}

/**
 * i18n · nombre del país en el idioma ACTIVO cuando no es español (`Intl.DisplayNames`: los 249 códigos, sin catálogo).
 * En español devuelve `null`: manda la tabla de arriba, que es la que fijan los datos y los tests.
 */
const regionNamesByLocale = new Map<string, Intl.DisplayNames | null>();
export function localizedCountryName(iso: string): string | null {
  const code = (iso ?? "").toUpperCase();
  if (getLocale() === DEFAULT_LOCALE || !/^[A-Z]{2}$/.test(code) || code === "ZZ") return null;
  const tag = getIntlLocale();
  let names = regionNamesByLocale.get(tag);
  if (names === undefined) { try { names = new Intl.DisplayNames([tag], { type: "region" }); } catch { names = null; } regionNamesByLocale.set(tag, names); }
  const name = names?.of(code);
  return name && name !== code && !/unknown|unbekannt|sconosciut/i.test(name) ? name : null;
}

/** Nombres de país (es/en) → código ISO, para importadores. */
const NAME_TO_ISO: Record<string, string> = {
  "reino unido": "GB",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  inglaterra: "GB",
  españa: "ES",
  spain: "ES",
  turquía: "TR",
  turkey: "TR",
  "estados unidos": "US",
  "united states": "US",
  usa: "US",
  "corea del sur": "KR",
  "south korea": "KR",
  korea: "KR",
  china: "CN",
  brasil: "BR",
  brazil: "BR",
  finlandia: "FI",
  finland: "FI",
  suecia: "SE",
  sweden: "SE",
  rusia: "RU",
  russia: "RU",
  marruecos: "MA",
  morocco: "MA",
  canadá: "CA",
  canada: "CA",
  bélgica: "BE",
  belgium: "BE",
  dinamarca: "DK",
  denmark: "DK",
  francia: "FR",
  france: "FR",
  alemania: "DE",
  germany: "DE",
  japón: "JP",
  japan: "JP",
};

/** Resuelve un país (código ISO de 2 letras o nombre) a ISO de 2 letras. */
export function toIso(country: string): string {
  if (!country) return "";
  const c = country.trim();
  if (c.length === 2) return c.toUpperCase();
  return NAME_TO_ISO[c.toLowerCase()] ?? c.toUpperCase();
}
