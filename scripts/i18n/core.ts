/**
 * I18N · ANÁLISIS DEL CÓDIGO (AST de TypeScript). Lo comparten el codemod (`codemod.ts`) y el auditor (`audit.ts`):
 * las dos herramientas deciden con las MISMAS reglas qué cadena es texto visible, así que «lo que el codemod habría
 * envuelto y nadie envolvió» es exactamente lo que el auditor denuncia.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ROOT = process.cwd();
export const SRC = join(ROOT, "src");
export const MESSAGES_DIR = join(SRC, "i18n", "messages");
export const TARGET_LOCALES = ["en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"] as const;

/** Carpetas que no son interfaz del juego (arneses de QA, legado, bots de Telegram, prompts de arte…). */
const SKIP_DIRS = [
  "src/i18n/", "src/app/design-system/", "src/legacy/", "src/telegram-control/", "src/tournament-notifications/",
  "src/artwork-ai/", "src/development/",
];
/** El servidor responde en español canónico (contrato de la API intacto): se EXTRAE para traducir en el cliente, no se envuelve. */
const EXTRACT_ONLY_DIRS = ["src/app/api/", "src/server/", "src/middleware.ts", "src/instrumentation.ts"];
const ADMIN_DIRS = ["src/app/admin/", "src/components/admin/", "src/server/admin/", "src/server/cms/", "src/domain/admin/", "src/domain/cms/", "src/app/api/admin/"];
export const ADMIN_NAMESPACES = new Set(["admin"]);

export function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, "/");
}

export function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
    }
  };
  walk(SRC);
  return out.filter((f) => !SKIP_DIRS.some((d) => rel(f).startsWith(d))).sort();
}

export function isExtractOnly(relPath: string): boolean {
  return EXTRACT_ONLY_DIRS.some((d) => relPath.startsWith(d));
}

/** Módulo (namespace) de un fichero: la carpeta funcional, con app/components/domain/lib del mismo nombre unidos. */
export function namespaceOf(relPath: string): string {
  if (ADMIN_DIRS.some((d) => relPath.startsWith(d))) return "admin";
  const p = relPath.split("/");
  if (p[1] === "app" && p[2] === "api") return "api";
  if (p[1] === "server") return "server";
  if (["app", "components", "domain", "lib"].includes(p[1])) {
    if (p.length <= 3) return p[1] === "app" ? "app" : p[1] === "lib" ? "lib" : p[1];
    return p[2].replace(/[^A-Za-z0-9]/g, "");
  }
  return p.length <= 2 ? "app" : p[1].replace(/[^A-Za-z0-9]/g, "");
}

export function parseFile(file: string): { sf: ts.SourceFile; text: string } {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return { sf, text };
}

/* ─────────────────────────── ¿es texto para una persona? ─────────────────────────── */

const ACCENT = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const ES_WORDS = new RegExp(
  "(?<![\\p{L}\\p{N}_])(" + [
    "el", "la", "los", "las", "de", "del", "que", "para", "con", "sin", "por", "tu", "tus", "una", "un", "no", "se", "ya", "esta", "este",
    "hay", "al", "en", "es", "y", "o", "te", "lo", "su", "sus", "como", "cuando", "nuevo", "nueva", "ver", "abrir", "cerrar", "volver",
    "jugar", "carta", "cartas", "sobre", "sobres", "partida", "partidas", "mazo", "equipo", "equipos", "temporada", "recompensa",
    "recompensas", "misiones", "cargando", "guardar", "cancelar", "confirmar", "continuar", "siguiente", "omitir", "mi", "mis", "todos",
    "todas", "todo", "nada", "ninguna", "ninguno", "has", "puedes", "tienes", "falta", "faltan", "desde", "hasta", "entre", "pero", "ahora",
    "hoy", "ayer", "nivel", "pase", "tienda", "duelo", "duelos", "ronda", "rondas", "rival", "turno", "victoria", "derrota", "empate",
    "ganas", "pierdes", "reclamar", "comprar", "precio", "gratis", "error", "intenta", "otra", "otro", "vez", "solo", "sin", "tras",
    "durante", "cada", "muy", "bien", "aqu", "pronto", "sesi", "cuenta", "perfil", "ajustes", "jugador", "jugadores", "torneo", "torneos",
    "evento", "eventos", "progreso", "puntos", "objetivo", "objetivos", "lista", "listo", "pendiente", "activo", "activa", "elige", "eligir",
  ].join("|") + ")(?![\\p{L}\\p{N}_])", "iu");

