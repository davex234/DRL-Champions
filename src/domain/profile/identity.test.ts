/**
 * PLAYER IDENTITY 2.0 · DOMINIO PURO (Fase 31). Perfil (1–10), vitrina (11–24), logros (25–30),
 * privacidad (31–40), social/H2H (41–48), competitivo (49–51), Pick'ems (54–56).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { levelFromXp } from "@/domain/progression/levels";
import { AVATARS, safeAvatar, isAllowedAvatar } from "./avatars";
import {
  SHOWCASE_MAX, FEATURED_MAX, parseShowcase, checkShowcaseOwnership, parseFeatured, checkFeaturedClaimed, parseExpectedVersion, applySave,
  collectionSummary, raritySummary, resolveShowcase, pickemsSummary, profileActivity, buildPlayerIdentity, dayOf, DEFAULT_ACCENT,
  type IdentityFacts, type CardLookup,
} from "./identity";

const ME = "00000000-0000-4000-8000-0000000000aa";
const RIVAL = "00000000-0000-4000-8000-0000000000bb";
const NOW = Date.UTC(2026, 8, 14, 18, 0);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CARDS: Record<string, { rank: number; limit: number | null; label: string; glow: string }> = {
  "a__icon": { rank: 15, limit: 25, label: "Icon Series", glow: "#ffce4f" },
  "b__gold": { rank: 3, limit: null, label: "Oro", glow: "#d4a74a" },
  "c__masters-mvp": { rank: 9, limit: 250, label: "Masters MVP", glow: "#7b5cff" },
  "d__bronze": { rank: 1, limit: null, label: "Bronce", glow: "#a0623a" },
};
const lookup: CardLookup = (cardId) => {
  const c = CARDS[cardId];
  return c ? { cardId, variantId: cardId.split("__")[1], variantLabel: c.label, rank: c.rank, serialLimit: c.limit, ovr: 80 + c.rank, nick: cardId.split("__")[0], team: "QA", role: "Duelista", glow: c.glow } : null;
};
const rankOf = (id: string) => CARDS[id]?.rank ?? null;

function facts(over: Partial<IdentityFacts> = {}): IdentityFacts {
  return {
    profile: { id: ME, username: "qa_david", avatar: "🐉", xp: 5000, equipped: {}, packsOpened: 42 },
    cosmetics: { title: null, frame: null, banner: null },
    ranked: { rating: 1258, gamesPlayed: 38, provisional: false, wins: 21, losses: 14, draws: 3, position: 124, rankedTotal: 512, winrate: 58, form: ["W", "W", "L", "W", "D"], streak: { kind: "W", n: 2 } },
    highestRating: 1302,
    recentMatches: [{ matchId: "m1", at: NOW - 3600_000, outcome: "WIN", letter: "W", scoreYou: 6, scoreRival: 4, rival: { userId: RIVAL, username: "kaelis", avatar: "🐺" } }],
    instanceCardIds: ["a__icon", "a__icon", "a__icon", "b__gold", "c__masters-mvp", "d__bronze"],
    showcaseInstances: [
      { uid: U(1), cardId: "a__icon", serial: 3, mintedVersion: null, obtainedAt: NOW - 9e8 },
      { uid: U(2), cardId: "a__icon", serial: 47, mintedVersion: null, obtainedAt: NOW - 8e8 },
      { uid: U(4), cardId: "c__masters-mvp", serial: 120, mintedVersion: null, obtainedAt: NOW - 7e8 },
    ],
    teams: [{ total: 4, ownedDistinct: 4 }, { total: 9, ownedDistinct: 2 }, { total: 5, ownedDistinct: 0 }],
    totalCards: 40,
    customization: { showcaseUids: [U(1), U(4)], featuredIds: ["coleccionista", "primer-mvp"], version: 3, updatedAt: NOW - 1000 },
    claimed: [{ id: "coleccionista", claimedAt: NOW - 3 * 86_400_000 + 12_345 }, { id: "primer-mvp", claimedAt: NOW - 10 * 86_400_000 }],
    catalog: [
      { id: "coleccionista", name: "Coleccionista", description: "40 distintas", icon: "🗂️" },
      { id: "primer-mvp", name: "Consigue un MVP", description: "Primera MVP", icon: "⭐" },
      { id: "sobres-100", name: "Abridor en serie", description: "100 sobres", icon: "📦" },
    ],
    pickems: [{ pickemEventId: "pe1", title: "QA Open", points: 64, correct: 8, total: 12, scoredAt: NOW - 2 * 86_400_000 }],
    h2h: { ranked: { wins: 3, losses: 2, draws: 0, matches: 5 }, private: { wins: 1, losses: 1, draws: 1, matches: 3 }, total: { wins: 4, losses: 3, draws: 1, matches: 8 } },
    privateDuels: 7,
    ...over,
  };
}
const build = (f: IdentityFacts, viewerId: string | null) => buildPlayerIdentity(f, { viewerId, now: NOW, lookup, rankOf });

/* ───────────── perfil (1–10) ───────────── */

