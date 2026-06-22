import type { PlayerStats } from "./types";

/**
 * Métricas reales de un jugador (estilo VLR.gg) a partir de las cuales se
 * generan las 6 estadísticas del juego. Todas opcionales: se usan valores
 * neutros por defecto cuando faltan.
 */
export interface RawMetrics {
  /** Average Combat Score. */
  acs?: number;
  /** Average Damage per Round. */
  adr?: number;
  kills?: number;
  deaths?: number;
  /** Ratio K/D (si no se dan kills/deaths). */
  kd?: number;
  assists?: number;
  /** Porcentaje de headshots (0-100). */
  hsPct?: number;
  /** Clutches ganados. */
  clutches?: number;
  /** KAST % (0-100). */
  kast?: number;
}

const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/**
 * Convierte métricas reales (ACS, ADR, K/D, HS%, asistencias, clutches) en las
 * estadísticas del juego (DMG, SCR, COM, HS, AST, CLU). Fórmulas calibradas
 * para que un jugador profesional medio quede ~70-85 y una estrella ~90+.
 */
export function statsFromMetrics(m: RawMetrics): PlayerStats {
  const acs = m.acs ?? 200;
  const adr = m.adr ?? acs * 0.62;
  const kd =
    m.kd ?? (m.kills != null && m.deaths != null ? m.kills / Math.max(1, m.deaths) : 1.05);
  const hsPct = m.hsPct ?? 25;
  const assists = m.assists ?? 4;
  const clutches = m.clutches ?? 4;
  const kast = m.kast ?? 72;

  return {
    scr: clamp(acs / 3.1), // ACS 250 -> 80, 300 -> 97
    dmg: clamp((adr - 50) / 1.45), // ADR 180 -> 90, 130 -> 55
    com: clamp(kd * 62), // K/D 1.0 -> 62, 1.3 -> 81, 1.5 -> 93
    hs: clamp(hsPct * 2.5), // 25% -> 63, 35% -> 88
    ast: clamp(0.6 * (35 + assists * 6.5) + 0.4 * kast), // mezcla asistencias + KAST
    clu: clamp(45 + clutches * 4), // 5 -> 65, 10 -> 85
  };
}
