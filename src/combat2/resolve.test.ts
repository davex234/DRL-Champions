/**
 * Tests del Combat Integration Engine (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/combat2/resolve.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Identity, Phase, SimLoadout, SimPlayer } from "@/sim";
import { PROFILES, neutralIdentity } from "@/sim";
import { loadoutDuelMult, profileFor, shieldEffect, utilityEffect, teamPosture, detectCombatEvents, WEAPON_PROFILES } from "./index";

function loadout(over: Partial<SimLoadout> = {}): SimLoadout {
  return { primary: "vandal", sidearm: "classic", armor: "heavy", utility: 1, firepower: 90, econValue: 3900, buy: "full", ...over };
}
function player(over: Partial<SimPlayer> = {}): SimPlayer {
  return {
    id: "ATK-0", name: "X", side: "ATK", role: "entry",
    attrs: { aim: 75, gameSense: 75, utility: 75, leadership: 75 },
    identity: neutralIdentity(), mental: { confidence: 60, tilt: 0, morale: 55, momentum: 0, fatigue: 0, pressure: 0 },
    pos: { x: 0, y: 0 }, facing: 0, alive: true, hp: 100, targetZone: "site", holdPos: { x: 0, y: 0 },
    intent: "fight", targetEnemyId: null, lastSeen: {}, flashedUntil: -1, movedThisTick: false,
    actionProgress: 0, reactBuffer: 0, ...over,
  };
}

test("sin loadout, el multiplicador es 1 (combate clásico intacto)", () => {
  assert.equal(loadoutDuelMult(player({ loadout: undefined }), player({ loadout: loadout() }), 100, "EXECUTE"), 1);
  assert.equal(loadoutDuelMult(player({ loadout: loadout() }), player({ loadout: undefined }), 100, "EXECUTE"), 1);
});

test("mejor arma → ventaja; peor arma → desventaja", () => {
  const rifleVsPistol = loadoutDuelMult(
    player({ loadout: loadout({ primary: "vandal", firepower: 90 }) }),
    player({ loadout: loadout({ primary: null, sidearm: "classic", armor: "none", firepower: 20 }) }),
    150, "EXECUTE",
  );
  const pistolVsRifle = loadoutDuelMult(
    player({ loadout: loadout({ primary: null, sidearm: "classic", armor: "none", firepower: 20 }) }),
    player({ loadout: loadout({ primary: "vandal", firepower: 90 }) }),
    150, "EXECUTE",
  );
  assert.ok(rifleVsPistol > 1.1, `rifle deberia tener ventaja: ${rifleVsPistol}`);
  assert.ok(pistolVsRifle < 0.9, `pistola deberia tener desventaja: ${pistolVsRifle}`);
});

test("el alcance importa: el sniper rinde mejor a distancia que la escopeta", () => {
  const atkOp = player({ loadout: loadout({ primary: "operator", firepower: 95 }) });
  const def = player({ loadout: loadout({ primary: "phantom", firepower: 88 }) });
  const close = loadoutDuelMult(atkOp, def, 60, "EXECUTE");
  const far = loadoutDuelMult(atkOp, def, 560, "EXECUTE");
  assert.ok(far > close, `el operator deberia mejorar a distancia: ${far} > ${close}`);
});

test("el escudo del defensor reduce la probabilidad del atacante", () => {
  const atk = player({ loadout: loadout() });
  const heavy = loadoutDuelMult(atk, player({ loadout: loadout({ armor: "heavy" }) }), 150, "EXECUTE");
  const none = loadoutDuelMult(atk, player({ loadout: loadout({ armor: "none" }) }), 150, "EXECUTE");
  assert.ok(none > heavy, `sin escudo el defensor cae más fácil: ${none} > ${heavy}`);
  assert.ok(shieldEffect("heavy").survival > shieldEffect("light").survival);
});

test("ADN: el mismo loadout rinde distinto (agresivo realiza más la ventaja de arma)", () => {
  // Sin utilidad para aislar el efecto de la AGRESIVIDAD (la utilidad la aprovecha
  // más el disciplinado, y es un efecto distinto, también deseado).
  const def = player({ loadout: loadout({ primary: null, sidearm: "classic", armor: "none", utility: 0, firepower: 20 }) });
  const aggro = player({ identity: PROFILES["aggressive-duelist"], loadout: loadout({ utility: 0 }) });
  const disc = player({ identity: PROFILES["patient-anchor"], loadout: loadout({ utility: 0 }) });
  const a = loadoutDuelMult(aggro, def, 150, "EXECUTE");
  const d = loadoutDuelMult(disc, def, 150, "EXECUTE");
  assert.notEqual(a, d);
  assert.ok(a > d, `el agresivo realiza más la ventaja: ${a} > ${d}`);
});

test("la utilidad ayuda en EXECUTE (atacante) y se nota más en disciplinados", () => {
  const def = player({ loadout: loadout({ utility: 0 }) });
  const withUtil = loadoutDuelMult(player({ identity: PROFILES["utility-support"], loadout: loadout({ utility: 2 }) }), def, 150, "EXECUTE");
  const noUtil = loadoutDuelMult(player({ identity: PROFILES["utility-support"], loadout: loadout({ utility: 0 }) }), def, 150, "EXECUTE");
  assert.ok(withUtil > noUtil, `la utilidad deberia ayudar en execute: ${withUtil} > ${noUtil}`);
  assert.ok(utilityEffect(2).execute > utilityEffect(0).execute);
});

test("determinismo: misma entrada ⇒ mismo multiplicador", () => {
  const a = player({ loadout: loadout() }), b = player({ loadout: loadout({ primary: "spectre", firepower: 60 }) });
  assert.equal(loadoutDuelMult(a, b, 200, "EXECUTE"), loadoutDuelMult(a, b, 200, "EXECUTE"));
});

test("el multiplicador queda acotado (no estados imposibles)", () => {
  for (const w of Object.keys(WEAPON_PROFILES)) {
    const m = loadoutDuelMult(
      player({ loadout: loadout({ primary: w, firepower: profileFor(loadout({ primary: w })).power * 100 }) }),
      player({ loadout: loadout({ primary: "classic", armor: "none" }) }),
      300, "EXECUTE",
    );
    assert.ok(m >= 0.5 && m <= 1.8, `fuera de rango ${w}: ${m}`);
  }
});

test("teamPosture: kit pobre → picks/agrupados; mucha utilidad+kit → executes", () => {
  const poor: SimLoadout[] = Array.from({ length: 5 }, () => loadout({ primary: null, sidearm: "classic", armor: "none", utility: 0, firepower: 20 }));
  const rich: SimLoadout[] = Array.from({ length: 5 }, () => loadout({ primary: "vandal", armor: "heavy", utility: 1, firepower: 90 }));
  assert.ok(teamPosture(poor).picks && teamPosture(poor).grouped);
  assert.ok(teamPosture(rich).executes && teamPosture(rich).utilityHeavy);
});

test("narrativa de combate: detecta equipment_kill y heroic_duel", () => {
  const rounds = [{
    seed: 1, tick: 100, phase: "ENDED" as Phase, players: [], spike: { planted: false, carrierId: null, pos: null, plantedTick: null, plantProgress: 0, defuseBy: null, defuseProgress: 0 },
    events: [
      { tick: 10, type: "kill" as const, data: { byName: "H0", bySide: "ATK", fpBy: 90, fpVic: 30 } },
      { tick: 20, type: "kill" as const, data: { byName: "A0", bySide: "DEF", fpBy: 25, fpVic: 95 } },
    ],
    coachSide: "ATK" as const, plans: { ATK: { approach: "default", tempo: "mid" as const, aggression: "balanced" as const }, DEF: { approach: "balanced", tempo: "mid" as const, aggression: "balanced" as const } },
    voz: { left: 0, total: 0 }, winner: "ATK" as const, endReason: "x", executeTick: null, forcedExecute: false, retakeFlashed: false,
    coachFlags: {
      fallbackUntil: 0, forceRetake: false, retakeTick: null,
      tempoBias: 0, aggressionBias: 0, laneFocus: null, stack: false,
      forceRotation: false, saveUtility: false, pushUtility: false, iglOverrideId: null,
    },
  }];
  const events = detectCombatEvents(rounds, new Set(["H0"]));
  assert.ok(events.some((e) => e.type === "equipment_kill" && e.team === "home"));
  assert.ok(events.some((e) => e.type === "heroic_duel" && e.team === "away"));
});
