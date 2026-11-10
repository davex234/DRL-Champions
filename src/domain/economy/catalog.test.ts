/**
 * FASE 41 · CATÁLOGO CANÓNICO: cada flujo sale de su constante real, no hay ids duplicados y los P0 cerrados constan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { economyFlows, seasonBudget, dailyRecurringCeiling, DUEL_TABLE, ECONOMY_VERSION } from "./catalog";
import { DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { CAMPAIGN_FIRST_CLEAR_CAP } from "@/domain/campaign/rewards";
import { PRESTIGE_TIERS } from "@/domain/collection/prestige";
import { CREDIT_PRODUCTS } from "@/domain/economy/drlCredits";
import { salvageValue } from "@/domain/economy/salvage";
import { CARDS } from "@/data/catalog";
import { GLOBAL_MARKET_ENABLED } from "@/config/features";
import { getPack } from "@/data/packs";

const flows = economyFlows();
const byId = (id: string) => flows.find((f) => f.id === id)!;

test("ids únicos y todas las clases presentes", () => {
  assert.equal(new Set(flows.map((f) => f.id)).size, flows.length);
  for (const cls of ["SOURCE", "SINK", "TRANSFER", "NON_ECONOMIC"]) assert.ok(flows.some((f) => f.cls === cls), cls);
});

test("toda fuente viva tiene tope o repetición acotada", () => {
  for (const f of flows.filter((x) => x.cls === "SOURCE" && x.status === "LIVE")) {
    assert.ok(f.repeat !== "PER_ACTION" || f.cap !== null, `${f.id} sin tope`);
  }
});

test("duelo PvE: tabla real (EASY 25–120 … HARD 60–350) y tope 20", () => {
  assert.equal(DUEL_TABLE.length, 9);
  assert.deepEqual(byId("pve-duel").credits, { min: 25, max: 350 });
  assert.match(byId("pve-duel").cap!, new RegExp(`^${DAILY_DUEL_AWARD_CAP} `));
});

test("logros: total igual a la suma real", () => {
  assert.equal(seasonBudget().achievementsCredits, ACHIEVEMENTS.reduce((s, a) => s + a.reward, 0));
});

test("campaña: total ≤ techo declarado", () => {
  assert.ok(seasonBudget().campaignCredits <= CAMPAIGN_FIRST_CLEAR_CAP);
});

test("pase: carril libre 15.900 + 6 sobres; competitivo 26.000 + 6 premium", () => {
  const b = seasonBudget();
  assert.equal(b.passFreeCredits, 15_900);
  assert.equal(b.passFreePacks, 6);
  assert.equal(b.passCompetitiveCredits, 26_000);
  assert.equal(b.passCompetitivePacks, 6);
});

test("techo diario recurrente = PvE al tope en Difícil + 3 diarias + 2 semanales mejor pagadas", () => {
  const b = seasonBudget();
  assert.equal(b.pveMaxPerDay, 20 * 350);
  assert.equal(dailyRecurringCeiling(), b.pveMaxPerDay + b.dailyMissionMaxPerDay + b.weeklyMissionMaxPerWeek);
});

test("P0 cerrados constan en el mapa (starter, misiones, sandbox, prestigio)", () => {
  assert.match(byId("starter-assist").fase41, /P0 cerrado/);
  assert.equal(byId("mission-daily").repeat, "ONCE_PER_WINDOW");
  assert.equal(byId("mission-weekly").repeat, "ONCE_PER_WINDOW");
  assert.equal(byId("sandbox-credits").status, "CLOSED");
  assert.match(byId("prestige").idempotency, /<uid>/);
});

test("sumideros y fuentes con importes reales (prestigio, créditos, reciclaje)", () => {
  assert.deepEqual(byId("prestige").credits, { min: -Math.max(...PRESTIGE_TIERS.map((t) => t.price)), max: -Math.min(...PRESTIGE_TIERS.map((t) => t.price)) });
  assert.equal(byId("sandbox-credits").credits.max, Math.max(...CREDIT_PRODUCTS.map((p) => p.credits)));
  assert.deepEqual(byId("salvage").credits, { min: Math.min(...CARDS.map(salvageValue)), max: Math.max(...CARDS.map(salvageValue)) });
});

test("sin economía: PvP, apertura; F72: Draft = entrada (sumidero) + recompensa (fuente); mercado desactivado y su interruptor intacto", () => {
  for (const id of ["pvp", "pack-open"]) assert.equal(byId(id).cls, "NON_ECONOMIC");
  assert.deepEqual([byId("draft-entry").cls, byId("draft-entry").credits], ["SINK", { min: -2_000, max: -2_000 }]);
  assert.deepEqual([byId("draft-reward").cls, byId("draft-reward").credits], ["SOURCE", { min: 0, max: 2_100 }]);
  assert.equal(byId("market").status, "DISABLED");
  assert.equal(GLOBAL_MARKET_ENABLED, false);
});

test("compra de sobres: solo sobres de pago ACTIVE (el gratis va por asistencia)", () => {
  const p = byId("pack-purchase");
  // Fase 57.4: el sobre de pago más caro de la tienda es Icon (12.500); el rango sale de los precios canónicos.
  assert.ok(p.credits.max < 0 && p.credits.min <= -getPack("icon")!.price);
});

test("versión económica expuesta", () => {
  assert.equal(ECONOMY_VERSION, 3);
});
