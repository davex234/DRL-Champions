/**
 * I18N · CODEMOD DE DATOS — envuelve en `td(…)` las expresiones de TIPO string que se pintan (hijo de JSX, atributo
 * visible o variable de un mensaje `t("… {x} …", { x })`). Decide con el comprobador de tipos, no por el nombre.
 *
 * `td` traduce si el texto está en algún catálogo (etiqueta de una tabla, estado, error del servidor) y devuelve lo
 * demás intacto (nombre de jugador, de equipo, cifra). Se excluye lo que identifica a una persona o un recurso.
 *
 *   npx tsx scripts/i18n/codemod-td.ts            ensayo
 *   npx tsx scripts/i18n/codemod-td.ts --write
 */
import ts from "typescript";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, isExtractOnly, isVisibleAttr, listSourceFiles, reachability, rel } from "./core";

const WRITE = process.argv.includes("--write");
const IDENTITY = /^(username|userName|nickname|nick|displayName|publicName|email|handle|tag|accountTag|id|uid|uuid|slug|href|url|src|code|query|search|className|class|style|key|path|route|locale|lang|password|token|avatar|emoji|flag|icon|glyph|symbol|initials|abbr|short|iso|hex|color|tone)$/i;
const ID_SUFFIX = /(Id|Ids|_id|Uid|Key|Slug|Url|Href|Src|Tag|Code|Version|_version|Hash|Token|Email|Hex|Color|Class|ClassName|Path|Iso|Nick|Username|Provider|Channel|Source|Bucket|Region|Timestamp|At|Date)$/;
const PERSON_NAME = /^(name|player|playerName|team|teamName|teamTag|rival|rivalName|opponent|opponentName|owner|ownerName|author|winner|loser|mvp|friend|nick|org|orgName|country|city)$/i;
const NAME_OWNERS = /^(pack|mode|mission|tier|rank|set|reward|product|offer|item|recipe|event|season|role|edition|rarity|option|opt|o|tab|section|step|stat|category|cat|filter|sort|objective|quest|challenge|achievement|badge|trophy|division|league|phase|stage|track|theme|preset|plan|bundle|slot|def|meta|config|cfg|group|kind|variant|modeInfo|agent|map|ability)$/i;

const files = listSourceFiles();
const reach = reachability();
const targets = files.filter((f) => reach.client.has(f) && !isExtractOnly(rel(f)));
const cfg = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true, incremental: false } });
const checker = program.getTypeChecker();

function stringish(t: ts.Type): boolean {
  if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
  if (t.isUnion()) {
    let some = false;
    for (const p of t.types) {
      if (p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
      if (!(p.flags & ts.TypeFlags.StringLike)) return false;
      some = true;
    }
    return some;
  }
  return !!(t.flags & ts.TypeFlags.StringLike);
}

/** Una unión de literales sin letras con espacios ni acentos («sm» | «md») es un identificador, no texto. */
function looksLikeIds(t: ts.Type): boolean {
  const parts = t.isUnion() ? t.types : [t];
  const lits = parts.filter((p) => p.isStringLiteral()) as ts.StringLiteralType[];
  if (!lits.length || lits.length !== parts.filter((p) => !(p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))).length) return false;
  return lits.every((l) => /^[a-z0-9_\-:./]*$/.test(l.value) || /^[A-Z0-9_]+$/.test(l.value) && !/\s/.test(l.value) && l.value.length <= 3);
}

function finalName(e: ts.Expression): { name: string; owner: string } {
  if (ts.isIdentifier(e)) return { name: e.text, owner: "" };
  if (ts.isPropertyAccessExpression(e)) {
    const o = e.expression;
    return { name: e.name.text, owner: ts.isIdentifier(o) ? o.text : ts.isPropertyAccessExpression(o) ? o.name.text : ts.isElementAccessExpression(o) ? "item" : "" };
  }
  if (ts.isElementAccessExpression(e)) return { name: "", owner: "" };
  return { name: "?", owner: "" };
}

