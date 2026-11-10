/**
 * I18N · CODEMOD DE FORMATO — quita el `"es-ES"` fijo de números y fechas en el código que llega al navegador.
 *
 *   x.toLocaleString("es-ES", o)                 → x.toLocaleString(getIntlLocale(), o)
 *   new Intl.NumberFormat("es-ES", o)            → new Intl.NumberFormat(getIntlLocale(), o)      (dentro de una función)
 *   const nf = new Intl.NumberFormat("es-ES", o) → const nf = lazyNumberFormat(o)                  (constante de módulo:
 *                                                   se crearía una sola vez, antes de conocer el idioma)
 * El servidor (API, servicios) no se toca: responde en español canónico.
 *
 *   npx tsx scripts/i18n/codemod-intl.ts [--write]
 */
import ts from "typescript";
import { writeFileSync } from "node:fs";
import { enclosingFunction, isExtractOnly, listSourceFiles, parseFile, reachability, rel } from "./core";

const WRITE = process.argv.includes("--write");
const reach = reachability();
const isEs = (n: ts.Node | undefined): boolean => !!n && ((ts.isStringLiteralLike(n) && /^es(-ES)?$/.test(n.text)) || (ts.isArrayLiteralExpression(n) && n.elements.length === 1 && isEs(n.elements[0])));
let total = 0, files = 0;

for (const file of listSourceFiles()) {
  const r = rel(file);
  if (!reach.client.has(file) || isExtractOnly(r)) continue;
  const { sf, text } = parseFile(file);
  const edits: { start: number; end: number; text: string }[] = [];
  const need = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^toLocale(String|DateString|TimeString)$/.test(n.expression.name.text) && isEs(n.arguments[0])) {
      edits.push({ start: n.arguments[0].getStart(), end: n.arguments[0].end, text: "getIntlLocale()" });
      need.add("getIntlLocale");
    }
    if (ts.isNewExpression(n) && n.arguments && isEs(n.arguments[0])) {
      const callee = n.expression.getText();
      const m = /^Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat|Collator)$/.exec(callee);
      if (m) {
        const lazy = m[1] === "NumberFormat" ? "lazyNumberFormat" : m[1] === "DateTimeFormat" ? "lazyDateTimeFormat" : null;
        if (!enclosingFunction(n) && lazy) {
          const rest = n.arguments.slice(1).map((a) => a.getText()).join(", ");
          edits.push({ start: n.getStart(), end: n.end, text: `${lazy}(${rest})` });
          need.add(lazy);
        } else if (enclosingFunction(n)) {
          edits.push({ start: n.arguments[0].getStart(), end: n.arguments[0].end, text: "getIntlLocale()" });
          need.add("getIntlLocale");
        } else console.log(`  REVISAR (módulo, sin envoltorio perezoso): ${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${callee}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  total += edits.length; files++;
  if (!WRITE) continue;

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const runtime = imports.find((i) => ts.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text === "@/i18n/runtime");
  const have = new Set<string>();
  if (runtime?.importClause?.namedBindings && ts.isNamedImports(runtime.importClause.namedBindings)) for (const el of runtime.importClause.namedBindings.elements) have.add((el.propertyName ?? el.name).text);
  const missing = [...need].filter((x) => !have.has(x));
  if (missing.length) {
    if (runtime) {
      const nb = runtime.importClause!.namedBindings as ts.NamedImports;
      const last = nb.elements[nb.elements.length - 1];
      edits.push({ start: last.end, end: last.end, text: `, ${missing.join(", ")}` });
    } else {
      const directive = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client");
      const anchor = imports.length ? imports[imports.length - 1].end : directive ? directive.end : 0;
      const line = `import { ${missing.join(", ")} } from "@/i18n/runtime";`;
      edits.push({ start: anchor, end: anchor, text: anchor === 0 ? line + eol + eol : eol + line });
    }
  }
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start || (a.end - a.start === 0 ? 1 : -1))) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  writeFileSync(file, out, "utf8");
}
console.log(`${WRITE ? "APLICADO" : "ENSAYO"} · ${total} formatos en ${files} ficheros`);