test("1 · el nivel sale de profiles.xp + levelFromXp, sin otra fórmula", () => {
  for (const xp of [0, 99, 5000, 48_200]) {
    const s = build(facts({ profile: { ...facts().profile, xp } }), RIVAL);
    assert.equal(s.player.level, levelFromXp(xp).level);
  }
});

test("2 · proyección PUBLIC: sin bloque self, sin XP exacta, sin versión ni uids guardados", () => {
  const s = build(facts(), RIVAL);
  assert.equal(s.view, "PUBLIC");
  assert.equal(s.self, null);
  const json = JSON.stringify(s);
  for (const k of ["xpIntoLevel", "xpForNext", "showcaseUids", "featuredIds", "version", "packsOpened", "privateDuels", "claimedAchievements", "unavailableSlots"]) assert.ok(!json.includes(`"${k}"`), k);
});

test("3 · proyección SELF: el propio jugador ve XP, versión, uids, logros reclamados, duelos privados y sobres", () => {
  const s = build(facts(), ME);
  assert.equal(s.view, "SELF");
  assert.ok(s.self);
  assert.equal(s.self!.version, 3);
  assert.deepEqual(s.self!.showcaseUids, [U(1), U(4)]);
  assert.equal(s.self!.privateDuels, 7);
  assert.equal(s.self!.packsOpened, 42);
  assert.deepEqual(s.self!.claimedAchievements.map((a) => a.id), ["coleccionista", "primer-mvp"]);
  assert.equal(s.self!.xpForNext, levelFromXp(5000).xpForNext);
});

test("4 · sin sesión también es PUBLIC (y sin H2H)", () => {
  const s = build(facts(), null);
  assert.equal(s.view, "PUBLIC");
  assert.equal(s.h2h, null);
});

test("5–7 · colección: distintas ≠ ejemplares; completado sobre distintas; equipos completos", () => {
  const c = collectionSummary(["a", "a", "a", "b", "c"], 20, [{ total: 3, ownedDistinct: 3 }, { total: 4, ownedDistinct: 1 }, { total: 0, ownedDistinct: 0 }]);
  assert.equal(c.instances, 5);
  assert.equal(c.distinct, 3, "tres copias de «a» cuentan UNA carta distinta");
  assert.equal(c.percent, 15);
  assert.equal(c.teamsComplete, 1);
  assert.equal(c.teamsStarted, 2);
  assert.deepEqual(collectionSummary([], 0, []), { instances: 0, distinct: 0, totalCards: 0, percent: 0, teamsComplete: 0, teamsStarted: 0 });
});

test("rareza: cubos reales (RarityBucket) sobre cartas distintas, de más rara a más común, sin cubos vacíos", () => {
  const r = raritySummary(["a__icon", "a__icon", "b__gold", "c__masters-mvp", "d__bronze", "zz__unknown"], rankOf);
  assert.deepEqual(r.map((x) => [x.bucket, x.count]), [["legendary", 1], ["epic", 1], ["uncommon", 1], ["common", 1]]);
  assert.deepEqual(r.map((x) => x.label), ["Legendaria", "Épica", "Poco común", "Común"]);
});

