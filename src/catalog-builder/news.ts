/**
 * NEWS (Fase 6) — noticias ESTRUCTURADAS de catálogo (nivel agregado; las noticias por carta
 * ya las emite F4 con buildCardNews). Forma `NewsItem` de intel REUTILIZADA, ids
 * deterministas derivados del GenerationId. Nunca renderiza.
 */
import type { NewsItem } from "@/intel/news";
import type { MaterializationResult } from "@/materializer";
import type { CatalogDiff } from "./types";

export function buildNews(mat: MaterializationResult, diff: CatalogDiff, at: number): NewsItem[] {
  const out: NewsItem[] = [];
  const gid = mat.generationId.toLowerCase();
  const colName = mat.collectionPatch.add[0]?.name ?? mat.collectionPatch.update[0]?.collectionId ?? mat.generationId;

  if (diff.added.length) {
    out.push({
      id: `news:catalog:add:${gid}`, at, kind: "event",
      title: `Se añaden ${diff.added.length} cartas de ${colName}`,
      body: `El catálogo incorpora ${diff.added.length} cartas nuevas (${mat.catalogPatch.playersAdd.length} jugadores debutan).`,
      tournament: colName, tags: ["catalogo", mat.generationId],
    });
  }
  if (mat.catalogPatch.playersAdd.length) {
    out.push({
      id: `news:catalog:players:${gid}`, at, kind: "event",
      title: `${mat.catalogPatch.playersAdd.length} jugadores nuevos entran al catálogo`,
      body: mat.catalogPatch.playersAdd.map((p) => p.nick).sort().join(", "),
      tags: ["jugadores", mat.generationId],
    });
  }
  if (mat.collectionPatch.add.length) {
    out.push({
      id: `news:catalog:collection:${gid}`, at, kind: "event",
      title: `Nueva colección: ${mat.collectionPatch.add[0].name}`,
      body: `Colección de torneo con ${mat.collectionPatch.add[0].items.length} cartas.`,
      tournament: mat.collectionPatch.add[0].name, tags: ["coleccion", mat.generationId],
    });
  }
  if (diff.removed.length || diff.retired.length) {
    const n = new Set([...diff.removed, ...diff.retired]).size;
    out.push({
      id: `news:catalog:retired:${gid}`, at, kind: "event",
      title: `${n} carta(s) retiradas del catálogo`,
      body: [...new Set([...diff.removed, ...diff.retired])].sort().join(", "),
      tags: ["retiradas", mat.generationId],
    });
  }
  return out;
}
