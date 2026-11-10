/**
 * MATERIALIZER ENGINE (Fase 5) — orquestador: CardGenerationResult + MaterializerCtx →
 * MaterializationResult. Motor PURO: no escribe catálogo/Collection/stores, no abre sobres,
 * no crea listados ni assets. Incremental: huella SHA-256 por spec — los ya materializados
 * (knownFingerprints) quedan `unchanged` y NO entran en ningún patch. Determinista e
 * idempotente. Aquí termina la Fase 5: los patches los aplicará la Fase 6.
 */
import { IMPORTER_SCHEMA_VERSION } from "@/importer";
import { ANALYZER_RESULT_SCHEMA_VERSION } from "@/analyzer";
import { APP_VERSION } from "@/platform/version";
import { cardsForPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import type { CardGenerationResult, CardSpec } from "@/card-generator";
import {
  MATERIALIZER_SCHEMA_VERSION,
  type MaterializerCtx, type MaterializationResult, type MaterializedCard, type Provenance,
} from "./types";
import { fingerprintSpec, defaultDigest } from "./patches";
import { buildMaterializedCard } from "./card";
import { resolveUpserts } from "./identity";
import { buildCatalogPatch } from "./catalog";
import { buildCollectionPatch } from "./collections";
import { buildPackPatch } from "./packs";
import { buildCraftPatch } from "./craft";
import { buildMarketPatch } from "./market";

const provenanceOf = (gen: CardGenerationResult, at: number): Provenance => ({
  importerSchema: IMPORTER_SCHEMA_VERSION,
  analyzerSchema: ANALYZER_RESULT_SCHEMA_VERSION,
  generatorSchema: gen.schemaVersion,
  materializerSchema: MATERIALIZER_SCHEMA_VERSION,
  rulesetId: gen.ruleset.id,
  rulesetVersion: gen.ruleset.version,
  generationId: gen.generationId,
  appVersion: APP_VERSION,
  at,
});

const empty = (gen: CardGenerationResult, at: number, skipped: boolean): MaterializationResult => ({
  schemaVersion: MATERIALIZER_SCHEMA_VERSION,
  generationId: gen.generationId,
  provenance: provenanceOf(gen, at),
  cards: [],
  unchanged: [],
  catalogPatch: { playersAdd: [], playersUpdate: [], cardsAdd: [], cardsUpdate: [], cardsRemove: [], affectedPlayers: [], fullRebuild: false },
  collectionPatch: { add: [], update: [], season: gen.season, series: [] },
  packPatch: { pools: [], invalidate: [] },
  craftPatch: { links: [], upgradePaths: [] },
  marketPatch: { entries: [] },
  summary: { cards: 0, unchanged: 0, playersAdded: 0, playersUpdated: 0, catalogAdds: 0, catalogUpdates: 0, catalogRemovals: 0, poolEntries: 0, marketTradable: 0 },
  skipped,
});

export async function materialize(gen: CardGenerationResult, ctx: MaterializerCtx): Promise<MaterializationResult> {
  const at = ctx.now ?? gen.generatedAt;
  if (gen.skipped) return empty(gen, at, true);

  const digest = ctx.digest ?? defaultDigest;
  const known = new Set(ctx.knownFingerprints ?? []);

  // 1. Huellas: separa specs cambiados de los ya materializados (cache incremental).
  const changed: { spec: CardSpec; card: MaterializedCard }[] = [];
  const unchanged: string[] = [];
  for (const spec of gen.cards) {
    const fp = await fingerprintSpec(spec, digest);
    if (known.has(fp)) unchanged.push(spec.cardId);
    else changed.push({ spec, card: buildMaterializedCard(spec, fp) });
  }
  if (!changed.length && !gen.retired.length) {
    return { ...empty(gen, at, false), unchanged, summary: { ...empty(gen, at, false).summary, unchanged: unchanged.length } };
  }

  const changedSpecs = changed.map((c) => c.spec);
  const cards = changed.map((c) => c.card);
  const changedIds = new Set(cards.map((c) => c.card.id));
  const changedPlayerIds = new Set([
    ...cards.map((c) => c.card.playerId),
    ...gen.retired.map((r) => r.playerId),
  ]);

  // 2. Upserts de jugador (solo afectados) + catálogo actual inyectado (o derivado del roster).
  const upserts = resolveUpserts(gen, ctx.roster, changedPlayerIds);
  const existingCards: CardDef[] = ctx.existingCards ?? dedupCards(ctx.roster.flatMap((p) => cardsForPlayer(p)));

  // 3. Patches incrementales.
  const catalogPatch = buildCatalogPatch(gen, upserts, existingCards, changedPlayerIds);
  const collectionPatch = buildCollectionPatch(gen, cards, ctx.existingCollections ?? []);
  const packPatch = buildPackPatch(changedSpecs, cards, upserts.playerAfter);
  const craftPatch = buildCraftPatch(cards, upserts.playerAfter);
  const marketPatch = buildMarketPatch(changedSpecs, changedIds);

  return {
    schemaVersion: MATERIALIZER_SCHEMA_VERSION,
    generationId: gen.generationId,
    provenance: provenanceOf(gen, at),
    cards: cards.sort((a, b) => a.card.id.localeCompare(b.card.id)),
    unchanged: unchanged.sort(),
    catalogPatch, collectionPatch, packPatch, craftPatch, marketPatch,
    summary: {
      cards: cards.length,
      unchanged: unchanged.length,
      playersAdded: catalogPatch.playersAdd.length,
      playersUpdated: catalogPatch.playersUpdate.length,
      catalogAdds: catalogPatch.cardsAdd.length,
      catalogUpdates: catalogPatch.cardsUpdate.length,
      catalogRemovals: catalogPatch.cardsRemove.length,
      poolEntries: packPatch.pools.reduce((a, p) => a + p.add.length, 0),
      marketTradable: marketPatch.entries.filter((e) => e.tradable).length,
    },
    skipped: false,
  };
}

function dedupCards(cards: CardDef[]): CardDef[] {
  const seen = new Set<string>();
  const out: CardDef[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