test("8 · ranked: rating, posición, récord, winrate y rating máximo tal cual llegan", () => {
  const s = build(facts(), RIVAL);
  assert.deepEqual([s.ranked!.rating, s.ranked!.position, s.ranked!.wins, s.ranked!.losses, s.ranked!.draws, s.ranked!.winrate, s.ranked!.highestRating], [1258, 124, 21, 14, 3, 58, 1302]);
});

test("9 · sin partidas ranked no hay bloque ranked (nunca «#0» ni rating inventado)", () => {
  assert.equal(build(facts({ ranked: null, highestRating: null }), RIVAL).ranked, null);
  assert.equal(build(facts({ ranked: { ...facts().ranked!, gamesPlayed: 0 } }), RIVAL).ranked, null);
});

test("10 · forma reciente = la de la Fase 28, sin recalcular", () => {
  const s = build(facts(), RIVAL);
  assert.deepEqual(s.ranked!.form, ["W", "W", "L", "W", "D"]);
  assert.deepEqual(s.ranked!.streak, { kind: "W", n: 2 });
});

/* ───────────── vitrina (11–24) ───────────── */

test("11–14 · forma: vacía vale; una vale; tres valen; más de tres se rechaza", () => {
  assert.deepEqual(parseShowcase([]), { ok: true, value: [] });
  assert.deepEqual(parseShowcase([U(1)]), { ok: true, value: [U(1)] });
  assert.equal(SHOWCASE_MAX, 3);
  assert.deepEqual(parseShowcase([U(1), U(2), U(3)]), { ok: true, value: [U(1), U(2), U(3)] });
  assert.deepEqual(parseShowcase([U(1), U(2), U(3), U(4)]), { ok: false, code: "TOO_MANY" });
  assert.deepEqual(parseShowcase("x"), { ok: false, code: "BAD_BODY" });
  assert.deepEqual(parseShowcase({ 0: U(1) }), { ok: false, code: "BAD_BODY" });
});

test("15 · UID repetido se rechaza (también con distinta capitalización)", () => {
  assert.deepEqual(parseShowcase([U(1), U(1)]), { ok: false, code: "DUPLICATE" });
  assert.deepEqual(parseShowcase([U(1), U(1).toUpperCase()]), { ok: false, code: "DUPLICATE" });
  assert.deepEqual(parseShowcase(["not-a-uuid"]), { ok: false, code: "BAD_UID" });
});

test("16–17 · propiedad: todas propias → ok; una ajena invalida el guardado entero", () => {
  const owned = new Set([U(1), U(2), U(4)]);
  assert.deepEqual(checkShowcaseOwnership([U(1), U(4)], owned), { ok: true, value: [U(1), U(4)] });
  assert.deepEqual(checkShowcaseOwnership([U(1), U(99)], owned), { ok: false, code: "NOT_OWNED" });
});

test("18–21 · la copia concreta se respeta: serial, variante y orden del slot", () => {
  const f = facts();
  const { slots } = resolveShowcase([U(2), U(4), U(1)], f.showcaseInstances, lookup);
  assert.deepEqual(slots.map((s) => s.uid), [U(2), U(4), U(1)], "orden guardado");
  assert.equal(slots[0].serial, 47, "la copia #47, no la #3, porque es la elegida");
  assert.equal(slots[2].serial, 3);
  assert.equal(slots[0].variantId, "icon");
  assert.equal(slots[1].variantLabel, "Masters MVP");
  assert.deepEqual(slots.map((s) => s.slot), [1, 2, 3]);
  assert.equal(slots[2].lowSerial, true, "#3 de 25 es serie baja");
  assert.equal(slots[1].lowSerial, false);
});

test("22 · guardar dos veces lo mismo es idempotente (UNCHANGED, versión intacta aunque la esperada sea vieja)", () => {
  const cur = { uids: [U(1)], featured: [], version: 5 };
  assert.deepEqual(applySave(cur, { uids: [U(1)], featured: null, expectedVersion: 5 }).code, "UNCHANGED");
  const again = applySave(cur, { uids: [U(1)], featured: null, expectedVersion: 2 });
  assert.equal(again.code, "UNCHANGED");
  assert.equal(again.version, 5);
});

