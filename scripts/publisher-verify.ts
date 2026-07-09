/**
 * VERIFICACIÓN DEL PUBLISHER (Card Generator Fase 7/7 — FINAL).
 *
 * Encadena el pipeline COMPLETO F1→F7 (import → analyze → generate → materialize → build →
 * publish) y comprueba: publish · rollback exacto · runtime refresh · singletons recreados ·
 * pack/craft/marketplace/search/news refresh · invalidación por huellas · idempotencia ·
 * transacción · RuntimeVersion · determinismo · auto-rollback ante fallo · rendimiento ·
 * cero estados imposibles. Este verify SÍ muta el catálogo vivo (es la fase de efectos) y lo
 * RESTAURA al terminar. Falla de verdad.
 */
import {
  importSnapshot, makeClock, createIdentityResolver, buildRegistry, type RawSnapshot, type ImportCtx,
} from "@/importer";
import { analyze, type TournamentFact } from "@/analyzer";
import { generateCards, type GeneratorCtx } from "@/card-generator";
import { materialize } from "@/materializer";
import { buildCatalog, type CatalogBuildResult } from "@/catalog-builder";
import {
  publish, rollback, resetRuntime, planInvalidation,
  runtimeRegistry, runtimePackEngine, runtimeCraftEngine, runtimeVersion, runtimeFingerprint,
  runtimeCollections, runtimeSearch, runtimeMarketEntries, runtimeNews, runtimeSnapshots,
} from "@/publisher";
import { CARDS, allPlayers, rebuildCatalog, totalCards, getCard } from "@/data/catalog";
import { buildPool } from "@/domain/packs/pool";
import { getPack } from "@/data/packs";
import type { Player } from "@/domain/cards/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const registry = buildRegistry([]);
const ictx = (): ImportCtx => ({ clock: makeClock(1_700_000_000_000), identity: createIdentityResolver(registry) });

/* ── Fixture (mismo Champions 2025 de F3-F6) ── */
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

async function buildFor(roster: Player[]): Promise<CatalogBuildResult> {
  const analysis = analyze(importSnapshot(fixture, ictx()).model, history);
  const gctx: GeneratorCtx = { roster, now: 1_700_000_000_000 };
  const gen = generateCards(analysis, gctx);
  const mat = await materialize(gen, { roster, now: 1_700_000_000_000 });
  return buildCatalog(mat, { roster, now: 1_700_000_000_000 });
}

