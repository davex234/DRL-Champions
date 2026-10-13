/**
 * FASE 69 · F68-013 — /cuenta enseñaba «Rango BRONCE I» (rangos por `profiles.points`, que suman Pick'ems y duelos
 * contra el bot) junto al resumen del ranked («Rating PvP», «Posición»), y los dos decían «escalera» y «Sin clasificar».
 * Contrato F55: el ranked PvP es rating (Elo) + puesto en la escalera, SIN rangos con nombre. Aquí se fija que cada
 * cifra dice de qué sistema es, sin inventar tiers para el Elo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

test("F69 F68-013 · /cuenta: el rango de la ficha se llama «Rango de puntos» y su puesto es «en puntos»", () => {
  const s = code(read("src/app/cuenta/page.tsx"));
  assert.match(s, /titulo="Rango de puntos"/);
  assert.match(s, /del mundo en puntos/);
  assert.ok(!/entras en la escalera/.test(s), "«escalera» es del ranked, no de los puntos");
  assert.match(s, /Gana duelos contra el bot o acierta predicciones de Pick&apos;ems/, "las fuentes reales de puntos");
  // Reanudación F69: ningún «rango» suelto en texto visible (el sondeo vivo lo encontraba en el pie y en el tope).
  const visible = [...s.matchAll(/"([^"]*)"|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2]).join(" | ");
  assert.ok(!/\b[Rr]ango\b(?! de puntos)/.test(visible), "todo «rango» visible dice de qué sistema es");
});

test("F69 F68-013 · resumen ranked en /cuenta: rating Elo y puesto ranked, sin tiers con nombre, enlace canónico", () => {
  const s = code(read("src/components/competitive/CompetitiveSummary.tsx"));
  assert.match(s, /label="Rating ranked \(Elo\)"/);
  assert.match(s, /label="Puesto ranked"/);
  assert.ok(!/\b(Bronce|Plata|Oro|Platino|Diamante|Maestro|Élite|Nexus|Bronze|Silver|Gold)\b/.test(s), "sin rangos con nombre para el Elo");
  assert.ok(!/RankBadge|RankEmblem|rankProgress/.test(s), "no mezcla los rangos de puntos");
  assert.match(s, /href="\/competitivo"/);
});

test("F69 F68-013 · /ranking e insignia: «rangos de puntos», no «la escalera» (que es del ranked)", () => {
  const r = code(read("src/app/ranking/page.tsx"));
  assert.match(r, /aria-label="Los rangos de puntos"/);
  assert.match(r, />\s*Rangos de puntos\s*</);
  assert.ok(!/>\s*La escalera\s*</.test(r));
  const b = code(read("src/components/progression/RankBadge.tsx"));
  assert.ok(!/entras en la escalera/.test(b));
  assert.match(b, /del mundo en puntos/);
});
