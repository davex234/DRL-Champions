/**
 * CARD GENERATOR ENGINE (Fase 4) — orquestador: AnalyzerResult + GeneratorCtx →
 * CardGenerationResult. Motor PURO y determinista: sin efectos secundarios, sin stores, sin
 * catálogo vivo, sin Date.now/Math.random. Aquí TERMINA el Card Generator: decide qué cartas
 * existen; la materialización (accolades → rebuildCatalog) es de la Fase 5.
 */
import { tournamentType } from "@/analyzer";
import type { AnalyzerResult } from "@/analyzer";
import type { Tournament } from "@/importer";
import type { TournamentType } from "@/engine/types";
import type { Player, VariantId } from "@/domain/cards/types";
import { abilityLabels } from "@/intel/abilities";
import { buildCardNews, type NewsItem } from "@/intel/news";
import { rarityFor, type PlayerHistory } from "@/intel/decide";
import { APP_VERSION, BUILD_NUMBER, FULL_VERSION } from "@/platform/version";
import {
  CARD_GENERATOR_SCHEMA_VERSION, freshLedger,
  type CardGenerationResult, type CardSpec, type GeneratorCtx, type GeneratorLedger,
  type OmittedCard, type PlayerResolution, type RetiredCard, type EditorialOverride,
} from "./types";
import { resolvePlayers } from "./identity";
import { DEFAULT_RULESET } from "./ruleset";
import { evaluateRules } from "./rules";
import { applyGrantOverrides, decideLifecycle, confidenceOf, releaseStateOf } from "./editorial";
import { predictCatalog, newVariantsFor, buildSpecCore } from "./specs";
import { simRegistry, buildEligibility } from "./eligibility";
import { resolveArtwork } from "./artwork";
import { buildCollection } from "./collection";

/** Año del nombre del torneo ("Champions 2025" → 2025) como fallback de temporada. */
const yearFromName = (name: string): number => {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : 0;
};