const hasLetters = (s: string, n = 2) => (s.match(/\p{L}/gu) ?? []).length >= n;
/** Con espacios y evidencia de español: una frase, no un identificador. */
export const isSentence = (s: string) => /\S\s+\S/.test(s.trim()) && hasLetters(s, 3) && (ACCENT.test(s) || ES_WORDS.test(s));
/** `foo-bar`, `foo_bar`, `a/b`, `a:b`, `fooBar`, `FOO_BAR`, `#fff`, urls… */
const idShaped = (s: string) =>
  /^[a-z0-9]+([-_:./][A-Za-z0-9]+)+$/.test(s) || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(s) || /^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(s) ||
  /^(#|\/|\.|https?:|data:|@)/.test(s) || /^[\d\s.,:%+\-–—·/()x×]*$/.test(s);
/** Etiqueta natural: palabra(s) con mayúscula inicial o con acento, no un identificador. */
const isNatural = (s: string) => {
  const t = s.trim();
  if (!hasLetters(t) || idShaped(t)) return false;
  return isSentence(t) || ACCENT.test(t) || /^[¿¡"«(]?\p{Lu}[\p{Ll}]+/u.test(t);
};
const isLabelish = (s: string) => hasLetters(s.trim()) && !idShaped(s.trim());

/** Atributos nativos que el navegador enseña o lee en voz alta. */
const NATIVE_VISIBLE_ATTRS = new Set(["title", "placeholder", "alt", "aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder"]);
/** Props de componentes propios que siempre son texto. */
const VISIBLE_ATTRS = new Set([
  ...NATIVE_VISIBLE_ATTRS, "label", "hint", "eyebrow", "subtitle", "description", "heading", "caption", "tooltip", "cta", "emptyLabel", "message",
  "text", "helper", "helperText", "summary", "note", "kicker", "tagline", "error", "confirmLabel", "cancelLabel", "headline", "sub", "lead",
  "emptyTitle", "emptyHint", "actionLabel", "backLabel", "legend", "prefix", "suffix", "unit", "footer", "header", "detail", "info",
]);
const NEVER_ATTRS = new Set([
  "className", "class", "style", "href", "src", "srcSet", "id", "key", "htmlFor", "type", "role", "name", "rel", "target", "testId",
  "inputMode", "autoComplete", "d", "viewBox", "fill", "stroke", "transform", "points", "accept", "pattern", "lang", "dir", "xmlns",
  "preserveAspectRatio", "dangerouslySetInnerHTML", "aria-controls", "aria-labelledby", "aria-describedby", "aria-live", "aria-current",
  "aria-haspopup", "aria-orientation", "aria-sort", "font", "fontFamily", "sizes", "media", "crossOrigin", "loading", "decoding", "enterKeyHint",
]);
/** `value` de un control nativo es un dato del formulario; en un componente propio (<Readout value="Gratis">) es texto. */
const NATIVE_VALUE_ATTRS = new Set(["value", "defaultValue"]);
export const VISIBLE_PROPS = new Set([
  "label", "title", "hint", "eyebrow", "subtitle", "description", "desc", "text", "message", "error", "reason", "cta", "caption", "headline",
  "tagline", "summary", "note", "detail", "help", "placeholder", "tooltip", "heading", "body", "blurb", "kicker", "warning", "notice",
  "empty", "name", "copy", "lead", "sub", "info", "tip", "explanation", "why", "how", "question", "answer", "action", "short", "long",
  "ariaLabel", "confirmLabel", "cancelLabel", "emptyLabel", "actionLabel", "legend", "subtitleText", "titleText", "footnote", "disclaimer",
]);
/** Nombres con los que un texto llega como dato a un `{…}` de JSX. */
const TEXTY_NAMES = new Set([
  "label", "title", "hint", "eyebrow", "subtitle", "description", "desc", "text", "message", "error", "reason", "cta", "caption", "headline",
  "tagline", "summary", "note", "detail", "help", "tooltip", "heading", "blurb", "kicker", "warning", "notice", "copy", "lead", "tip",
  "explanation", "msg", "err", "errorMessage", "statusText", "statusLabel", "footnote", "disclaimer", "legend", "shortLabel", "longLabel",
  "ariaLabel", "emptyLabel", "actionLabel", "confirmLabel", "cancelLabel", "placeholder", "info", "sub",
]);
const NAME_OWNERS = /^(pack|mode|mission|tier|rank|set|reward|product|offer|item|recipe|event|season|role|edition|rarity|option|opt|o|tab|section|step|stat|category|cat|filter|sort|objective|quest|challenge|achievement|badge|trophy|division|league|phase|stage|track|theme|preset|plan|bundle|slot|def|meta|config|cfg|group|kind|variant|modeInfo)$/i;

const NEVER_CALLS_DEEP = /^(cn|clsx|classNames|cva|twMerge|track\w*|logEvent|log|warn|debug|trace|telemetry\w*|insert|update|upsert|rpc|invariant|assert\w*|require|fetch|redirect|prefetch|navigate|dispatchEvent|postMessage|createElement|getElementById|querySelector\w*|setAttribute|getAttribute|addEventListener|removeEventListener|getItem|setItem|removeItem|matchMedia|play\w*|vibrate|mark|measure|ns|td|t|tr|i18nT|i18nTd)$/;
const NEVER_CALLS_DIRECT = /^(includes|startsWith|endsWith|indexOf|lastIndexOf|split|join|replaceAll|test|exec|get|set|has|delete|add|append|useState|useRef|useReducer|useMemo|createContext|Symbol|localeCompare|padStart|padEnd|at|charAt|slice|substring|search|normalize|toLocaleString|toLocaleDateString|toLocaleTimeString|format|parse|stringify|keyOf|define\w*|register\w*|describe|it|test)$/;
const NEVER_NEW = /^(Error|TypeError|RangeError|URL|URLSearchParams|RegExp|Date|Map|Set|Headers|Request|Response|Blob|File|Event|CustomEvent|Worker|Audio|Image|Intl|NumberFormat|DateTimeFormat|PluralRules|RelativeTimeFormat|ListFormat|Collator|BroadcastChannel|WebSocket|EventSource|AbortController|FormData)$/;
const SINK_CALLS = /^(toast|notify|showToast|pushToast|addToast|set(Error|Err|Message|Msg|Notice|StatusText|Feedback|Hint|Info|Warning|Banner|Alert|Toast|Problem|Fail\w*)|announce|say|flash)$/;
const SINK_METHODS = /^(error|success|info|warning|warn|show|push|notify)$/;
const SKIP_JSX_TEXT_TAGS = new Set(["style", "script", "code", "pre", "kbd", "samp"]);

function calleeName(expr: ts.Expression): { name: string; owner: string } {
  if (ts.isIdentifier(expr)) return { name: expr.text, owner: "" };
  if (ts.isPropertyAccessExpression(expr)) return { name: expr.name.text, owner: ts.isIdentifier(expr.expression) ? expr.expression.text : ts.isPropertyAccessExpression(expr.expression) ? expr.expression.name.text : "" };
  return { name: "", owner: "" };
}

export function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p) && "body" in p) return p as ts.FunctionLikeDeclaration;
  return undefined;
}

