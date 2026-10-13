/**
 * I18N · sonda: cómo sale un texto de DATOS (`td`) en cada idioma. Lee los textos de un JSON (array) o de los argumentos.
 *   npx tsx scripts/_i18n-td-probe.ts "Sobre ICON · 1 carta: Filipinas MEGA"   |   npx tsx scripts/_i18n-td-probe.ts @fichero.json
 */
import { readFileSync } from "node:fs";
import { ALL_CATALOGS } from "../src/i18n/bundles/all";
import { registerCatalog, setActiveLocale, td } from "../src/i18n/runtime";
import type { Locale } from "../src/i18n/config";

const args = process.argv.slice(2);
const texts: string[] = args[0]?.startsWith("@") ? JSON.parse(readFileSync(args[0].slice(1), "utf8")) : args;
for (const [l, c] of Object.entries(ALL_CATALOGS)) registerCatalog(l as Locale, c);
for (const s of texts) {
  console.log(`es     ${s}`);
  for (const l of Object.keys(ALL_CATALOGS)) { setActiveLocale(l as Locale); console.log(`${l.padEnd(6)} ${td(s)}`); }
}
