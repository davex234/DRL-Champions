/**
 * RUNTIME HOST (Fase 7) — el estado de runtime CONTROLADO del publisher y la resolución
 * DEFINITIVA del bug de los singletones congelados: los engines se recrean automáticamente
 * cuando cambia la IDENTIDAD del catálogo vivo (`rebuildCatalog` reasigna `CARDS`, un live
 * binding), de modo que NINGÚN consumidor puede quedarse apuntando a un catálogo antiguo —
 * ni tras publish/rollback ni tras imports del admin (useRosterStore.sync).
 */
import { CARDS, allPlayers } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import { PackEngine } from "@/pack";
import { CraftEngine } from "@/craft";
import type { CardDef } from "@/domain/cards/types";
import type { CollectionDef } from "@/domain/collections/types";
import type { NewsItem } from "@/intel/news";
import type { MarketEntry } from "@/materializer";
import type { SearchArtifact, CatalogFingerprint, CatalogVersion } from "@/catalog-builder";
import type { RuntimeSnapshot, RuntimeVersion } from "./types";

interface EngineHost {
  cardsRef: CardDef[]; // identidad del catálogo vivo con el que se construyeron los engines
  registry: CardRegistry;
  packEngine: PackEngine;
  craftEngine: CraftEngine;
}

interface PublisherRuntime {
  engines: EngineHost | null;
  runtimeVersion: RuntimeVersion;
  catalogVersion: CatalogVersion;
  catalogFingerprint: CatalogFingerprint;
  generationId: string;
  collections: CollectionDef[];
  search: SearchArtifact;
  marketEntries: Map<string, MarketEntry>;
  news: NewsItem[];
  /** Historial de instantáneas publicadas (rollback exacto). */
  snapshots: RuntimeSnapshot[];
  materializationFingerprints: Set<string>;
  generationIds: Set<string>;
}

const fresh = (): PublisherRuntime => ({
  engines: null,
  runtimeVersion: 0,
  catalogVersion: "0.0.0",
  catalogFingerprint: "",
  generationId: "",
  collections: [],
  search: { rows: [] },
  marketEntries: new Map(),
  news: [],
  snapshots: [],
  materializationFingerprints: new Set(),
  generationIds: new Set(),
});

let runtime: PublisherRuntime = fresh();

/** Engines SIEMPRE ligados al catálogo vigente (recreación automática si `CARDS` cambió). */
function ensureEngines(): EngineHost {
  if (!runtime.engines || runtime.engines.cardsRef !== CARDS) {
    const registry = new CardRegistry(); // snapshot del catálogo vivo ACTUAL
    runtime.engines = {
      cardsRef: CARDS,
      registry,
      packEngine: new PackEngine(registry),
      craftEngine: new CraftEngine(registry),
    };
  }
  return runtime.engines;
}

/** Registro vigente (se recrea solo si el catálogo vivo cambió). */
export const runtimeRegistry = (): CardRegistry => ensureEngines().registry;
/** Pack Engine vigente — sustituye al singleton congelado de useGameStore. */
export const runtimePackEngine = (): PackEngine => ensureEngines().packEngine;
/** Craft Engine vigente — ídem. */
export const runtimeCraftEngine = (): CraftEngine => ensureEngines().craftEngine;

export const runtimeVersion = (): RuntimeVersion => runtime.runtimeVersion;
export const runtimeFingerprint = (): CatalogFingerprint => runtime.catalogFingerprint;
export const runtimeGenerationId = (): string => runtime.generationId;
export const runtimeCollections = (): CollectionDef[] => runtime.collections;
export const runtimeSearch = (): SearchArtifact => runtime.search;
export const runtimeMarketEntries = (): MarketEntry[] => [...runtime.marketEntries.values()];
export const runtimeNews = (): NewsItem[] => runtime.news;
export const runtimeSnapshots = (): RuntimeSnapshot[] => runtime.snapshots;
export const knownMaterializationFingerprints = (): Set<string> => runtime.materializationFingerprints;
export const knownGenerationIds = (): Set<string> => runtime.generationIds;

/** Mutadores internos del publisher (SOLO los usan engine/rollback/appliers de este módulo). */
export const internal = {
  state: (): PublisherRuntime => runtime,
  bumpVersion(): RuntimeVersion { return ++runtime.runtimeVersion; },
  setPublished(v: { catalogVersion: CatalogVersion; catalogFingerprint: CatalogFingerprint; generationId: string }): void {
    runtime.catalogVersion = v.catalogVersion;
    runtime.catalogFingerprint = v.catalogFingerprint;
    runtime.generationId = v.generationId;
  },
  invalidateEngines(): void { runtime.engines = null; },
  pushSnapshot(s: RuntimeSnapshot): void { runtime.snapshots.push(s); },
};

/** Instantánea del estado ACTUAL (catálogo vivo + secciones del runtime). */
export function captureSnapshot(): RuntimeSnapshot {
  return {
    runtimeVersion: runtime.runtimeVersion,
    catalogVersion: runtime.catalogVersion,
    catalogFingerprint: runtime.catalogFingerprint,
    generationId: runtime.generationId,
    players: allPlayers(),
    cards: [...CARDS],
    collections: [...runtime.collections],
    search: { rows: [...runtime.search.rows] },
    marketEntries: [...runtime.marketEntries.values()],
    news: [...runtime.news],
  };
}

/** Reinicio total (tests/verify). NO restaura el catálogo vivo: eso es rollback/rebuild. */
export function resetRuntime(): void {
  runtime = fresh();
}