const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken]);

export type Position =
  | { kind: "child" } | { kind: "attr"; name: string } | { kind: "prop"; name: string } | { kind: "sink" } | { kind: "other" }
  | { kind: "never"; why: string };

/**
 * Dónde está una cadena: hijo de JSX, atributo, propiedad de objeto, argumento de un «sumidero» de texto u otra cosa.
 * `never` = posición en la que una cadena jamás es texto para el jugador (clase CSS, comparación, tipo, clave…).
 */
export function positionOf(node: ts.Node): Position {
  let cur: ts.Node = node;
  let result: Position | null = null;
  let crossedJsx = false;
  for (let p = node.parent; p; cur = p, p = p.parent) {
    if (ts.isTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isEnumMember(p) || ts.isTaggedTemplateExpression(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode(p)) return { kind: "never", why: "tipo/import" };
    if (ts.isExpressionStatement(p) && ts.isSourceFile(p.parent) && ts.isStringLiteral(cur)) return { kind: "never", why: "directiva" };
    if (ts.isThrowStatement(p)) return { kind: "never", why: "error" };
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxFragment(p)) crossedJsx = true;
    if (ts.isJsxAttribute(p)) {
      const an = p.name.getText();
      // Un atributo «nunca» (className, href…) solo veta lo que es SU valor, no el JSX anidado que cuelga de él.
      const tag = ts.isJsxOpeningElement(p.parent.parent) || ts.isJsxSelfClosingElement(p.parent.parent) ? p.parent.parent.tagName.getText() : "";
      const nativeValue = NATIVE_VALUE_ATTRS.has(an) && /^[a-z]/.test(tag);
      if (!crossedJsx && (NEVER_ATTRS.has(an) || an.startsWith("data-") || nativeValue)) return { kind: "never", why: `atributo ${an}` };
      if (!result && !/^on[A-Z]/.test(an)) result = { kind: "attr", name: NATIVE_VALUE_ATTRS.has(an) ? "label" : an };
      continue;
    }
    if (ts.isCallExpression(p) && cur !== p.expression) {
      const { name, owner } = calleeName(p.expression);
      if (/^(confirm|alert|prompt)$/.test(name)) { if (!result) result = { kind: "sink" }; continue; }
      if (NEVER_CALLS_DEEP.test(name) || /^(console|logger|Sentry|supabase|sb|db|window|document|navigator|history|router|crypto|JSON|performance|localStorage|sessionStorage)$/.test(owner)) return { kind: "never", why: `llamada ${owner}.${name}` };
      if (!result) {
        if (NEVER_CALLS_DIRECT.test(name)) return { kind: "never", why: `argumento de ${name}` };
        if (SINK_CALLS.test(name) || (SINK_METHODS.test(name) && /toast|notif|snack|alert|banner|feedback/i.test(owner))) result = { kind: "sink" };
        else result = { kind: "other" };
      }
      continue;
    }
    if (ts.isNewExpression(p) && cur !== p.expression) {
      const n = calleeName(p.expression).name;
      if (/Error$/.test(n)) return { kind: "never", why: "error" };
      if (NEVER_NEW.test(n)) return { kind: "never", why: `new ${n}` };
      if (!result) result = { kind: "other" };
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      if (COMPARE.has(p.operatorToken.kind)) { if (!result) return { kind: "never", why: "comparación" }; continue; }
      const op = p.operatorToken.kind;
      const transparent = op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || (op === ts.SyntaxKind.AmpersandAmpersandToken && cur === p.right);
      if (transparent) continue;
      if (!result) result = { kind: "other" };
      continue;
    }
    if (ts.isCaseClause(p) && cur === p.expression) return { kind: "never", why: "case" };
    if (ts.isSwitchStatement(p) && cur === p.expression) return { kind: "never", why: "switch" };
    if (ts.isElementAccessExpression(p) && cur === p.argumentExpression) return { kind: "never", why: "índice" };
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && cur === p.name) return { kind: "never", why: "clave" };
    if (ts.isComputedPropertyName(p)) return { kind: "never", why: "clave calculada" };
    if (ts.isConditionalExpression(p)) { if (cur === p.condition && !result) return { kind: "never", why: "condición" }; continue; }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p) || ts.isTemplateSpan(p)) continue;
    if (ts.isTemplateExpression(p)) { if (!result) result = { kind: "other" }; continue; }
    if (ts.isJsxExpression(p)) {
      if (!result && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) result = { kind: "child" };
      continue;
    }
    if (ts.isPropertyAssignment(p) && cur === p.initializer) {
      if (!result) result = { kind: "prop", name: p.name.getText().replace(/^["']|["']$/g, "") };
      continue;
    }
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) { if (!result) result = { kind: "other" }; if (ts.isSourceFile(p)) break; continue; }
    if (!result && !ts.isJsxElement(p) && !ts.isJsxFragment(p) && !ts.isJsxSelfClosingElement(p) && !ts.isJsxOpeningElement(p) && !ts.isJsxAttributes(p)) result = { kind: "other" };
  }
  return result ?? { kind: "other" };
}

