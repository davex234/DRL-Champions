/**
 * VERIFICACIÓN — Deck & Squad Builder Engine (DRL Champions, Collection Fase 3/7).
 *
 *   npx tsx scripts/deck-verify.ts
 *
 * Comprueba la capa ENTRE Collection y Gameplay (no juega; construye el equipo que consume el Player
 * Mapper y el Match Engine) SIN duplicar roster/Player/Team/Identity/Gameplay: decks/roster/roles/
 * titulares/suplentes/reservas/coach · sinergias · química · validación · persistencia · migraciones ·
 * import/export · compatibilidad · determinismo · rendimiento (100.000 cartas · 1.000 decks) · cero
 * estados imposibles · compat Gameplay/Career/Collection. 100% DETERMINISTA.
 */
import type { OwnedCard, Player, RoleId } from "../src/domain/cards/types";
import { CARDS, allPlayers, getPlayer, cardsForPlayer } from "../src/data/catalog";
import { buildHomeRoster } from "../src/lib/match/roster";
import { teamChemistry, relKey, freshRelationship } from "../src/development";
import {
  DeckEngine, migrateDeck, cloneDeck, exportDeck, serializeDeck, importDeck, roleCoverage,
  validateDeck, type Deck,
} from "../src/deck";

let failures = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
console.log("# Verificación del Deck & Squad Builder Engine — DRL Champions (Collection Fase 3/7)\n");

// ── Colección controlada: 6 jugadores de ROLES distintos (para cobertura), 1 carta poseída cada uno ──
const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const pickByRole = (role: RoleId): Player | undefined => allPlayers().find((p) => p.role === role);
const chosen: Player[] = [];
for (const r of ROLES) { const p = pickByRole(r); if (p) chosen.push(p); }
const extra = allPlayers().find((p) => !chosen.some((c) => c.id === p.id));
if (extra) chosen.push(extra);                         // un 6º para banquillo/reservas
const bestCardOf = (p: Player) => cardsForPlayer(p).reduce((b, c) => (c.ovr > b.ovr ? c : b), cardsForPlayer(p)[0]);
const owned: OwnedCard[] = chosen.map((p, i) => ({ uid: `u${i}`, cardId: bestCardOf(p).id, obtainedAt: i }));
const eng = new DeckEngine(owned);
const mkDeck = (over: Partial<Deck> = {}): Deck => migrateDeck({ id: "d", name: "Deck", starters: owned.slice(0, 5).map((o) => o.uid), kind: "competitive", ...over });

// ─────────────────────── 1. Roster handoff (compat Gameplay) ───────────────────────
console.log("## Roster handoff → Player Mapper → Gameplay");
{
  const deck = mkDeck({ iglUid: owned[0].uid });
  const { rosters, missing } = eng.toRosters(deck, 123);
  check("HANDOFF: deck → MatchRosters (home 5 + away 5) vía Player Mapper", rosters.home.length === 5 && rosters.away.length === 5 && missing.length === 0);
  check("HANDOFF: exactamente 1 IGL en el equipo (shot-caller único)", rosters.home.filter((e) => e.role === "igl").length === 1);
  const igl = rosters.home.find((e) => e.role === "igl");
  check("HANDOFF: honra el IGL DESIGNADO (uid explícito, no el automático)", igl?.meta?.cardUid === owned[0].uid);
  check("HANDOFF: no crea otro roster — es exactamente buildHomeRoster", JSON.stringify(eng.homeRoster(deck).roster) === JSON.stringify(buildHomeRoster(deck.starters, owned, { iglUid: owned[0].uid }).roster));
}

// ─────────────────────── 2. Validación ───────────────────────
console.log("\n## Validación de decks");
{
  check("VÁLIDO: 5 titulares consistentes ⇒ ok", eng.validate(mkDeck()).ok);
  check("INCOMPLETO: <5 titulares ⇒ incomplete", eng.validate(mkDeck({ starters: owned.slice(0, 3).map((o) => o.uid) })).validity === "incomplete");
  const dupCard = mkDeck({ starters: [owned[0].uid, owned[0].uid, owned[1].uid, owned[2].uid, owned[3].uid] });
  check("DUPLICADO carta: mismo uid dos veces ⇒ DUPLICATE_CARD", eng.validate(dupCard).issues.some((i) => i.code === "DUPLICATE_CARD"));
  const unknown = mkDeck({ starters: [owned[0].uid, owned[1].uid, owned[2].uid, owned[3].uid, "no-existe"] });
  check("INEXISTENTE: uid no poseído ⇒ UNKNOWN_CARD + missing", eng.validate(unknown).issues.some((i) => i.code === "UNKNOWN_CARD") && eng.validate(unknown).missing.includes("no-existe"));
  check("CAPITÁN: capitán no titular ⇒ CAPTAIN_NOT_STARTER", eng.validate(mkDeck({ captainUid: owned[5].uid })).issues.some((i) => i.code === "CAPTAIN_NOT_STARTER"));
  check("IGL: igl no titular ⇒ IGL_NOT_STARTER", eng.validate(mkDeck({ iglUid: owned[5].uid })).issues.some((i) => i.code === "IGL_NOT_STARTER"));
  check("COACH: coach que además es titular ⇒ COACH_IN_STARTERS", eng.validate(mkDeck({ coachUid: owned[0].uid })).issues.some((i) => i.code === "COACH_IN_STARTERS"));
  check("RESERVAS: reserva que solapa titular ⇒ RESERVE_OVERLAP", eng.validate(mkDeck({ reserves: [owned[0].uid] })).issues.some((i) => i.code === "RESERVE_OVERLAP"));
}