let total = 0, changed = 0;
const sample: string[] = [];
for (const file of targets) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const text = sf.text;
  let NS = "", TD = "";
  const translators = new Set<string>();
  const idents = new Set<string>();
  let runtimeImport: ts.ImportDeclaration | null = null;
  const scan = (n: ts.Node) => { if (ts.isIdentifier(n)) idents.add(n.text); ts.forEachChild(n, scan); };
  scan(sf);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === "@/i18n/runtime") {
      runtimeImport = st;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) { const o = (el.propertyName ?? el.name).text; if (o === "ns") NS = el.name.text; if (o === "td") TD = el.name.text; }
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (NS && d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === NS && ts.isIdentifier(d.name)) translators.add(d.name.text);
    }
  }
  const hadTD = !!TD;
  if (!TD) TD = ["td", "i18nTd", "i18nData"].find((n) => !idents.has(n))!;

  const edits: { start: number; end: number; text: string }[] = [];
  const wrapLeaf = (e: ts.Expression) => {
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
    if (ts.isConditionalExpression(x)) { wrapLeaf(x.whenTrue); wrapLeaf(x.whenFalse); return; }
    if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { wrapLeaf(x.left); wrapLeaf(x.right); return; }
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { wrapLeaf(x.right); return; }
    if (!(ts.isIdentifier(x) || ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x))) return;
    if (ts.isIdentifier(x) && (x.text === "undefined" || x.text === "children")) return;
    const { name, owner } = finalName(x);
    if (IDENTITY.test(name) || ID_SUFFIX.test(name)) return;
    if (PERSON_NAME.test(name) && !NAME_OWNERS.test(owner)) return;
    let type: ts.Type;
    try { type = checker.getTypeAtLocation(x); } catch { return; }
    if (!stringish(type) || looksLikeIds(type)) return;
    edits.push({ start: x.getStart(), end: x.end, text: `${TD}(${text.slice(x.getStart(), x.end)})` });
    if (sample.length < 400) sample.push(`${rel(file)}:${sf.getLineAndCharacterOfPosition(x.getStart()).line + 1}\t${x.getText().slice(0, 70)}`);
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === TD && hadTD) return; // ya envuelto
      if (translators.has(n.expression.text)) {
        const vars = n.arguments[1];
        if (vars && ts.isObjectLiteralExpression(vars)) {
          for (const p of vars.properties) {
            if (ts.isPropertyAssignment(p)) wrapLeaf(p.initializer);
            else if (ts.isShorthandPropertyAssignment(p)) {
              const { name } = finalName(p.name);
              let type: ts.Type | undefined;
              try { const sym = checker.getShorthandAssignmentValueSymbol(p); type = sym ? checker.getTypeOfSymbolAtLocation(sym, p.name) : undefined; } catch { type = undefined; }
              if (type && stringish(type) && !looksLikeIds(type) && !IDENTITY.test(name) && !PERSON_NAME.test(name)) edits.push({ start: p.getStart(), end: p.end, text: `${name}: ${TD}(${name})` });
            }
          }
        }
        return;
      }
    }
    if (ts.isJsxExpression(n) && n.expression) {
      const inChild = ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent);
      const inAttr = ts.isJsxAttribute(n.parent) && isVisibleAttr(n.parent.name.getText());
      if (inChild || inAttr) wrapLeaf(n.expression);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  total += edits.length; changed++;
  if (!WRITE) continue;

  if (!hadTD) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const spec = TD === "td" ? "td" : `td as ${TD}`;
    if (runtimeImport) {
      const nb = runtimeImport.importClause!.namedBindings as ts.NamedImports;
      const last = nb.elements[nb.elements.length - 1];
      edits.push({ start: last.end, end: last.end, text: `, ${spec}` });
    } else {
      const imports = sf.statements.filter(ts.isImportDeclaration);
      const directive = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client");
      const anchor = imports.length ? imports[imports.length - 1].end : directive ? directive.end : 0;
      const line = `import { ${spec} } from "@/i18n/runtime";`;
      edits.push({ start: anchor, end: anchor, text: anchor === 0 ? line + eol + eol : eol + line });
    }
  }
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start || (a.end - a.start === 0 ? 1 : -1))) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  writeFileSync(file, out, "utf8");
}
writeFileSync(join(ROOT, "logs", "i18n", "codemod-td.txt"), sample.join("\n"), "utf8");
console.log(`${WRITE ? "APLICADO" : "ENSAYO"} · ${total} expresiones en ${changed} ficheros`);
