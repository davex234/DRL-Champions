/**
 * CONSISTENCY — mismo jugador ⇒ misma imagen · mismo equipo ⇒ mismo logo · mismo torneo ⇒
 * mismo branding, más el estado del ciclo de vida: versión anticuada (existe una más
 * reciente) y divergencia respecto a la versión OFICIAL registrada. Solo informa.
 */
import { currentVersion } from "@/artwork-updater";
import type { AnalysisContext, QualityIssue } from "./types";

export function consistencyIssues(ctx: AnalysisContext): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const byId = new Map(ctx.assets.map((a) => [a.id, a]));

  // Mismo sujeto usado con DISTINTAS imágenes en las composiciones existentes.
  if (ctx.compositions?.length) {
    const usedBySubject = new Map<string, Set<string>>();
    for (const comp of ctx.compositions) {
      for (const layer of comp.layers) {
        for (const el of layer.elements) {
          if (el.isPlaceholder) continue;
          const asset = byId.get(el.ref);
          if (!asset?.subjectId) continue;
          const key = `${asset.category}:${asset.subjectId}`;
          (usedBySubject.get(key) ?? usedBySubject.set(key, new Set()).get(key)!).add(el.ref);
        }
      }
    }
    for (const [key, refs] of [...usedBySubject.entries()].sort()) {
      if (refs.size <= 1) continue;
      for (const ref of [...refs].sort()) {
        issues.push({
          assetId: ref, category: byId.get(ref)!.category, code: "INCONSISTENT_SUBJECT", severity: "warning",
          message: `el sujeto ${key} aparece con ${refs.size} imágenes distintas en las composiciones`,
        });
      }
    }
  }

  // Ciclo de vida: versión anticuada o divergente de la oficial registrada.
  if (ctx.lifecycle) {
    for (const a of ctx.assets) {
      const entry = ctx.lifecycle.assets[a.id];
      if (!entry) continue;
      const latest = entry.versions[entry.versions.length - 1];
      if (latest.version !== entry.current) {
        issues.push({
          assetId: a.id, category: a.category, code: "OUTDATED_VERSION", severity: "info",
          message: `existe una versión más reciente (v${latest.version}; vigente v${entry.current})`,
        });
      }
      const official = [...entry.versions].reverse().find((v) => v.license === "official");
      const cur = currentVersion(entry);
      if (official && cur.license !== "official" && cur.checksum !== official.checksum) {
        issues.push({
          assetId: a.id, category: a.category, code: "UNOFFICIAL_MISMATCH", severity: "warning",
          message: `difiere de la versión OFICIAL registrada (v${official.version})`,
        });
      }
    }
  }

  return issues;
}
