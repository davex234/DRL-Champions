/**
 * Tests de la Buy AI (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/buy/ai.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Role, RosterEntry } from "@/sim";
import { PROFILES, neutralIdentity } from "@/sim";
import type { BuyTier } from "@/economy";
import { buildLoadout, buildTeamLoadout, spentByName, detectBuyEvents, getItem, CATALOG } from "./index";
import type { BuyInput } from "./types";

function input(over: Partial<BuyInput> = {}): BuyInput {
  return {
    playerName: "p", role: "entry" as Role, identity: neutralIdentity(),
    credits: 4000, tier: "full", priority: "balanced", risk: "medium", seed: 1, ...over,
  };
}

test("catálogo: precios no negativos y Classic gratis", () => {
  for (const i of CATALOG) assert.ok(i.price >= 0, `${i.id} precio negativo`);
  assert.equal(getItem("classic")!.price, 0);
});

test("save: solo pistola gratis, sin gasto", () => {
  const l = buildLoadout(input({ tier: "save", credits: 5000 }));
  assert.equal(l.primary, null);
  assert.equal(l.sidearm, "classic");
  assert.equal(l.armor, "none");
  assert.equal(l.creditsSpent, 0);
  assert.equal(l.creditsRemaining, 5000);
});

test("full buy con dinero: rifle + escudo pesado + utilidad", () => {
  const l = buildLoadout(input({ tier: "full", credits: 5000, priority: "balanced" }));
  assert.ok(l.primary, "debe tener arma principal");
  assert.equal(getItem(l.primary!)!.category, "primary");
  assert.equal(l.armor, "heavy");
  assert.ok(l.utility >= 1);
  assert.ok(l.creditsRemaining >= 0);
});

test("eco: mejora la pistola sin arma principal y guarda dinero", () => {
  const l = buildLoadout(input({ tier: "eco", credits: 2400 }));
  assert.equal(l.primary, null);
  assert.ok(l.creditsSpent < 2400, "el eco debe guardar dinero");
});

test("nunca créditos negativos ni gasto > disponible", () => {
  const tiers: BuyTier[] = ["save", "eco", "half", "force", "full"];
  for (const tier of tiers) {
    for (const credits of [0, 800, 2400, 3900, 9000]) {
      for (const prof of ["aggressive-duelist", "patient-anchor", "flank-lurker"] as const) {
        const l = buildLoadout(input({ tier, credits, identity: PROFILES[prof], seed: credits + tier.length }));
        assert.ok(l.creditsRemaining >= 0, `negativo ${tier}/${credits}`);
        assert.ok(l.creditsSpent >= 0 && l.creditsSpent <= credits, `gasto inválido ${tier}/${credits}`);
      }
    }
  }
});

test("determinismo: misma entrada ⇒ mismo loadout", () => {
  assert.deepEqual(buildLoadout(input({ seed: 7 })), buildLoadout(input({ seed: 7 })));
});

test("ADN: un equipo agresivo invierte más que uno disciplinado (mismo dinero)", () => {
  const aggro = buildLoadout(input({ tier: "full", credits: 4000, identity: PROFILES["aggressive-duelist"] }));
  const disc = buildLoadout(input({ tier: "full", credits: 4000, identity: PROFILES["patient-anchor"] }));
  assert.ok(aggro.creditsSpent >= disc.creditsSpent, `${aggro.creditsSpent} >= ${disc.creditsSpent}`);
  assert.ok(aggro.firepower >= disc.firepower);
});

test("rol: un ancla con dinero puede acceder al sniper", () => {
  const anchor = buildLoadout(input({ tier: "full", credits: 6000, role: "anchor", priority: "weapons", identity: PROFILES["patient-anchor"] }));
  assert.ok(anchor.primary === "operator" || getItem(anchor.primary!)!.class === "rifle");
});

test("buildTeamLoadout: 5 loadouts y gasto por jugador coherente", () => {
  const roster: RosterEntry[] = ["entry", "igl", "lurk", "anchor", "support"].map((role, i) => ({
    name: `p${i}`, role: role as Role, attrs: { aim: 75, gameSense: 75, utility: 75, leadership: 75 }, identity: neutralIdentity(),
  }));
  const credits = { p0: 4000, p1: 4000, p2: 4000, p3: 4000, p4: 4000 };
  const team = buildTeamLoadout(roster, credits, "full", "balanced", "medium", 5);
  assert.equal(team.players.length, 5);
  const spent = spentByName(team);
  for (const p of team.players) assert.equal(spent[p.playerName], p.creditsSpent);
  assert.ok(team.totalFirepower > 0 && team.totalValue > 0);
});

test("narrativa de compra: milagro económico al ganar en eco; perfect_buy en full", () => {
  const events = detectBuyEvents([
    { round: 1, winner: "home", home: { buy: "eco", value: 500, firepower: 40 }, away: { buy: "full", value: 4000, firepower: 120 } },
    { round: 2, winner: "away", home: { buy: "full", value: 4000, firepower: 120 }, away: { buy: "full", value: 4000, firepower: 120 } },
  ]);
  assert.ok(events.some((e) => e.type === "economic_miracle" && e.team === "home"));
  assert.ok(events.some((e) => e.type === "heroic_buy" && e.team === "home"));
  assert.ok(events.some((e) => e.type === "perfect_buy"));
});
