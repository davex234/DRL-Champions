/**
 * UTILITY ENGINE — LECTURAS tácticas del mapa vivo.
 *
 * Convierte el MapState en frases de ENTRENADOR (no estadísticas): control ganado,
 * utilidad invertida, retake débil, info perdida, momento de acelerar/esperar. Lo
 * consumen Coach, Broadcast y Narrative. PURO: solo lee `RoundState.map`.
 */
import type { RoundState, Side } from "../sim/types";
import type { ZoneId } from "../sim/map/ascentA";
import type { MapState } from "./types";

const other = (s: Side): Side => (s === "ATK" ? "DEF" : "ATK");

const ZONE_LABEL: Partial<Record<ZoneId, string>> = {
  a_main: "Main", a_main_choke: "Main", tree: "Tree", tree_choke: "Tree", mid: "Mid",
  site: "el sitio", plant: "el plante", generator: "Generator", heaven: "Heaven", ct: "CT",
};

/** Resumen de utilidad de un bando. */
export function utilitySummary(map: MapState, side: Side): { spent: number; charges: number; remaining: number; fraction: number } {
  const spent = map.spent[side];
  const charges = Math.max(1, map.charges[side]);
  return { spent, charges, remaining: Math.max(0, charges - spent), fraction: spent / charges };
}

/** Zonas "calientes" (presión/riesgo alto) para el broadcast. */
export function hotZones(map: MapState): { zone: ZoneId; pressure: number }[] {
  return (Object.keys(map.zones) as ZoneId[])
    .map((z) => ({ zone: z, pressure: Math.max(map.zones[z].pressure, map.zones[z].risk.ATK, map.zones[z].risk.DEF) }))
    .filter((z) => z.pressure > 0.5)
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 3);
}

/** Probabilidad de execute (0..100) desde control + utilidad gastada + info. */
export function executeProbability(s: RoundState): number {
  const map = s.map;
  if (!map) return 50;
  const us = s.coachSide;
  const enemy = other(us);
  const obj = s.spike.planted ? "plant" : "site";
  const ourControlNearObj = (map.zones[obj]?.control ?? 0) * (us === "ATK" ? 1 : -1);
  const enemyUtil = utilitySummary(map, enemy).fraction; // gastaron → execute más fácil
  const ourInfo = map.zones[obj]?.info[us] ?? 0;
  const p = 50 + ourControlNearObj * 22 + enemyUtil * 22 + ourInfo * 8 - (map.zones[obj]?.risk[us] ?? 0) * 12;
  return Math.max(5, Math.min(95, Math.round(p)));
}

/** Lecturas tácticas para el entrenador (frases, no números). */
export function mapReads(s: RoundState): string[] {
  const map = s.map;
  if (!map) return [];
  const us = s.coachSide;
  const enemy = other(us);
  const out: string[] = [];

  // Control de zonas clave ganado por nosotros.
  const controlled = (Object.keys(map.zones) as ZoneId[]).filter((z) => {
    const c = map.zones[z].control * (us === "ATK" ? 1 : -1);
    return c > 0.45 && ZONE_LABEL[z];
  });
  const labels = [...new Set(controlled.map((z) => ZONE_LABEL[z]!))];
  if (labels.includes("Main")) out.push("Hemos ganado el control de Main.");
  else if (labels.includes("Mid")) out.push("Controlamos Mid.");
  else if (labels.length >= 3) out.push("Dominamos el control del mapa.");

  // Utilidad enemiga invertida.
  const enemyUtil = utilitySummary(map, enemy);
  if (enemyUtil.fraction >= 0.7) {
    out.push("Han invertido mucha utilidad.");
    if (enemy === "DEF") out.push("Su retake será débil: prioriza plantar.");
    out.push("Podemos acelerar: ya no tienen herramientas.");
  } else if (enemyUtil.fraction <= 0.2 && s.tick > 200) {
    out.push("El rival guarda utilidad: cuidado con el contra-juego.");
  }

  // Información: ¿el rival nos ve?
  const objZone = s.spike.planted ? "plant" : "site";
  const seenByEnemy = map.zones[objZone]?.info[enemy] ?? 0;
  if (seenByEnemy < 0.2) out.push("Ya no tienen información de nosotros: podemos movernos.");

  if (out.length === 0) out.push("Mapa en disputa: saca más control antes de comprometer.");
  return out;
}
