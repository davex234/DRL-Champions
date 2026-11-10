/**
 * CATÁLOGO DISEÑADO · EL JUEGO ADAPTADO (post-reemplazo, 2026-09-21).
 *
 * Contratos que impiden volver a dejar contenido imposible o etiquetas fantasma tras el reemplazo:
 *   · equipos: todo equipo impreso tiene identidad canónica, sin fusionar equipos distintos; mojibake reparado;
 *   · ediciones: la taxonomía del producto son las 7 del catálogo;
 *   · eventos, tareas semanales y logros: toda condición la cumple al menos una carta real, y toda carta que
 *     se da como recompensa existe;
 *   · sobres: todo sobre a la venta tiene pool, las rarezas que promete existen y la tienda enseña lo que
 *     entrega el motor.
 */
import test from "node:test";
import assert from "node:assert/strict";
import VLR_ROSTER from "./vlr/players-vct-2026.json";
import { CARDS, getCard, getPlayer } from "./catalog";
import { CARD_MANIFEST } from "./cardCatalog";
import { PLAYERS } from "./players";
import { PACKS } from "./packs";
import { packStats } from "./packStats";
import { EVENTS, WEEKLY_TASKS } from "./events";
import { SEASONS } from "./seasons";
import { repairMojibake, printedTeamTag } from "./teamText";
import {
  PRINTED_TEAM_IDENTITY, TEAM_IDENTITIES, canonicalCardTeam, canonicalTeam, normalizeAlias, printedTeamIdentity,
  resolveTeamIdentity, sameTeam, isTeamPackCard,
} from "./teamIdentities";
import { DESIGNED_EDITIONS, getVariant } from "@/domain/cards/variants";
import { EDITION_ORDER } from "@/domain/collection/room";
import { EVENT_EDITIONS, isEpicOrBetterCard, isEventEdition, isLegendaryCard } from "@/domain/events/editions";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { CardRegistry } from "@/collection/registry";
import { buildPool } from "@/domain/packs/pool";
import { bucketForRank, type RarityBucket } from "@/domain/packs/types";
import { isPurchasable } from "@/domain/packs/lifecycle";

/* ─────────────── equipos ─────────────── */

test("EQUIPOS · las 41 etiquetas impresas resuelven cada una a UNA identidad distinta; todas las cartas tienen equipo", () => {
  const impresas = new Set(CARD_MANIFEST.map((e) => printedTeamTag(e.source)!));
  assert.equal(impresas.size, 41);
  for (const tag of impresas) assert.ok(printedTeamIdentity(tag), `«${tag}» sin identidad`);
  const ids = Object.values(PRINTED_TEAM_IDENTITY);
  assert.equal(new Set(ids).size, ids.length, "dos etiquetas impresas no pueden ser el mismo equipo");
  for (const c of CARDS) {
    assert.equal(c.team, printedTeamTag(CARD_MANIFEST.find((e) => e.id === c.id)!.source), c.id);
    assert.ok(!canonicalCardTeam(c, getPlayer(c.playerId)).key.startsWith("raw:"), `${c.id} sin equipo canónico`);
  }
});

test("EQUIPOS · el equipo de la CARTA es el impreso: no mezcla equipos que solo comparten `Player.team`", () => {
  const team = (id: string) => canonicalCardTeam(getCard(id)!, getPlayer(getCard(id)!.playerId)).key;
  assert.equal(team("derke__base"), "vitality", "Derke («Fnatic» en la semilla) lleva VIT impreso");
  assert.equal(team("veqaj__base"), "fnatic");
  assert.notEqual(team("derke__base"), team("veqaj__base"));
  assert.equal(team("benjy__base") , team("riens__base"), "«Team Heretics» y «TH» son el mismo equipo");
  assert.equal(canonicalTeam("TH").key, canonicalTeam("Team Heretics").key);
  assert.ok(sameTeam("FNC", "Fnatic"));
  // Lo que la decisión 10 separa, sigue separado por `Player.team` (Gen.G ≠ GEN; DRX ≠ KRX; G2 ≠ G2 Gozen).
  assert.ok(!sameTeam("Gen.G", "GEN"));
  assert.ok(!sameTeam("DRX", "KRX"));
  assert.ok(!sameTeam("G2", "G2 Gozen"));
});

