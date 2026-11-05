/**
 * FASE 68 · BUG F68-008: tras reclamar recompensas (+3.430 créditos, cuenta QA real a 1024 px) el HUD seguía en 6.000:
 * los reclamos releían la foto de PROGRESIÓN, pero el saldo del HUD vive en el store de JUEGO. Arreglo: si algo se
 * cobró, se relee también el estado del servidor (`syncFromServer`), en el hub/post-partida (`useClaims`) y en /logros.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("F68 B008 · useClaims (hub y post-partida): tras cobrar, relee el estado de juego del servidor", () => {
  const s = read("src/lib/progression/claims.ts");
  assert.match(s, /import \{ syncFromServer \} from "@\/lib\/game\/sync";/);
  assert.match(s, /await onAfter\(\);[\s\S]*?if \(ok\.length > 0\) await syncFromServer\(\)\.catch\(\(\) => undefined\);/);
});

test("F68 B008 · /logros: tras un reclamo correcto, relee el estado de juego (el HUD enseña el saldo nuevo)", () => {
  const s = read("src/app/logros/page.tsx");
  assert.match(s, /await fn\(\);\n\s*notify\(okMsg, true\);\n\s*await load\(\);\n\s*await syncFromServer\(\)\.catch\(\(\) => undefined\);/);
});

test("F68 B008 · releer el servidor no toca la autoridad: el cliente sigue sin enviar cantidades", () => {
  const s = read("src/lib/progression/claims.ts");
  assert.ok(!/credits|amount|xp:/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "ni créditos ni XP en el transporte");
});