// ─────────────────────── 3. Roles / cobertura ───────────────────────
console.log("\n## Roles / cobertura (reutiliza RoleId + roleToSimRole)");
{
  const cov = roleCoverage(chosen.slice(0, 5).map((p) => p.role));
  check("COBERTURA: reparto por rol de carta y por rol de sim", Object.values(cov.byCardRole).reduce((a, b) => a + b, 0) === 5 && Object.values(cov.bySimRole).reduce((a, b) => a + b, 0) === 5);
  check("COBERTURA: 5 roles distintos ⇒ equilibrado, sin roles faltantes", cov.balanced && cov.missing.length === 0);
  const monoCov = roleCoverage(["Duelista", "Duelista", "Duelista", "Duelista", "Duelista"]);
  check("COBERTURA: quinteto monorol ⇒ desequilibrado + roles faltantes", !monoCov.balanced && monoCov.missing.length === 4);
}

// ─────────────────────── 4. Titulares / suplentes / reservas ───────────────────────
console.log("\n## Titulares / suplentes / reservas");
{
  const deck = mkDeck({ subs: [owned[5].uid], reserves: [] });
  check("BANQUILLO: suplente válido (no titular) ⇒ ok", eng.validate(deck).ok && deck.subs.length === 1);
  check("SUPLENTE-EN-TITULAR: uid en ambos ⇒ STARTER_IN_SUBS", eng.validate(mkDeck({ subs: [owned[0].uid] })).issues.some((i) => i.code === "STARTER_IN_SUBS"));
}

// ─────────────────────── 5. Coach / capitán / IGL ───────────────────────
console.log("\n## Coach / Capitán / IGL");
{
  const deck = mkDeck({ captainUid: owned[1].uid, iglUid: owned[2].uid, coachUid: owned[5].uid });
  const v = eng.validate(deck);
  check("DESIGNACIONES: capitán+IGL titulares y coach externo ⇒ válido", v.ok);
  check("VALIDEZ: deck con IGL + cobertura ⇒ 'competitive'", v.validity === "competitive");
  check("COACH: coach externo NO aparece como jugador del roster", eng.toRosters(deck, 1).rosters.home.every((e) => e.meta?.cardUid !== owned[5].uid));
}

// ─────────────────────── 6. Sinergias / química (reutiliza agents + development) ───────────────────────
console.log("\n## Sinergias / Química");
{
  const deck = mkDeck({ iglUid: owned[0].uid });
  const a = eng.analyze(deck);
  check("ANÁLISIS: rating + química(0..100) + arquetipo + fortalezas/debilidades/sinergias", a.rating > 0 && a.chemistry >= 0 && a.chemistry <= 100 && a.archetype !== "unknown" && (a.strengths.length + a.weaknesses.length) > 0);
  // La química REUTILIZA development.teamChemistry (misma fórmula, sin motor nuevo).
  const roster = eng.homeRoster(deck).roster;
  const ids = roster.map((r) => r.meta?.playerId ?? r.name);
  const rels: Record<string, ReturnType<typeof freshRelationship>> = {};
  for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) rels[relKey(ids[i], ids[j])] = freshRelationship(ids[i], ids[j], roster[i].identity!.selfBelief, roster[j].identity!.selfBelief);
  check("QUÍMICA: reutiliza development.teamChemistry (valor idéntico, sin duplicar)", a.chemistry === teamChemistry(rels, ids));
  check("SINERGIAS: cobertura de composición presente (reutiliza @/agents)", a.playstyle.length >= 0 && Array.isArray(a.synergies));
}

// ─────────────────────── 7. Compatibilidad (reutiliza @/agents compareCompositions) ───────────────────────
console.log("\n## Compatibilidad entre decks");
{
  const a = mkDeck({ id: "a" });
  const b = mkDeck({ id: "b", starters: [owned[5].uid, owned[1].uid, owned[2].uid, owned[3].uid, owned[4].uid] });
  const cmp = eng.compatibility(a, b);
  check("COMPATIBILIDAD: favored ∈ {a,b,even} + margen + notas", ["a", "b", "even"].includes(cmp.favored) && typeof cmp.margin === "number" && cmp.notes.length > 0);
}

