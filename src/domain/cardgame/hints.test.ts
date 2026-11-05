/**
 * F71 · pistas de las cartas ocultas del rival (`domain/cardgame/hints`). Ejecutar: `npm test`.
 *
 * Función pura: mismos datos → misma lista. Aquí se fija qué pista sale de cada campo, que el tipo lo
 * decide un hash estable (no el orden del mazo ni el azar), el salto al siguiente tipo cuando el campo
 * está vacío y que en la salida no viaja nada de la carta salvo `{ type, value }`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HINT_TYPES, NO_COUNTRY, fnv1a32, hiddenCardHints, hintForCard, type HintSource,
} from "./hints";

const COUNTRY: Record<string, string> = {};
const REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;
const ROLES = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"] as const;
const TEAMS = ["Fnatic", "Team Heretics", "Sentinels", "Paper Rex", "EDward Gaming"];

function card(i: number): HintSource {
  const playerId = `p-${i}`;
  COUNTRY[playerId] = ["ES", "SE", "KR", "BR", "FI"][i % 5];
  return {
    uid: `uid-${i}`,
    playerId,
    team: TEAMS[i % TEAMS.length],
    region: REGIONS[i % REGIONS.length],
    role: ROLES[i % ROLES.length],
  };
}
const DECK = Array.from({ length: 40 }, (_, i) => card(i));
const countryOf = (pid: string) => COUNTRY[pid] ?? "";

test("F71 H1 · los cuatro tipos salen, cada uno con el valor de SU campo", () => {
  const seen = new Set<string>();
  for (const c of DECK) {
    const h = hintForCard("match-1", c, countryOf)!;
    seen.add(h.type);
    const expected = {
      COUNTRY: COUNTRY[c.playerId],
      REGION: c.region,
      TEAM: c.team,
      ROLE: c.role,
    }[h.type];
    assert.equal(h.value, expected, `${c.uid}: ${h.type}`);
  }
  assert.deepEqual([...seen].sort(), [...HINT_TYPES].sort(), "con 40 cartas aparecen los cuatro tipos");
});

test("F71 H2 · el tipo lo decide un hash estable de «matchKey:uid»", () => {
  for (const c of DECK.slice(0, 10)) {
    const idx = fnv1a32(`match-1:${c.uid}`) % 4;
    assert.equal(hintForCard("match-1", c, countryOf)!.type, HINT_TYPES[idx]);
  }
  // FNV-1a de referencia (vector conocido): «a» → 0xe40c292c.
  assert.equal(fnv1a32("a"), 0xe40c292c);
});

test("F71 H3 · campo vacío → el SIGUIENTE tipo, siempre el mismo", () => {
  // Una carta cuyo hash elige PAÍS, sin país conocido: cae en LIGA.
  const c = DECK.find((x) => hintForCard("match-1", x, countryOf)!.type === "COUNTRY")!;
  const h = hintForCard("match-1", c, NO_COUNTRY)!;
  assert.equal(h.type, "REGION");
  assert.equal(h.value, c.region);
  // Sin país, sin región y sin equipo, queda el rol (que toda carta tiene).
  const bare = { ...c, region: "" as never, team: "" };
  assert.deepEqual(hintForCard("match-1", bare, NO_COUNTRY), { type: "ROLE", value: c.role });
  // Y una carta sin ningún dato no inventa pista.
  assert.equal(hintForCard("match-1", { ...bare, role: "" as never }, NO_COUNTRY), null);
});

test("F71 H4 · determinista: mismos datos → misma lista; otra partida → otras pistas", () => {
  const a = hiddenCardHints("match-1", DECK.slice(0, 10), countryOf);
  const b = hiddenCardHints("match-1", DECK.slice(0, 10), countryOf);
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  const other = hiddenCardHints("match-2", DECK.slice(0, 10), countryOf);
  assert.notDeepEqual(other, a, "cambiar la partida cambia el sorteo de pistas");
});

test("F71 H5 · el orden NO sigue el del mazo: cualquier permutación de la entrada da la misma salida", () => {
  const hidden = DECK.slice(0, 10);
  const base = hiddenCardHints("match-1", hidden, countryOf);
  const reversed = hiddenCardHints("match-1", [...hidden].reverse(), countryOf);
  const shuffled = hiddenCardHints("match-1", [...hidden.slice(5), ...hidden.slice(0, 5)], countryOf);
  assert.deepEqual(reversed, base);
  assert.deepEqual(shuffled, base);
  // Y no coincide con el orden de entrada (si coincidiera, el orden delataría la posición en el mazo).
  const inDeckOrder = hidden.map((c) => hintForCard("match-1", c, countryOf)!);
  assert.notDeepEqual(base, inDeckOrder);
});

test("F71 H6 · sin fugas: cada pista es { type, value } y no lleva uid, jugador ni nada más", () => {
  const out = hiddenCardHints("match-1", DECK.slice(0, 10), countryOf);
  const json = JSON.stringify(out);
  for (const h of out) assert.deepEqual(Object.keys(h!).sort(), ["type", "value"]);
  for (const c of DECK.slice(0, 10)) {
    assert.ok(!json.includes(c.uid), c.uid);
    assert.ok(!json.includes(`"${c.playerId}"`), c.playerId);
  }
});

test("F71 H7 · dominio puro: sin azar, sin reloj, sin catálogo, sin red", () => {
  const src = readFileSync(new URL("./hints.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["Math.random", "Date.now", "crypto", "@/data", "@/collection", "supabase", "fetch(", "react"]) {
    assert.ok(!src.includes(forbidden), forbidden);
  }
});
