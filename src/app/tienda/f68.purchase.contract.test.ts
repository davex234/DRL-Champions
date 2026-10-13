/**
 * FASE 68 · CLOSED BETA — BUG F68-002: doble clic en «Confirmar» de la tienda cobraba DOS sobres.
 *
 * Medido en la beta (cuenta QA, 390 px): dos clics en la misma tarea → 2 × 1.000 créditos y 2 sobres. Causa: la guardia
 * era `busy` (estado de React, el segundo clic lee el mismo `false`) y cada compra salía con una clave de idempotencia
 * NUEVA (`newGesture()` por llamada), así que el servidor no podía reconocer el segundo envío como el mismo gesto.
 * Arreglo: guardia síncrona (`useRef`) + UNA clave por gesto de compra (por apertura del diálogo), que llega a
 * `/api/game/packs {action:"buy", ref}` → `app_buy_pack` deduplica en `economy_ops` (reintento = +0).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("F68 B002 · tienda: guardia síncrona antes de cobrar y liberada al terminar (éxito o fallo)", () => {
  const s = code(read("src/app/tienda/page.tsx"));
  assert.match(s, /const inFlight = useRef\(false\);/);
  assert.match(s, /if \(busy \|\| inFlight\.current \|\| !packId\) return;\s*inFlight\.current = true;/);
  assert.match(s, /finally \{ inFlight\.current = false; setBusy\(false\); \}/);
});

test("F68 B002 · tienda: UNA clave por gesto (al abrir el diálogo), la misma en el reintento, nueva tras comprar", () => {
  const s = code(read("src/app/tienda/page.tsx"));
  assert.match(s, /function select\(p: ResolvedProduct\) \{[\s\S]*?gesture\.current = newGesture\(\);/);
  assert.match(s, /await buyPackOnline\(packId, gesture\.current \?\? undefined\);/);
  assert.match(s, /gesture\.current = null;/);
  // Ninguna otra llamada de compra sin clave en la página.
  assert.equal((s.match(/buyPackOnline\(/g) ?? []).length, 1);
});

test("F68 B002 · la clave llega al servidor: buyPackOnline → buyPack(packId, ref) → {action:'buy', packId, ref}", () => {
  const sync = code(read("src/lib/game/sync.ts"));
  // I18N · el cuerpo puede ir dentro de la guardia de cambio de idioma (no añade petición): la PRIMERA llamada sigue siendo la compra con su clave.
  assert.match(sync, /export async function buyPackOnline\(packId: string, ref\?: string\): Promise<void> \{\s*(?:const endCritical = beginCriticalOperation\(\);\s*try \{\s*)?await apiBuyPack\(packId, ref\);/);
  const buyBody = sync.slice(sync.indexOf("export async function buyPackOnline("));
  assert.equal((buyBody.slice(0, buyBody.indexOf("\nexport ", 1) > 0 ? buyBody.indexOf("\nexport ", 1) : undefined).match(/apiBuyPack\(/g) ?? []).length, 1, "una sola petición de compra");
  const client = code(read("src/lib/game/client.ts"));
  // ICON (2026-10-09) · + el precio que esta pestaña enseña (`seenPrice`): solo puede BLOQUEAR un cobro distinto.
  assert.match(client, /export const buyPack = \(packId: string, ref = newGesture\(\)\) =>\s*postJson<[^>]+>\(\s*"\/api\/game\/packs", \{ action: "buy", packId, ref, \.\.\.seenPrice\(packId\) \}\);/);
  const hook = code(read("src/lib/game/usePackPurchase.ts"));
  assert.match(hook, /async \(packId: string, ref\?: string\)[\s\S]*?await buyPackOnline\(packId, ref\);/);
});

test("F68 B002 · ficha del sobre (/packs/[id]): la misma guardia síncrona en su botón de compra", () => {
  const s = code(read("src/app/packs/[packId]/page.tsx"));
  assert.match(s, /const inFlight = useRef\(false\);/);
  assert.match(s, /if \(inFlight\.current\) return;\s*inFlight\.current = true;\s*setBusy\(true\);/);
  assert.match(s, /finally \{\s*inFlight\.current = false;\s*setBusy\(false\);\s*\}/);
});

test("F68 B002 · el servidor reconoce la clave: la ruta pasa `ref` a la compra (misma clave = misma operación)", () => {
  const route = code(read("src/app/api/game/packs/route.ts"));
  assert.match(route, /ref/);
  const mig = read("supabase/migrations/0019_economy_ledger.sql");
  const fn = mig.slice(mig.indexOf("function public.app_buy_pack"), mig.indexOf("function public.app_apply_pack_open"));
  assert.match(fn, /economy_ops/, "app_buy_pack consulta economy_ops por la clave antes de cobrar");
});