test("EQUIPOS · mojibake de la descarga reparado sin tocar textos sanos", () => {
  assert.equal(repairMojibake("KRÃœ"), "KRÜ");
  assert.equal(repairMojibake("RosÃ©"), "Rosé");
  for (const sano of ["KRÜ", "Leviatán", "Gen.G", "Rosé", "100T", ""]) assert.equal(repairMojibake(sano), sano);
  assert.equal(normalizeAlias("KRÃœ"), normalizeAlias("KRÜ"));
  assert.equal(resolveTeamIdentity("KRÃœ")?.canonicalId, "kru");
  // Medido sobre la descarga: 13 campos (6 × equipo y etiqueta de KRÜ + el nick de Rosé), ninguno más.
  const rows = VLR_ROSTER as { nick: string; team: string; teamTag: string; country: string }[];
  const reparados = rows.flatMap((r) => [r.nick, r.team, r.teamTag, r.country].filter((t) => typeof t === "string" && repairMojibake(t) !== t));
  assert.equal(reparados.length, 13);
  assert.ok(!PLAYERS.some((p) => /Ã|Â/.test(`${p.nick}${p.team}${p.teamTag}`)), "ningún jugador enseña mojibake");
  assert.ok(TEAM_IDENTITIES.every((i) => !/Ã|Â/.test(i.displayName)));
});

/* ─────────────── ediciones ─────────────── */

test("EDICIONES · la colección ofrece exactamente las 7 ediciones del catálogo", () => {
  assert.equal(DESIGNED_EDITIONS.size, 7);
  assert.deepEqual(new Set(EDITION_ORDER), new Set(CARDS.map((c) => c.variantId)));
  for (const e of EDITION_ORDER) assert.ok(CARDS.some((c) => c.variantId === e), `${e} sin cartas`);
  const sets = new CardRegistry().allSets();
  for (const s of sets) assert.ok(s.cardIds.length > 0, `${s.id} vacío`);
  assert.ok(!sets.some((s) => /^set-(regional|mvp|winner|internacional|exclusiva|base)$/.test(s.id)), "sin sets de grupos antiguos");
});

/* ─────────────── eventos, tareas y logros ─────────────── */

const alMenosUna = (f: (variantId: string) => boolean) => CARDS.some((c) => f(c.variantId));

