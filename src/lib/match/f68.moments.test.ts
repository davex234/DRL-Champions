/**
 * FASE 68 · POLISH F68-006: la ceremonia del Tactical Coach decía «Ganasteis a pesar de ceder el control» en una DERROTA
 * 1–13 (medido en la beta). La frase describe las RONDAS ganadas: con el partido perdido, lo dice así.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { utilityStory } from "./moments";

const round = (winner: "ATK" | "DEF", ctrlUs: number, ctrlThem: number) =>
  ({ coachSide: "ATK", winner, map: { control: { ATK: ctrlUs, DEF: ctrlThem }, spent: { ATK: 0, DEF: 0 } } });

test("F68 B006 · partido PERDIDO: nunca «Ganasteis…»; habla de las rondas ganadas", () => {
  const lost = { winner: "away", rounds: [round("ATK", 1, 5), ...Array.from({ length: 13 }, () => round("DEF", 1, 5))] } as never;
  const s = utilityStory(lost)!;
  assert.match(s, /^Las rondas que ganasteis fueron a pesar de ceder el control/);
  assert.ok(!/^Ganasteis/.test(s));
});

test("F68 B006 · partido GANADO: la frase original, intacta", () => {
  const won = { winner: "home", rounds: Array.from({ length: 13 }, () => round("ATK", 1, 5)) } as never;
  assert.equal(utilityStory(won), "Ganasteis a pesar de ceder el control: puro aim y duelos.");
  const ctrl = { winner: "home", rounds: Array.from({ length: 13 }, () => round("ATK", 6, 1)) } as never;
  assert.equal(utilityStory(ctrl), "Ganasteis gracias al control del mapa.");
});
