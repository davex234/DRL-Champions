/**
 * I18N · CODEMOD — envuelve el texto visible en `t("…")` y el texto que llega como dato en `td(…)`.
 *
 *   npx tsx scripts/i18n/codemod.ts            ensayo: no escribe; deja el detalle en logs/i18n/codemod-dry.txt
 *   npx tsx scripts/i18n/codemod.ts --write    aplica
 *   npx tsx scripts/i18n/codemod.ts --only src/components/store   limita a una carpeta
 *
 * Edita por posiciones (no reimprime el fichero): formato, comentarios y finales de línea (CRLF) quedan intactos.
 * Es idempotente: lo ya envuelto no se vuelve a envolver.
 */
import ts from "typescript";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, acceptsText, enclosingFunction, isPluralBranch, isExtractOnly, isTextyExpression, isVisibleAttr, jsxTagOf, jsxTextValue, listSourceFiles,
  namespaceOf, parseFile, positionOf, reachability, rel, skipJsxTextIn, staticTextOfTemplate, templateToMessage,
} from "./core";

const WRITE = process.argv.includes("--write");
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt > 0 ? process.argv[onlyAt + 1].replace(/\\/g, "/") : null;

interface Edit { start: number; end: number; text: string; kind: string }

const NBSP = String.fromCharCode(0xa0), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const lit = (s: string) => JSON.stringify(s).split(NBSP).join("\u00a0").split(LS).join("\u2028").split(PS).join("\u2029");

function applyEdits(text: string, edits: Edit[], from = 0, to = text.length): string {
  const inside = edits.filter((e) => e.start >= from && e.end <= to).sort((a, b) => b.start - a.start || (a.end - a.start === 0 ? 1 : -1));
  let out = text.slice(from, to);
  for (const e of inside) out = out.slice(0, e.start - from) + e.text + out.slice(e.end - from);
  return out;
}

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };
const dry: string[] = [];
let changedFiles = 0;

const reach = reachability();

