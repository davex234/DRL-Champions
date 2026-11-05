/**
 * FASE 69 · F68-010 — el Tactical Coach NO da créditos, XP ni nivel. Medido en F68/F69 con cuentas QA reales: el HUD
 * pasaba de 9.430 a 12.280 créditos y del nivel 3 al 6 al terminar un partido del Coach, mientras el servidor seguía en
 * 9.430 / 552 XP; al sincronizar volvía atrás. Causa: `grantMatchOutcomeReward` aplicaba `applyReward` al store LOCAL.
 * Decisión de producto: el Coach es entrenamiento. Estos tests fijan que el final del partido no toca saldo ni XP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoachSetup } from "@/sim";
import { DEMO_HOME, DEMO_AWAY } from "@/sim/mapping/demoRoster";
import { simulateMatch, makeMatchConfig } from "@/match";
import { useGameStore } from "@/store/useGameStore";
import { levelFromXp } from "@/domain/progression/levels";
import * as matchEnd from "./rewards";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

test("F69 F68-010 · terminar un partido del Coach deja saldo, XP y nivel EXACTAMENTE como estaban (servidor = X → HUD = X)", () => {
  for (const seed of [12345, 20250626, 7]) {
    const m = simulateMatch(makeMatchConfig({ seed, rosters: { home: DEMO_HOME, away: DEMO_AWAY }, homeSetup: SETUP }));
    assert.equal(m.phase, "MATCH_END");
    // Estado del HUD = el que dejó la última sincronización con el servidor.
    useGameStore.setState({ credits: 9430, xp: 552 });
    const before = { credits: useGameStore.getState().credits, xp: useGameStore.getState().xp };
    const summary = matchEnd.recordCoachMatch(m);
    const after = { credits: useGameStore.getState().credits, xp: useGameStore.getState().xp };
    assert.deepEqual(after, before, `seed ${seed}: el Coach movió el saldo o la XP del HUD`);
    assert.equal(levelFromXp(after.xp).level, levelFromXp(before.xp).level, "el nivel no cambia");
    assert.equal(summary.won, m.winner === "home");
    assert.ok(!("credits" in summary) && !("xp" in summary), "el resumen no lleva cifras económicas");
  }
});

test("F69 F68-010 · el módulo del final del partido ya no exporta ni aplica recompensas", () => {
  const exported = Object.keys(matchEnd);
  for (const gone of ["grantMatchOutcomeReward", "grantMatchReward", "computeMatchOutcomeReward", "computeMatchReward"]) {
    assert.ok(!exported.includes(gone), `${gone} sigue exportado`);
  }
  const src = code(read("src/lib/match/rewards.ts"));
  assert.ok(!/applyReward|addCredits|addXp|credits:|xp:/.test(src), "rewards.ts no toca créditos ni XP");
});

test("F69 F68-010 · el bucle del Coach y la ceremonia no prometen créditos ni XP", () => {
  const loop = code(read("src/components/sim/useCoachMatch.ts"));
  assert.ok(!/applyReward|grantMatch|addCredits|addXp/.test(loop), "useCoachMatch no aplica recompensas");
  const ceremony = code(read("src/components/coach/MatchCeremony.tsx"));
  assert.ok(!/\+\$\{[^}]*(credits|xp)[^}]*\}/.test(ceremony), "sin «+N créditos / +N XP»");
  assert.ok(!/label="(Créditos|Experiencia)"/.test(ceremony), "sin casillas de créditos/experiencia");
  assert.match(read("src/components/coach/MatchCeremony.tsx"), /no suma créditos ni XP/, "dice claramente que es entrenamiento");
  const page = code(read("src/app/entrenador/partido/page.tsx"));
  assert.ok(!/loop\.reward|applyReward/.test(page));
});

test("F69 F68-010 · ninguna pantalla del Coach vuelve a pintar recompensas económicas", () => {
  for (const f of ["src/components/coach/MatchCeremony.tsx", "src/components/coach/RoundOutcome.tsx", "src/app/entrenador/partido/page.tsx"]) {
    const s = code(read(f));
    assert.ok(!/\+\$\{[^}]*\}\s*(créditos|XP)/.test(s), `${f}: pinta «+N créditos/XP»`);
    assert.ok(!/from "@\/lib\/rewards"/.test(s), `${f}: importa el aplicador de recompensas local`);
  }
});
