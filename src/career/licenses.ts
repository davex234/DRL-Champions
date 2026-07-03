/**
 * MANAGER CAREER ENGINE — licencias.
 *
 * Progresión de licencias por RESULTADOS (nivel + títulos + reputación), NO por tiempo.
 * Cada licencia desbloquea prestigio (y, en fases futuras, ofertas de mejores equipos). Puro.
 */
import type { LicenseDef, LicenseId, ManagerCareer } from "./types";
import { globalReputationScore } from "./reputation";

/** Definiciones ordenadas de menor a mayor. */
export const LICENSES: LicenseDef[] = [
  { id: "nivel-1", name: "Licencia Nivel 1", req: { level: 1, titles: 0, reputation: 0 } },
  { id: "nivel-2", name: "Licencia Nivel 2", req: { level: 5, titles: 0, reputation: 25 } },
  { id: "nivel-3", name: "Licencia Nivel 3", req: { level: 12, titles: 1, reputation: 45 } },
  { id: "nivel-4", name: "Licencia Nivel 4", req: { level: 25, titles: 3, reputation: 60 } },
  { id: "elite", name: "Licencia Elite", req: { level: 45, titles: 8, reputation: 78 } },
  { id: "legend", name: "Licencia Legend", req: { level: 70, titles: 20, reputation: 92 } },
];

const ORDER: LicenseId[] = LICENSES.map((l) => l.id);

export function licenseDef(id: LicenseId): LicenseDef {
  return LICENSES.find((l) => l.id === id) ?? LICENSES[0];
}

export function licenseRank(id: LicenseId): number {
  return ORDER.indexOf(id);
}

function meetsReq(career: ManagerCareer, def: LicenseDef): boolean {
  const rep = globalReputationScore(career.reputation);
  return (
    career.level >= def.req.level &&
    career.stats.titles >= def.req.titles &&
    rep >= def.req.reputation
  );
}

/** Licencia más alta que el entrenador cumple AHORA mismo (monótona: nunca baja). */
export function licenseFor(career: ManagerCareer): LicenseId {
  let best: LicenseId = "nivel-1";
  for (const def of LICENSES) {
    if (meetsReq(career, def)) best = def.id;
  }
  // Nunca degradar respecto a la licencia ya obtenida.
  return licenseRank(best) >= licenseRank(career.license) ? best : career.license;
}

/** Siguiente licencia por obtener (o null si ya es Legend). */
export function nextLicense(career: ManagerCareer): LicenseDef | null {
  const idx = licenseRank(career.license);
  return idx >= 0 && idx < LICENSES.length - 1 ? LICENSES[idx + 1] : null;
}
