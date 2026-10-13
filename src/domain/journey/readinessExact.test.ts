/**
 * F63 · `deckReadiness` EXACTO — un jugador con cartas de DOS roles ocupa UN solo hueco del equipo.
 *
 * Hallado en la simulación del starter (20.000 cuentas, `_fase63-starter.ts`): el 0,02 % salía «listo» sin poder formar
 * equipo, la guía proponía crearlo, el constructor fallaba y el Sobre Inicial gratis se negaba («ya puedes»).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import type { RoleId } from "@/domain/cards/types";
import { deckReadiness, type ReadinessCard } from "./index";
import { starterEligibility } from "@/domain/economy/starter";

const V = "VCT-2026";
const card = (playerId: string, role: RoleId): ReadinessCard => ({ playerId, role, dataVersion: V, combat: true });

function resolverOf(cards: Record<string, ReadinessCard>) { return (id: string) => cards[id] ?? null; }

test("F63 R01 · un jugador con cartas Duelista y Flex NO cubre dos huecos: 9 jugadores → no listo", () => {
  const cards: Record<string, ReadinessCard> = {
    d1: card("p1", "Duelista"), x_d: card("px", "Duelista"), x_f: card("px", "Flex"), f2: card("p2", "Flex"),
    c1: card("p3", "Controlador"), c2: card("p4", "Controlador"), i1: card("p5", "Iniciador"), i2: card("p6", "Iniciador"),
    s1: card("p7", "Centinela"), s2: card("p8", "Centinela"),
  };
  const r = deckReadiness(Object.keys(cards), resolverOf(cards));
  assert.equal(r.ready, false, "antes salía listo: px contaba en Duelista Y en Flex");
  assert.equal(r.shortages.reduce((s, x) => s + (x.need - x.have), 0), 1, "falta exactamente un hueco");
  // Coherencia con la política F41: sin equipo posible y sin Iniciales por abrir, el Sobre Inicial gratis SÍ se concede.
  assert.equal(starterEligibility({ deckReady: r.ready, unopenedStarter: 0, freeClaims: 0 }).eligible, true);
});

test("F63 R02 · el mismo jugador de dos roles SÍ vale cuando el otro rol está cubierto por otros (asignación óptima)", () => {
  const cards: Record<string, ReadinessCard> = {
    d1: card("p1", "Duelista"), x_d: card("px", "Duelista"), x_f: card("px", "Flex"), f2: card("p2", "Flex"), f3: card("p9", "Flex"),
    c1: card("p3", "Controlador"), c2: card("p4", "Controlador"), i1: card("p5", "Iniciador"), i2: card("p6", "Iniciador"),
    s1: card("p7", "Centinela"), s2: card("p8", "Centinela"),
  };
  const r = deckReadiness(Object.keys(cards), resolverOf(cards));
  assert.equal(r.ready, true, "px va a Duelista; p2 y p9 cubren Flex");
  assert.deepEqual(r.shortages, []);
});

test("F63 R03 · cuentas normales (un rol por jugador) dan lo mismo que antes; cartas sin combate o de otra versión no cuentan", () => {
  const cards: Record<string, ReadinessCard> = {};
  const roles: RoleId[] = ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"];
  roles.forEach((role, i) => { cards[`a${i}`] = card(`q${i}a`, role); cards[`b${i}`] = card(`q${i}b`, role); });
  assert.equal(deckReadiness(Object.keys(cards), resolverOf(cards)).ready, true);
  cards.b4 = { ...cards.b4, combat: false };
  assert.equal(deckReadiness(Object.keys(cards), resolverOf(cards)).ready, false);
  cards.b4 = { ...cards.b4, combat: true, dataVersion: "OTRA" };
  assert.equal(deckReadiness(Object.keys(cards), resolverOf(cards)).ready, false, "una sola versión de datos por equipo");
});

test("F63 R04 · catálogo real: hay jugadores con cartas de roles distintos (el caso existe de verdad)", () => {
  const rolesBy = new Map<string, Set<string>>();
  for (const c of CARDS) { const r = c.role ?? getPlayer(c.playerId)?.role; if (!r) continue; (rolesBy.get(c.playerId) ?? rolesBy.set(c.playerId, new Set()).get(c.playerId)!).add(r); }
  assert.ok([...rolesBy.values()].some((s) => s.size > 1));
});