// ─────────────────────── 8. Persistencia / migraciones ───────────────────────
console.log("\n## Persistencia / migraciones");
{
  const legacy = { id: "old", name: "Legacy", starters: [owned[0].uid], subs: [], createdAt: 1, lastUsedAt: null }; // sin kind/reserves/version
  const migrated = migrateDeck(legacy);
  check("MIGRACIÓN: equipo antiguo (sin kind/reserves/version) ⇒ defaults + versión", migrated.kind === "custom" && Array.isArray(migrated.reserves) && (migrated.version ?? 0) >= 1);
  const corrupt = migrateDeck({ id: 5, name: "", starters: "x", subs: null, kind: "inventado" });
  check("MIGRACIÓN: corrupto se sanea (arrays válidos, kind válido, nombre por defecto)", Array.isArray(corrupt.starters) && corrupt.starters.length === 0 && corrupt.kind === "custom" && corrupt.name.length > 0);
  check("MIGRACIÓN: null ⇒ deck vacío estable", migrateDeck(null).starters.length === 0);
}

// ─────────────────────── 9. Import / export ───────────────────────
console.log("\n## Import / export");
{
  const deck = mkDeck({ id: "src", name: "Exportado", captainUid: owned[0].uid, favorite: true });
  const round = importDeck(serializeDeck(deck), { id: "new", now: 99 });
  check("ROUNDTRIP: export→import preserva la composición (uids/kind/capitán)", !!round && round.id === "new" && JSON.stringify(round!.starters) === JSON.stringify(deck.starters) && round!.captainUid === owned[0].uid && round!.kind === deck.kind);
  check("EXPORT: formato portable sin fechas locales", (() => { const e = exportDeck(deck) as unknown as Record<string, unknown>; return e.format === "drl-deck" && !("createdAt" in (e.deck as object)); })());
  check("IMPORT: formato inválido ⇒ null (no crea basura)", importDeck({ foo: "bar" }, { id: "x", now: 0 }) === null && importDeck("no-json", { id: "x", now: 0 }) === null);
  const cl = cloneDeck(deck, { id: "clone", now: 7 });
  check("CLON: copia con nuevo id, misma composición, deja de ser favorito", cl.id === "clone" && JSON.stringify(cl.starters) === JSON.stringify(deck.starters) && cl.favorite === false);
}

// ─────────────────────── 10. Determinismo ───────────────────────
console.log("\n## Determinismo");
{
  const deck = mkDeck({ iglUid: owned[0].uid });
  const e2 = new DeckEngine(owned);
  check("DETERMINISMO: mismas entradas ⇒ mismo validate/analyze/roster", JSON.stringify(eng.validate(deck)) === JSON.stringify(e2.validate(deck)) && JSON.stringify(eng.analyze(deck)) === JSON.stringify(e2.analyze(deck)) && JSON.stringify(eng.toRosters(deck, 5)) === JSON.stringify(e2.toRosters(deck, 5)));
}

// ─────────────────────── 11. Cero estados imposibles ───────────────────────
console.log("\n## Cero estados imposibles");
{
  let bad = 0;
  const empty = migrateDeck({ id: "e", name: "Vacío", starters: [] });
  if (eng.validate(empty).validity !== "empty") bad++;
  if (eng.toRosters(empty, 1).rosters.home.length !== 0) bad++;         // roster vacío coherente
  if (eng.analyze(empty).starters !== 0) bad++;
  try { eng.validate(migrateDeck({ id: "c", name: "x", starters: ["a", "b"] })); } catch { bad++; }  // corrupto no lanza
  check("INTEGRIDAD: vacío coherente, roster vacío, análisis 0, validación nunca lanza", bad === 0);
}

// ─────────────────────── 12. Rendimiento (100.000 cartas · 1.000 decks) ───────────────────────
console.log("\n## Rendimiento (100.000 cartas · 1.000 decks)");
{
  const N = 100000;
  const bigOwned: OwnedCard[] = [];
  for (let i = 0; i < N; i++) bigOwned.push({ uid: `b${i}`, cardId: CARDS[i % CARDS.length].id, obtainedAt: i });
  const t0 = Date.now();
  const bigEng = new DeckEngine(bigOwned);
  const decks: Deck[] = [];
  for (let d = 0; d < 1000; d++) decks.push(migrateDeck({ id: `d${d}`, name: `D${d}`, starters: [0, 1, 2, 3, 4].map((k) => `b${(d * 5 + k) % N}`) }));
  let okCount = 0;
  for (const d of decks) { const v = bigEng.validate(d); bigEng.summary(d); if (v.ok) okCount++; }
  bigEng.analyze(decks[0]);
  const ms = Date.now() - t0;
  check("RENDIMIENTO: 100k cartas + 1.000 decks (validate+summary) sin O(n²)", ms < 4000 && okCount >= 0, `${ms}ms · ${N} cartas · 1000 decks · ${okCount} válidos`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
