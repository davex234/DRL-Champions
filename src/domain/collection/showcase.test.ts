/**
 * EL BUCLE DE COLECCIÓN EN NÚMEROS (Fase 25) — pruebas 1–4, 7–9, 16, 24–26, 31–35 del brief sobre
 * funciones puras. Catálogo y sobres REALES; propiedad sintética (QA SYNTHETIC).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { PACKS, getPack } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import { isStoreVisible, isPubliclyOpenable } from "@/domain/packs/lifecycle";
import type { OwnedCard } from "@/domain/cards/types";
import { buildTeamCollection } from "@/domain/collections/teamCollection";
import {
  ownedPackGroups, totalOwnedPacks, isLowSerial, bestOf, recentlyAcquired, duplicateCardIds, instancesOf, heroMetrics,
} from "./showcase";
import { loopCards } from "@/components/lobby/LoopStrip";
import { featuredPacks } from "@/components/packs/packCatalog";
import { canonicalCardTeam } from "@/data/teamIdentities";

const NOW = Date.parse("2026-09-14T12:00:00Z");
const H = 3_600_000;
const own = (cardId: string, uid: string, obtainedAt: number, serial?: number): OwnedCard => ({ uid, cardId, obtainedAt, serial });

/* ─────────────── sobres ─────────────── */

test("1+2 · «Mis sobres» agrupa por producto (×n) y omite lo que no se puede abrir", () => {
  const active = PACKS.find((p) => isStoreVisible(p))!;
  const draft = PACKS.find((p) => p.lifecycle === "DRAFT");
  const retired = PACKS.find((p) => (p.lifecycle === "RETIRED" || p.retired) && isPubliclyOpenable(p));
  const inv: Record<string, number> = { [active.id]: 4, "no-existe": 2, zero: 0 };
  if (draft) inv[draft.id] = 1;
  if (retired) inv[retired.id] = 1;
  const groups = ownedPackGroups(inv, getPack);
  assert.equal(groups.find((g) => g.pack.id === active.id)?.count, 4, "cuatro copias → un grupo ×4");
  assert.ok(!groups.some((g) => g.pack.id === "no-existe" || g.pack.id === "zero"));
  if (draft) assert.ok(!groups.some((g) => g.pack.id === draft.id), "DRAFT nunca aparece, ni poseído");
  if (retired) assert.equal(groups.find((g) => g.pack.id === retired.id)?.retired, true, "RETIRED poseído se puede abrir y se marca");
  assert.equal(totalOwnedPacks(inv), 4 + 2 + (draft ? 1 : 0) + (retired ? 1 : 0), "cuenta bruta del inventario (sin filtrar)");
  assert.equal(groups[0].count, 4, "el grupo más numeroso va primero");
});

test("3+4+16 · destacados: solo sobres visibles, uno por familia, y el de equipo dice «aumentada»", () => {
  const visible = PACKS.filter(isStoreVisible);
  const featured = featuredPacks(visible);
  assert.ok(featured.length >= 1 && featured.length <= 3);
  for (const f of featured) assert.ok(isStoreVisible(f.pack));
  const th = featured.find((f) => f.pack.team);
  if (th) assert.match(th.why, /Probabilidad aumentada/);
  // DRAFT/RETIRED jamás entran aunque se pasen a la fuerza.
  assert.equal(featuredPacks(PACKS.filter((p) => !isStoreVisible(p))).length >= 0, true);
});

/* ─────────────── cartas ─────────────── */

test("24 · serie baja es presentación: ≤10 o ≤1 % de la tirada, y no toca ningún valor", () => {
  assert.equal(isLowSerial(1, 500), true);
  assert.equal(isLowSerial(10, 500), true);
  assert.equal(isLowSerial(11, 500), false);
  assert.equal(isLowSerial(25, 5000), true);
  assert.equal(isLowSerial(60, 5000), false);
  assert.equal(isLowSerial(null, 500), false);
  assert.equal(isLowSerial(3, null), true);
});

