/**
 * F82 · COLLECTION SETS — dominio puro: progreso, variantes, duplicados, generador (reglas y descartes), validación de
 * publicación, estabilidad de versión, insignias y modelo de la Sala de Trofeos. Sin red ni BD.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS, getPlayer } from "@/data/catalog";
import { canonicalCardTeam } from "@/data/teamIdentities";
import type { CardDef, Player } from "@/domain/cards/types";
import { progressOf, stateOf, setsTouchedBy, canonicalPayload } from "./progress";
import { generateTeamDrafts, generateEditionDrafts, isSkip, liveContext, conflictIdentities, MIN_TEAM_PLAYERS, type DraftProposal, type GeneratorContext } from "./generator";
import { validateForPublish } from "./validate";
import { badgeFact, badgeIndex } from "./badges";
import { BADGE_ID_PATTERN, type CollectionSetDef } from "./types";
import { visibleSets, sortSets, remainingText } from "@/components/trophies/trophyModel";
import type { SetView } from "@/server/services/collectionSets";

const teams = generateTeamDrafts();
const proposal = (id: string) => teams.find((d) => !isSkip(d) && d.id === id) as DraftProposal;
const asSet = (p: DraftProposal, status: CollectionSetDef["status"] = "PUBLISHED"): CollectionSetDef => ({
  ...p, status, checksum: status === "DRAFT" ? null : "x", publishedAt: null, retiredAt: null, rowVersion: 1,
});
const G2 = asSet(proposal("team-g2-v1"));

// ───────────────────────── progreso ─────────────────────────

test("team set 0/N: sin cartas → 0 %, todo falta, LOCKED (visible, no escondido)", () => {
  const p = progressOf(G2, new Set());
  assert.equal(p.required, 5); assert.equal(p.owned, 0); assert.equal(p.missing, 5); assert.equal(p.pct, 0);
  assert.equal(p.complete, false);
  assert.equal(stateOf(p, false), "LOCKED");
});

test("team set parcial 4/5: 80 %, falta exactamente el jugador que no tiene, IN_PROGRESS", () => {
  const owned = new Set(G2.requirements.slice(0, 4).map((r) => r.cardIds[0]));
  const p = progressOf(G2, owned);
  assert.equal(p.owned, 4); assert.equal(p.missing, 1); assert.equal(p.pct, 80);
  assert.deepEqual(p.requirements.filter((r) => !r.satisfied).map((r) => r.key), [G2.requirements[4].key]);
  assert.equal(stateOf(p, false), "IN_PROGRESS");
});

test("team set N/N: completo → 100 % y CLAIMABLE; reclamado → COMPLETED", () => {
  const p = progressOf(G2, new Set(G2.requirements.map((r) => r.cardIds.at(-1)!)));
  assert.equal(p.complete, true); assert.equal(p.pct, 100);
  assert.equal(stateOf(p, false), "CLAIMABLE");
  assert.equal(stateOf(p, true), "COMPLETED");
});

test("variantes: cualquier carta elegible del jugador satisface su requisito; se listan las variantes poseídas", () => {
  const r = G2.requirements.find((x) => x.cardIds.length >= 3)!;
  for (const id of r.cardIds) assert.equal(progressOf({ requirements: [r] }, new Set([id])).owned, 1, id);
  const both = progressOf({ requirements: [r] }, new Set(r.cardIds.slice(0, 2)));
  assert.equal(both.owned, 1, "dos variantes del mismo jugador = UN requisito");
  assert.equal(both.requirements[0].ownedCardIds.length, 2);
});

test("duplicados: 5 copias del mismo jugador no son 5 jugadores (el servidor pasa ids DISTINTOS)", () => {
  const one = G2.requirements[0].cardIds[0];
  const p = progressOf(G2, new Set([one, one, one, one, one]));
  assert.equal(p.owned, 1);
});

test("asociación de equipo: una carta del MISMO jugador impresa con otro equipo NO cuenta (sociablee: FUT vs NAVI)", () => {
  const fut = asSet(proposal("team-fut-v1"));
  const navi = asSet(proposal("team-navi-v1"));
  const rFut = fut.requirements.find((r) => r.playerId === "sociablee");
  const rNavi = navi.requirements.find((r) => r.playerId === "sociablee");
  assert.ok(rFut && rNavi, "sociablee aparece en los dos");
  assert.equal(rFut.cardIds.filter((id) => rNavi.cardIds.includes(id)).length, 0, "listas disjuntas");
  for (const id of rNavi.cardIds) assert.equal(progressOf({ requirements: [rFut] }, new Set([id])).owned, 0);
  for (const id of rFut.cardIds) assert.equal(canonicalCardTeam(CARDS.find((c) => c.id === id)!, getPlayer("sociablee")).key, "fut");
});

test("setsTouchedBy: un sobre con una carta de G2 toca el set de G2 y no el de Fnatic", () => {
  const fnc = asSet(proposal("team-fnatic-v1"));
  assert.deepEqual(setsTouchedBy([G2, fnc], [G2.requirements[0].cardIds[0]]).map((s) => s.id), ["team-g2-v1"]);
});

// ───────────────────────── generador ─────────────────────────

// 2026-10-15: con los 16 logos que faltaban ya nadie se descarta por NO_LOGO (antes 23 borradores y 18 descartes).
test("generador sobre la BD real: 36 borradores de equipo y 5 descartes, todos con motivo", () => {
  const ok = teams.filter((d) => !isSkip(d));
  const skip = teams.filter(isSkip);
  assert.equal(ok.length, 36, ok.map((d) => d.subjectId).join(","));
  assert.equal(skip.length, 5);
  assert.ok(!skip.some((s) => s.skip.includes("NO_LOGO")));
  for (const s of skip) assert.ok(s.skip.length > 0, s.subjectId);
  assert.deepEqual(skip.filter((s) => s.skip.includes("TOO_FEW_PLAYERS")).map((s) => s.subjectId), ["envy"]);
  for (const id of ["drx", "edward-gaming", "gen-g", "sentinels"]) assert.ok(skip.find((s) => s.subjectId === id)?.skip.includes("IDENTITY_CONFLICT"), id);
});

test("generador: cada borrador tiene logo REAL, ≥4 jugadores, requisitos por identidad de jugador y cartas de ESE equipo", () => {
  for (const d of teams) {
    if (isSkip(d)) continue;
    assert.ok(d.logo && d.logo.startsWith("/hints/teams/"), d.id);
    assert.ok(d.requirements.length >= MIN_TEAM_PLAYERS, d.id);
    assert.equal(new Set(d.requirements.map((r) => r.playerId)).size, d.requirements.length, `${d.id}: sin jugadores repetidos`);
    assert.ok(BADGE_ID_PATTERN.test(d.reward.badgeId), d.reward.badgeId);
    for (const r of d.requirements) {
      assert.equal(r.key, `player:${r.playerId}`);
      for (const id of r.cardIds) {
        const c = CARDS.find((x) => x.id === id)!;
        assert.equal(c.playerId, r.playerId);
        assert.equal(canonicalCardTeam(c, getPlayer(c.playerId)).key, d.subjectId);
      }
    }
  }
});

function fakeCtx(over: Partial<GeneratorContext> = {}): GeneratorContext {
  const base = liveContext();
  return { ...base, ...over };
}

test("generador: un jugador sin NINGUNA carta obtenible descarta el equipo entero (UNOBTAINABLE), nunca lo quita en silencio", () => {
  const ctx = fakeCtx({ obtainable: (c: CardDef) => c.playerId !== "jawgemo" });
  const g2 = generateTeamDrafts(ctx).find((d) => d.subjectId === "g2")!;
  assert.ok(isSkip(g2) && g2.skip.includes("UNOBTAINABLE"), JSON.stringify(g2));
});

test("generador: sin logo real → NO_LOGO (no se dibuja un escudo falso)", () => {
  const g2 = generateTeamDrafts(fakeCtx({ logo: () => null })).find((d) => d.subjectId === "g2")!;
  assert.ok(isSkip(g2) && g2.skip.includes("NO_LOGO"));
});

test("generador: las identidades en conflicto salen de la auditoría 20.2 (packTeam null), no de una lista a mano", () => {
  assert.deepEqual([...conflictIdentities()].sort(), ["drx", "edward-gaming", "gen-g", "sentinels"]);
});

test("ediciones: solo las de tamaño de objetivo (Champions S y Future Star, 20 cartas); las demás con motivo", () => {
  const ed = generateEditionDrafts();
  assert.deepEqual(ed.filter((d) => !isSkip(d)).map((d) => d.subjectId).sort(), ["champions-s", "future-star"]);
  for (const d of ed) if (!isSkip(d)) { assert.equal(d.requirements.length, 20); assert.equal(d.logo, null); for (const r of d.requirements) assert.equal(r.cardIds.length, 1); }
  assert.deepEqual(ed.filter(isSkip).map((d) => `${d.subjectId}:${d.skip.join("+")}`).sort(),
    ["base:TOO_LARGE", "masters-l:TOO_LARGE", "masters-sdc:TOO_LARGE", "moments:TOO_SMALL", "record-breaker:TOO_SMALL"]);
});

// ───────────────────────── validación de publicación ─────────────────────────

test("publicar: un borrador generado válido pasa; uno vacío, duplicado, con carta ajena o inexistente, no", () => {
  const ctx = liveContext();
  const draft = asSet(proposal("team-g2-v1"), "DRAFT");
  assert.deepEqual(validateForPublish(draft, ctx), []);
  const codes = (s: CollectionSetDef) => validateForPublish(s, ctx).map((i) => i.code);
  assert.ok(codes({ ...draft, requirements: [] }).includes("EMPTY"));
  assert.ok(codes({ ...draft, requirements: [...draft.requirements, draft.requirements[0]] }).includes("DUPLICATE_REQUIREMENT"));
  const fnc = proposal("team-fnatic-v1").requirements[0];
  assert.ok(codes({ ...draft, requirements: [...draft.requirements, fnc] }).includes("CARD_TEAM_MISMATCH"));
  assert.ok(codes({ ...draft, requirements: [{ ...draft.requirements[0], key: "player:nadie", playerId: "nadie", cardIds: ["nadie__base"] }] }).includes("UNKNOWN_CARD"));
  assert.ok(codes({ ...draft, requirements: [{ ...draft.requirements[0], cardIds: [] }] }).includes("EMPTY_REQUIREMENT"));
  assert.ok(codes({ ...draft, reward: { badgeId: "credits:5000" } }).includes("BAD_REWARD"), "solo insignias");
  assert.ok(codes({ ...draft, logo: "/hints/teams/fnatic.png" }).includes("NO_LOGO"), "el logo debe ser el real de ESE equipo");
  assert.ok(codes({ ...draft, status: "PUBLISHED" }).includes("NOT_DRAFT"));
});

test("publicar: un requisito sin carta obtenible es UNOBTAINABLE (no se publica un set imposible)", () => {
  const ctx = fakeCtx({ obtainable: (c: CardDef) => c.playerId !== G2.requirements[0].playerId });
  assert.ok(validateForPublish(asSet(proposal("team-g2-v1"), "DRAFT"), ctx).some((i) => i.code === "UNOBTAINABLE"));
});

// ───────────────────────── versionado y estabilidad ─────────────────────────

test("versión estable: un set publicado guarda SUS cartas; una carta nueva del jugador en el catálogo no lo cambia", () => {
  const frozen = asSet(proposal("team-g2-v1"));
  const before = canonicalPayload(frozen);
  const r0 = frozen.requirements[0];
  const fakeNew: CardDef = { ...CARDS.find((c) => c.id === r0.cardIds[0])!, id: `${r0.playerId}__moments` };
  const regenerated = generateTeamDrafts(fakeCtx({ cards: [...CARDS, fakeNew] })).find((d) => d.subjectId === "g2") as DraftProposal;
  assert.ok(regenerated.requirements[0].cardIds.includes(fakeNew.id), "el GENERADOR vería la carta nueva…");
  assert.equal(canonicalPayload(frozen), before, "…pero el set publicado no cambia");
  assert.equal(progressOf(frozen, new Set([fakeNew.id])).owned, 0, "y esa carta no cuenta para la v1 (se publicaría una v2)");
});

test("cambio de plantilla (roster actual) no muta un set publicado: el progreso solo lee los requisitos congelados", () => {
  const frozen = asSet(proposal("team-g2-v1"));
  const before = canonicalPayload(frozen);
  const moved: (id: string) => Player | undefined = (id) => { const p = getPlayer(id); return p ? { ...p, team: "Otro equipo" } : p; };
  generateTeamDrafts(fakeCtx({ player: moved }));
  assert.equal(canonicalPayload(frozen), before);
  assert.equal(progressOf(frozen, new Set(frozen.requirements.map((r) => r.cardIds[0]))).complete, true);
});

test("checksum canónico: el orden de requisitos y de cartas no cambia la huella", () => {
  const a = asSet(proposal("team-g2-v1"));
  const b = { ...a, requirements: [...a.requirements].reverse().map((r) => ({ ...r, cardIds: [...r.cardIds].reverse() })) };
  assert.equal(canonicalPayload(a), canonicalPayload(b));
});

// ───────────────────────── insignias ─────────────────────────

test("insignias: la de equipo lleva el logo REAL; la de maestría se pinta por su id; una de colección desconocida no se pinta", () => {
  const idx = badgeIndex([G2]);
  const b = badgeFact(G2.reward.badgeId, idx)!;
  assert.equal(b.logo, "/hints/teams/g2.png"); assert.equal(b.kind, "TEAM"); assert.equal(b.label, "G2");
  assert.equal(badgeFact("insignia:equipo:g2", idx)?.kind, "MASTERY");
  assert.equal(badgeFact("insignia:coleccion:fantasma", idx), null);
  assert.equal(badgeFact("titulo:aspirante", idx), null, "un título no es una insignia");
});

// ───────────────────────── modelo de la sala ─────────────────────────

const view = (id: string, state: SetView["state"], owned: number, required: number, extra: Partial<SetView> = {}): SetView => ({
  id, family: `team:${id}`, version: 1, kind: "TEAM", subjectId: id, title: id.toUpperCase(), logo: null, retired: false, state,
  required, owned, missing: required - owned, pct: Math.floor((owned / required) * 100), completeNow: owned === required,
  completedAt: null, badge: null, requirements: [], ...extra,
});

test("sala: por defecto «más cerca» — reclamables, luego lo que menos falta; completadas al final", () => {
  const list = [view("a", "LOCKED", 0, 5), view("b", "IN_PROGRESS", 4, 5), view("c", "COMPLETED", 5, 5, { completedAt: "2026-10-01" }), view("d", "CLAIMABLE", 5, 5), view("e", "IN_PROGRESS", 2, 5)];
  assert.deepEqual(sortSets(list, "closest").map((s) => s.id), ["d", "b", "e", "a", "c"]);
  assert.deepEqual(visibleSets(list, { filter: "COMPLETED", kind: "ALL", query: "", sort: "closest" }).map((s) => s.id), ["c"]);
  assert.deepEqual(visibleSets(list, { filter: "IN_PROGRESS", kind: "ALL", query: "", sort: "closest" }).map((s) => s.id), ["d", "b", "e"]);
  assert.deepEqual(visibleSets(list, { filter: "LOCKED", kind: "ALL", query: "", sort: "closest" }).map((s) => s.id), ["a"]);
  assert.deepEqual(visibleSets(list, { filter: "ALL", kind: "ALL", query: "b", sort: "alpha" }).map((s) => s.id), ["b"]);
  assert.equal(remainingText(list[1]), "1 jugador restante");
  assert.equal(remainingText(list[3]), "¡Lista para reclamar!");
});
