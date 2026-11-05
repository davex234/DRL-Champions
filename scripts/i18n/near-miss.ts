/**
 * I18N · CASI-TEXTOS — cadenas dentro de funciones del cliente que las reglas NO consideran texto visible pero lo parecen
 * (una palabra con mayúscula inicial, una frase corta sin palabras «delatoras»). Es una lista para revisar a ojo:
 * lo que de verdad sea texto se envuelve a mano o se añade a `--apply <fichero>` (una línea `ruta:línea` por caso).
 *
 *   npx tsx scripts/i18n/near-miss.ts                 lista → logs/i18n/near-miss.txt
 *   npx tsx scripts/i18n/near-miss.ts --apply lista   envuelve en t("…") los casos de esa lista
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, acceptsText, enclosingFunction, isExtractOnly, isPluralBranch, listSourceFiles, namespaceOf, parseFile, positionOf, reachability, rel } from "./core";

const applyAt = process.argv.indexOf("--apply");
const wanted = applyAt > 0 ? new Set(readFileSync(process.argv[applyAt + 1], "utf8").split(/\r?\n/).map((l) => l.split("\t")[0].trim()).filter(Boolean)) : null;
const reach = reachability();
const out: string[] = [];
let applied = 0;

for (const file of listSourceFiles()) {
  const r = rel(file);
  if (!reach.client.has(file) || isExtractOnly(r)) continue;
  const { sf, text } = parseFile(file);
  let NS = "";
  let T = "";
  const idents = new Set<string>();
  const scan = (n: ts.Node) => { if (ts.isIdentifier(n)) idents.add(n.text); ts.forEachChild(n, scan); };
  scan(sf);
  let runtime: ts.ImportDeclaration | null = null;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === "@/i18n/runtime") {
      runtime = st;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if ((el.propertyName ?? el.name).text === "ns") NS = el.name.text;
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (NS && d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === NS && ts.isIdentifier(d.name)) T = d.name.text;
    }
  }
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === T || /^(td|i18nTd|i18nData)$/.test(n.expression.text))) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && enclosingFunction(n)) {
      const s = n.text.trim();
      const pos = positionOf(n);
      const marked = text.slice(n.getFullStart(), n.getStart()).includes("i18n-id");
      if (!marked && pos.kind !== "never" && !acceptsText(n.text, pos) && !isPluralBranch(n) && !ts.isPropertyAccessExpression(n.parent) && !ts.isElementAccessExpression(n.parent)) {
        const looks = /^[¿¡]?\p{Lu}\p{Ll}{2,}([ \-·:,.!?…]|$)/u.test(s) || (/\p{Ll}{3,}\s+\p{L}{2,}/u.test(s) && !/[=<>{}()[\];$\\/_]|^\s*[a-z]+(-[a-z0-9[\]./%]+)+/.test(s) && !/\b(px|rem|rgba?|var|calc|flex|grid|text-|bg-|border|shadow|opacity|inset|ease|translate|scale|rotate)\b/.test(s));
        if (looks && s.length <= 160) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const key = `${r}:${line}`;
          out.push(`${key}\t${pos.kind}${"name" in pos ? `:${pos.name}` : ""}\t${s}`);
          if (wanted?.has(key)) edits.push({ start: n.getStart(), end: n.end, text: `${ts.isJsxAttribute(n.parent) ? "{" : ""}__T__(${JSON.stringify(n.text)})${ts.isJsxAttribute(n.parent) ? "}" : ""}` });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (!T) {
    T = ["t", "tr", "i18nT", "i18nTranslate"].find((x) => !idents.has(x))!;
    const nsName = NS || (idents.has("ns") ? "i18nNs" : "ns");
    const imports = sf.statements.filter(ts.isImportDeclaration);
    const directive = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client");
    const anchor = imports.length ? imports[imports.length - 1].end : directive ? directive.end : 0;
    let head = "";
    if (!NS) {
      if (runtime) { const nb = runtime.importClause!.namedBindings as ts.NamedImports; const last = nb.elements[nb.elements.length - 1]; edits.push({ start: last.end, end: last.end, text: `, ${nsName === "ns" ? "ns" : `ns as ${nsName}`}` }); }
      else head += `import { ${nsName === "ns" ? "ns" : `ns as ${nsName}`} } from "@/i18n/runtime";${eol}`;
    }
    head += `${eol}const ${T} = ${nsName}(${JSON.stringify(namespaceOf(r))});`;
    edits.push({ start: anchor, end: anchor, text: anchor === 0 ? head + eol + eol : eol + head });
  }
  let res = text;
  for (const e of edits.sort((a, b) => b.start - a.start || (a.end - a.start === 0 ? 1 : -1))) res = res.slice(0, e.start) + e.text.replace("__T__", T) + res.slice(e.end);
  writeFileSync(file, res, "utf8");
  applied += edits.filter((e) => e.text.includes("__T__")).length;
}
if (wanted) console.log(`envueltos: ${applied}`);
else { writeFileSync(join(ROOT, "logs", "i18n", "near-miss.txt"), out.join("\n"), "utf8"); console.log(`casi-textos: ${out.length} → logs/i18n/near-miss.txt`); }
