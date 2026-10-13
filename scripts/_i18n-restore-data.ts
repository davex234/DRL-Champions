/**
 * I18N · cierre (instrumento): claves RETIRADAS al unir fragmentos que siguen vivas como DATO.
 *
 * Al convertir «{n} {t("de")} {m}» en frases enteras, los trozos sueltos quedaron huérfanos y se retiraron. Pero `td()`
 * traduce cualquier texto que esté en algún catálogo: un dato («equipo», «clase») podía estar traduciéndose gracias a
 * un trozo homónimo. Aquí se cruzan las claves retiradas (catálogos de la copia previa) con los literales del código
 * que NO son argumento de un traductor; las coincidencias se devuelven a `extra-sources.json` (módulo `data`) con la
 * traducción que tenían.
 *
 *   npx tsx scripts/_i18n-restore-data.ts <carpeta con messages/ de antes> [--write]
 */
import ts from "typescript";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES_DIR, listSourceFiles, parseFile, reachability, rel, translatorsOf } from "./i18n/core";

const OLD = process.argv[2];
const WRITE = process.argv.includes("--write");
const load = (dir: string, l: string) => { const out = new Map<string, string>(); for (const f of readdirSync(join(dir, l))) for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(dir, l, f), "utf8")) as Record<string, string>)) if (!out.has(k)) out.set(k, v); return out; };
const oldEs = load(OLD, "es"), nowEs = load(MESSAGES_DIR, "es");
const removed = new Set([...oldEs.keys()].filter((k) => !nowEs.has(k)));

const reach = reachability();
const data = new Map<string, string>();
for (const file of listSourceFiles()) {
  if (!reach.client.has(file) && !reach.server.has(file)) continue;
  const { sf } = parseFile(file);
  const tr = translatorsOf(sf);
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && removed.has(n.text)) {
      const p = n.parent;
      const inT = ts.isCallExpression(p) && ts.isIdentifier(p.expression) && tr.has(p.expression.text) && p.arguments[0] === n;
      const technical = ts.isImportDeclaration(p) || ts.isLiteralTypeNode(p) || (ts.isJsxAttribute(p) && /^(className|href|src|id|key|type|role)$/.test(p.name.getText()));
      if (!inT && !technical && !data.has(n.text)) data.set(n.text, `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const old = { en: load(OLD, "en"), de: load(OLD, "de"), it: load(OLD, "it") };
const translations: Record<string, Record<string, string>> = {};
for (const [k, at] of [...data].sort()) {
  translations[k] = { en: old.en.get(k) ?? "", de: old.de.get(k) ?? "", it: old.it.get(k) ?? "" };
  console.log(`${JSON.stringify(k).padEnd(34)} ${at.padEnd(60)} ${translations[k].en} | ${translations[k].de} | ${translations[k].it}`);
}
console.log(`retiradas ${removed.size} · vivas como dato ${data.size}`);
if (WRITE) writeFileSync(join("logs", "i18n", "final", "tr-restore.json"), JSON.stringify({ translations, dataSources: [...data.keys()].sort(), skipped: [], testsTouched: [], notes: "claves retiradas que siguen vivas como dato (td)" }, null, 1));
