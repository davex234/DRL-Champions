/**
 * Tests del Player Mapper (node:test, sin dependencias nuevas).
 * Ejecutar: `npx tsx --test src/lib/match/playerMapper.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CardDef, Player, PlayerStats } from "@/domain/cards/types";
import {
  statsToAttributes, roleToSimRole, deriveIdentity, cardToRosterEntry, buildRoster,
  type CardMappingInput,
} from "./playerMapper";

const STATS: PlayerStats = { dmg: 80, scr: 80, com: 80, hs: 70, ast: 60, clu: 70 };

function mkPlayer(over: Partial<Player> = {}): Player {
  return {
    id: "x", nick: "X", team: "Team", teamTag: "TM", region: "EMEA",
    role: "Duelista", country: "ES", stats: STATS, accolades: [], ...over,
  };
}
function mkInput(p: Player, over: Partial<CardDef> = {}): CardMappingInput {
  const card: CardDef = { id: `${p.id}__gold`, playerId: p.id, variantId: "gold", ovr: 85, stats: p.stats, ...over };
  return { owned: { uid: `u-${p.id}`, cardId: card.id, obtainedAt: 0 }, card, player: p, variantLabel: "Oro" };
}

test("statsToAttributes mantiene el rango 1..99", () => {
  const a = statsToAttributes({ dmg: 99, scr: 99, com: 99, hs: 99, ast: 99, clu: 99 });
  for (const v of Object.values(a)) assert.ok(v >= 1 && v <= 99, `fuera de rango: ${v}`);
  const lo = statsToAttributes({ dmg: 0, scr: 0, com: 0, hs: 0, ast: 0, clu: 0 });
  for (const v of Object.values(lo)) assert.ok(v >= 1 && v <= 99);
});

test("roleToSimRole traduce roles de agente a roles tácticos", () => {
  assert.equal(roleToSimRole("Duelista"), "entry");
  assert.equal(roleToSimRole("Centinela"), "anchor");
  assert.equal(roleToSimRole("Flex"), "lurk");
});

test("cardToRosterEntry usa el NICK real y adjunta metadata de carta", () => {
  const entry = cardToRosterEntry(mkInput(mkPlayer({ id: "aspas", nick: "aspas" })));
  assert.equal(entry.name, "aspas");                 // nombre real, no PLAYER_1
  assert.ok(entry.identity, "debe llevar ADN");
  assert.ok(entry.meta, "debe llevar metadata");
  assert.equal(entry.meta!.playerId, "aspas");
  assert.equal(entry.meta!.ovr, 85);
});

test("deriveIdentity es DETERMINISTA (aspas siempre se comporta como aspas)", () => {
  const p = mkPlayer({ id: "aspas", stats: { dmg: 95, scr: 96, com: 93, hs: 80, ast: 50, clu: 88 } });
  const a = deriveIdentity(p, "entry", 92);
  const b = deriveIdentity(p, "entry", 92);
  assert.deepEqual(a, b);
});

test("dos jugadores distintos producen identidades distintas", () => {
  const aspas = deriveIdentity(mkPlayer({ id: "aspas", stats: { dmg: 95, scr: 96, com: 93, hs: 80, ast: 50, clu: 90 } }), "entry", 92);
  const boaster = deriveIdentity(mkPlayer({ id: "boaster", stats: { dmg: 70, scr: 72, com: 74, hs: 62, ast: 92, clu: 80 } }), "support", 76);
  assert.notDeepEqual(aspas, boaster);
});

test("forceIgl convierte al jugador en IGL con voz de mando", () => {
  const entry = cardToRosterEntry(mkInput(mkPlayer({ id: "boaster" })), { forceIgl: true });
  assert.equal(entry.role, "igl");
  assert.ok(entry.attrs.leadership >= 70);
  assert.ok(entry.identity!.leadershipDrive >= 80);
});

test("buildRoster designa EXACTAMENTE un IGL y conserva el tamaño", () => {
  const inputs = ["a", "b", "c", "d", "e"].map((id, i) =>
    mkInput(mkPlayer({ id, nick: id.toUpperCase(), stats: { ...STATS, ast: 50 + i * 8 } })),
  );
  const roster = buildRoster(inputs);
  assert.equal(roster.length, 5);
  assert.equal(roster.filter((r) => r.role === "igl").length, 1);
  // El IGL debe ser el de más asistencias (mayor liderazgo derivado): "E".
  assert.equal(roster.find((r) => r.role === "igl")!.name, "E");
});
