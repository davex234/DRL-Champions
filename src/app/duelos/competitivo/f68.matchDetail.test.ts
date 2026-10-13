/**
 * FASE 68 · POLISH F68-014: /duelos/competitivo/partida/<id mal formado> enseñaba «Algo ha fallado · Reintentar» (el
 * servidor responde 400) — reintentar no puede arreglar un enlace roto. Ahora cae en «Partida no encontrada», igual que 404.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("F68 B014 · id mal formado (400) = partida no encontrada, con salida a /competitivo", () => {
  const s = readFileSync(join(process.cwd(), "src/app/duelos/competitivo/partida/[matchId]/page.tsx"), "utf8");
  assert.match(s, /if \(error\?\.status === 404 \|\| error\?\.status === 400\) \{\s*return <EmptyState icon="🔒" title="Partida no encontrada"[^>]*action=\{\{ href: "\/competitivo", label: "Volver al competitivo" \}\} \/>;/);
});
