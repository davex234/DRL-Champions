/**
 * REPORT — ensamblado del QualityReport: detecciones de inventario (huérfanos vía refs,
 * nunca-usados vía composiciones, sin licencia vía ciclo de vida, corruptos), score por
 * asset, agregados por grado, ranking estable, duplicados y recomendaciones. Determinista.
 */
import { artworkHash } from "@/artwork";
import { currentVersion } from "@/artwork-updater";
import { backgroundIssues } from "./background";
import { consistencyIssues } from "./consistency";
import { croppingIssues } from "./cropping";
import { duplicateIssues, findDuplicates } from "./duplicates";
import { scoreAsset } from "./quality";
import { buildSuggestions } from "./recommendations";
import { resolutionIssues } from "./resolution";
import {
  ARTWORK_AI_SCHEMA_VERSION,
  type AnalysisContext, type AssetQuality, type QualityGrade, type QualityIssue, type QualityReport,
} from "./types";

/** Issues de inventario: corruptos, huérfanos, nunca usados, sin licencia. */
export function inventoryIssues(ctx: AnalysisContext): QualityIssue[] {
  const issues: QualityIssue[] = [];

  const referenced = ctx.refs ? new Set([
    ...ctx.refs.players.map((s) => `player:${s}`),
    ...ctx.refs.teams.map((s) => `team:${s}`),
    ...ctx.refs.countries.map((s) => `country:${s}`),
    ...ctx.refs.tournaments.map((s) => `tournament-logo:${s}`),
    ...ctx.refs.collections.map((s) => `collection:${s}`),
    ...ctx.refs.badges.map((s) => `badge:${s}`),
  ]) : null;

  const used = ctx.compositions
    ? new Set(ctx.compositions.flatMap((c) => c.assetsUsed))
    : null;

  for (const a of ctx.assets) {
    const px = ctx.pixels.get(a.id);
    if (px?.corrupt) {
      issues.push({ assetId: a.id, category: a.category, code: "CORRUPT", severity: "critical", message: "el fichero no decodifica" });
    }
    if (referenced && a.subjectId && !referenced.has(a.id)) {
      issues.push({ assetId: a.id, category: a.category, code: "ORPHAN", severity: "info", message: "sujeto sin referencias vivas" });
    }
    if (used && !used.has(a.id)) {
      issues.push({ assetId: a.id, category: a.category, code: "UNUSED", severity: "info", message: "nunca utilizado en una composición" });
    }
    if (ctx.lifecycle) {
      const entry = ctx.lifecycle.assets[a.id];
      if (!entry || !currentVersion(entry).license) {
        issues.push({ assetId: a.id, category: a.category, code: "NO_LICENSE", severity: "warning", message: "sin licencia registrada" });
      }
    }
  }
  return issues;
}

/** Todos los issues del contexto (píxeles + inventario + consistencia + duplicados). */
export function detectIssues(ctx: AnalysisContext): { issues: QualityIssue[]; duplicates: QualityReport["duplicates"] } {
  const duplicates = findDuplicates(ctx);
  const issues: QualityIssue[] = [
    ...ctx.assets.flatMap((a) => {
      const px = ctx.pixels.get(a.id) ?? null;
      return [...resolutionIssues(a, px), ...backgroundIssues(a, px), ...croppingIssues(a, px)];
    }),
    ...duplicateIssues(ctx, duplicates),
    ...consistencyIssues(ctx),
    ...inventoryIssues(ctx),
  ];
  issues.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : a.code < b.code ? -1 : 1));
  return { issues, duplicates };
}

export function buildReport(ctx: AnalysisContext): QualityReport {
  const { issues, duplicates } = detectIssues(ctx);
  const assets: AssetQuality[] = ctx.assets
    .map((a) => scoreAsset(a, ctx.pixels.get(a.id) ?? null, issues, ctx))
    .sort((a, b) => b.score - a.score || (a.assetId < b.assetId ? -1 : 1));

  const byGrade: Record<QualityGrade, number> = { excelente: 0, bueno: 0, aceptable: 0, deficiente: 0, "crítico": 0 };
  for (const a of assets) byGrade[a.grade]++;

  const core = {
    schemaVersion: ARTWORK_AI_SCHEMA_VERSION,
    generatedAt: ctx.now,
    scope: ctx.scope,
    analyzed: assets.length,
    averageScore: assets.length ? Math.round(assets.reduce((s, a) => s + a.score, 0) / assets.length) : 0,
    byGrade,
    ranking: assets.map((a) => ({ assetId: a.assetId, score: a.score, grade: a.grade })),
    duplicates,
    unlicensed: issues.filter((i) => i.code === "NO_LICENSE").map((i) => i.assetId).sort(),
    orphans: issues.filter((i) => i.code === "ORPHAN").map((i) => i.assetId).sort(),
    unused: issues.filter((i) => i.code === "UNUSED").map((i) => i.assetId).sort(),
    issues,
    suggestions: buildSuggestions(issues),
    assets,
  };
  return { ...core, fingerprint: artworkHash(JSON.stringify({ ...core, generatedAt: 0 })) };
}
