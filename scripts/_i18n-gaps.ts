/**
 * I18N · INVENTARIO DE HUECOS que el auditor no denuncia (instrumento, fuera de CI).
 *
 *   npx tsx scripts/_i18n-gaps.ts            escribe logs/i18n/gaps-fragments.txt y logs/i18n/gaps-literals.txt
 *
 * 1. FRASES COMPUESTAS POR FRAGMENTOS: una frase repartida en varios `t()` alrededor de un valor o de una etiqueta
 *    («{n} {t("de")} {m} {t("cartas")}»). Cada trozo está traducido, pero el orden de las palabras queda en español.
 * 2. LITERALES SIN ENVOLVER: texto español en tablas y helpers del código que llega al navegador y que ni pasa por
 *    `t()` ni está en ningún catálogo (así que `td()` tampoco lo traduce).
 */
import ts from "typescript";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES_DIR, isCodeLike, isSentence, listSourceFiles, parseFile, reachability, rel, translatorsOf } from "./i18n/core";

const reach = reachability();
const known = new Set<string>();
for (const f of readdirSync(join(MESSAGES_DIR, "es"))) for (const k of JSON.parse(readFileSync(join(MESSAGES_DIR, "es", f), "utf8")) as string[] | Record<string, string>
  ? Object.values(JSON.parse(readFileSync(join(MESSAGES_DIR, "es", f), "utf8")) as Record<string, string>).concat(Object.keys(JSON.parse(readFileSync(join(MESSAGES_DIR, "es", f), "utf8")) as Record<string, string>))
  : []) known.add(String(k));

