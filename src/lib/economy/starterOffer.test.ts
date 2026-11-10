/**
 * FASE 41 · PRESENTACIÓN DEL SOBRE INICIAL: nunca ofrece «gratis» lo que el servidor rechazaría y siempre dice por qué.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { starterOffer } from "./starterOffer";
import type { StarterStatus } from "@/server/services/starter";

const st = (o: Partial<StarterStatus>): StarterStatus => ({
  eligible: false, reason: null, deckReady: false, unopenedStarter: 0, freeClaims: 0, maxFreeClaims: 8, missingRoles: [], ...o,
});

test("con un Sobre Inicial en el inventario: abrir (sin preguntar al servidor)", () => {
  const o = starterOffer({ owned: 2, online: true, status: undefined });
  assert.equal(o.kind, "open-owned"); assert.ok(o.enabled); assert.equal(o.cta, "Abrir sobre");
});

test("sin sesión: no se ofrece nada gratis", () => {
  const o = starterOffer({ owned: 0, online: false, status: null });
  assert.equal(o.kind, "offline"); assert.equal(o.enabled, false);
});

test("comprobando: botón desactivado", () => {
  const o = starterOffer({ owned: 0, online: true, status: undefined });
  assert.equal(o.kind, "checking"); assert.equal(o.enabled, false);
});

test("error al comprobar: desactivado con motivo", () => {
  const o = starterOffer({ owned: 0, online: true, status: null });
  assert.equal(o.enabled, false); assert.ok(o.note);
});

test("elegible: «Conseguir Sobre Inicial gratis» + copia del encargo + roles que faltan", () => {
  const o = starterOffer({ owned: 0, online: true, status: st({ eligible: true, missingRoles: [{ role: "Centinela", have: 1, need: 2 }] }) });
  assert.equal(o.kind, "claim"); assert.ok(o.enabled);
  assert.equal(o.cta, "Conseguir Sobre Inicial gratis");
  assert.match(o.note!, /^Consigue las cartas que te faltan para completar tu equipo\./); // F64 · «equipo»
  assert.match(o.note!, /Centinela 1\/2/);
});

test("plantilla ya posible: no disponible, dice por qué", () => {
  const o = starterOffer({ owned: 0, online: true, status: st({ reason: "DECK_READY", deckReady: true }) });
  assert.equal(o.kind, "not-needed"); assert.equal(o.enabled, false); assert.equal(o.priceLabel, "No disponible");
  assert.match(o.note!, /ya no es necesario/);
});

test("ya tiene uno sin abrir (servidor): abrir", () => {
  const o = starterOffer({ owned: 0, online: true, status: st({ reason: "HAS_UNOPENED_STARTER", unopenedStarter: 1 }) });
  assert.equal(o.kind, "has-unopened"); assert.ok(o.enabled);
});

test("tope alcanzado: no disponible y señala la ruta con créditos", () => {
  const o = starterOffer({ owned: 0, online: true, status: st({ reason: "CLAIM_CAP", freeClaims: 8 }) });
  assert.equal(o.kind, "cap"); assert.equal(o.enabled, false); assert.match(o.note!, /Sobre Estándar/);
});

test("nunca «gratis» habilitado si el servidor dice que no", () => {
  for (const reason of ["DECK_READY", "CLAIM_CAP"] as const) {
    const o = starterOffer({ owned: 0, online: true, status: st({ reason }) });
    assert.ok(!(o.enabled && /gratis/i.test(o.cta)));
  }
});