/** ¿Esta cadena, en esta posición, es texto visible? */
const NEVER_PROPS = new Set(["fragmentShader", "vertexShader", "className", "style", "query", "sql", "href", "src", "url", "id", "key", "type", "fase41", "testId", "path", "route", "event", "code"]);

export function acceptsText(text: string, pos: Position): boolean {
  const s = text.trim();
  if (!s || pos.kind === "never") return false;
  if (/[\n\r]/.test(s) || s.length > 600) return false; // GLSL, SQL, bloques: no son etiquetas
  if (pos.kind === "prop" && NEVER_PROPS.has(pos.name)) return false;
  if (pos.kind === "child") return hasLetters(s) && !/^(&\w+;|\W)+$/.test(s);
  if (pos.kind === "attr") {
    if (NATIVE_VISIBLE_ATTRS.has(pos.name)) return hasLetters(s);
    if (VISIBLE_ATTRS.has(pos.name)) return isLabelish(s) && !/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(s);
    return isSentence(s);
  }
  if (pos.kind === "prop") {
    if (pos.name === "name") return !idShaped(s) && (isSentence(s) || (ACCENT.test(s) && /\s/.test(s)));
    if (VISIBLE_PROPS.has(pos.name)) return isNatural(s);
    return isSentence(s);
  }
  if (pos.kind === "sink") return isNatural(s);
  return isSentence(s);
}

