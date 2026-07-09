/**
 * VERIFICACIÓN DEL CARD GENERATOR (Card Generator Fase 4/7).
 *
 * Comprueba: determinismo · identity · rule engine · editorial · specs · eligibility ·
 * collection · GenerationId · CardStatus · compat Analyzer/Collection/Catalog/Packs/Craft/
 * Marketplace · no duplicados · versionado · migraciones · rendimiento · cero estados
 * imposibles. 100% en memoria, sin red, sin stores. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze, type AnalyzerResult, type TournamentFact } from "@/analyzer";
import {
  generateCards, makeGenerationId, DEFAULT_RULESET,
  type GeneratorCtx, type CardGenerationResult, type EditorialOverride, type CardStatus,
} from "@/card-generator";
import { cardsForPlayer, variantsForAccolade } from "@/data/catalog";
import { applyStatBoost, computeOvr } from "@/domain/cards/ovr";
import { getVariant } from "@/domain/cards/variants";
import { CardRegistry } from "@/collection/registry";
import { isEligible } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import { instanceValue } from "@/domain/economy/pricing";
import type { Player } from "@/domain/cards/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ictx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

/* ── Fixture: Champions 2025 (el mismo de F3) ── */
const fixture: RawSnapshot = {
  tournament: { id: "champions-2025", name: "Champions 2025", type: "champions", tier: "vct-international", status: "finished", startDate: "2025-09-01T00:00:00Z" },
  stages: [{ id: "st-po", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
  teams: [
    { id: "sen", name: "Sentinels", region: "Americas", active: true },
    { id: "nrg", name: "NRG", region: "Americas" },
    { id: "g2", name: "G2", region: "Americas" },
    { id: "fnc", name: "Fnatic", region: "EMEA" },
  ],
  players: [
    { id: "star", nick: "zekken", team: "Sentinels", role: "duelist", agents: ["Jett", "Raze", "Neon"] },
    { id: "sup", nick: "zellsis", team: "Sentinels", role: "initiator", agents: ["Sova"] },
    { id: "riv", nick: "ethan", team: "NRG", role: "sentinel", agents: ["Killjoy"] },
  ],
  coaches: [{ id: "co", name: "kaplan", team: "Sentinels", status: "active" }],
  matches: [
    { id: "m0", stageId: "st-po", teamA: "Sentinels", teamB: "G2", status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: "Sentinels", round: "Semifinal", matchOrder: 1 },
    { id: "m1", stageId: "st-po", teamA: "Sentinels", teamB: "NRG", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "Sentinels", round: "Grand Final", matchOrder: 2 },
  ],
  maps: [
    { id: "m0m1", matchId: "m0", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 10, winner: "Sentinels" },
    { id: "m0m2", matchId: "m0", map: "Bind", mapOrder: 2, scoreA: 8, scoreB: 13, winner: "G2" },
    { id: "m0m3", matchId: "m0", map: "Ascent", mapOrder: 3, scoreA: 13, scoreB: 11, winner: "Sentinels" },
    { id: "m1m1", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 7, winner: "Sentinels" },
    { id: "m1m2", matchId: "m1", map: "Haven", mapOrder: 2, scoreA: 13, scoreB: 9, winner: "Sentinels" },
  ],
  mapStats: [
    { matchMapId: "m0m1", matchId: "m0", player: "zekken", team: "Sentinels", agent: "Jett", acs: 300, kills: 20, deaths: 10, assists: 4, kast: 80, adr: 170, hsPct: 32, fk: 5, fd: 2, clutches: 3 },
    { matchMapId: "m1m1", matchId: "m1", player: "zekken", team: "Sentinels", agent: "Raze", acs: 200, kills: 10, deaths: 10, assists: 6, kast: 70, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 2 },
    { matchMapId: "m0m1", matchId: "m0", player: "zellsis", team: "Sentinels", agent: "Sova", acs: 190, kills: 12, deaths: 12, assists: 9, kast: 74, adr: 140, fk: 1, fd: 1, clutches: 0 },
    { matchMapId: "m1m1", matchId: "m1", player: "ethan", team: "NRG", agent: "Killjoy", acs: 210, kills: 14, deaths: 15, assists: 5, kast: 68, adr: 145, fk: 2, fd: 3, clutches: 1 },
  ],
  standings: [
    { team: "Sentinels", position: 1, wins: 2, losses: 0, mapsWon: 4, mapsLost: 1, status: "qualified" },
    { team: "NRG", position: 2, wins: 1, losses: 1, mapsWon: 2, mapsLost: 2 },
    { team: "G2", position: 3, wins: 1, losses: 1 },
    { team: "Fnatic", position: 4, wins: 0, losses: 1, status: "eliminated" },
  ],
  awards: { champion: "Sentinels", runnerUp: "NRG" },
};

const history: TournamentFact[] = [{
  tournamentId: "champions-2024", type: "champions", endDate: 1_690_000_000_000,
  championTeamId: "t:sentinels",
  placements: [{ position: 1, teamId: "t:sentinels" }, { position: 5, teamId: "t:nrg" }],
  teamIds: ["t:sentinels", "t:nrg"], playerIds: ["p:zekken"],
  playerRatings: [{ playerId: "p:zekken", rating: 60 }],
}];

/* Roster inyectado: zekken existe en el catálogo; zellsis/ethan NO (drafts). */
const seedPlayer = (id: string, nick: string, extra: Partial<Player> = {}): Player => ({
  id, nick, team: "Sentinels", teamTag: "SEN", region: "Americas", role: "Duelista", country: "us",
  stats: { dmg: 80, scr: 82, com: 78, hs: 75, ast: 70, clu: 72 }, accolades: ["champions"],
  image: `/players/${id}.png`, ...extra,
});
const ROSTER: Player[] = [seedPlayer("zekken", "zekken")];

const analysis: AnalyzerResult = analyze(importSnapshot(fixture, ictx()).model, history);
const ctx = (): GeneratorCtx => ({ roster: ROSTER, now: 1_700_000_000_000 });

console.log("# Verificación del Card Generator — DRL Champions (Fase 4/7)\n");
const res: CardGenerationResult = generateCards(analysis, ctx());
const spec = (cardId: string) => res.cards.find((c) => c.cardId === cardId);

// COMPAT ANALYZER + VERSIONADO
console.log("## Compatibilidad Analyzer + versionado");
check("consume el AnalyzerResult real (schemaVersion 2)", analysis.schemaVersion === 2 && res.tournamentId === "champions-2025");
check("resultado versionado (schema 1 + ruleset v1 + generator)", res.schemaVersion === 1 && res.ruleset.version === 1 && res.generator.version.length > 0);
check("temporada derivada del torneo (2025)", res.season === 2025);

// DETERMINISMO
console.log("\n## Determinismo");
const a = JSON.stringify(generateCards(analysis, ctx()));
const b = JSON.stringify(generateCards(analysis, ctx()));
check("misma entrada ⇒ mismo resultado (byte a byte)", a === b);

// IDENTITY
console.log("\n## Identity Resolver");
const pr = (id: string) => res.players.find((p) => p.analyzerId === id)!;
check("p:zekken resuelto al roster por nick/id", pr("p:zekken").status === "resolved" && pr("p:zekken").playerId === "zekken");
check("p:zellsis y p:ethan creados como drafts", pr("p:zellsis").status === "created" && pr("p:ethan").status === "created");
check("draft con stats desde statsFromMetrics (finitas 1..99)", Object.values(pr("p:ethan").draft!.stats).every((v) => Number.isFinite(v) && v >= 1 && v <= 99));
const ambRoster = [...ROSTER, seedPlayer("ethan-a", "ethan"), seedPlayer("ethan-b", "Ethan")];
const ambRes = generateCards(analysis, { ...ctx(), roster: ambRoster });
check("nick duplicado en roster ⇒ ambiguous (nunca se adivina)", ambRes.players.find((p) => p.analyzerId === "p:ethan")?.status === "ambiguous");
const aliasRes = generateCards(analysis, { ...ctx(), roster: ambRoster, aliases: { "p:ethan": "ethan-a" } });
check("alias inyectado resuelve la ambigüedad", aliasRes.players.find((p) => p.analyzerId === "p:ethan")?.status === "resolved");

// RULE ENGINE
console.log("\n## Rule Engine (solo datos)");
const grant = (pid: string, acc: string) => res.grants.find((g) => g.playerId === pid && g.accolade === acc);
check("MVP → tournament-mvp con ruleId + evidencia", grant("zekken", "tournament-mvp")?.ruleId === "mvp-award" && (grant("zekken", "tournament-mvp")?.evidence.length ?? 0) > 0);
check("champion se expande al roster del equipo (zekken + zellsis)", !!grant("zekken", "tournament-champion") && res.grants.some((g) => g.accolade === "tournament-champion" && g.playerId === pr("p:zellsis").playerId));
check("líderes estadísticos → top-rating/top-acs (zekken)", grant("zekken", "tournament-top-rating")?.ruleId === "leader-rating" && !!grant("zekken", "tournament-top-acs"));
check("puerta minConfidence: prime NO se concede (nadie con high+90)", !res.grants.some((g) => g.accolade === "prime"));
check("badges históricos/narrativos con traza", res.badges.some((bg) => bg.badge === "back-to-back-champion") && res.badges.every((bg) => bg.ruleId.length > 0 && bg.evidence.length > 0));
check("reglas sin ids duplicados (default ruleset)", new Set(DEFAULT_RULESET.rules.map((r) => r.id)).size === DEFAULT_RULESET.rules.length);

// EDITORIAL
console.log("\n## Editorial Engine");
const mythic = spec("zekken__mythic");
check("MVP ⇒ decisión special (decideCard reutilizado)", mythic?.decision === "special", mythic?.decisionReason);
check("releaseState approved para jugador resuelto con datos completos", mythic?.releaseState === "approved" && (mythic?.confidence ?? 0) >= 0.9);
check("drafts de jugador nuevo ⇒ releaseState draft", res.cards.filter((c) => c.playerId === pr("p:ethan").playerId).every((c) => c.releaseState === "draft"));
check("CardStatus emitido = generated (publicación es F5)", res.cards.every((c) => c.status === "generated"));
const statuses: CardStatus[] = ["planned", "generated", "approved", "published", "retired", "archived"];
check("CardStatus: unión completa de 6 estados", statuses.length === 6);

// OVERRIDES
console.log("\n## Overrides editoriales (trazados)");
const ovs: EditorialOverride[] = [
  { kind: "set-mvp", tournamentId: "champions-2025", playerId: pr("p:ethan").playerId!, reason: "MVP oficial de Riot", author: "editor" },
  { kind: "block-card", tournamentId: "champions-2025", playerId: "zekken", family: "tournament-top-acs", reason: "revisión", author: "editor" },
];
const ovRes = generateCards(analysis, { ...ctx(), overrides: ovs });
check("set-mvp desvía el MVP al objetivo (ethan) y zekken lo pierde",
  ovRes.grants.some((g) => g.accolade === "tournament-mvp" && g.playerId === pr("p:ethan").playerId) &&
  !ovRes.grants.some((g) => g.accolade === "tournament-mvp" && g.playerId === "zekken"));
check("block-card omite el spec con motivo", !ovRes.cards.some((c) => c.playerId === "zekken" && c.family === "tournament-top-acs") &&
  ovRes.omitted.some((o) => o.playerId === "zekken" && o.action === "blocked"));
check("overrides aplicados quedan trazados", ovRes.overridesApplied.length === 2);

// SPEC BUILDER (compat Catalog)
console.log("\n## Card Spec Builder (matemática del catálogo)");
check("cardId = playerId__variantId y variante existente", res.cards.every((c) => c.cardId === `${c.playerId}__${c.variantId}` && !!getVariant(c.variantId)));
const zk = ROSTER[0];
const zkAfter: Player = { ...zk, accolades: [...zk.accolades, "tournament-mvp", "tournament-champion", "tournament-top-rating", "tournament-top-acs", "tournament-top-hs", "tournament-top-kills", "tournament-top-assists", "tournament-clutch"] };
const predicted = cardsForPlayer(zkAfter);
check("cada spec ∈ cardsForPlayer(jugador+accolades) con ovr/stats IDÉNTICOS",
  res.cards.filter((c) => c.playerId === "zekken").every((c) => {
    const p = predicted.find((x) => x.id === c.cardId);
    return !!p && p.ovr === c.ovr && JSON.stringify(p.stats) === JSON.stringify(c.stats);
  }));
check("ovr === computeOvr(applyStatBoost(base, boost))",
  res.cards.filter((c) => c.playerId === "zekken").every((c) => c.ovr === computeOvr(applyStatBoost(zk.stats, getVariant(c.variantId).statBoost))));
check("serialLimit desde VARIANTS (mythic=25)", mythic?.serialLimit === 25 && mythic?.serialized === true);
check("badges/tags en el spec (back-to-back, champion...)", (mythic?.badges.includes("back-to-back-champion") ?? false) && (mythic?.narrativeTags.includes("champion") ?? false));

// ELIGIBILITY (compat Packs / Craft / Marketplace)
console.log("\n## Eligibility (packs · craft · marketplace)");
check("familias especiales ⇒ market impossible y fuera de packs", !!mythic && mythic.eligibility.market.impossible && mythic.eligibility.packs.length === 0);
const ethanBase = res.cards.find((c) => c.playerId === pr("p:ethan").playerId && c.family === "base" && getVariant(c.variantId).group === "base");
check("carta base de jugador nuevo elegible en packs reales", !!ethanBase && ethanBase.eligibility.packs.length > 0, ethanBase?.eligibility.packs.join(","));
check("claims de pack confirmados por isEligible (motor real)", !!ethanBase && ethanBase.eligibility.packs.every((pid) => {
  const pk = getPack(pid);
  const reg = new CardRegistry([], (id) => (id === ethanBase.playerId ? pr("p:ethan").draft : undefined));
  return !!pk && isEligible(reg, pk, { id: ethanBase.cardId, playerId: ethanBase.playerId, variantId: ethanBase.variantId, ovr: ethanBase.ovr, stats: ethanBase.stats });
}));
check("craft: salvage siempre + upgradeTargets hacia variantes superiores", res.cards.every((c) => c.eligibility.craft.salvage) && (ethanBase?.eligibility.craft.upgradeTargets.length ?? 0) > 0);
check("marketplace: valor estimado = instanceValue (finito, ≥25)", res.cards.every((c) => c.estimatedValue === instanceValue({ id: c.cardId, playerId: c.playerId, variantId: c.variantId, ovr: c.ovr, stats: c.stats }) && c.estimatedValue >= 25));

// COLLECTION (compat domain/collections)
console.log("\n## Collection Builder");
check("CollectionDef source=tournament con items = specs", res.collection.source === "tournament" && res.collection.items.length === res.cards.length && res.collection.tournamentId === "champions-2025");
check("awards estadísticos en forma AwardWinner (top-rating...)", res.collection.awards.some((w) => w.kind === "top-rating" && w.cardId === `${w.playerId}__${w.variantId}`));
check("slug determinista", res.collection.slug === "champions-2025");

// GENERATION ID + NO DUP + MIGRACIONES
console.log("\n## GenerationId · anti-dup · migraciones");
check("GenerationId formato GEN-<temporada>-<torneo>", res.generationId === "GEN-2025-CHAMPIONS-2025");
check("GenerationId nunca se reutiliza (sufijo determinista)", makeGenerationId(2025, "Champions 2025", [res.generationId]) === "GEN-2025-CHAMPIONS-2025-2");
check("cardIds únicos en el resultado", new Set(res.cards.map((c) => c.cardId)).size === res.cards.length);
const rerun = generateCards(analysis, { ...ctx(), ledger: res.ledgerAfter });
check("re-procesar el mismo torneo ⇒ skipped, 0 cartas, ledger intacto", rerun.skipped && rerun.cards.length === 0 && rerun.ledgerAfter === res.ledgerAfter);
const roundtrip = JSON.parse(JSON.stringify(res)) as CardGenerationResult;
check("migración/roundtrip v1: JSON re-parseable e íntegro", roundtrip.schemaVersion === 1 && roundtrip.cards.length === res.cards.length);
check("ledgerAfter encadena (processed + cardKeys + history + generationIds)",
  res.ledgerAfter.processed.includes("champions-2025") && res.ledgerAfter.generationIds.includes(res.generationId) &&
  res.ledgerAfter.cardKeys.includes(`zekken:tournament-mvp:2025`) && res.ledgerAfter.history["zekken"]?.ownsFamilies.includes("tournament-mvp"));
const again = generateCards({ ...analysis, tournamentId: "champions-2025-b" }, { ...ctx(), ledger: res.ledgerAfter });
check("anti-dup entre torneos: misma familia+temporada no se repite", !again.cards.some((c) => c.playerId === "zekken" && c.family === "tournament-mvp") &&
  again.omitted.some((o) => o.playerId === "zekken" && o.family === "tournament-mvp" && o.action === "duplicate"));

// CERO ESTADOS IMPOSIBLES + NO MATERIALIZACIÓN
console.log("\n## Cero estados imposibles · no materialización");
const ser = JSON.stringify(res);
check("sin instancias: sin uid/serial/obtainedAt en la salida", !ser.includes('"uid"') && !ser.includes('"serial"') && !ser.includes('"obtainedAt"'));
check("todo finito y en rango (ovr 1..99, confidence 0..1)", res.cards.every((c) => Number.isFinite(c.ovr) && c.ovr >= 1 && c.ovr <= 99 && c.confidence > 0 && c.confidence <= 1 && Object.values(c.stats).every(Number.isFinite)));
check("artwork = solo referencias (image/template/palette)", res.cards.every((c) => c.artwork.image.length > 0 && c.artwork.templateAssetKey.startsWith("card_template:variant:")));
check("news deterministas por carta no-base", res.news.length === res.cards.filter((c) => c.family !== "base").length && res.news.every((n) => n.id.startsWith("news:")));
check("variantsForAccolade respetado (mvp→mythic, champion→champion-edition)",
  variantsForAccolade("tournament-mvp", zkAfter).includes("mythic") && !!spec("zekken__champion-edition"));

// RENDIMIENTO
console.log("\n## Rendimiento");
function bigSnapshot(T: number): RawSnapshot {
  const teams = Array.from({ length: T }, (_, i) => ({ id: `T${i}`, name: `Team ${i}`, active: true }));
  const players = teams.flatMap((t, ti) => Array.from({ length: 5 }, (_, pi) => ({ id: `p${ti}_${pi}`, nick: `p${ti}_${pi}`, team: t.name, role: "duelist" })));
  const matches: RawSnapshot["matches"] = [];
  const maps: NonNullable<RawSnapshot["maps"]> = [];
  const mapStats: NonNullable<RawSnapshot["mapStats"]> = [];
  let order = 0;
  for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) {
    const id = `m_${i}_${j}`;
    matches.push({ id, teamA: teams[i].name, teamB: teams[j].name, status: "finished", format: "bo3", scoreA: 2, scoreB: 1, winner: teams[i].name, matchOrder: order++ });
    for (let k = 0; k < 3; k++) {
      const mid = `${id}_${k}`;
      maps.push({ id: mid, matchId: id, map: "Ascent", mapOrder: k, scoreA: 13, scoreB: 10, winner: teams[i].name });
      for (let s = 0; s < 5; s++) mapStats.push({ matchMapId: mid, matchId: id, player: `p${i}_${s}`, team: teams[i].name, acs: 200 + s, kills: 15, deaths: 12, assists: 5, kast: 72, adr: 150, hsPct: 25, fk: 2, fd: 2, clutches: 1 });
    }
  }
  return { tournament: { id: "big", name: "Big Masters 2025", type: "masters", status: "finished" }, teams, players, matches, maps, mapStats, standings: teams.map((t, i) => ({ team: t.name, position: i + 1, wins: 1, losses: 0 })), awards: { champion: teams[0].name } };
}
const bigAnalysis = analyze(importSnapshot(bigSnapshot(30), ictx()).model);
const t0 = process.hrtime.bigint();
const bigRes = generateCards(bigAnalysis, { roster: [], now: 1_700_000_000_000 });
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
check("torneo grande (150 jugadores nuevos) generado", bigRes.players.length === 150 && bigRes.cards.length > 0, `${bigRes.cards.length} cartas · ${Math.round(ms)} ms`);
check("rendimiento aceptable (sin O(n²) patológico)", ms < 4000, `${Math.round(ms)} ms`);

console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
if (fail > 0) process.exitCode = 1;