test("23 · dos pestañas: la segunda con versión vieja recibe CONFLICT; nada se corrompe", () => {
  let cur = { uids: [U(1)], featured: [] as string[], version: 1 };
  const tabA = applySave(cur, { uids: [U(1), U(2)], featured: null, expectedVersion: 1 });
  assert.equal(tabA.code, "SAVED"); assert.equal(tabA.version, 2);
  cur = { uids: tabA.uids, featured: tabA.featured, version: tabA.version };
  const tabB = applySave(cur, { uids: [U(4)], featured: null, expectedVersion: 1 });
  assert.equal(tabB.code, "CONFLICT");
  assert.deepEqual(tabB.uids, [U(1), U(2)], "se conserva lo guardado por la pestaña A");
  assert.equal(applySave(cur, { uids: [U(4)], featured: null, expectedVersion: null }).code, "SAVED", "sin versión: último en escribir gana (documentado)");
  assert.deepEqual(parseExpectedVersion(-1), { ok: false, code: "BAD_BODY" });
  assert.deepEqual(parseExpectedVersion(1.5), { ok: false, code: "BAD_BODY" });
});

test("24 · una instancia vendida/desguazada no se enseña: se salta y se cuenta como no disponible (solo SELF)", () => {
  const f = facts({ customization: { showcaseUids: [U(1), U(77), U(4)], featuredIds: [], version: 1, updatedAt: null } });
  const pub = build(f, RIVAL);
  assert.deepEqual(pub.showcase.map((s) => s.uid), [U(1), U(4)]);
  assert.deepEqual(pub.showcase.map((s) => s.slot), [1, 2]);
  const self = build(f, ME);
  assert.equal(self.self!.unavailableSlots, 1);
});

test("carta destacada: el slot 1 marca el acento con su paleta; sin vitrina, el acento de la casa", () => {
  assert.equal(build(facts(), RIVAL).accent.color, "#ffce4f");
  assert.equal(build(facts(), RIVAL).accent.rarity, "legendary");
  const empty = build(facts({ customization: null }), RIVAL);
  assert.equal(empty.accent.color, DEFAULT_ACCENT);
  assert.deepEqual(empty.showcase, []);
});

/* ───────────── logros (25–30) ───────────── */

const CATALOG_IDS = new Set(["coleccionista", "primer-mvp", "sobres-100"]);

test("25–26 · se destaca un logro conseguido; uno bloqueado se rechaza", () => {
  assert.deepEqual(checkFeaturedClaimed(["coleccionista"], new Set(["coleccionista"])), { ok: true, value: ["coleccionista"] });
  assert.deepEqual(checkFeaturedClaimed(["sobres-100"], new Set(["coleccionista"])), { ok: false, code: "LOCKED" });
});

test("27–30 · máximo 3, sin repetir, orden conservado, id desconocido rechazado", () => {
  assert.equal(FEATURED_MAX, 3);
  assert.deepEqual(parseFeatured(["a", "b", "c", "d"], CATALOG_IDS), { ok: false, code: "TOO_MANY" });
  assert.deepEqual(parseFeatured(["coleccionista", "coleccionista"], CATALOG_IDS), { ok: false, code: "DUPLICATE" });
  assert.deepEqual(parseFeatured(["primer-mvp", "coleccionista"], CATALOG_IDS), { ok: true, value: ["primer-mvp", "coleccionista"] });
  assert.deepEqual(parseFeatured(["mastery:equipo:th"], CATALOG_IDS), { ok: false, code: "BAD_BODY" });
  assert.deepEqual(parseFeatured(["no-existe"], CATALOG_IDS), { ok: false, code: "UNKNOWN" });
});

test("la foto solo destaca logros que siguen reclamados y del catálogo, en el orden guardado", () => {
  const s = build(facts({ customization: { showcaseUids: [], featuredIds: ["primer-mvp", "sobres-100", "coleccionista"], version: 1, updatedAt: null } }), RIVAL);
  assert.deepEqual(s.featured.map((a) => a.id), ["primer-mvp", "coleccionista"]);
  assert.deepEqual(s.achievements, { completed: 2, total: 3 });
});

/* ───────────── privacidad (31–40) ───────────── */