/* ─────────────────────────── texto de un nodo ─────────────────────────── */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", middot: "·", mdash: "—", ndash: "–", hellip: "…", rarr: "→", larr: "←", times: "×", laquo: "«", raquo: "»", copy: "©", euro: "€", bull: "•", deg: "°" };

/** Texto de un JsxText tal como lo ve React (líneas recortadas y unidas), sin entidades. `null` si no se puede. */
export function jsxTextValue(raw: string): { lead: string; core: string; trail: string } | null {
  const lead = /^\s*/.exec(raw)![0];
  const trail = lead.length === raw.length ? "" : /\s*$/.exec(raw)![0];
  const lines = raw.slice(lead.length, raw.length - trail.length).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let core = lines.join(" ");
  let bad = false;
  core = core.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    if (e in ENTITIES) return ENTITIES[e];
    bad = true; return m;
  });
  if (bad || /[{}]/.test(core)) return null;
  return { lead, core, trail };
}

export function jsxTagOf(node: ts.JsxText): string {
  const p = node.parent;
  return ts.isJsxElement(p) ? p.openingElement.tagName.getText() : "";
}
export const skipJsxTextIn = (tag: string) => SKIP_JSX_TEXT_TAGS.has(tag);

/** Plantilla → mensaje ICU: `Tienes ${n} sobres` → "Tienes {n} sobres" + nombres de las variables. */
export function templateToMessage(node: ts.TemplateExpression): { message: string; vars: { name: string; expr: ts.Expression }[] } | null {
  const used = new Map<string, number>();
  const vars: { name: string; expr: ts.Expression }[] = [];
  let message = node.head.text;
  if (/[{}]/.test(node.head.text)) return null;
  for (const span of node.templateSpans) {
    if (/[{}]/.test(span.literal.text)) return null;
    let base = "v";
    let e: ts.Expression = span.expression;
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) base = e.text;
    else if (ts.isPropertyAccessExpression(e)) base = e.name.text;
    else if (ts.isCallExpression(e)) {
      const a = e.arguments[0];
      const obj = ts.isPropertyAccessExpression(e.expression) ? e.expression.expression : null;
      base = a && ts.isIdentifier(a) ? a.text : a && ts.isPropertyAccessExpression(a) ? a.name.text
        : obj && ts.isIdentifier(obj) ? obj.text : obj && ts.isPropertyAccessExpression(obj) ? obj.name.text : "v";
    }
    base = base.replace(/[^A-Za-z0-9_]/g, "") || "v";
    if (/^\d/.test(base)) base = `v${base}`;
    const same = vars.find((v) => v.expr.getText() === span.expression.getText());
    let name = same?.name;
    if (!name) {
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      name = n === 1 ? base : `${base}${n}`;
      vars.push({ name, expr: span.expression });
    }
    message += `{${name}}${span.literal.text}`;
  }
  return { message, vars };
}

export function staticTextOfTemplate(node: ts.TemplateExpression): string {
  return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
}

/** `{label}` / `{pack.name}`: expresión que trae un texto como dato. */
export function isTextyExpression(expr: ts.Expression): boolean {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return TEXTY_NAMES.has(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    const n = e.name.text;
    if (TEXTY_NAMES.has(n)) return true;
    if (n === "name") {
      const o = e.expression;
      const owner = ts.isIdentifier(o) ? o.text : ts.isPropertyAccessExpression(o) ? o.name.text : "";
      return NAME_OWNERS.test(owner);
    }
  }
  return false;
}

export function isVisibleAttr(name: string): boolean {
  return VISIBLE_ATTRS.has(name);
}

/* ─────────────────────────── extracción (lo que YA está internacionalizado) ─────────────────────────── */

