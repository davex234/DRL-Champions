/**
 * I18N · DESHACE el envoltorio donde el texto español es un IDENTIFICADOR TIPADO (`type ModeStatus = "DISPONIBLE" | …`).
 * Lee los errores de `tsc` (fichero de log), y en cada posición devuelve `t("X")` a `/* i18n-id *​/ "X"`: el valor sigue
 * siendo el identificador y se traduce al pintarlo (`td(status)`). El marcador impide que el codemod lo vuelva a envolver.
 *
 *   npx tsx scripts/i18n/unwrap-typed.ts logs/i18n/tsc-1.log
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, parseFile, translatorsOf } from "./core";

const log = readFileSync(process.argv[2], "utf8");
const byFile = new Map<string, { line: number; col: number }[]>();
for (const m of log.matchAll(/^(src\/[^\s(]+)\((\d+),(\d+)\): error TS(2322|1355|2345|2367|2678|2820)/gm)) {
  const list = byFile.get(m[1]) ?? [];
  list.push({ line: Number(m[2]) - 1, col: Number(m[3]) - 1 });
  byFile.set(m[1], list);
}

let total = 0;
for (const [file, spots] of byFile) {
  const abs = join(ROOT, file);
  const { sf, text } = parseFile(abs);
  const names = new Set(translatorsOf(sf).keys());
  const edits = new Map<number, { end: number; text: string }>();
  const isT = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text) && n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0]);
  for (const s of spots) {
    const lineStart = sf.getPositionOfLineAndCharacter(s.line, 0);
    const lineEnd = s.line + 1 < sf.getLineStarts().length ? sf.getPositionOfLineAndCharacter(s.line + 1, 0) : text.length;
    const at = lineStart + s.col;
    // el error puede señalar la llamada, la propiedad que la contiene o la sentencia: se deshacen las llamadas del tramo afectado
    let best: ts.CallExpression | null = null;
    const visit = (n: ts.Node) => {
      if (n.end <= lineStart || n.getStart() >= lineEnd) return;
      if (isT(n) && n.getStart() >= at - 1 && n.getStart() - at <= 40 && (!best || n.getStart() < best.getStart())) best = n;
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (best) {
      const call = best as ts.CallExpression;
      const p = call.parent;
      const end = ts.isAsExpression(p) && p.type.getText() === "const" ? p.end : call.end;
      edits.set(call.getStart(), { end, text: `/* i18n-id */ ${call.arguments[0].getText()}${end !== call.end ? " as const" : ""}` });
    }
  }
  if (!edits.size) continue;
  let out = text;
  for (const [start, e] of [...edits].sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + e.text + out.slice(e.end);
  writeFileSync(abs, out, "utf8");
  total += edits.size;
  console.log(`${file}: ${edits.size}`);
}
console.log(`deshechos: ${total}`);