async function main(): Promise<void> {
  console.log("# Verificación del Publisher — DRL Champions (Fase 7/7 FINAL)\n");

  // El runtime de esta verificación parte del catálogo semilla REAL y se restaura al final.
  const originalPlayers = allPlayers();
  const originalTotal = totalCards();
  resetRuntime();

  const roster = allPlayers(); // roster vigente (semilla) — zekken existe en el seed real
  const build = await buildFor(roster);

  // RUNTIME PRE-PUBLICACIÓN (engines siguen el catálogo vivo desde ya)
  console.log("## Runtime pre-publicación (bug de singletons resuelto en frío)");
  const regBefore = runtimeRegistry();
  check("engines ligados al catálogo vivo actual", runtimePackEngine().registry === regBefore && regBefore.total === originalTotal);
  rebuildCatalog(originalPlayers); // reasigna CARDS (simula un import del admin)
  check("rebuildCatalog externo ⇒ engines se RECREAN solos (sin publish)", runtimeRegistry() !== regBefore && runtimePackEngine().registry === runtimeRegistry());

  // PUBLISH
  console.log("\n## Publish (transacción)");
  const t0 = process.hrtime.bigint();
  const pub = publish(build, { now: 1_700_000_000_000 });
  const pubMs = Number(process.hrtime.bigint() - t0) / 1e6;
  check("publicación COMPLETED y aplicada", pub.ok && pub.applied && pub.transaction.finalState === "COMPLETED");
  check("ciclo de estados PREPARING→VALIDATING→PUBLISHING→COMPLETED",
    JSON.stringify(pub.transaction.states.map((s) => s.state)) === JSON.stringify(["PREPARING", "VALIDATING", "PUBLISHING", "COMPLETED"]));
  check("RuntimeVersion (separada de CatalogVersion) avanzó a 1", pub.runtimeVersion === 1 && runtimeVersion() === 1 && pub.catalogVersion === build.catalogVersion);
  check("catálogo VIVO actualizado (cartas nuevas accesibles)", totalCards() === build.catalog.cards.length && !!getCard("zekken__mythic"));
  check("validación de runtime OK", pub.validation.ok, `${pub.validation.issues.length} issues`);

  // SINGLETON / RUNTIME REFRESH
  console.log("\n## Runtime refresh (fin del singleton congelado)");
  const reg = runtimeRegistry();
  check("CardRegistry recreado sobre el catálogo publicado", reg.cards === CARDS && reg.total === build.catalog.cards.length && reg.has("zekken__mythic"));
  check("PackEngine/CraftEngine SIN referencias antiguas", runtimePackEngine().registry === reg && runtimeCraftEngine().registry === reg);
  check("pools de packs reflejan las cartas nuevas (buildPool real)", build.packs.pools.every((p) => buildPool(reg, getPack(p.packId)!).size === p.size));

  // SECCIONES
  console.log("\n## Secciones publicadas");
  check("colecciones en runtime", runtimeCollections().some((c) => c.id === "col-champions-2025"));
  check("búsqueda en runtime (filas de la build)", runtimeSearch().rows.length === build.search.rows.length);
  check("mercado en runtime (mythic restringida)", runtimeMarketEntries().some((e) => e.cardId === "zekken__mythic" && !e.tradable));
  check("noticias estructuradas publicadas (dedupe por id)", runtimeNews().length === build.news.length && pub.metrics.newsPublished === build.news.length);

  // MÉTRICAS
  console.log("\n## Métricas");
  check("métricas completas (cartas/huellas/hashes/versión/tiempo)",
    pub.metrics.newCards === build.diff.added.length && pub.metrics.catalogFingerprint === build.catalogFingerprint &&
    pub.metrics.sectionHashes === 10 && pub.metrics.materializationFingerprints > 0 && Number.isFinite(pub.metrics.durationMs),
    `${pub.metrics.newCards} nuevas · ${Math.round(pubMs)} ms`);

  // IDEMPOTENCIA + CACHE
  console.log("\n## Idempotencia · invalidación por huella");
  const again = publish(build, { now: 1_700_000_000_000 });
  check("re-publicar la MISMA build ⇒ no-op idempotente (fingerprint)", again.ok && !again.applied && again.transaction.finalState === "COMPLETED" && runtimeVersion() === 1);
  check("planInvalidation detecta build ya publicada", planInvalidation(build).alreadyPublished);
  check("runtime fingerprint = CatalogFingerprint publicado", runtimeFingerprint() === build.catalogFingerprint);

  // ROLLBACK
  console.log("\n## Rollback (exacto, sin reconstrucción manual)");
  const preRollbackTotal = totalCards();
  const rb = rollback({ generationId: build.generationId }, { now: 1_700_000_000_001 });
  check("rollback a la generación publicada ⇒ ROLLED_BACK ok", rb.ok && rb.transaction.finalState === "ROLLED_BACK" && rb.transaction.kind === "rollback");
  check("estado restaurado EXACTO (catálogo + fingerprint + versión runtime avanzada)",
    totalCards() === preRollbackTotal && runtimeFingerprint() === build.catalogFingerprint && runtimeVersion() === 2);
  check("engines recreados tras rollback", runtimePackEngine().registry === runtimeRegistry());
  check("rollback por CatalogFingerprint también resuelve", rollback({ catalogFingerprint: build.catalogFingerprint }, { now: 1_700_000_000_002 }).ok);
  check("rollback a objetivo inexistente ⇒ FAILED sin tocar nada", !rollback({ generationId: "GEN-NO-EXISTE" }).ok && totalCards() === preRollbackTotal);
  check("historial de instantáneas disponible", runtimeSnapshots().length >= 1 && runtimeSnapshots()[0].manifest?.generationId === build.generationId);

  // AUTO-ROLLBACK ANTE FALLO
  console.log("\n## Auto-rollback ante build corrupta");
  resetRuntime();
  rebuildCatalog(originalPlayers);
  const good = publish(build, { now: 1_700_000_000_000 });
  const corrupt: CatalogBuildResult = JSON.parse(JSON.stringify(await buildFor(allPlayers())));
  corrupt.validation.ok = false;
  corrupt.validation.issues.push({ severity: "error", section: "catalog", message: "corrupción plantada" });
  const failed = publish(corrupt, { now: 1_700_000_000_003 });
  check("build inválida ⇒ FAILED sin aplicar", good.ok && !failed.ok && failed.transaction.finalState === "FAILED" && !failed.applied);
  const corrupt2: CatalogBuildResult = JSON.parse(JSON.stringify(await buildFor(originalPlayers)));
  corrupt2.catalogFingerprint = "f".repeat(64); // esquiva el no-op idempotente
  corrupt2.manifest.catalogFingerprint = corrupt2.catalogFingerprint;
  corrupt2.manifest.materializationFingerprints = ["0".repeat(64)];
  corrupt2.diff.added = [...corrupt2.diff.added, "fantasma__gold"]; // el registry no podrá indexarla ⇒ fallo EN runtime
  const auto = publish(corrupt2, { now: 1_700_000_000_004 });
  check("fallo a MITAD de publicación ⇒ auto-rollback al estado previo",
    !auto.ok && auto.transaction.finalState === "ROLLED_BACK" && !!auto.rolledBackTo && runtimeFingerprint() === build.catalogFingerprint);

  // DETERMINISMO
  console.log("\n## Determinismo");
  resetRuntime(); rebuildCatalog(originalPlayers);
  const r1 = publish(await buildFor(allPlayers()), { now: 1_700_000_000_000 });
  resetRuntime(); rebuildCatalog(originalPlayers);
  const r2 = publish(await buildFor(allPlayers()), { now: 1_700_000_000_000 });
  const strip = (r: typeof r1): string => JSON.stringify({ ...r, metrics: { ...r.metrics, durationMs: 0 } });
  check("misma build + mismo estado ⇒ mismo PublishResult (sin el tiempo real)", strip(r1) === strip(r2));

  // BUILD SKIPPED
  console.log("\n## Passthrough");
  const skippedBuild: CatalogBuildResult = { ...(await buildFor(allPlayers())), skipped: true };
  const skipRes = publish(skippedBuild, { now: 1_700_000_000_005 });
  check("build skipped ⇒ COMPLETED sin aplicar", skipRes.ok && !skipRes.applied);

  // RENDIMIENTO + CERO IMPOSIBLES
  console.log("\n## Rendimiento · integridad");
  check("publicación en tiempo razonable", pubMs < 4000, `${Math.round(pubMs)} ms`);
  const ser = JSON.stringify(r1);
  check("PublishResult serializable, sin instancias/listados", JSON.parse(ser).schemaVersion === 1 && !ser.includes('"uid"') && !ser.includes('"listingId"'));
  check("estados de transacción válidos siempre", [r1, again, rb, failed, auto, skipRes].every((r) =>
    ["PREPARING", "VALIDATING", "PUBLISHING", "COMPLETED", "ROLLED_BACK", "FAILED"].includes(r.transaction.finalState)));

  // RESTAURACIÓN FINAL (higiene: el verify deja el catálogo semilla intacto)
  resetRuntime();
  rebuildCatalog(originalPlayers);
  check("catálogo semilla restaurado al terminar", totalCards() === originalTotal);

  console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