export interface Extracted { ns: string; source: string; file: string; line: number; via: "t" | "data" | "server" }

/** Nombres locales de los traductores de un fichero: `const t = ns("store")` → { t: "store" }. */
export function translatorsOf(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && d.initializer.expression.text === "ns" && ts.isIdentifier(d.name)) {
        const a = d.initializer.arguments[0];
        if (a && ts.isStringLiteralLike(a)) out.set(d.name.text, a.text);
      }
    }
  }
  return out;
}

/* ─────────────────────────── alcance: ¿qué código llega al navegador? ─────────────────────────── */

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(from, "..", spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* siguiente candidato */ }
  }
  return null;
}

function importsOf(file: string): string[] {
  const { sf } = parseFile(file);
  const out: string[] = [];
  const add = (spec: string) => { const r = resolveImport(file, spec); if (r && /\.tsx?$/.test(r)) out.push(r); };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) { if (!n.importClause?.isTypeOnly) add(n.moduleSpecifier.text); }
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) { if (!n.isTypeOnly) add(n.moduleSpecifier.text); }
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) add(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function closure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of importsOf(f)) if (!seen.has(i)) stack.push(i);
  }
  return seen;
}

function appEntries(api: boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel(p);
      if (statSync(p).isDirectory()) { if (!r.startsWith("src/app/design-system")) walk(p); }
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n) && r.startsWith("src/app/api/") === api) out.push(p);
    }
  };
  walk(join(SRC, "app"));
  return out;
}

/** `client`: lo importa alguna pantalla (llega al navegador). `server`: solo lo alcanza la API. Lo demás no es producto. */
export function reachability(): { client: Set<string>; server: Set<string> } {
  const client = closure(appEntries(false));
  const server = closure([...appEntries(true), join(SRC, "middleware.ts")]);
  return { client, server };
}

/** Rama de un plural casero: `n === 1 ? "carta" : "cartas"`. Es texto aunque sea una sola palabra en minúsculas. */
export function isPluralBranch(n: ts.Node): boolean {
  const p = n.parent;
  if (!p || !ts.isConditionalExpression(p) || (p.whenTrue !== n && p.whenFalse !== n)) return false;
  let c: ts.Expression = p.condition;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  if (!ts.isBinaryExpression(c)) return false;
  const one = (e: ts.Expression) => ts.isNumericLiteral(e) && e.text === "1";
  const other = p.whenTrue === n ? p.whenFalse : p.whenTrue;
  if (!(one(c.right) || one(c.left)) || !ts.isStringLiteralLike(other) || !ts.isStringLiteralLike(n)) return false;
  const a = n.text.trim().toLowerCase(), b = other.text.trim().toLowerCase();
  // singular y plural comparten raíz («carta»/«cartas», «vez»/«veces»): descarta `n === 1 ? "sm" : "md"`
  return a.length >= 3 && b.length >= 3 && a !== b && a.slice(0, 2) === b.slice(0, 2) && /^[\p{L}\s]+$/u.test(a) && /^[\p{L}\s]+$/u.test(b);
}

/**
 * Cadenas que NO son texto para una persona aunque tengan palabras: marcado SVG/HTML, listas de clases CSS, cabeceras
 * HTTP, rutas de API, slugs de ejemplo, instrucciones a un modelo. No entran en los catálogos: nunca se traducen.
 */
export function isCodeLike(s: string): boolean {
  const t = s.trim();
  if (/<\/?[a-zA-Z][^>]*>/.test(t) || /^<|\/>$/.test(t)) return true;
  if (/(^|\s)(sm|md|lg|xl|hover|focus):[a-z-]/.test(t) || /\b(inset-|max-h-|min-h-|rounded-|translate-)[a-z0-9[]/.test(t)) return true;
  if (/^(GET|POST|PUT|DELETE|PATCH) \//.test(t) || /\bno-store\b|\bmust-revalidate\b/.test(t)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return true; // color
  if (/(rgba?|hsla?|calc|var|url|linear-gradient|radial-gradient)\(/.test(t) || /(^|\s)(text|bg|border|shadow|ring|from|to|via)-[a-z]+(-\d+|\/\d+|-\[)/.test(t)) return true; // CSS
  if (/, en español\.?$/.test(t)) return true; // instrucciones de idioma a un modelo (el servidor las usa tal cual)
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(t) || /^[a-z]+:[a-z]+:/.test(t)) return true;
  return false;
}
