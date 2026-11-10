/** F71 · tema de duelo en el cliente: capas del fondo con respaldo DEFAULT y URL CSS saneada. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arenaBackgroundLayers, cssUrl } from "./duelTheme";
import { ARENAS } from "./arenas";
import { CODE_DEFAULT_THEME } from "@/domain/duelThemes";

const BASE = ARENAS["nexus-champions"].background;

test("F71 THEMES C01 · sin tema o con el DEFAULT de código: solo la arena de siempre", () => {
  assert.deepEqual(arenaBackgroundLayers(null, BASE), { wide: `url("${BASE.wide}")`, narrow: `url("${BASE.narrow}")` });
  assert.deepEqual(arenaBackgroundLayers(CODE_DEFAULT_THEME, BASE), arenaBackgroundLayers(null, BASE));
});

test("F71 THEMES C02 · tema de evento ENCIMA y la arena DEFAULT debajo (si su imagen falla, se ve la de siempre)", () => {
  const l = arenaBackgroundLayers({ id: "a", slug: "champions", name: "Champions", wide: "https://cdn/w.webp", narrow: "https://cdn/n.webp", source: "event" }, BASE);
  assert.equal(l.wide, `url("https://cdn/w.webp"), url("${BASE.wide}")`);
  assert.equal(l.narrow, `url("https://cdn/n.webp"), url("${BASE.narrow}")`);
});

test("F71 THEMES C03 · la URL no puede romper la declaración CSS", () => {
  assert.equal(cssUrl('https://x/a") ; background:red;("'), 'url("https://x/a) ; background:red;(")');
});

test("F71 THEMES C04 · la arena usa las capas del tema y una sola lectura pública (no carga todos los fondos)", () => {
  const env = readFileSync(join(process.cwd(), "src/components/duel/arena/ArenaEnvironment.tsx"), "utf8");
  assert.match(env, /arenaBackgroundLayers\(theme, arena\.background\)/);
  const client = readFileSync(join(process.cwd(), "src/lib/duel/duelTheme.ts"), "utf8");
  assert.equal((client.match(/fetch\(/g) ?? []).length, 1);
  assert.match(client, /\/api\/content\/duel-theme/);
});