test("31–39 · la foto pública no arrastra ningún campo privado aunque los hechos lo traigan", () => {
  const dirty = { ...facts(), profile: { ...facts().profile, email: "qa@x.com", credits: 999999, is_admin: true, role: "admin", equipped: { marco: "marco:neon" } } } as unknown as IdentityFacts;
  const json = JSON.stringify(build(dirty, RIVAL));
  for (const k of ["email", "credits", "is_admin", "\"admin\"", "deck", "cardUids", "ledger", "reward", "objective", "baseline", "access_token", "auth", "equipped", "packs_opened"]) {
    assert.ok(!json.includes(k), `la foto pública no contiene «${k}»`);
  }
});

test("40 · sin marca de presencia exacta; fechas de actividad públicas redondeadas al día", () => {
  const s = build(facts(), RIVAL);
  const json = JSON.stringify(s);
  assert.ok(!/lastSeenAt|last_seen/.test(json));
  const ach = s.activity.find((a) => a.kind === "ACHIEVEMENT")!;
  assert.equal(ach.at % 86_400_000, 0);
  assert.equal(dayOf(NOW + 5000), dayOf(NOW));
});

test("avatar: conjunto cerrado de emojis; cualquier otra cosa se sirve como el avatar por defecto", () => {
  assert.equal(AVATARS.length, 12);
  assert.equal(isAllowedAvatar("🐉"), true);
  assert.equal(isAllowedAvatar("javascript:alert(1)"), false);
  assert.equal(safeAvatar("https://evil/x.png"), "🎮");
  assert.equal(safeAvatar("<img src=x onerror=1>"), "🎮");
  assert.equal(build(facts({ profile: { ...facts().profile, avatar: "data:text/html,<script>" } }), RIVAL).player.avatar, "🎮");
});

/* ───────────── social / H2H (41–48) ───────────── */

test("41 · el propio perfil no lleva H2H", () => {
  assert.equal(build(facts(), ME).h2h, null);
});

test("46 · H2H con otro jugador: RANKED / PRIVADOS / TOTAL tal cual y con su texto", () => {
  const s = build(facts(), RIVAL);
  assert.deepEqual([s.h2h!.ranked.matches, s.h2h!.private.matches, s.h2h!.total.matches], [5, 3, 8]);
  assert.deepEqual(s.h2h!.text, { ranked: "3–2", private: "1–1–1", total: "4–3–1" });
});

test("47 · las partidas recientes del perfil son las ranked públicas (ninguna privada), como mucho 5", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ ...facts().recentMatches[0], matchId: `m${i}` }));
  const s = build(facts({ recentMatches: many }), RIVAL);
  assert.equal(s.recentMatches.length, 5);
});

/* ───────────── Pick'ems (54–56) ───────────── */

test("54–55 · Pick'ems: solo filas ya corregidas (pickem_scores), totales y precisión; sin elecciones", () => {
  const p = pickemsSummary([{ pickemEventId: "a", title: "A", points: 40, correct: 6, total: 10, scoredAt: 2 }, { pickemEventId: "b", title: null, points: 10, correct: 1, total: 2, scoredAt: 5 }])!;
  assert.deepEqual([p.events, p.points, p.correct, p.total, p.accuracy], [2, 50, 7, 12, 58]);
  assert.equal(p.recent[0].pickemEventId, "b", "el más reciente primero");
  assert.equal(p.recent[0].title, "Pick'em");
  assert.ok(!/option|pick"|answer/.test(JSON.stringify(p)));
});

test("56 · sin Pick'ems corregidos → null (vacío honesto)", () => {
  assert.equal(pickemsSummary([]), null);
  assert.equal(build(facts({ pickems: [] }), RIVAL).pickems, null);
});

test("actividad: resultados ranked, logros conseguidos y Pick'ems corregidos; nada de compras ni recompensas; ≤ 6", () => {
  const items = profileActivity({ matches: facts().recentMatches, claimed: facts().claimed, catalog: facts().catalog, pickems: facts().pickems });
  assert.deepEqual(new Set(items.map((i) => i.kind)), new Set(["RANKED_RESULT", "ACHIEVEMENT", "PICKEM_SCORED"]));
  assert.ok(items.every((i, k) => k === 0 || items[k - 1].at >= i.at));
  assert.ok(!/crédit|compra|recompensa|objetivo/i.test(JSON.stringify(items)));
});