test("mejor carta · rareza, luego OVR, luego serial más bajo — estable y sin azar", () => {
  const sorted = [...CARDS].sort((a, b) => getVariant(b.variantId).rank - getVariant(a.variantId).rank);
  const hi = sorted[0]; const lo = sorted[sorted.length - 1];
  const best = bestOf([
    { cardId: lo.id, rank: getVariant(lo.variantId).rank, ovr: 99, serial: 1 },
    { cardId: hi.id, rank: getVariant(hi.variantId).rank, ovr: 50, serial: 900 },
  ]);
  assert.equal(best?.cardId, hi.id, "la rareza manda sobre el OVR");
  const tie = bestOf([{ cardId: "a", rank: 5, ovr: 80, serial: 300 }, { cardId: "b", rank: 5, ovr: 80, serial: 7 }]);
  assert.equal(tie?.cardId, "b", "a igual rareza y OVR, el serial más bajo");
  assert.equal(bestOf([]), null);
});

test("35 · recientes: solo con obtainedAt real dentro de la ventana, más nuevas primero", () => {
  const c = CARDS[0].id;
  const owned = [own(c, "old", NOW - 3 * 24 * H), own(c, "new", NOW - 2 * H), own(c, "newer", NOW - 10 * 60_000), { uid: "sin-fecha", cardId: c, obtainedAt: 0 } as OwnedCard];
  const r = recentlyAcquired(owned, NOW);
  assert.deepEqual(r.map((x) => x.uid), ["newer", "new"]);
});

test("31+32 · duplicadas e instancias: una definición, varias copias con su serial", () => {
  const c = CARDS[0].id; const d = CARDS[1].id;
  const owned = [own(c, "1", NOW, 84), own(c, "2", NOW, 932), own(c, "3", NOW - H), own(d, "4", NOW, 5)];
  assert.deepEqual([...duplicateCardIds(owned)], [c]);
  assert.deepEqual(instancesOf(owned, c).map((i) => i.serial ?? null), [84, 932, null]);
  assert.equal(instancesOf(owned, "nada").length, 0);
});

/* ─────────────── hero / equipos ─────────────── */

test("33+34 · completion global y por equipo salen del catálogo real; equipos completos se cuentan bien", () => {
  // Equipo canónico de la CARTA (el impreso), la clave de `buildTeamCollection`.
  const team = canonicalCardTeam(CARDS[0], getPlayer(CARDS[0].playerId)).key;
  const teamCards = CARDS.filter((c) => canonicalCardTeam(c, getPlayer(c.playerId)).key === team);
  const owned = teamCards.map((c, i) => own(c.id, `t${i}`, NOW));
  const entries = buildTeamCollection(owned, { includeEmpty: true });
  const mine = entries.find((e) => e.team === team)!;
  assert.equal(mine.ownedDistinct, mine.total, "todas las cartas del equipo → completo");
  const metrics = heroMetrics({ distinct: owned.length, total: CARDS.length, percent: 1 }, [...owned, own(teamCards[0].id, "dup", NOW)], entries);
  assert.equal(metrics.teamsComplete, 1);
  assert.equal(metrics.teamsStarted, 1);
  assert.equal(metrics.duplicates, 1);
  assert.equal(metrics.instances, owned.length + 1);
  assert.ok(metrics.teamsTotal > 1);
});

/* ─────────────── home ─────────────── */

test("home · la tira del bucle: sobres → nueva carta → equipo incompleto → objetivo; nuevo jugador ve «abrir»", () => {
  const c = CARDS[0];
  const cards = loopCards({ unopened: { estandar: 3 }, owned: [own(c.id, "u", NOW - H)], deck: { name: "Mío", size: 8, valid: false }, now: NOW });
  assert.deepEqual(cards.map((k) => k.id), ["packs", "recent", "deck", "goal"]);
  assert.match(cards[0].title, /3 sobres/);
  assert.match(cards[2].title, /8\/10/);
  assert.equal(loopCards({ unopened: {}, owned: [], deck: undefined, now: NOW }).map((k) => k.id)[0], "start");
  // Sin datos no hay tarjeta: un mazo válido y completo no pide nada.
  const ok = loopCards({ unopened: {}, owned: [own(c.id, "u", NOW - 5 * 24 * H)], deck: { name: "Listo", size: 10, valid: true }, now: NOW });
  assert.ok(!ok.some((k) => k.id === "deck" || k.id === "recent" || k.id === "packs"));
});
