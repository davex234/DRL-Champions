/**
 * RECOMMENDATIONS — SOLO sugerencias en lenguaje humano a partir de los issues detectados,
 * priorizadas (crítico > warning > info) y deterministas. Jamás se corrige nada
 * automáticamente: la decisión es siempre de una persona.
 */
import type { QualityIssue, Suggestion } from "./types";

const TEMPLATES: Record<QualityIssue["code"], { priority: number; text: (i: QualityIssue) => string }> = {
  TOO_SMALL: { priority: 95, text: (i) => `${i.category} "${i.assetId}" demasiado pequeño: consigue una versión de mayor resolución.` },
  CORRUPT: { priority: 98, text: (i) => `El asset "${i.assetId}" está corrupto: no decodifica y debería re-adquirirse.` },
  NO_TRANSPARENCY: { priority: 90, text: (i) => `"${i.assetId}" ha perdido la transparencia: exporta con canal alfa.` },
  BACKGROUND_NOT_REMOVED: { priority: 85, text: (i) => `El fondo de "${i.assetId}" parece no haber sido eliminado.` },
  UNOFFICIAL_MISMATCH: { priority: 80, text: (i) => `"${i.assetId}" es diferente al oficial registrado: revisa cuál debe ser el vigente.` },
  LOW_RESOLUTION: { priority: 70, text: (i) => `${i.category} "${i.assetId}" con resolución por debajo del estándar.` },
  BAD_ASPECT: { priority: 65, text: (i) => `"${i.assetId}" está estirado o con proporciones incorrectas.` },
  CROPPED_EDGES: { priority: 60, text: (i) => `"${i.assetId}" tiene los bordes recortados: el sujeto no cabe en el encuadre.` },
  DUPLICATE: { priority: 55, text: (i) => `Hay assets idénticos a "${i.assetId}": considera deduplicarlos.` },
  OUTDATED_VERSION: { priority: 50, text: (i) => `Existe una versión más reciente de "${i.assetId}".` },
  OVER_COMPRESSED: { priority: 45, text: (i) => `"${i.assetId}" muestra compresión excesiva: consigue el original.` },
  NO_LICENSE: { priority: 40, text: (i) => `"${i.assetId}" no tiene licencia registrada.` },
  INCONSISTENT_SUBJECT: { priority: 75, text: (i) => `${i.message} (unifica la imagen del sujeto).` },
  ORPHAN: { priority: 30, text: (i) => `"${i.assetId}" está huérfano: su sujeto ya no se referencia.` },
  UNUSED: { priority: 20, text: (i) => `"${i.assetId}" nunca se ha utilizado en una composición.` },
};

export function buildSuggestions(issues: QualityIssue[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.assetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = TEMPLATES[i.code];
    out.push({ assetId: i.assetId, code: i.code, priority: t.priority, message: t.text(i) });
  }
  return out.sort((a, b) => b.priority - a.priority || (a.assetId! < b.assetId! ? -1 : 1));
}
