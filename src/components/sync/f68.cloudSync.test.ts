/**
 * FASE 68 · BUG F68-007: con dos pestañas del MISMO navegador, la 2.ª seguía enseñando el saldo viejo (5.310) después
 * de comprar en la 1.ª (servidor: 2.810), también tras recibir el foco y navegar dentro de la app. Solo se corregía
 * recargando. Arreglo: `CloudSync` relee el estado del servidor al recuperar el foco / volver a ser visible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESYNC_MIN_MS } from "./CloudSync";

const src = readFileSync(join(process.cwd(), "src/components/sync/CloudSync.tsx"), "utf8").replace(/\r\n/g, "\n");

test("F68 B007 · al volver a la pestaña se relee el servidor (foco o visibilidad), con sesión", () => {
  assert.match(src, /window\.addEventListener\("focus", resync\);/);
  assert.match(src, /document\.addEventListener\("visibilitychange", onVisible\);/);
  assert.match(src, /const onVisible = \(\) => \{ if \(document\.visibilityState === "visible"\) resync\(\); \};/);
  assert.match(src, /if \(!configured \|\| !user\) return;\n\s*let last = Date\.now\(\);/, "sin sesión no hace nada (modo local intacto)");
});

test("F68 B007 · con freno: como mucho una lectura cada RESYNC_MIN_MS (presupuesto de peticiones F64)", () => {
  assert.ok(RESYNC_MIN_MS >= 5_000);
  assert.match(src, /if \(Date\.now\(\) - last < RESYNC_MIN_MS\) return;/);
  assert.match(src, /syncFromServer\(\)\.catch\(\(\) => undefined\);/, "un fallo de red no rompe la pestaña");
  assert.match(src, /removeEventListener\("focus", resync\)[\s\S]*removeEventListener\("visibilitychange", onVisible\)/, "sin oyentes colgados");
});
