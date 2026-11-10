/**
 * VERIFICACIÓN DEL CATALOG BUILDER (Card Generator Fase 6/7).
 *
 * Encadena el pipeline REAL F1→F6 (import → analyze → generate → materialize → build) y
 * comprueba: catálogo · índices · colecciones · packs · craft · mercado · búsqueda ·
 * noticias · manifiesto · estadísticas · diff · fingerprint · versión · GenerationId ·
 * determinismo · idempotencia · rebuild incremental · rendimiento · compat F4/F5/Collection/
 * Packs/Craft/Marketplace/Search · cero estados imposibles. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze, type TournamentFact } from "@/analyzer";
import { generateCards, type GeneratorCtx } from "@/card-generator";
import { materialize, type MaterializationResult } from "@/materializer";
import { buildCatalog, nextCatalogVersion, type CatalogBuildResult, type CatalogBuilderCtx } from "@/catalog-builder";
import { cardsForPlayer, CARDS, totalCards } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { CardRegistry } from "@/collection/registry";
import { buildPool } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import { RECIPE_BY_ID, RECIPES } from "@/data/recipes";
import { MIN_ROUNDS } from "@/domain/cards/combat";
import type { Player } from "@/domain/cards/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ictx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

/* ── Fixture (mismo Champions 2025 de F3/F4/F5) ── */
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

/*
 * `metrics` es OBLIGATORIO para que un jugador del roster genere cartas: `cardsForPlayer`
 * devuelve [] sin métricas reales (`rounds >= MIN_ROUNDS`) ni autoría `editorial` («cero
 * estadísticas por defecto»). Sin ellas el pipeline F1→F6 llegaba aquí con cero cartas y el
 * catálogo construido quedaba vacío. Son métricas de FIXTURE: no tocan el catálogo del producto.
 */
const seedMetrics = (i = 0): Player["metrics"] => ({
  rounds: 4 * MIN_ROUNDS + i, kills: 300 + 4 * i, deaths: 250 + 2 * i, assists: 90 + 3 * i,
  fk: 55 + i, fd: 40 + i, acs: 210 + 4 * i, adr: 145 + 2 * i,
  kd: 1.2 - i * 0.02, kast: 72 + i, hsPct: 24 + i, clutches: 6 + (i % 4),
});

const seedPlayer = (id: string, nick: string, extra: Partial<Player> = {}): Player => ({
  id, nick, team: "Sentinels", teamTag: "SEN", region: "Americas", role: "Duelista", country: "us",
  stats: { dmg: 80, scr: 82, com: 78, hs: 75, ast: 70, clu: 72 }, accolades: ["champions"],
  image: `/players/${id}.png`, metrics: seedMetrics(), ...extra,
});
const ROSTER: Player[] = [seedPlayer("zekken", "zekken")];
const gctx = (): GeneratorCtx => ({ roster: ROSTER, now: 1_700_000_000_000 });
const bctx = (): CatalogBuilderCtx => ({ roster: ROSTER, now: 1_700_000_000_000 });

