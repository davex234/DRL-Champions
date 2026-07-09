/**
 * VERIFICACIÓN DEL MATERIALIZER (Card Generator Fase 5/7).
 *
 * Encadena el pipeline REAL F1→F5 (import → analyze → generateCards → materialize) y
 * comprueba: CardSpec→CardDef · fingerprint · provenance · CatalogPatch · CollectionPatch ·
 * PackPatch · CraftPatch · MarketplacePatch · rebuild incremental · idempotencia ·
 * determinismo · versionado · migraciones · compat F4/Collection/Packs/Craft/Marketplace ·
 * rendimiento · no duplicados · cero estados imposibles. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze, type TournamentFact } from "@/analyzer";
import { generateCards, type GeneratorCtx, type CardGenerationResult } from "@/card-generator";
import { materialize, canonicalJson, fingerprintSpec, type MaterializationResult, type MaterializerCtx } from "@/materializer";
import { cardsForPlayer, CARDS, totalCards } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { CardRegistry } from "@/collection/registry";
import { isEligible, buildPool } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import { RECIPE_BY_ID } from "@/data/recipes";
import { instanceValue } from "@/domain/economy/pricing";
import type { Player } from "@/domain/cards/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ictx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

/* ── Fixture (mismo Champions 2025 de F3/F4) ── */
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

const seedPlayer = (id: string, nick: string, extra: Partial<Player> = {}): Player => ({
  id, nick, team: "Sentinels", teamTag: "SEN", region: "Americas", role: "Duelista", country: "us",
  stats: { dmg: 80, scr: 82, com: 78, hs: 75, ast: 70, clu: 72 }, accolades: ["champions"],
  image: `/players/${id}.png`, ...extra,
});
const ROSTER: Player[] = [seedPlayer("zekken", "zekken")];
const gctx = (): GeneratorCtx => ({ roster: ROSTER, now: 1_700_000_000_000 });
const mctx = (): MaterializerCtx => ({ roster: ROSTER, now: 1_700_000_000_000 });