test("EVENTOS · toda misión y tarea semanal que mide cartas la cumple alguna carta real; las recompensas existen", () => {
  for (const ev of EVENTS) {
    for (const m of ev.missions) {
      if (m.metric === "get_event_card") assert.ok(EVENT_EDITIONS[ev.type].length > 0 && alMenosUna((v) => isEventEdition(ev.type, v)), `${ev.id}/${m.id}`);
      if (m.metric === "get_legendary") assert.ok(alMenosUna(isLegendaryCard), `${ev.id}/${m.id}`);
      if (m.metric === "get_epic") assert.ok(alMenosUna(isEpicOrBetterCard), `${ev.id}/${m.id}`);
    }
    // EWC no tiene edición: no se le ofrece «Consigue una carta EWC».
    if (!EVENT_EDITIONS[ev.type].length) assert.ok(!ev.missions.some((m) => m.metric === "get_event_card"), ev.id);
    for (const [lvl, r] of Object.entries(ev.passRewards ?? {})) {
      if (r.cardId) {
        const c = getCard(r.cardId);
        assert.ok(c && CARDS.includes(c), `${ev.id} nivel ${lvl}: ${r.cardId} no existe`);
        // Mismo escalón que las MVP que sustituye (rank 12-13, legendarias): legendaria.
        assert.equal(bucketForRank(getVariant(c!.variantId).rank), "legendary", `${ev.id} nivel ${lvl}`);
      }
      if (r.packId) assert.ok(PACKS.some((p) => p.id === r.packId), `${ev.id} nivel ${lvl}: sobre ${r.packId}`);
    }
  }
  const cardIds = EVENTS.flatMap((e) => Object.values(e.passRewards ?? {}).map((r) => r.cardId).filter(Boolean));
  assert.equal(new Set(cardIds).size, cardIds.length, "cada evento da una legendaria distinta");
  for (const t of WEEKLY_TASKS) {
    if (t.metric === "get_legendary") assert.ok(alMenosUna(isLegendaryCard), t.id);
    if (t.metric === "get_epic") assert.ok(alMenosUna(isEpicOrBetterCard), t.id);
    assert.ok(!/MVP|Winner|Icon/i.test(t.label), `${t.id}: «${t.label}» nombra contenido que ya no existe`);
  }
  for (const s of SEASONS) for (const r of [...Object.values(s.free), ...Object.values(s.premium)]) {
    if (r.packId) assert.ok(PACKS.some((p) => p.id === r.packId), `${s.id}: sobre ${r.packId}`);
    if (r.cardId) assert.ok(getCard(r.cardId), `${s.id}: carta ${r.cardId}`);
  }
});

test("LOGROS · todos alcanzables con el catálogo: coleccionar el catálogo entero los completa", () => {
  const todo = new Set(CARDS.map((c) => c.id));
  for (const a of ACHIEVEMENTS) {
    const ctx = { packsOpened: 1000, ownedCardIds: todo };
    assert.ok(a.goal > 0, `${a.id}: meta vacía`);
    assert.ok(a.progress(ctx) >= a.goal, `${a.id}: imposible con el catálogo (${a.progress(ctx)}/${a.goal})`);
    assert.ok(!/MVP|Icon Series/i.test(`${a.name} ${a.description}`), `${a.id} nombra una edición que ya no existe`);
  }
  const heretics = ACHIEVEMENTS.find((a) => a.id === "completa-heretics")!;
  assert.equal(heretics.goal, 11, "Team Heretics = las 11 cartas con TH impreso");
});

/* ─────────────── sobres ─────────────── */

test("SOBRES · todo sobre a la venta tiene pool, sus rarezas con peso existen, y la tienda enseña lo que entrega el motor", () => {
  const registry = new CardRegistry();
  for (const p of PACKS.filter((x) => isPurchasable(x))) {
    const flat = buildPool(registry, p).flat;
    assert.ok(flat.length > 0, `${p.id}: pool vacío`);
    const hay = new Set<RarityBucket>(flat.map((c) => bucketForRank(getVariant(c.variantId).rank)));
    const s = packStats(p.id);
    if (!s) continue; // gratis: sin estadística de compra
    for (const b of Object.keys(p.weights) as RarityBucket[]) {
      const promete = (p.weights[b] ?? 0) > 0;
      assert.equal(s.impossible.includes(b), promete && !hay.has(b), `${p.id}/${b}: «imposible» de la tienda ≠ pool`);
      if (!hay.has(b)) assert.equal(s.drawn[b], 0, `${p.id}/${b}: la tienda da probabilidad a una rareza sin cartas`);
    }
  }
  // Los sobres de evento vuelven a poder dar lo que prometen: raras y legendarias.
  for (const id of ["masters", "champions", "ewc"]) assert.deepEqual(packStats(id)!.impossible, [], id);
  // Un Team Pack a la venta siempre tiene cartas de su equipo (el impreso).
  for (const p of PACKS.filter((x) => x.team && isPurchasable(x))) {
    assert.ok(buildPool(registry, p).flat.some((c) => isTeamPackCard(c, registry.player(c.playerId), p.team)), p.id);
  }
});
