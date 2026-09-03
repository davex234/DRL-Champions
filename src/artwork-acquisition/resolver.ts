/**
 * RESOLVER — detección de lo que FALTA: pregunta al Artwork Asset Manager (manifest con las
 * referencias vivas de la generación) qué sujetos siguen cubiertos solo por placeholder y
 * los convierte en objetivos de adquisición con identidad resuelta. Cero red, cero estado.
 */
import type { ArtworkEngine, ArtworkRefs } from "@/artwork";
import type { CardGenerationResult } from "@/card-generator";
import { refsOfGeneration, targetsOfGeneration } from "./identity";
import type { AcquisitionTarget } from "./types";

export interface RequirementScan {
  refs: ArtworkRefs;
  /** Sujetos que YA tienen asset real en el Manager. */
  available: { category: AcquisitionTarget["category"]; subjectId: string }[];
  /** Objetivos a adquirir (hoy en placeholder). */
  targets: AcquisitionTarget[];
}

/** Escanea una generación contra el Manager: disponibles vs objetivos pendientes. */
export function scanGeneration(artwork: ArtworkEngine, gen: CardGenerationResult): RequirementScan {
  const refs = refsOfGeneration(gen);
  const manifest = artwork.manifest(refs, 0);
  const missing = manifest.missing;

  const missingKey = new Set(missing.map((m) => `${m.category}:${m.subjectId}`));
  const available: RequirementScan["available"] = [];
  const pairs: [AcquisitionTarget["category"], string[]][] = [
    ["player", refs.players], ["team", refs.teams], ["country", refs.countries],
    ["tournament-logo", refs.tournaments],
  ];
  for (const [category, ids] of pairs) {
    for (const subjectId of ids) {
      if (!missingKey.has(`${category}:${subjectId}`)) available.push({ category, subjectId });
    }
  }

  return { refs, available, targets: targetsOfGeneration(gen, missing) };
}
