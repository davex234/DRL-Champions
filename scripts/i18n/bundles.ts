/**
 * I18N · GENERA LOS TROZOS POR IDIOMA a partir de `src/i18n/messages/<idioma>/<módulo>.json`.
 *
 *   src/i18n/bundles/<idioma>.ts          juego (un trozo, se descarga solo si el jugador usa ese idioma)
 *   src/i18n/bundles/<idioma>.admin.ts    administración (aparte)
 *   src/i18n/bundles/all.ts               todo, para tests y herramientas
 *
 *   npm run i18n:bundles
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_NAMESPACES, MESSAGES_DIR, SRC, TARGET_LOCALES } from "./core";

const OUT = join(SRC, "i18n", "bundles");
mkdirSync(OUT, { recursive: true });
const HEADER = "// GENERADO por scripts/i18n/bundles.ts — no editar a mano. Las traducciones viven en src/i18n/messages/.\n";
/** `pt-BR` → `ptBR`: el idioma como identificador de JavaScript. */
const lid = (locale: string) => locale.replace(/[^A-Za-z0-9]/g, "");
const ident = (ns: string) => `m_${ns.replace(/[^A-Za-z0-9]/g, "_")}`;

function emit(file: string, locale: string, names: string[]): void {
  const lines = [HEADER, `import type { Catalog } from "../runtime";`];
  for (const n of names) lines.push(`import ${ident(n)} from "../messages/${locale}/${n}.json";`);
  lines.push("", `const catalog: Catalog = {`, ...names.map((n) => `  ${JSON.stringify(n)}: ${ident(n)},`), `};`, "", `export default catalog;`, "");
  writeFileSync(join(OUT, file), lines.join("\n"), "utf8");
}

const all: string[] = [HEADER, `import type { Catalog } from "../runtime";`, `import type { Locale } from "../config";`];
for (const locale of TARGET_LOCALES) {
  const dir = join(MESSAGES_DIR, locale);
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : [];
  emit(`${locale}.ts`, locale, names.filter((n) => !ADMIN_NAMESPACES.has(n)));
  emit(`${locale}.admin.ts`, locale, names.filter((n) => ADMIN_NAMESPACES.has(n)));
  all.push(`import ${lid(locale)} from "./${locale}";`, `import ${lid(locale)}Admin from "./${locale}.admin";`);
  console.log(`${locale}: ${names.length} módulos`);
}
all.push("", `export const ALL_CATALOGS: Record<Exclude<Locale, "es">, Catalog> = {`, ...TARGET_LOCALES.map((l) => `  ${JSON.stringify(l)}: { ...${lid(l)}, ...${lid(l)}Admin },`), `};`, "");
writeFileSync(join(OUT, "all.ts"), all.join("\n"), "utf8");
