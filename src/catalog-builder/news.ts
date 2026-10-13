/**
 * NEWS (Fase 6) — noticias ESTRUCTURADAS de catálogo (nivel agregado; las noticias por carta
 * ya las emite F4 con buildCardNews). Forma `NewsItem` de intel REUTILIZADA, ids
 * deterministas derivados del GenerationId. Nunca renderiza.
 */
import type { NewsItem } from "@/intel/news";
import type { MaterializationResult } from "@/materializer";
import type { CatalogDiff } from "./types";
import { ns, td } from "@/i18n/runtime";

const t = ns("catalogbuilder");

export function buildNews(mat: MaterializationResult, diff: CatalogDiff, at: number): NewsItem[] {
  const out: NewsItem[] = [];
  const gid = mat.generationId.toLowerCase();
  const colName = mat.collectionPatch.add[0]?.name ?? mat.collectionPatch.update[0]?.collectionId ?? mat.generationId;

  if (diff.added.length) {
    out.push({
      id: `news:catalog:add:${gid}`, at, kind: "event",
      title: t("Se añaden {length} cartas de {colName}", { length: diff.added.length, colName: td(colName) }),
      body: t("El catálogo incorpora {length} cartas nuevas ({length2} jugadores debutan).", { length: diff.added.length, length2: mat.catalogPatch.playersAdd.length }),
      tournament: colName, tags: ["catalogo", mat.generationId],
    });
  }
  if (mat.catalogPatch.playersAdd.length) {
    out.push({
      id: `news:catalog:players:${gid}`, at, kind: "event",
      title: t("{length} jugadores nuevos entran al catálogo", { length: mat.catalogPatch.playersAdd.length }),
      body: mat.catalogPatch.playersAdd.map((p) => p.nick).sort().join(", "),
      tags: ["jugadores", mat.generationId],
    });
  }
  if (mat.collectionPatch.add.length) {
    out.push({
      id: `news:catalog:collection:${gid}`, at, kind: "event",
      title: t("Nueva colección: {name}", { name: td(mat.collectionPatch.add[0].name) }),
      body: t("Colección de torneo con {length} cartas.", { length: mat.collectionPatch.add[0].items.length }),
      tournament: mat.collectionPatch.add[0].name, tags: ["coleccion", mat.generationId],
    });
  }
  if (diff.removed.length || diff.retired.length) {
    const n = new Set([...diff.removed, ...diff.retired]).size;
    out.push({
      id: `news:catalog:retired:${gid}`, at, kind: "event",
      title: t("{n} carta(s) retiradas del catálogo", { n }),
      body: [...new Set([...diff.removed, ...diff.retired])].sort().join(", "),
      tags: ["retiradas", mat.generationId],
    });
  }
  return out;
}
