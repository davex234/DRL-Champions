/**
 * I18N · AUDITOR — extrae el texto fuente del código y comprueba los catálogos de cada idioma.
 *
 *   npm run i18n:extract     reescribe src/i18n/messages/es/<módulo>.json (la lista canónica de textos) y audita
 *   npm run i18n:audit       solo audita; sale con 1 si hay algo que impida publicar un idioma
 *
 * QUÉ DENUNCIA (errores)
 *   · texto visible sin internacionalizar   lo que el codemod habría envuelto y nadie envolvió
 *   · clave dinámica                        `t(variable)`: no se puede extraer (para datos se usa `td`)
 *   · clave ausente / traducción vacía      un texto fuente sin traducción en un idioma
 *   · variables incompatibles               la traducción no usa las mismas `{variables}` que el original
 *   · plural incompleto                     falta la rama `other`
 *   · clave huérfana                        traducción de un texto que ya no existe en el código
 *   · catálogo `es` desfasado               el código cambió y no se ha vuelto a extraer
 * Y AVISA DE
 *   · traducciones inconsistentes           el mismo texto traducido de dos maneras en módulos distintos
 *   · glosario                              un término del glosario traducido de otra forma
 *   · posible sin traducir                  traducción idéntica al español en un texto con palabras españolas
 */
import ts from "typescript";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MESSAGES_DIR, ROOT, SRC, TARGET_LOCALES, acceptsText, isCodeLike, enclosingFunction, isExtractOnly, isPluralBranch, isSentence, jsxTagOf, jsxTextValue,
  listSourceFiles, namespaceOf, parseFile, positionOf, reachability, rel, skipJsxTextIn, staticTextOfTemplate, templateToMessage, type Position,
} from "./core";
import { messagePlaceholders, messagePluralCategories } from "../../src/i18n/icu";

const WRITE = process.argv.includes("--write");
const QUIET = process.argv.includes("--quiet");

interface Finding { file: string; line: number; text: string }
const sources = new Map<string, Map<string, string>>(); // módulo → texto → primera referencia
const unwrapped: Finding[] = [];
const dynamic: Finding[] = [];
const add = (nsName: string, source: string, ref: string) => {
  if (!source.trim() || isCodeLike(source) || ignored?.has(source)) return;
  let m = sources.get(nsName);
  if (!m) sources.set(nsName, (m = new Map()));
  if (!m.has(source)) m.set(source, ref);
};

const extra: { add?: Record<string, string[]>; ignore?: string[] } = existsSync(join(SRC, "i18n", "extra-sources.json")) ? JSON.parse(readFileSync(join(SRC, "i18n", "extra-sources.json"), "utf8")) : {};
const ignored = new Set(extra.ignore ?? []);
for (const [n, list] of Object.entries(extra.add ?? {})) for (const x of list) add(n, x, "src/i18n/extra-sources.json");

const reach = reachability();

