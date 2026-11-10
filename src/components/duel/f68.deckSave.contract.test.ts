/**
 * FASE 68 · CLOSED BETA — BUG F68-003: doble clic en «Guardar equipo» de un equipo NUEVO creaba DOS equipos iguales.
 *
 * Medido en la beta (cuenta QA, 1024 px): dos clics en la misma tarea → «Equipo 1» ×2 con las mismas diez cartas.
 * La guardia era `saving` (estado de React: el segundo clic lee el mismo `false`) y un equipo nuevo no tiene versión que
 * el servidor pueda comparar. Con un doble clic humano (60 ms) ya salía uno solo; el arreglo cierra también el caso
 * rápido con una guardia síncrona (`useRef`) que se levanta antes de la primera `await` y se libera en `finally`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/components/duel/DeckBuilder.tsx"), "utf8").replace(/\r\n/g, "\n");

test("F68 B003 · el guardado del constructor tiene guardia síncrona antes de llamar al servidor", () => {
  assert.match(src, /const savingRef = useRef\(false\);/);
  assert.match(src, /async function save\(\): Promise<boolean> \{\n\s*if \(saving \|\| savingRef\.current\) return false;/);
  const body = src.slice(src.indexOf("async function save()"), src.indexOf("function reloadTheirs()"));
  assert.ok(body.indexOf("savingRef.current = true;") < body.indexOf("await props.onSave("), "la guardia se levanta ANTES de la primera await");
  assert.match(body, /finally \{\n\s*savingRef\.current = false;\n\s*setSaving\(false\);/);
});

test("F68 B003 · todas las vías de guardar pasan por la misma save() (botón, «Guardar mi versión», «Guardar y salir»)", () => {
  assert.equal((src.match(/props\.onSave\(/g) ?? []).length, 1, "una sola llamada al servidor");
  assert.ok((src.match(/save\(\)/g) ?? []).length >= 3);
});
