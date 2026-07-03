/**
 * AGREGACIÓN DE STATS + PUNTUACIONES DE ROL — helpers PUROS y deterministas sobre `MapPlayerStat`.
 * Promedia rates (acs/kast/adr/hs) y suma totales (kills/deaths/assists/fk/fd/clutches). Las
 * puntuaciones de rol son funciones fijas de las stats (no dependen del resto del campo).
 */
import type { MapPlayerStat } from "@/importer";
import type { RoleScores } from "./types";

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Línea de estadística agregada de un conjunto de mapas (promedios + totales). */
export interface StatLine {
  maps: number;
  acs: number; kast: number; adr: number; hsPct: number;   // promedios
  kills: number; deaths: number; assists: number; fk: number; fd: number; clutches: number; // totales
}

const numsOf = (stats: MapPlayerStat[], f: (s: MapPlayerStat) => number | undefined): number[] =>
  stats.map(f).filter((v): v is number => typeof v === "number");
const sum = (stats: MapPlayerStat[], f: (s: MapPlayerStat) => number | undefined): number =>
  stats.reduce((a, s) => a + (f(s) ?? 0), 0);

/** Agrega una lista de `MapPlayerStat` (de un jugador, en cualquier subconjunto de mapas). */
export function accumulate(stats: MapPlayerStat[]): StatLine {
  return {
    maps: stats.length,
    acs: avg(numsOf(stats, (s) => s.acs)),
    kast: avg(numsOf(stats, (s) => s.kast)),
    adr: avg(numsOf(stats, (s) => s.adr)),
    hsPct: avg(numsOf(stats, (s) => s.hsPct)),
    kills: sum(stats, (s) => s.kills),
    deaths: sum(stats, (s) => s.deaths),
    assists: sum(stats, (s) => s.assists),
    fk: sum(stats, (s) => s.fk),
    fd: sum(stats, (s) => s.fd),
    clutches: sum(stats, (s) => s.clutches),
  };
}

export const kd = (l: StatLine): number => l.kills / Math.max(1, l.deaths);
const perMap = (total: number, maps: number): number => total / Math.max(1, maps);

/**
 * Puntuaciones de rol 0..100 — funciones DETERMINISTAS de las stats con escalas de referencia fijas
 * (no relativas al campo). Miden aptitud, no el rol asignado.
 */
export function roleScores(l: StatLine): RoleScores {
  const nAcs = clamp(l.acs / 300, 0, 1);
  const nKast = clamp(l.kast / 100, 0, 1);
  const nAdr = clamp(l.adr / 180, 0, 1);
  const nKd = clamp(kd(l) / 1.5, 0, 1);
  const fkm = perMap(l.fk, l.maps), fdm = perMap(l.fd, l.maps);
  const asm = perMap(l.assists, l.maps), clm = perMap(l.clutches, l.maps), dtm = perMap(l.deaths, l.maps);
  const nFk = clamp(fkm / 0.9, 0, 1), nAssist = clamp(asm / 7, 0, 1), nClutch = clamp(clm / 1.2, 0, 1);
  const survive = clamp(1 - dtm / 20, 0, 1);
  const r = (x: number): number => Math.round(clamp(x, 0, 1) * 100);
  return {
    duelist: r(0.35 * nAcs + 0.30 * nFk + 0.20 * nKd + 0.15 * clamp(perMap(l.kills, l.maps) / 20, 0, 1)),
    controller: r(0.40 * nAssist + 0.35 * nKast + 0.25 * nAdr),
    initiator: r(0.40 * nAssist + 0.30 * nFk + 0.30 * nKast),
    sentinel: r(0.40 * nClutch + 0.35 * survive + 0.25 * nKast),
    entry: r(0.55 * nFk + 0.30 * clamp((fkm - fdm + 0.5) / 1.5, 0, 1) + 0.15 * nAcs),
    support: r(0.60 * nAssist + 0.40 * nKast),
    anchor: r(0.50 * nClutch + 0.30 * nKast + 0.20 * survive),
  };
}

/** Score del rol asignado (o el mejor de todos si no hay rol/es desconocido). */
export function rolePerformance(scores: RoleScores, role?: string): number {
  const r = (role ?? "").toLowerCase();
  if (r.includes("duel")) return scores.duelist;
  if (r.includes("control")) return scores.controller;
  if (r.includes("init")) return scores.initiator;
  if (r.includes("sentinel")) return scores.sentinel;
  return Math.max(scores.duelist, scores.controller, scores.initiator, scores.sentinel);
}

/** Agrupa por clave (O(n), sin O(n²)). */
export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