for (const file of listSourceFiles()) {
  const r = rel(file);
  if (isExtractOnly(r) || !reach.client.has(file) || (ONLY && !r.startsWith(ONLY))) continue;
  const { sf, text } = parseFile(file);
  const isTsx = file.endsWith(".tsx");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  const idents = new Set<string>();
  const compared = new Set<string>();
  const called = new Set<string>();
  const jsxTags = new Set<string>();
  let usesHooks = false;
  const scan = (n: ts.Node) => {
    if (ts.isIdentifier(n)) { idents.add(n.text); if (/^use[A-Z]/.test(n.text)) usesHooks = true; }
    if (ts.isStringLiteralLike(n)) { const p = positionOf(n); if (p.kind === "never" && /comparación|case|índice|argumento de (includes|indexOf|has|get|set)/.test(p.why)) compared.add(n.text); }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) called.add(n.expression.text);
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) jsxTags.add(n.tagName.getText());
    ts.forEachChild(n, scan);
  };
  scan(sf);

  // Importaciones ya presentes (segunda pasada del codemod): se reutilizan sus nombres.
  let T = "", TD = "", NS = "", HOOK = "";
  let nsDeclared = false, runtimeImport: ts.ImportDeclaration | null = null, reactImport: ts.ImportDeclaration | null = null;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const named = st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings) ? st.importClause.namedBindings.elements : [];
      if (st.moduleSpecifier.text === "@/i18n/runtime") {
        runtimeImport = st;
        for (const el of named) { const orig = (el.propertyName ?? el.name).text; if (orig === "ns") NS = el.name.text; if (orig === "td") TD = el.name.text; }
      }
      if (st.moduleSpecifier.text === "@/i18n/react") { reactImport = st; for (const el of named) if ((el.propertyName ?? el.name).text === "useLocale") HOOK = el.name.text; }
    }
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && NS && d.initializer.expression.text === NS && ts.isIdentifier(d.name)) { T = d.name.text; nsDeclared = true; }
    }
  }
  const pick = (...names: string[]) => names.find((n) => !idents.has(n))!;
  const hadTD = !!TD, hadNS = !!NS, hadHOOK = !!HOOK;
  if (!T) T = pick("t", "tr", "i18nT", "i18nTranslate");
  if (!TD) TD = pick("td", "i18nTd", "i18nData");
  if (!NS) NS = pick("ns", "i18nNs");
  if (!HOOK) HOOK = pick("useLocale", "useI18nLocale");

  const edits: Edit[] = [];
  let usedT = false, usedTD = false;
  const alreadyWrapped = (n: ts.Node) => {
    for (let p = n.parent; p && !ts.isFunctionLike(p); p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && (p.expression.text === T || p.expression.text === TD)) {
        // solo el PRIMER argumento es el mensaje ya envuelto; las variables ({ v: n === 1 ? "queda" : "quedan" }) son texto por envolver
        const a0 = p.arguments[0];
        return !a0 || (n.pos >= a0.pos && n.end <= a0.end) || p.expression.text === TD;
      }
    }
    return false;
  };
  /** Literal que es (rama de) el valor de una variable de un mensaje: siempre es texto. */
  const inMessageVars = (n: ts.Node): boolean => {
    let cur: ts.Node = n;
    for (let p = n.parent; p; cur = p, p = p.parent) {
      if (ts.isConditionalExpression(p)) { if (cur === p.condition) return false; continue; }
      if (ts.isParenthesizedExpression(p)) continue;
      if (ts.isPropertyAssignment(p) && cur === p.initializer) {
        const obj = p.parent, call = obj.parent;
        return ts.isObjectLiteralExpression(obj) && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === T && call.arguments[1] === obj;
      }
      return false;
    }
    return false;
  };

  const visit = (n: ts.Node) => {
    ts.forEachChild(n, visit); // post-orden: las ediciones interiores existen antes de componer una plantilla

    if (ts.isJsxText(n)) {
      if (!enclosingFunction(n) || skipJsxTextIn(jsxTagOf(n))) return;
      const v = jsxTextValue(n.text);
      if (!v || !acceptsText(v.core, { kind: "child" })) return;
      edits.push({ start: n.pos, end: n.end, text: `${v.lead}{${T}(${lit(v.core)})}${v.trail}`, kind: "jsxText" });
      usedT = true;
      dry.push(`${r}:${sf.getLineAndCharacterOfPosition(n.pos).line + 1}\tjsx\t${v.core}`);
      return;
    }

    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!enclosingFunction(n) || alreadyWrapped(n) || text.slice(n.getFullStart(), n.getStart()).includes("i18n-id")) return;
      if (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) return;
      const pos = positionOf(n);
      if (!acceptsText(n.text, pos) && !(pos.kind !== "never" && isPluralBranch(n)) && !(inMessageVars(n) && /\p{L}{2,}/u.test(n.text))) return;
      if (compared.has(n.text) && pos.kind !== "child") { bump("omitida: también se usa en una comparación"); dry.push(`${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}\tSKIP-compare\t${n.text}`); return; }
      const lead = /^\s*/.exec(n.text)![0];
      const trail = lead.length === n.text.length ? "" : /\s*$/.exec(n.text)![0];
      const core = n.text.slice(lead.length, n.text.length - trail.length);
      const parts = [lead && lit(lead), `${T}(${lit(core)})`, trail && lit(trail)].filter(Boolean) as string[];
      let expr = parts.join(" + ");
      const direct = ts.isJsxAttribute(n.parent);
      if (parts.length > 1 && !direct && !ts.isJsxExpression(n.parent)) expr = `(${expr})`;
      edits.push({ start: n.getStart(), end: n.end, text: direct ? `{${expr}}` : expr, kind: `literal:${pos.kind}` });
      usedT = true;
      dry.push(`${r}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}\t${pos.kind}${"name" in pos ? `:${pos.name}` : ""}\t${n.text}`);
      return;
    }

    if (ts.isTemplateExpression(n)) {
      if (!enclosingFunction(n) || alreadyWrapped(n)) return;
      const pos = positionOf(n);
      if (!acceptsText(staticTextOfTemplate(n), pos)) return;
      const m = templateToMessage(n);
      if (!m) { bump("omitida: plantilla con llaves"); return; }
      const start = n.getStart();
      const vars = m.vars.map((v) => {
        const src = applyEdits(text, edits, v.expr.getStart(), v.expr.end);
        return src === v.name ? v.name : `${v.name}: ${src}`;
      });
      for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= start && edits[i].end <= n.end) edits.splice(i, 1);
      const call = `${T}(${lit(m.message)}${vars.length ? `, { ${vars.join(", ")} }` : ""})`;
      edits.push({ start, end: n.end, text: ts.isJsxAttribute(n.parent) ? `{${call}}` : call, kind: `template:${pos.kind}` });
      usedT = true;
      dry.push(`${r}:${sf.getLineAndCharacterOfPosition(start).line + 1}\ttpl:${pos.kind}\t${m.message}`);
      return;
    }

    if (ts.isJsxExpression(n) && n.expression && enclosingFunction(n)) {
      const inChild = ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent);
      const inAttr = ts.isJsxAttribute(n.parent) && isVisibleAttr(n.parent.name.getText());
      if ((inChild || inAttr) && isTextyExpression(n.expression)) {
        const e = n.expression;
        edits.push({ start: e.getStart(), end: e.end, text: `${TD}(${text.slice(e.getStart(), e.end)})`, kind: "td" });
        usedTD = true;
        dry.push(`${r}:${sf.getLineAndCharacterOfPosition(e.getStart()).line + 1}\ttd\t${e.getText()}`);
      }
    }
  };
  visit(sf);
  if (!edits.length) continue;

  // Suscripción al idioma: los componentes (y hooks) de primer nivel que ahora traducen se vuelven a pintar al cambiarlo.
  let usedHook = false;
  const directive = sf.statements.find((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use client");
  if (isTsx && (directive || usesHooks)) {
    const hasEditIn = (n: ts.Node) => edits.some((e) => e.start >= n.pos && e.end <= n.end);
    const hasJsx = (n: ts.Node): boolean => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || !!ts.forEachChild(n, (c) => hasJsx(c) || undefined);
    const alreadyHooked = (body: ts.Node) => new RegExp(`\\b${HOOK}\\(\\)`).test(body.getText());
    const consider = (name: string, fn: ts.FunctionLikeDeclaration) => {
      if (!fn.body || !hasEditIn(fn) || fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || fn.asteriskToken) return;
      const isHook = /^use[A-Z]/.test(name);
      if (!isHook && !(/^[A-Z]/.test(name) && hasJsx(fn) && !(called.has(name) && !jsxTags.has(name)))) return;
      if (alreadyHooked(fn.body)) return;
      if (ts.isBlock(fn.body)) {
        const at = fn.body.getStart() + 1;
        const first = fn.body.statements[0];
        const indent = first ? /[ \t]*$/.exec(text.slice(0, first.getStart()))![0] : "  ";
        edits.push({ start: at, end: at, text: `${eol}${indent}${HOOK}();`, kind: "hook" });
      } else {
        edits.push({ start: fn.body.getStart(), end: fn.body.getStart(), text: `{ ${HOOK}(); return `, kind: "hook" });
        edits.push({ start: fn.body.end, end: fn.body.end, text: `; }`, kind: "hook" });
      }
      usedHook = true;
    };
    const fnOf = (e: ts.Expression | undefined): ts.FunctionLikeDeclaration | null => {
      if (!e) return null;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
      if (ts.isCallExpression(e) && /^(memo|forwardRef|React\.memo|React\.forwardRef)$/.test(e.expression.getText())) return fnOf(e.arguments[0]);
      return null;
    };
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) consider(st.name.text, st);
      else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) { const f = ts.isIdentifier(d.name) ? fnOf(d.initializer) : null; if (f) consider((d.name as ts.Identifier).text, f); }
      else if (ts.isExportAssignment(st)) { const f = fnOf(st.expression); if (f) consider(f.name?.getText() ?? "Default", f); }
    }
  }

  // Cabecera: import + traductor del módulo, tras el último import.
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const header: string[] = [];
  const needNS = usedT && !nsDeclared;
  const runtimeNames: string[] = [];
  if (needNS && !hadNS) runtimeNames.push(NS === "ns" ? "ns" : `ns as ${NS}`);
  if (usedTD && !hadTD) runtimeNames.push(TD === "td" ? "td" : `td as ${TD}`);
  if (runtimeNames.length) {
    if (runtimeImport) {
      const nb = runtimeImport.importClause!.namedBindings as ts.NamedImports;
      const last = nb.elements[nb.elements.length - 1];
      edits.push({ start: last.end, end: last.end, text: `, ${runtimeNames.join(", ")}`, kind: "import" });
    } else header.push(`import { ${runtimeNames.join(", ")} } from "@/i18n/runtime";`);
  }
  if (usedHook && !hadHOOK && !reactImport) header.push(`import { ${HOOK === "useLocale" ? "useLocale" : `useLocale as ${HOOK}`} } from "@/i18n/react";`);
  if (needNS) header.push(`${eol}const ${T} = ${NS}(${lit(namespaceOf(r))});`);
  if (header.length) {
    const anchor = imports.length ? imports[imports.length - 1].end : directive ? directive.end : 0;
    const block = anchor === 0 ? header.join(eol) + eol + eol : eol + header.join(eol);
    edits.push({ start: anchor, end: anchor, text: block, kind: "import" });
  }

  for (const e of edits) bump(e.kind);
  changedFiles++;
  if (WRITE) writeFileSync(file, applyEdits(text, edits), "utf8");
}

mkdirSync(join(ROOT, "logs", "i18n"), { recursive: true });
writeFileSync(join(ROOT, "logs", "i18n", WRITE ? "codemod-applied.txt" : "codemod-dry.txt"), dry.join("\n"), "utf8");
console.log(`${WRITE ? "APLICADO" : "ENSAYO"} · ficheros: ${changedFiles}`);
console.log(Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join("\n"));