/** GenerationId único (GEN-<temporada>-<TORNEO>) — jamás se reutiliza (sufijo determinista). */
export function makeGenerationId(season: number, name: string, used: string[]): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = `GEN-${season}-${slug || "TOURNAMENT"}`;
  if (!used.includes(base)) return base;
  let n = 2;
  while (used.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

const emptySummary = () => ({
  players: { resolved: 0, created: 0, ambiguous: 0 },
  grants: 0, badges: 0, cards: 0, byDecision: {}, omitted: 0, approved: 0, pending: 0, drafts: 0, estimatedValueTotal: 0,
});

export function generateCards(analysis: AnalyzerResult, ctx: GeneratorCtx): CardGenerationResult {
  const ledger = ctx.ledger ?? freshLedger();
  const name = analysis.report.name;
  const season = ctx.season ?? yearFromName(name);
  const now = ctx.now ?? 0;

  const base = {
    schemaVersion: CARD_GENERATOR_SCHEMA_VERSION,
    tournamentId: analysis.tournamentId,
    tournamentName: name,
    season,
    generatedAt: now,
    ruleset: { id: (ctx.ruleset ?? DEFAULT_RULESET).id, version: (ctx.ruleset ?? DEFAULT_RULESET).version },
    generator: { version: APP_VERSION, build: BUILD_NUMBER, full: FULL_VERSION },
  };

  // Anti-reproceso: torneo ya generado ⇒ resultado vacío idempotente (ledger intacto).
  if (ledger.processed.includes(analysis.tournamentId)) {
    return {
      ...base, generationId: "", players: [], grants: [], badges: [], cards: [], omitted: [], retired: [],
      collection: buildCollection({ tournamentId: analysis.tournamentId, tournamentName: name, specs: [], nickOf: () => undefined }),
      news: [], overridesApplied: [], summary: emptySummary(), ledgerAfter: ledger, skipped: true,
    };
  }

  const ruleset = ctx.ruleset ?? DEFAULT_RULESET;
  const ttype: TournamentType = ctx.tournamentType
    ?? tournamentType({ id: analysis.tournamentId, name, type: "", status: analysis.report.status } as Tournament);

  // 1. Identidad.
  const resolutions = resolvePlayers(analysis, ctx);
  const byAnalyzer = new Map(resolutions.map((r) => [r.analyzerId, r]));
  const playerOf = new Map<string, Player>();
  for (const r of resolutions) {
    if (r.status === "created" && r.draft) playerOf.set(r.playerId!, r.draft);
  }
  for (const p of ctx.roster) playerOf.set(p.id, p);

  // 2. Reglas (datos) → grants/badges/retires con evidencia.
  const evaluation = evaluateRules(analysis, ruleset, ttype);

  // 3. Overrides sobre grants (set-mvp / grant-accolade / retire-card) — trazados.
  const overrides = ctx.overrides ?? [];
  const grantsStage = applyGrantOverrides(evaluation.grants, overrides, resolutions);

  // 4. Ciclo de vida (decideCard reutilizado) + anti-dup por (jugador, familia, temporada).
  const lifecycle = decideLifecycle(grantsStage.grants, analysis, resolutions, ledger, season);
  const omitted: OmittedCard[] = [...lifecycle.omitted];
  const retired: RetiredCard[] = [
    ...grantsStage.retires,
    ...evaluation.retires.map((r) => {
      const catalogId = byAnalyzer.get(r.playerId)?.playerId ?? r.playerId;
      return { playerId: catalogId, reason: `${r.ruleId}: ${r.evidence}` };
    }),
  ];

  // Traducción de grants a ids de catálogo (los ambiguos ya quedaron fuera del lifecycle).
  const grants = grantsStage.grants
    .map((g) => ({ ...g, catalogId: byAnalyzer.get(g.playerId)?.playerId }))
    .filter((g): g is typeof g & { catalogId: string } => !!g.catalogId);

  // Badges por jugador (los de equipo se proyectan a los jugadores del equipo).
  const teamOf = new Map(analysis.report.players.map((p) => [p.playerId, p.teamId]));
  const badgesOfPlayer = (analyzerId: string): string[] => {
    const teamId = teamOf.get(analyzerId);
    return evaluation.badges
      .filter((b) => b.playerId === analyzerId || (b.teamId && b.teamId === teamId))
      .map((b) => b.badge)
      .sort();
  };
  const tagKinds = (teamId?: string) => ({
    narrative: analysis.narrativeTags.filter((t) => t.teamId === teamId).map((t) => t.kind).sort(),
    historical: analysis.historicalContext.tags
      .filter((t) => (t.teamId && t.teamId === teamId))
      .map((t) => t.kind)
      .sort(),
  });

  // 5. Specs: catálogo predicho por jugador (cardsForPlayer reutilizado) + enriquecimiento.
  const registry = simRegistry((id) => playerOf.get(id));
  const confOf = new Map(analysis.performance.map((p) => [p.playerId, p.confidence.level]));
  const reportOf = new Map(analysis.report.players.map((p) => [p.playerId, p]));
  const forcedVariant = new Map(
    overrides.filter((o) => o.kind === "force-variant" && o.family && o.variantId).map((o) => [`${o.playerId}:${o.family}`, o] as const),
  );
  const blocked = new Map(
    overrides.filter((o) => o.kind === "block-card" && o.family).map((o) => [`${o.playerId}:${o.family}`, o] as const),
  );
  const appliedOverrides: EditorialOverride[] = [...grantsStage.applied];

  const specs: CardSpec[] = [];
  const grantsByPlayer = new Map<string, typeof grants>();
  for (const g of grants) {
    const arr = grantsByPlayer.get(g.playerId);
    if (arr) arr.push(g);
    else grantsByPlayer.set(g.playerId, [g]);
  }

  // Se procesan los jugadores con grants Y los creados sin grants (sus cartas base también
  // nacen en esta generación: son lo que rebuildCatalog producirá al materializar el draft).
  const processIds = [...new Set([
    ...grantsByPlayer.keys(),
    ...resolutions.filter((r) => r.status === "created").map((r) => r.analyzerId),
  ])].sort((x, y) => x.localeCompare(y));

  for (const analyzerId of processIds) {
    const playerGrants = grantsByPlayer.get(analyzerId) ?? [];
    const resolution = byAnalyzer.get(analyzerId)!;
    const catalogId = resolution.playerId!;
    const basePlayer = playerOf.get(catalogId);
    if (!basePlayer) continue;

    const emitible = playerGrants.filter((g) => lifecycle.decisions.has(`${analyzerId}:${g.accolade}`));
    if (!emitible.length && resolution.status !== "created") continue;

    const granted = emitible.map((g) => g.accolade);
    const { after, cards: predicted } = predictCatalog(basePlayer, granted);
    const rep = reportOf.get(analyzerId);
    const conf = confidenceOf({
      resolution,
      analyzerConfidence: confOf.get(analyzerId) ?? "low",
      hasImage: !!after.image,
      hasCountry: !!after.country,
    });
    const releaseState = releaseStateOf(resolution, conf.confidence);
    const badges = badgesOfPlayer(analyzerId);
    const tags = tagKinds(rep?.teamId);

    const pushSpec = (family: string, variantId: VariantId, decision: NonNullable<ReturnType<typeof lifecycle.decisions.get>>, ruleIds: string[]): void => {
      const block = blocked.get(`${catalogId}:${family}`);
      if (block) {
        omitted.push({ playerId: catalogId, family, action: "blocked", reason: `override: ${block.reason}` });
        appliedOverrides.push(block);
        return;
      }
      const core = buildSpecCore({ player: after, granted, family, variantId, decision }, predicted, season);
      if (!core) return;
      specs.push({
        ...core,
        status: "generated",
        releaseState,
        confidence: conf.confidence,
        issues: conf.issues,
        badges,
        narrativeTags: tags.narrative,
        historicalTags: tags.historical,
        eligibility: buildEligibility({ id: core.cardId, playerId: core.playerId, variantId: core.variantId, ovr: core.ovr, stats: core.stats }, family, decision.tier, registry, predicted),
        artwork: resolveArtwork(after, variantId, ctx.photosByPlayer?.[catalogId]),
        ruleIds,
      });
    };

    for (const g of emitible) {
      const decision = lifecycle.decisions.get(`${analyzerId}:${g.accolade}`)!;
      const forced = forcedVariant.get(`${catalogId}:${g.accolade}`);
      let variants = newVariantsFor(basePlayer, g.accolade);
      if (forced?.variantId) {
        variants = [forced.variantId];
        appliedOverrides.push(forced);
      }
      for (const v of variants) pushSpec(g.accolade, v, decision, [g.ruleId]);
    }

    // Jugador NUEVO: sus cartas base (metal + regional) también nacen en esta generación.
    if (resolution.status === "created") {
      const grantedVariants = new Set(specs.filter((s) => s.playerId === catalogId).map((s) => s.variantId));
      for (const c of predicted) {
        if (grantedVariants.has(c.variantId)) continue;
        pushSpec("base", c.variantId, { action: "new", reason: "Primera carta del jugador", tier: "comun", tierLabel: "Común" }, []);
      }
    }
  }

  // 6. Colección + noticias + resumen + ledger.
  const nickOf = (playerId: string): string | undefined => playerOf.get(playerId)?.nick;
  const collection = buildCollection({ tournamentId: analysis.tournamentId, tournamentName: name, specs, nickOf });

  const champion = analysis.report.teams.find((t) => t.champion)?.teamId;
  const news: NewsItem[] = specs
    .filter((s) => s.family !== "base")
    .map((s) => {
      const rep = [...reportOf.values()].find((p) => byAnalyzer.get(p.playerId)?.playerId === s.playerId);
      return buildCardNews({
        playerNick: nickOf(s.playerId) ?? s.playerId,
        tournamentName: name,
        rating: rep?.rating ?? s.ovr,
        tierLabel: rarityFor(rep?.rating ?? s.ovr).label,
        action: s.decision,
        abilities: abilityLabels(s.stats),
        family: s.family,
        won: !!champion && rep?.teamId === champion,
        mvp: s.family === "tournament-mvp",
        at: now,
      });
    });

  const generationId = makeGenerationId(season, name, ledger.generationIds);
  const historyAfter: Record<string, PlayerHistory> = { ...ledger.history };
  for (const s of specs) {
    const h = historyAfter[s.playerId] ?? { bestRating: null, ownsFamilies: [] };
    const rep = [...reportOf.values()].find((p) => byAnalyzer.get(p.playerId)?.playerId === s.playerId);
    historyAfter[s.playerId] = {
      bestRating: Math.max(h.bestRating ?? 0, rep?.rating ?? 0) || h.bestRating,
      ownsFamilies: [...new Set([...h.ownsFamilies, s.family])],
    };
  }
  const ledgerAfter: GeneratorLedger = {
    processed: [...ledger.processed, analysis.tournamentId],
    cardKeys: [...new Set([...ledger.cardKeys, ...specs.map((s) => `${s.playerId}:${s.family}:${s.season}`)])],
    history: historyAfter,
    generationIds: [...ledger.generationIds, generationId],
  };

  const byDecision: Record<string, number> = {};
  for (const s of specs) byDecision[s.decision] = (byDecision[s.decision] ?? 0) + 1;
  const summary = {
    players: {
      resolved: resolutions.filter((r) => r.status === "resolved").length,
      created: resolutions.filter((r) => r.status === "created").length,
      ambiguous: resolutions.filter((r) => r.status === "ambiguous").length,
    },
    grants: grants.length,
    badges: evaluation.badges.length,
    cards: specs.length,
    byDecision,
    omitted: omitted.length,
    approved: specs.filter((s) => s.releaseState === "approved").length,
    pending: specs.filter((s) => s.releaseState === "pending").length,
    drafts: specs.filter((s) => s.releaseState === "draft").length,
    estimatedValueTotal: specs.reduce((a, s) => a + s.estimatedValue, 0),
  };

  return {
    ...base, generationId,
    players: resolutions,
    grants: grants.map(({ catalogId, ...g }) => ({ ...g, playerId: catalogId })),
    badges: evaluation.badges,
    cards: specs.sort((a, b) => a.cardId.localeCompare(b.cardId)),
    omitted, retired, collection, news,
    overridesApplied: appliedOverrides,
    summary, ledgerAfter, skipped: false,
  };
}