for (const file of listSourceFiles()) {
  const client = reach.client.has(file);
  if (!client && !reach.server.has(file)) continue;
  const r = rel(file);
  const extractOnly = isExtractOnly(r) || !client;
  const { sf, text } = parseFile(file);
  const nsName = namespaceOf(r);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  // nombres locales de `ns` y `td`, y traductores `const t = ns("módulo")`
  let NS = "", TD = "";
  const translators = new Map<string, string>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === "@/i18n/runtime") {
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) { const orig = (el.propertyName ?? el.name).text; if (orig === "ns") NS = el.name.text; if (orig === "td") TD = el.name.text; }
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (NS && d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === NS && ts.isIdentifier(d.name)) {
        const a = d.initializer.arguments[0];
        if (a && ts.isStringLiteralLike(a)) translators.set(d.name.text, a.text);
      }
    }
  }

  const insideTranslatorCall = (n: ts.Node): boolean => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && (translators.has(p.expression.text) || p.expression.text === TD) && p.arguments[0] && n.pos >= p.arguments[0].pos && n.end <= p.arguments[0].end) return true;
    }
    return false;
  };
  const relaxed = (pos: Position): Position => (pos.kind === "never" && pos.why === "error" ? { kind: "other" } : pos);

  /**
   * Tabla de etiquetas de módulo: `const BUCKET_LABEL = { common: "Común", rare: "Rara" }`. Sus valores son texto aunque
   * sean una sola palabra y cuelguen de claves que no dicen nada («common»): se pintan con `td(TABLA[x])`.
   */
  const inLabelTable = (n: ts.Node, value: string): boolean => {
    if (enclosingFunction(n) || !/\p{L}{3,}/u.test(value) || /^[a-z0-9_\-:./]+$/.test(value) || /^[A-Z0-9_]+$/.test(value)) return false;
    for (let q = n.parent; q; q = q.parent) {
      if (ts.isPropertyAssignment(q) && q.name === n) return false;
      if (ts.isVariableDeclaration(q)) return ts.isIdentifier(q.name) && /(LABEL|LABELS|TITLE|TITLES|NAME|NAMES|TEXT|TEXTS|COPY|HINT|HINTS|DESC|DESCRIPTION|DESCRIPTIONS|TAGLINE|VERB|VERBS|WORD|WORDS)$/.test(q.name.text);
      if (!(ts.isObjectLiteralExpression(q) || ts.isArrayLiteralExpression(q) || ts.isPropertyAssignment(q) || ts.isAsExpression(q) || ts.isSatisfiesExpression(q) || ts.isParenthesizedExpression(q))) return false;
    }
    return false;
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && translators.has(n.expression.text)) {
      const a = n.arguments[0];
      if (a && ts.isStringLiteralLike(a)) add(translators.get(n.expression.text)!, a.text, `${r}:${lineOf(n)}`);
      else dynamic.push({ file: r, line: lineOf(n), text: n.getText().slice(0, 80) });
      n.arguments.slice(1).forEach(visit);
      return;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "plural") {
      for (const a of n.arguments.slice(1, 3)) if (ts.isStringLiteralLike(a)) add(nsName, a.text, `${r}:${lineOf(n)}`);
    }
    if (ts.isJsxText(n)) {
      if (!extractOnly && enclosingFunction(n) && !skipJsxTextIn(jsxTagOf(n))) {
        const v = jsxTextValue(n.text);
        if (v && acceptsText(v.core, { kind: "child" })) unwrapped.push({ file: r, line: lineOf(n), text: v.core });
      }
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (insideTranslatorCall(n)) return;
      const isTpl = ts.isTemplateExpression(n);
      const value = isTpl ? staticTextOfTemplate(n) : n.text;
      const marked = text.slice(n.getFullStart(), n.getStart()).includes("i18n-id");
      const raw = positionOf(n);
      const pos = relaxed(raw);
      const ok = marked || inLabelTable(n, value) || (acceptsText(value, pos) && !(ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent))) || (!isTpl && pos.kind !== "never" && isPluralBranch(n));
      if (ok) {
        const message = isTpl ? templateToMessage(n)?.message : n.text.trim();
        const dataOnly = marked || extractOnly || !enclosingFunction(n) || raw.kind === "never";
        if (message) {
          if (dataOnly) add(nsName, message, `${r}:${lineOf(n)}`);
          else unwrapped.push({ file: r, line: lineOf(n), text: message });
        }
      }
      if (!isTpl) return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

/* ─────────────────────────── catálogo español (lista canónica) ─────────────────────────── */

const readJson = (p: string): Record<string, string> => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
const sortObj = (o: Record<string, string>) => Object.fromEntries(Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, o[k]]));
const esDir = join(MESSAGES_DIR, "es");
const namespaces = [...sources.keys()].sort();
let stale = 0;
if (WRITE) {
  mkdirSync(esDir, { recursive: true });
  for (const f of existsSync(esDir) ? readdirSync(esDir) : []) if (f.endsWith(".json") && !sources.has(f.slice(0, -5))) rmSync(join(esDir, f));
}
for (const name of namespaces) {
  const want = sortObj(Object.fromEntries([...sources.get(name)!.keys()].map((k) => [k, k])));
  const file = join(esDir, `${name}.json`);
  const body = JSON.stringify(want, null, 2) + "\n";
  if (WRITE) writeFileSync(file, body, "utf8");
  else if (!existsSync(file) || readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== body) stale++;
}

/* ─────────────────────────── comprobación de cada idioma ─────────────────────────── */

const glossary: Record<string, Record<string, string>> = existsSync(join(SRC, "i18n", "glossary.json")) ? JSON.parse(readFileSync(join(SRC, "i18n", "glossary.json"), "utf8")) : {};
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

interface LocaleReport { missing: number; empty: number; vars: string[]; plural: string[]; orphan: string[]; inconsistent: string[]; glossary: string[]; maybeUntranslated: number; translated: number; byNs: Record<string, { total: number; done: number }> }
const report: Record<string, LocaleReport> = {};
let totalKeys = 0;
for (const name of namespaces) totalKeys += sources.get(name)!.size;