async function main(): Promise<void> {
  console.log("# Verificación del Materializer — DRL Champions (Fase 5/7)\n");

  const cardsBefore = totalCards();
  const catalogSnapshotBefore = JSON.stringify(CARDS.slice(0, 5));

  const analysis = analyze(importSnapshot(fixture, ictx()).model, history);
  const gen: CardGenerationResult = generateCards(analysis, gctx());
  const res: MaterializationResult = await materialize(gen, mctx());

  // COMPAT CARD GENERATOR + VERSIONADO + PROVENANCE
  console.log("## Compat Card Generator · versionado · provenance");
  check("consume el CardGenerationResult real (F4)", res.generationId === gen.generationId && gen.cards.length > 0);
  check("provenance completa (importer/analyzer/generator/materializer/ruleset/GEN/appVersion)",
    res.provenance.importerSchema === 1 && res.provenance.analyzerSchema === 2 && res.provenance.generatorSchema === 1 &&
    res.provenance.materializerSchema === 1 && res.provenance.rulesetVersion === 1 &&
    res.provenance.generationId === "GEN-2025-CHAMPIONS-2025" && res.provenance.appVersion.length > 0);
  check("timestamp lógico inyectado (nunca Date.now)", res.provenance.at === 1_700_000_000_000);

  // CARDSPEC → CARDDEF
  console.log("\n## CardSpec → CardDef");
  check("una MaterializedCard por spec (todas cambiadas la 1ª vez)", res.cards.length === gen.cards.length && res.unchanged.length === 0);
  check("CardDef byte-idéntico al spec (id/ovr/stats sin recalcular)",
    res.cards.every((c) => {
      const s = gen.cards.find((x) => x.cardId === c.card.id)!;
      return c.card.ovr === s.ovr && JSON.stringify(c.card.stats) === JSON.stringify(s.stats) && c.card.variantId === s.variantId;
    }));
  const mythic = res.cards.find((c) => c.card.id === "zekken__mythic");
  check("metadatos de release (tier/status/releaseState/badges) proyectados",
    mythic?.releaseState === "approved" && mythic?.status === "generated" && (mythic?.badges.includes("back-to-back-champion") ?? false));
  check("artwork resuelto (template/background/palette/renderProfile)",
    res.cards.every((c) => c.artwork.templateAssetKey.startsWith("card_template:variant:") &&
      c.artwork.backgroundAssetKey === `background:variant:${c.card.variantId}` && !!c.artwork.renderProfile && !!c.artwork.palette.primary));

  // FINGERPRINT
  console.log("\n## MaterializationFingerprint (SHA-256)");
  check("sha256 hex de 64 chars por carta", res.cards.every((c) => /^[0-9a-f]{64}$/.test(c.fingerprint)));
  const spec0 = gen.cards[0];
  const fpA = await fingerprintSpec(spec0);
  const fpB = await fingerprintSpec(JSON.parse(canonicalJson(spec0)));
  check("huella estable ante reordenación de claves (JSON canónico)", fpA === fpB);
  const fpMut = await fingerprintSpec({ ...spec0, ovr: spec0.ovr === 99 ? 98 : spec0.ovr + 1 });
  check("cambiar el spec cambia la huella", fpMut !== fpA);

  // CATALOG PATCH (incremental)
  console.log("\n## CatalogPatch (incremental, jamás rebuild)");
  const cp = res.catalogPatch;
  check("drafts añadidos con accolades fusionadas (zellsis/ethan)",
    cp.playersAdd.length === 2 && cp.playersAdd.some((p) => p.nick === "zellsis" && p.accolades.includes("tournament-champion")));
  check("zekken actualizado SOLO con accolades nuevas", cp.playersUpdate.length === 1 && cp.playersUpdate[0].playerId === "zekken" &&
    cp.playersUpdate[0].addAccolades.includes("tournament-mvp") && !cp.playersUpdate[0].addAccolades.includes("champions"));
  check("cardsAdd ⊇ todas las cartas materializadas", res.cards.every((c) => cp.cardsAdd.some((a) => a.id === c.card.id)));
  check("incremental: solo jugadores afectados; sin fullRebuild", cp.fullRebuild === false && cp.affectedPlayers.length === 3 && cp.cardsRemove.length === 0);
  // Compat Collection/Catalog: aplicar el patch reproduce EXACTAMENTE el catálogo predicho.
  const rosterAfter: Player[] = [
    ...ROSTER.map((p) => {
      const up = cp.playersUpdate.find((u) => u.playerId === p.id);
      return up ? { ...p, accolades: [...p.accolades, ...up.addAccolades] } : p;
    }),
    ...cp.playersAdd,
  ];
  const rebuilt = new Map(rosterAfter.flatMap((p) => cardsForPlayer(p)).map((c) => [c.id, c]));
  check("compat catálogo: patch aplicado ⇒ cardsForPlayer reproduce cada add byte a byte",
    cp.cardsAdd.every((a) => { const r = rebuilt.get(a.id); return !!r && r.ovr === a.ovr && JSON.stringify(r.stats) === JSON.stringify(a.stats); }));
  const regAfter = new CardRegistry([...rebuilt.values()], (id) => rosterAfter.find((p) => p.id === id));
  check("compat Collection: CardRegistry indexa las cartas nuevas", cp.cardsAdd.every((a) => regAfter.has(a.id)));

  // COLLECTION PATCH
  console.log("\n## CollectionPatch");
  check("colección nueva del torneo (source=tournament, items = cartas)", res.collectionPatch.add.length === 1 &&
    res.collectionPatch.add[0].source === "tournament" && res.collectionPatch.add[0].items.length === res.cards.length);
  check("season y series afectadas", res.collectionPatch.season === 2025 && res.collectionPatch.series.length > 0);
  const resUpd = await materialize(gen, { ...mctx(), existingCollections: [{ id: `col-champions-2025`, itemIds: [res.cards[0].card.id] }] });
  check("colección existente ⇒ solo addItems (incremental)", resUpd.collectionPatch.add.length === 0 &&
    resUpd.collectionPatch.update[0]?.addItems.length === res.cards.length - 1);

  // PACK PATCH
  console.log("\n## PackPatch");
  const pool = (packId: string) => res.packPatch.pools.find((p) => p.packId === packId);
  check("cartas base de drafts entran en pools reales", res.packPatch.pools.length > 0 &&
    res.packPatch.pools.some((p) => p.add.length > 0));
  check("claims revalidados con isEligible (motor real)", res.packPatch.pools.every((p) => {
    const pk = getPack(p.packId)!;
    return p.add.every((e) => {
      const card = res.cards.find((c) => c.card.id === e.cardId)!.card;
      return isEligible(regAfter, pk, card);
    });
  }));
  check("drop groups = bucket por rank de variante", res.packPatch.pools.every((p) => p.add.every((e) => {
    const c = res.cards.find((x) => x.card.id === e.cardId)!;
    return e.bucket === c.rarityBucket;
  })));
  check("mythic (mercado imposible) en NINGÚN pool", !res.packPatch.pools.some((p) => p.add.some((e) => e.cardId === "zekken__mythic")));
  check("invalidate = packs afectados (recrear pools/engines congelados)", res.packPatch.invalidate.length === res.packPatch.pools.length);
  const builtPool = buildPool(regAfter, getPack("estandar")!);
  check("compat Packs: pool real reconstruido contiene las altas de 'estandar'",
    !pool("estandar") || pool("estandar")!.add.every((e) => builtPool.flat.some((c) => c.id === e.cardId)));

  // CRAFT PATCH
  console.log("\n## CraftPatch");
  check("solo recetas EXISTENTES enlazadas (jamás se crean)", res.craftPatch.links.every((l) => l.recipes.every((r) => RECIPE_BY_ID.has(r))));
  check("toda carta enlaza al menos salvage/dismantle", res.craftPatch.links.every((l) => l.recipes.includes("dismantle-card")));
  const basePath = res.craftPatch.upgradePaths.find((p) => p.via === "upgrade-next");
  check("upgrade path hacia la variante inmediatamente superior del jugador", !!basePath && getVariant(res.cards.find((c) => c.card.id === basePath.to)!.card.variantId).rank >
    getVariant(res.cards.find((c) => c.card.id === basePath.from)?.card.variantId ?? "bronze").rank);
  check("paths de evolución/promoción vía recetas de grupo", res.craftPatch.upgradePaths.every((p) => RECIPE_BY_ID.has(p.via)));

  // MARKETPLACE PATCH
  console.log("\n## MarketplacePatch");
  const entry = (id: string) => res.marketPatch.entries.find((e) => e.cardId === id);
  check("mythic: no tradable, impossible, unlisted", entry("zekken__mythic")?.tradable === false &&
    entry("zekken__mythic")?.restrictions.impossible === true && entry("zekken__mythic")?.visibility === "unlisted");
  check("cartas base: tradable, valor inicial = instanceValue", res.marketPatch.entries.filter((e) => e.tradable).length > 0 &&
    res.marketPatch.entries.every((e) => {
      const c = res.cards.find((x) => x.card.id === e.cardId)!.card;
      return e.initialValue === instanceValue(c);
    }));
  check("nunca abre listados (solo entradas declarativas)", res.marketPatch.entries.every((e) => !("listingId" in e) && !("sellerId" in e)));

  // INCREMENTAL + IDEMPOTENCIA + DETERMINISMO
  console.log("\n## Incremental · idempotencia · determinismo");
  const known = res.cards.map((c) => c.fingerprint);
  const res2 = await materialize(gen, { ...mctx(), knownFingerprints: known });
  check("rebuild incremental: huellas conocidas ⇒ todo unchanged, patches vacíos",
    res2.unchanged.length === gen.cards.length && res2.cards.length === 0 && res2.catalogPatch.cardsAdd.length === 0 &&
    res2.packPatch.pools.length === 0 && res2.marketPatch.entries.length === 0);
  const runA = JSON.stringify(await materialize(gen, mctx()));
  const runB = JSON.stringify(await materialize(gen, mctx()));
  check("determinismo: misma entrada ⇒ mismo resultado (byte a byte, incl. huellas)", runA === runB);
  const skippedGen = generateCards(analysis, { ...gctx(), ledger: gen.ledgerAfter });
  const resSkip = await materialize(skippedGen, mctx());
  check("gen skipped ⇒ materialización vacía (idempotencia extremo a extremo)", resSkip.skipped && resSkip.cards.length === 0);

  // VERSIONADO + MIGRACIONES + NO DUP + CERO IMPOSIBLES
  console.log("\n## Versionado · migraciones · integridad");
  const roundtrip = JSON.parse(JSON.stringify(res)) as MaterializationResult;
  check("migración/roundtrip v1 íntegro", roundtrip.schemaVersion === 1 && roundtrip.cards.length === res.cards.length);
  check("sin cardIds duplicados en cards/patches", new Set(res.cards.map((c) => c.card.id)).size === res.cards.length &&
    new Set(cp.cardsAdd.map((c) => c.id)).size === cp.cardsAdd.length);
  const ser = JSON.stringify(res);
  check("sin instancias (uid/serial/obtainedAt) ni listados", !ser.includes('"uid"') && !ser.includes('"obtainedAt"') && !ser.includes('"listingId"'));
  check("todo finito y en rango", res.cards.every((c) => c.card.ovr >= 1 && c.card.ovr <= 99 && Object.values(c.card.stats).every(Number.isFinite)) &&
    res.marketPatch.entries.every((e) => Number.isFinite(e.initialValue) && e.initialValue >= 25));
  check("PROHIBIDO respetado: catálogo VIVO intacto tras materializar",
    totalCards() === cardsBefore && JSON.stringify(CARDS.slice(0, 5)) === catalogSnapshotBefore);

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
  const bigGen = generateCards(analyze(importSnapshot(bigSnapshot(30), ictx()).model), { roster: [], now: 1_700_000_000_000 });
  const t0 = process.hrtime.bigint();
  const bigRes = await materialize(bigGen, { roster: [], now: 1_700_000_000_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  check("torneo grande materializado (patches completos)", bigRes.cards.length === bigGen.cards.length && bigRes.catalogPatch.playersAdd.length > 0, `${bigRes.cards.length} cartas · ${Math.round(ms)} ms`);
  check("rendimiento aceptable (sin O(n²) patológico)", ms < 4000, `${Math.round(ms)} ms`);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
