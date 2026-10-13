/**
 * I18N · FORMATO DE MENSAJES (subconjunto de ICU MessageFormat, sin dependencias).
 *
 *   "Tienes {n} sobres"                                        variables
 *   "{n, plural, one {# carta} other {# cartas}}"              plurales (reglas de `Intl.PluralRules` del idioma)
 *   "{n, plural, =0 {Sin cartas} one {# carta} other {# cartas}}"   casos exactos
 *
 * Un mensaje SIN variables se devuelve tal cual (no se interpreta): un texto con llaves literales no se rompe.
 * Una variable que falta se deja visible como `{nombre}` en desarrollo y vacía nunca: mejor ver el hueco que ocultarlo.
 */
export type MessageVars = Record<string, unknown>;

type Node = string | { v: string } | { v: string; plural: Record<string, Node[]> } | { hash: true };

const cache = new Map<string, Node[]>();
const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rules(locale: string): Intl.PluralRules {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}

function nf(locale: string): Intl.NumberFormat {
  let f = numberFormats.get(locale);
  if (!f) numberFormats.set(locale, (f = new Intl.NumberFormat(locale, { useGrouping: "always" } as Intl.NumberFormatOptions)));
  return f;
}

/** Índice de la llave que cierra la abierta en `open` (respeta anidamiento); -1 si no cierra. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function parse(s: string, inPlural: boolean): Node[] {
  const out: Node[] = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  while (i < s.length) {
    const c = s[i];
    if (c === "#" && inPlural) { flush(); out.push({ hash: true }); i++; continue; }
    if (c !== "{") { buf += c; i++; continue; }
    const end = closing(s, i);
    if (end < 0) { buf += s.slice(i); break; }
    const body = s.slice(i + 1, end);
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*plural\s*,([\s\S]*))?$/.exec(body);
    if (!m) { buf += s.slice(i, end + 1); i = end + 1; continue; }
    flush();
    if (m[2] === undefined) out.push({ v: m[1] });
    else {
      const options: Record<string, Node[]> = {};
      const rest = m[2];
      let j = 0;
      while (j < rest.length) {
        const om = /\s*(=\d+|[a-z]+)\s*\{/y;
        om.lastIndex = j;
        const hit = om.exec(rest);
        if (!hit) break;
        const open = om.lastIndex - 1;
        const close = closing(rest, open);
        if (close < 0) break;
        options[hit[1]] = parse(rest.slice(open + 1, close), true);
        j = close + 1;
      }
      out.push({ v: m[1], plural: options });
    }
    i = end + 1;
  }
  flush();
  return out;
}

function render(nodes: Node[], vars: MessageVars, locale: string, hash: number | null): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") out += n;
    else if ("hash" in n) out += hash === null ? "#" : nf(locale).format(hash);
    else if ("plural" in n) {
      const raw = vars[n.v];
      const num = typeof raw === "number" ? raw : Number(raw);
      const branch = n.plural[`=${num}`] ?? n.plural[Number.isFinite(num) ? rules(locale).select(num) : "other"] ?? n.plural.other ?? [];
      out += render(branch, vars, locale, Number.isFinite(num) ? num : null);
    } else {
      const val = vars[n.v];
      out += val === null || val === undefined ? `{${n.v}}` : String(val);
    }
  }
  return out;
}

export function formatMessage(message: string, vars: MessageVars | undefined, locale: string): string {
  if (!vars) return message;
  let nodes = cache.get(message);
  if (!nodes) cache.set(message, (nodes = parse(message, false)));
  return render(nodes, vars, locale, null);
}

/** Nombres de las variables de un mensaje (para el auditor: las traducciones deben usar las mismas). */
export function messagePlaceholders(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (typeof n === "string" || "hash" in n) continue;
      names.add(n.v);
      if ("plural" in n) Object.values(n.plural).forEach(walk);
    }
  };
  walk(parse(message, false));
  return [...names].sort();
}

/** Categorías de plural declaradas por cada variable plural (para el auditor). */
export function messagePluralCategories(message: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const n of parse(message, false)) {
    if (typeof n !== "string" && "plural" in n) out[n.v] = Object.keys(n.plural).sort();
  }
  return out;
}