for (const locale of TARGET_LOCALES) {
  const rep: LocaleReport = { missing: 0, empty: 0, vars: [], plural: [], orphan: [], inconsistent: [], glossary: [], maybeUntranslated: 0, translated: 0, byNs: {} };
  const seen = new Map<string, { value: string; ns: string }>();
  const dir = join(MESSAGES_DIR, locale);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) if (f.endsWith(".json") && !sources.has(f.slice(0, -5))) rep.orphan.push(`${f} (módulo inexistente)`);
  for (const name of namespaces) {
    const src = sources.get(name)!;
    const tr = readJson(join(dir, `${name}.json`));
    const stat = (rep.byNs[name] = { total: src.size, done: 0 });
    for (const k of Object.keys(tr)) if (!src.has(k)) rep.orphan.push(`${name}: ${k.slice(0, 70)}`);
    for (const k of src.keys()) {
      const v = tr[k];
      if (v === undefined) { rep.missing++; continue; }
      if (typeof v !== "string" || !v.trim()) { rep.empty++; continue; }
      stat.done++; rep.translated++;
      if (!same(messagePlaceholders(k), messagePlaceholders(v))) rep.vars.push(`${name}: «${k.slice(0, 60)}» → «${v.slice(0, 60)}»`);
      for (const [vn, cats] of Object.entries(messagePluralCategories(v))) if (!cats.includes("other")) rep.plural.push(`${name}: «${k.slice(0, 60)}» ({${vn}} sin «other»)`);
      if (k.startsWith(" ") !== v.startsWith(" ") || k.endsWith(" ") !== v.endsWith(" ")) rep.vars.push(`${name}: espacios de borde distintos en «${k.slice(0, 60)}»`);
      const prev = seen.get(k);
      if (prev && prev.value !== v) rep.inconsistent.push(`«${k.slice(0, 50)}»: ${prev.ns}=«${prev.value.slice(0, 40)}» / ${name}=«${v.slice(0, 40)}»`);
      else if (!prev) seen.set(k, { value: v, ns: name });
      const g = glossary[k]?.[locale];
      if (g && g !== v) rep.glossary.push(`${name}: «${k}» debe ser «${g}», es «${v}»`);
      if (v === k && isSentence(k) && k.length > 12) rep.maybeUntranslated++;
    }
  }
  report[locale] = rep;
}

mkdirSync(join(ROOT, "logs", "i18n"), { recursive: true });
writeFileSync(join(ROOT, "logs", "i18n", "audit.json"), JSON.stringify({ namespaces: namespaces.length, totalKeys, unwrapped, dynamic, stale, report }, null, 2), "utf8");

let errors = unwrapped.length + dynamic.length + stale;
console.log(`I18N · ${namespaces.length} módulos · ${totalKeys} textos fuente`);
console.log(`  texto visible sin internacionalizar: ${unwrapped.length}`);
console.log(`  claves dinámicas: ${dynamic.length}`);
if (!WRITE) console.log(`  catálogos «es» desfasados: ${stale}`);
for (const locale of TARGET_LOCALES) {
  const r = report[locale];
  errors += r.missing + r.empty + r.vars.length + r.plural.length + r.orphan.length + r.glossary.length;
  console.log(`  [${locale}] traducidos ${r.translated}/${totalKeys} · ausentes ${r.missing} · vacíos ${r.empty} · variables ${r.vars.length} · plural ${r.plural.length} · huérfanas ${r.orphan.length} · glosario ${r.glossary.length} · (avisos: inconsistentes ${r.inconsistent.length}, ¿sin traducir? ${r.maybeUntranslated})`);
}
if (!QUIET) {
  for (const u of unwrapped.slice(0, 25)) console.log(`    sin i18n  ${u.file}:${u.line}  ${u.text.slice(0, 90)}`);
  for (const d of dynamic.slice(0, 10)) console.log(`    dinámica  ${d.file}:${d.line}  ${d.text}`);
  for (const locale of TARGET_LOCALES) for (const kind of ["vars", "plural", "orphan", "glossary"] as const) for (const x of report[locale][kind].slice(0, 8)) console.log(`    [${locale}] ${kind}  ${x}`);
}
console.log(errors ? `RESULTADO: ${errors} problema(s). Detalle en logs/i18n/audit.json` : "RESULTADO: sin problemas.");
process.exit(errors && !WRITE ? 1 : 0);
