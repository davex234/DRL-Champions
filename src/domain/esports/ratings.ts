/**
 * DRL ESPORTS — cálculo de métricas individuales por mapa.
 *
 * Funciones PURAS para derivar ACS, K/D, KAST y un rating estilo VLR 2.0 a
 * partir de las estadísticas crudas de un jugador en un mapa. La fórmula del
 * rating es una aproximación (VLR no publica la oficial): combina impacto por
 * ronda (ACS), eficiencia de bajas (K/D), supervivencia/utilidad (KAST) y
 * entradas (first kills). Sirve como base coherente y comparable.
 */

export interface RawMapLine {
  kills: number;
  deaths: number;
  assists: number;
  /** Combat score total del jugador en el mapa. */
  combatScore?: number;
  /** Rondas jugadas en el mapa. */
  rounds: number;
  /** % KAST si la fuente lo provee (0-100). */
  kast?: number;
  /** Daño total para derivar ADR. */
  damage?: number;
  firstKills?: number;
  firstDeaths?: number;
  hsPct?: number;
}

export interface DerivedStats {
  acs: number;
  kd: number;
  kast: number;
  adr: number;
  fk: number;
  fd: number;
  plusMinus: number;
  rating: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Average Combat Score: combat score por ronda. */
export function acs(combatScore: number, rounds: number): number {
  if (rounds <= 0) return 0;
  return round1(combatScore / rounds);
}

/** Average Damage per Round. */
export function adr(damage: number, rounds: number): number {
  if (rounds <= 0) return 0;
  return round1(damage / rounds);
}

/** Ratio K/D (evita división por cero). */
export function kd(kills: number, deaths: number): number {
  if (deaths <= 0) return round2(kills);
  return round2(kills / deaths);
}

/**
 * Rating aproximado estilo VLR 2.0, anclado en 1.0 = rendimiento medio.
 * Pondera: ACS (impacto), K/D (eficiencia), KAST (consistencia) y entradas.
 */
export function rating(d: {
  acs: number;
  kd: number;
  kast: number;
  fk: number;
  fd: number;
  rounds: number;
}): number {
  const acsTerm = d.acs / 200; // ~200 ACS ≈ media
  const kdTerm = d.kd; // 1.0 = media
  const kastTerm = (d.kast || 60) / 70; // ~70% ≈ media
  const entryTerm = d.rounds > 0 ? ((d.fk - d.fd) / d.rounds) * 0.5 : 0;
  const raw = 0.4 * acsTerm + 0.35 * kdTerm + 0.2 * kastTerm + entryTerm + 0.05;
  return round2(Math.max(0, raw));
}

/** Deriva todas las métricas de una línea cruda de mapa. */
export function deriveMapStats(line: RawMapLine): DerivedStats {
  const a = line.combatScore != null ? acs(line.combatScore, line.rounds) : 0;
  const d = line.damage != null ? adr(line.damage, line.rounds) : 0;
  const ratio = kd(line.kills, line.deaths);
  const kastVal = line.kast ?? 0;
  const fk = line.firstKills ?? 0;
  const fd = line.firstDeaths ?? 0;
  return {
    acs: a,
    kd: ratio,
    kast: round1(kastVal),
    adr: d,
    fk,
    fd,
    plusMinus: line.kills - line.deaths,
    rating: rating({ acs: a, kd: ratio, kast: kastVal, fk, fd, rounds: line.rounds }),
  };
}