const CONNECT = /(^|\s)(de|del|en|a|al|con|por|para|y|o|que|el|la|los|las|un|una|sin|se|es|son|como|tu|tus|su|sus|más|desde|hasta|entre|tras)$/i;
const fragmentary = (s: string) => {
  const t = s.trim();
  if (!t) return false;
  return /^[\p{Ll}·,.;:)(/+×x%-]/u.test(t) || /[(,·/]$/.test(t) || CONNECT.test(t);
};

/** Sin separadores de maquetación («· OVR», «Academia (», «Plazo:»): ¿queda un trozo de frase a medias? */
const core = (s: string) => s.trim().replace(/^[·:()—–\-,.;/+×#✓⏸\s\d]+/u, "").replace(/[·:()—–\-,.;/+×#\s]+$/u, "");
const midSentence = (s: string) => { const c = core(s); return !!c && (/^\p{Ll}/u.test(c) || CONNECT.test(c)); };
/** Unidad o nombre tras un número («{n} pts», «{n} activos»): mismo orden en los cuatro idiomas. */
const unitLike = (s: string) => /^\p{Ll}[\p{L}%]*( \p{Ll}[\p{L}]*)?$/u.test(core(s)) && !CONNECT.test(core(s));
const real: string[] = [];
const frags: string[] = [];
const lits: string[] = [];
const ACCENT = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;

for (const file of listSourceFiles()) {
  if (!reach.client.has(file)) continue;
  const r = rel(file);
  if (r.startsWith("src/app/design-system") || r.startsWith("src/i18n/")) continue;
  const { sf, text } = parseFile(file);
  const tr = translatorsOf(sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const tText = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && tr.has(e.expression.text)) {
      const a = e.arguments[0];
      return a && ts.isStringLiteralLike(a) ? a.text : null;
    }
    return null;
  };
  const show = (n: ts.Node) => n.getText().replace(/\s+/g, " ").slice(0, 300);
  const idMarked = (n: ts.Node) => /\/\*\s*i18n-(id|ok)\s*\*\/\s*$/.test(text.slice(Math.max(0, n.getFullStart()), n.getStart()));

  const visit = (n: ts.Node) => {
    // 1a · hijos de JSX
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = n.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
      const ts_ = kids.map((c) => (ts.isJsxExpression(c) ? tText(c.expression) : null));
      const tcount = ts_.filter((x) => x !== null).length;
      const others = kids.filter((c, i) => ts_[i] === null && !(ts.isJsxExpression(c) && c.expression && ts.isStringLiteralLike(c.expression) && !c.expression.text.trim())).length;
      const anyFrag = ts_.some((x) => x !== null && fragmentary(x));
      const texts = ts_.filter((x): x is string => x !== null);
      const mids = texts.filter(midSentence);
      const isReal = mids.length >= 1 && !(texts.length === 1 && unitLike(texts[0])) && !(mids.every(unitLike) && texts.length <= 1);
      if (tcount >= 1 && others >= 1 && isReal && kids.length <= 14) real.push(`${r}:${lineOf(n)} :: ${kids.map(show).join(" ⏐ ").slice(0, 600)}`);
      if (tcount >= 1 && others >= 1 && anyFrag && kids.length <= 14) frags.push(`${r}:${lineOf(n)} :: ${kids.map(show).join(" ⏐ ").slice(0, 420)}`);
    }
    // 1b · plantillas y concatenaciones con varios t()
    if (ts.isTemplateExpression(n)) {
      const parts = n.templateSpans.map((s) => tText(s.expression)).filter((x): x is string => x !== null);
      if (parts.length >= 1 && n.templateSpans.length >= 2 && parts.some(midSentence) && !(parts.length === 1 && unitLike(parts[0]))) real.push(`${r}:${lineOf(n)} :: ${show(n)}`);
      if (parts.length >= 1 && n.templateSpans.length >= 2 && parts.some(fragmentary)) frags.push(`${r}:${lineOf(n)} :: ${show(n)}`);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const flat: ts.Expression[] = [];
      const walk = (e: ts.Expression) => { if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) { walk(e.left); walk(e.right); } else flat.push(e); };
      walk(n);
      const parts = flat.map(tText).filter((x): x is string => x !== null);
      if (parts.length >= 1 && flat.length >= 2 && parts.some(midSentence) && !(parts.length === 1 && unitLike(parts[0]))) real.push(`${r}:${lineOf(n)} :: ${show(n)}`);
      if (parts.length >= 1 && flat.length >= 2 && parts.some(fragmentary)) frags.push(`${r}:${lineOf(n)} :: ${show(n)}`);
    }
    // 2 · literales con español que nadie traduce
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !idMarked(n)) {
      const s = n.text.trim();
      const p = n.parent;
      const inCall = ts.isCallExpression(p) && ts.isIdentifier(p.expression) && (tr.has(p.expression.text) || /^(td|tdIn|ns|tr|t)$/.test(p.expression.text));
      const technical = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isJsxAttribute(p) && /^(className|href|src|id|key|type|role|name)$/.test(p.name.getText())
        || (ts.isCallExpression(p) && /(^|\.)(log|warn|error|debug|track\w*|Error|includes|startsWith|endsWith|test|match|replace|split|getItem|setItem|querySelector\w*)$/.test(p.expression.getText()))
        || (ts.isNewExpression(p) && /Error$/.test(p.expression.getText()))
        || (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText()))
        || ts.isCaseClause(p) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isElementAccessExpression(p);
      if (!inCall && !technical && s.length >= 3 && !known.has(s) && !isCodeLike(s) && (isSentence(s) || (ACCENT.test(s) && /^[\p{L}\s¿¡!?.,:·-]+$/u.test(s)))) lits.push(`${r}:${lineOf(n)} :: ${JSON.stringify(s).slice(0, 160)} :: ${sf.text.split("\n")[lineOf(n) - 1].trim().slice(0, 200)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
mkdirSync(join("logs", "i18n"), { recursive: true });
writeFileSync(join("logs", "i18n", "gaps-fragments.txt"), [...new Set(frags)].join("\n") + "\n");
writeFileSync(join("logs", "i18n", "gaps-fragments-real.txt"), [...new Set(real)].join("\n") + "\n");
writeFileSync(join("logs", "i18n", "gaps-literals.txt"), [...new Set(lits)].join("\n") + "\n");
const by = (list: string[]) => Object.entries(list.reduce<Record<string, number>>((a, l) => { const k = l.split("/").slice(1, 3).join("/").split(":")[0]; a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ");
console.log(`frases a medias ${new Set(real).size}
  ${by([...new Set(real)])}`);
console.log(`fragmentos ${new Set(frags).size}\n  ${by([...new Set(frags)])}\nliterales ${new Set(lits).size}\n  ${by([...new Set(lits)])}`);