async function main(): Promise<void> {
  console.log("# Verificación del Catalog Builder — DRL Champions (Fase 6/7)\n");

  const cardsBefore = totalCards();
  const liveSnapshot = JSON.stringify(CARDS.slice(0, 5));

  const analysis = analyze(importSnapshot(fixture, ictx()).model, history);
  const gen = generateCards(analysis, gctx());
  const mat: MaterializationResult = await materialize(gen, { roster: ROSTER, now: 1_700_000_000_000 });
  const res: CatalogBuildResult = await buildCatalog(mat, bctx());

  // CATALOG + COMPAT MATERIALIZER/CARD GENERATOR
  console.log("## Catálogo (compat Materializer/Card Generator)");
  const baseCount = ROSTER.flatMap((p) => cardsForPlayer(p)).length;
  check("catálogo lógico = snapshot + patch aplicado", res.catalog.cards.length === baseCount + mat.catalogPatch.cardsAdd.length &&
    res.catalog.players.length === ROSTER.length + mat.catalogPatch.playersAdd.length);
  check("GenerationId propagado F4→F5→F6", res.generationId === gen.generationId && res.manifest.generationId === "GEN-2025-CHAMPIONS-2025");
  check("cartas del patch presentes byte a byte", mat.catalogPatch.cardsAdd.every((a) => {
    const c = res.catalog.cards.find((x) => x.id === a.id);
    return !!c && c.ovr === a.ovr && JSON.stringify(c.stats) === JSON.stringify(a.stats);
  }));
  check("incremental: cartas preexistentes intactas (no recomputadas)", ROSTER.flatMap((p) => cardsForPlayer(p)).every((c) =>
    res.catalog.cards.some((x) => x.id === c.id && x.ovr === c.ovr)));

  // ÍNDICES (compat Collection)
  console.log("\n## Índices");
  check("byPlayer/byVariant/byGroup/byRegion completos", Object.values(res.indexes.byPlayer).flat().length === res.catalog.cards.length &&
    res.indexes.byPlayer["zekken"]?.includes("zekken__mythic") && (res.indexes.byVariant["mythic"]?.length ?? 0) > 0);
  check("byRarity por bucket de rank", res.indexes.byRarity.legendary.includes("zekken__mythic"));
  check("bySeason/byFamily con procedencia de la generación", res.indexes.bySeason["2025"]?.includes("zekken__mythic") &&
    res.indexes.byFamily["tournament-mvp"]?.includes("zekken__mythic"));
  check("byPack/byMarket/byCraft desde los patches", Object.keys(res.indexes.byPack).length === mat.packPatch.pools.length &&
    res.indexes.byMarket.restricted.includes("zekken__mythic") && (res.indexes.byCraft["dismantle-card"]?.length ?? 0) > 0);
  check("sets del CardRegistry reutilizados (grupos/regiones/series)", res.indexes.sets.some((s) => s.id === "series-champions") &&
    res.indexes.sets.every((s) => s.cardIds.every((id) => res.catalog.cards.some((c) => c.id === id))));

  // COLECCIONES
  console.log("\n## Colecciones");
  check("colección del torneo aplicada con álbum y totales", res.collections.collections.some((c) => c.id === "col-champions-2025") &&
    res.collections.completion.some((c) => c.collectionId === "col-champions-2025" && c.total === mat.cards.length) &&
    res.collections.album.some((a) => a.collectionId === "col-champions-2025" && a.cardIds.length === mat.cards.length));
  check("museo = cartas serializadas del catálogo", res.collections.museum.includes("zekken__mythic") &&
    res.collections.museum.every((id) => getVariant(res.catalog.cards.find((c) => c.id === id)!.variantId).serialized));
  check("series de la generación", Object.keys(res.collections.series).length > 0);
  const resInc = await buildCatalog(mat, { ...bctx(), existingCollections: res.collections.collections });
  check("incremental: colecciones existentes no se duplican", resInc.collections.collections.length === res.collections.collections.length);

  // PACKS (compat Packs)
  console.log("\n## Packs");
  check("solo packs afectados (incremental)", res.packs.pools.length === mat.packPatch.pools.length && res.packs.pools.length > 0);
  check("drop tables = buildPool REAL sobre el registry nuevo", res.packs.pools.every((p) => {
    const reg = new CardRegistry(res.catalog.cards, (id) => res.catalog.players.find((x) => x.id === id));
    const built = buildPool(reg, getPack(p.packId)!);
    return built.size === p.size;
  }));
  check("odds normalizadas entre buckets no vacíos (Σ=1)", res.packs.pools.every((p) => Math.abs(Object.values(p.odds).reduce((a, b) => a + b, 0) - 1) < 0.001));
  check("invalidate propagado del PackPatch", JSON.stringify(res.packs.invalidated) === JSON.stringify([...mat.packPatch.invalidate].sort()));

  // CRAFT (compat Craft)
  console.log("\n## Craft");
  check("recetas = catálogo de datos (jamás se crean)", res.craft.recipes.length === RECIPES.length && res.craft.recipes.every((r) => RECIPE_BY_ID.has(r)));
  check("grafos separados: upgrade (upgrade/fusion) vs evolución (grupo)", res.craft.upgradeGraph.every((p) => ["upgrade-next", "fuse-triple"].includes(p.via)) &&
    res.craft.evolutionGraph.every((p) => ["evolve-international", "promote-exclusive"].includes(p.via)));
  check("dependencias económicas de referencia (sin recalcular)", res.craft.dependencies.length === RECIPES.length &&
    res.craft.dependencies.find((d) => d.recipeId === "upgrade-next")?.credits === 500);

  // MARKETPLACE (compat Marketplace)
  console.log("\n## Marketplace");
  check("registro con elegibles/restringidas", res.marketplace.entries.length === mat.marketPatch.entries.length &&
    res.marketplace.eligible + res.marketplace.restricted === res.marketplace.entries.length);
  check("mythic restringida; sin listados", res.marketplace.entries.find((e) => e.cardId === "zekken__mythic")?.tradable === false &&
    !JSON.stringify(res.marketplace).includes('"listingId"'));

  // SEARCH (compat Search)
  console.log("\n## Búsqueda");
  check("filas de carta del CardRegistry + tags editoriales", res.search.rows.some((r) => r.kind === "card" && r.ref === "zekken__mythic" && r.hay.includes("back-to-back-champion")));
  check("entradas player/team/collection/variant", ["player", "team", "collection", "variant"].every((k) => res.search.rows.some((r) => r.kind === k)));
  check("todas las filas de carta resuelven", res.search.rows.filter((r) => r.kind === "card").length === res.catalog.cards.length);

  // NEWS
  console.log("\n## Noticias (estructuradas)");
  check("noticia agregada de altas con conteo real", res.news.some((n) => n.id === `news:catalog:add:${gen.generationId.toLowerCase()}` && n.title.includes(`${res.diff.added.length} cartas`)));
  /*
   * ANTES exigía SIEMPRE la noticia «jugadores nuevos». `news.ts` solo la emite si
   * `catalogPatch.playersAdd` no está vacío, y con el contrato actual los borradores no generan
   * cartas ni se dan de alta: no hay jugadores nuevos, así que no hay noticia — y es correcto,
   * publicar «0 jugadores nuevos» sería ruido.
   *
   * Se mantiene la de colección (sigue siendo obligatoria) y la de jugadores pasa a comprobarse
   * como la condición que realmente es: existe SI Y SOLO SI hay altas. Así se sigue cubriendo el
   * cableado en ambos sentidos en vez de borrar la comprobación.
   */
  check("noticia de colección siempre; la de jugadores nuevos si y solo si hay altas",
    res.news.some((n) => n.id.includes("catalog:collection"))
    && res.news.some((n) => n.id.includes("catalog:players")) === (mat.catalogPatch.playersAdd.length > 0));
  check("ids deterministas (derivados del GenerationId)", res.news.every((n) => n.id.startsWith("news:catalog:")));

  // MANIFEST + VERSION + FINGERPRINT
  console.log("\n## Manifiesto · CatalogVersion · CatalogFingerprint");
  check("versión semántica inicial <temporada>.1.0", res.catalogVersion === "2025.1.0");
  check("bump: estructural ⇒ minor; metadatos ⇒ patch; temporada nueva ⇒ reset",
    nextCatalogVersion("2025.1.0", 2025, res.diff) === "2025.2.0" &&
    nextCatalogVersion("2025.3.0", 2025, { added: [], updated: [], removed: [], moved: [], retired: [], changed: ["x"] }) === "2025.3.1" &&
    nextCatalogVersion("2025.9.4", 2026, res.diff) === "2026.1.0");
  check("CatalogFingerprint sha256 (64 hex) + hashes por sección", /^[0-9a-f]{64}$/.test(res.catalogFingerprint) &&
    Object.keys(res.manifest.hashes).length === 10 && Object.values(res.manifest.hashes).every((h) => /^[0-9a-f]{64}$/.test(h)));
  check("manifiesto: counts + huellas de materialización + dependencias", res.manifest.counts.cards === res.catalog.cards.length &&
    res.manifest.materializationFingerprints.length === mat.cards.length &&
    res.manifest.dependencies.catalogBuilderSchema === 1 && res.manifest.dependencies.appVersion.length > 0);

  // STATS + DIFF
  console.log("\n## Estadísticas · Diff");
  check("stats coherentes con los artefactos", res.stats.totalCards === res.catalog.cards.length && res.stats.newCards === res.diff.added.length &&
    res.stats.searchEntries === res.search.rows.length && res.stats.generation.generationId === gen.generationId);
  check("diff: added = patch, sin removed/retired en este fixture", res.diff.added.length === mat.catalogPatch.cardsAdd.length &&
    res.diff.removed.length === 0 && res.diff.retired.length === 0);

  // VALIDACIÓN
  console.log("\n## Validación (cero estados imposibles)");
  check("build válida (0 errores)", res.validation.ok, `${res.validation.issues.length} issues`);
  const corrupt: MaterializationResult = JSON.parse(JSON.stringify(mat));
  corrupt.packPatch.pools.push({ packId: "estandar", add: [{ cardId: "fantasma__gold", bucket: "common" }] });
  const badRes = await buildCatalog(corrupt, bctx());
  check("corrupción plantada detectada (alta de pool inexistente ⇒ error)", !badRes.validation.ok &&
    badRes.validation.issues.some((i) => i.severity === "error" && i.section === "packs"));

  // DETERMINISMO + IDEMPOTENCIA + INCREMENTAL
  console.log("\n## Determinismo · idempotencia · incremental");
  const runA = JSON.stringify(await buildCatalog(mat, bctx()));
  const runB = JSON.stringify(await buildCatalog(mat, bctx()));
  check("misma entrada ⇒ misma build (byte a byte, incl. fingerprint)", runA === runB);
  const matUnchanged = await materialize(gen, { roster: ROSTER, now: 1_700_000_000_000, knownFingerprints: mat.cards.map((c) => c.fingerprint) });
  const resUnchanged = await buildCatalog(matUnchanged, { ...bctx(), previousVersion: res.catalogVersion });
  check("rebuild incremental: todo unchanged ⇒ catálogo base intacto, diff vacío, bump patch",
    resUnchanged.unchanged.length === mat.cards.length && resUnchanged.diff.added.length === 0 &&
    resUnchanged.catalog.cards.length === baseCount && resUnchanged.catalogVersion === "2025.1.1");
  check("gen skipped ⇒ build passthrough sin cambios", (await buildCatalog(await materialize(generateCards(analysis, { ...gctx(), ledger: gen.ledgerAfter }), { roster: ROSTER, now: 1_700_000_000_000 }), bctx())).skipped);

  // PROHIBICIONES + INTEGRIDAD
  console.log("\n## Prohibiciones · integridad");
  check("catálogo VIVO intacto (nada escrito/publicado)", totalCards() === cardsBefore && JSON.stringify(CARDS.slice(0, 5)) === liveSnapshot);
  const ser = JSON.stringify(res);
  check("sin instancias/listados/paths de disco", !ser.includes('"uid"') && !ser.includes('"listingId"') && !ser.includes("C:\\\\"));
  check("resultado 100% serializable y re-parseable", (JSON.parse(ser) as CatalogBuildResult).catalogFingerprint === res.catalogFingerprint);

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
  /*
   * ANTES: `roster: []`. Los 150 eran borradores, no generaban ninguna carta, y la comprobación
   * de abajo comparaba `0 === 0`: pasaba EN VACÍO. Se le da su catálogo para que vuelva a medir
   * construir a escala, y la aserción exige además que haya cartas.
   */
  const bigRoster: Player[] = Array.from({ length: 30 }, (_, ti) =>
    Array.from({ length: 5 }, (_, pi) => seedPlayer(`p${ti}_${pi}`, `p${ti}_${pi}`, {
      team: `Team ${ti}`, teamTag: `T${ti}`, accolades: [], metrics: seedMetrics(ti + pi),
    })),
  ).flat();
  const bigGen = generateCards(analyze(importSnapshot(bigSnapshot(30), ictx()).model), { roster: bigRoster, now: 1_700_000_000_000 });
  const bigMat = await materialize(bigGen, { roster: bigRoster, now: 1_700_000_000_000 });
  const t0 = process.hrtime.bigint();
  const bigRes = await buildCatalog(bigMat, { roster: bigRoster, now: 1_700_000_000_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  /*
   * La igualdad anterior (`catalog.cards.length === catalogPatch.cardsAdd.length`) solo se
   * cumplía con el roster vacío, comparando 0 con 0. Con catálogo real el construido son las
   * cartas de los 150 del roster MÁS las nuevas, así que la igualdad es falsa por diseño.
   * Lo que sí debe cumplirse —y es lo que la comprobación quería decir— es que TODA carta
   * añadida por el patch esté en el catálogo construido, y que este valide.
   */
  check("torneo grande construido y válido",
    bigRes.validation.ok && bigRes.catalog.cards.length > 0 && bigMat.catalogPatch.cardsAdd.length > 0
    && bigMat.catalogPatch.cardsAdd.every((a) => bigRes.catalog.cards.some((c) => c.id === a.id)),
    `${bigRes.catalog.cards.length} cartas (${bigMat.catalogPatch.cardsAdd.length} nuevas) · ${Math.round(ms)} ms`);
  check("rendimiento aceptable (sin O(n²) patológico)", ms < 4000, `${Math.round(ms)} ms`);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
