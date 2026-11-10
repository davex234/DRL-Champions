/**
 * FASE 41 · POLÍTICA DE ASISTENCIA DE PRIMER EQUIPO (pura): elegibilidad del Sobre Inicial gratis, asistencia de rol y
 * clave de concesión.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import {
  STARTER_POLICY, STARTER_COPY, ECONOMY_VERSION, starterEligibility, starterAssistFor, starterClaimGesture,
} from "./starter";

const REG = new CardRegistry();
const resolve = (id: string) => {
  const c = REG.card(id); const p = c ? REG.player(c.playerId) : undefined;
  return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
};
/** `per` jugadores distintos de cada rol (una carta por jugador). */
function cardsWith(per: Partial<Record<string, number>>): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const c of REG.cards) {
    const role = c.role ?? REG.player(c.playerId)?.role;
    if (!role || seen.has(c.playerId)) continue;
    const want = per[role] ?? 0;
    if (out.filter((id) => { const d = REG.card(id)!; return (d.role ?? REG.player(d.playerId)?.role) === role; }).length >= want) continue;
    seen.add(c.playerId); out.push(c.id);
  }
  return out;
}

test("política: 2 huecos asistidos, tope 8, solo Sobre Inicial, versión económica 3", () => {
  assert.equal(STARTER_POLICY.packId, "inicial");
  assert.equal(STARTER_POLICY.assistSlots, 2);
  assert.equal(STARTER_POLICY.maxFreeClaims, 8);
  assert.equal(ECONOMY_VERSION, 3);
});

// Matriz exhaustiva: plantilla posible × sobres sin abrir × concesiones.
for (const deckReady of [false, true]) {
  for (const unopenedStarter of [0, 1, 3]) {
    for (const freeClaims of [0, 3, 7, 8, 12]) {
      test(`elegibilidad · plantilla=${deckReady} sin abrir=${unopenedStarter} concesiones=${freeClaims}`, () => {
        const e = starterEligibility({ deckReady, unopenedStarter, freeClaims });
        const expected = !deckReady && unopenedStarter === 0 && freeClaims < 8;
        assert.equal(e.eligible, expected);
        if (deckReady) assert.equal(e.reason, "DECK_READY");
        else if (unopenedStarter > 0) assert.equal(e.reason, "HAS_UNOPENED_STARTER");
        else if (freeClaims >= 8) assert.equal(e.reason, "CLAIM_CAP");
        else assert.equal(e.reason, null);
      });
    }
  }
}

test("clave de concesión: determinista por índice (dos peticiones simultáneas → misma clave)", () => {
  assert.equal(starterClaimGesture(0), starterClaimGesture(0));
  assert.notEqual(starterClaimGesture(0), starterClaimGesture(1));
  assert.match(starterClaimGesture(4), /^[\w:-]{1,128}$/);
});

test("asistencia: cuenta vacía → faltan 2 de cada rol, sin jugadores poseídos", () => {
  const a = starterAssistFor("inicial", [], resolve)!;
  assert.equal(a.slots, 2);
  for (const r of DUEL_ROLES) assert.equal(a.needByRole[r], 2);
  assert.equal(a.ownedPlayers.size, 0);
});

test("asistencia: solo los roles que faltan y cuántos", () => {
  const ids = cardsWith({ Duelista: 2, Controlador: 2, Iniciador: 1, Centinela: 0, Flex: 2 });
  const a = starterAssistFor("inicial", ids, resolve)!;
  assert.deepEqual(Object.keys(a.needByRole).sort(), ["Centinela", "Iniciador"]);
  assert.equal(a.needByRole.Iniciador, 1);
  assert.equal(a.needByRole.Centinela, 2);
  assert.equal(a.ownedPlayers.size, 7);
});

test("asistencia: con plantilla posible no existe (sobre normal)", () => {
  const ids = cardsWith({ Duelista: 2, Controlador: 2, Iniciador: 2, Centinela: 2, Flex: 2 });
  assert.equal(starterAssistFor("inicial", ids, resolve), null);
});

test("asistencia: nunca en otro sobre (Estándar, Premium…)", () => {
  for (const id of ["estandar", "premium", "icon", "champions"]) assert.equal(starterAssistFor(id, [], resolve), null);
});

test("copia del recorrido: frase exacta del encargo", () => {
  assert.equal(STARTER_COPY.collect, "Consigue las cartas que te faltan para completar tu equipo.");
});
