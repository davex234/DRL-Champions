/**
 * ECONOMÍA MUNDIAL — inflación/boom/crisis/mercado caliente-frío (Career Fase 6/7).
 *
 * EMERGE de los agregados del `WorldState` (valores, presupuestos, volumen de traspasos, la
 * tendencia value vs prevValue). Nunca aleatoria. Aplica un factor de inflación ACOTADO a los
 * valores (no compone: el mundo recalcula el valor base cada temporada) y un empujón de
 * presupuesto por fase. PURO. Determinista.
 */
import type { WorldState, WorldPlayer } from "@/world";
import type { Region } from "@/domain/cards/types";
import type { GlobalEconomy, EconomyPhase, RegionValue } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

export function globalEconomy(world: WorldState): GlobalEconomy {
  const active = Object.values(world.players).filter((p) => p.status === "active");
  const n = Math.max(1, active.length);
  const avgPlayerValue = Math.round(active.reduce((a, p) => a + p.value, 0) / n);
  const totalMoney = Math.round(Object.values(world.teams).reduce((a, t) => a + t.budget, 0));
  const season = world.season;
  const transferVolume = world.transfers.filter((t) => t.season === season - 1 || t.season === season).reduce((a, t) => a + t.fee, 0);

  // Tendencia: crecimiento medio de valor respecto a la temporada anterior.
  const growth = active.reduce((a, p) => a + (p.value - p.prevValue) / Math.max(1, p.prevValue), 0) / n;
  const temp = clamp(Math.round((transferVolume / Math.max(1, totalMoney)) * 400), 0, 100);

  let phase: EconomyPhase;
  if (growth > 0.06 && temp > 55) phase = "boom";
  else if (growth < -0.05 || temp < 12) phase = "crisis";
  else if (growth < 0) phase = "cooling";
  else phase = "stable";

  const inflation = clamp(1 + growth * 1.5 + (phase === "boom" ? 0.12 : phase === "crisis" ? -0.15 : 0), 0.82, 1.35);

  // Valor por región (suma de valores de jugadores activos de esa región).
  const regionValues: RegionValue[] = REGIONS.map((region) => {
    const players = active.filter((p) => p.region === region);
    const value = Math.round(players.reduce((a, p) => a + p.value, 0));
    const trend = players.length ? +(players.reduce((a, p) => a + (p.value - p.prevValue), 0) / players.length).toFixed(0) : 0;
    return { region, value, trend };
  });
  const leagueValue = Math.round(active.reduce((a, p) => a + p.value, 0));

  const note = phase === "boom" ? "El mercado hierve: los valores se disparan." : phase === "crisis" ? "Crisis económica: los clubes aprietan el cinturón." : phase === "cooling" ? "El mercado se enfría." : "Economía estable.";
  return { phase, inflation, marketTemperature: temp, avgPlayerValue, totalMoney, transferVolume, regionValues, leagueValue, note };
}

/** Aplica la economía: inflación ACOTADA a los valores + empujón de presupuesto por fase. Muta el mundo. */
export function applyEconomy(world: WorldState, econ: GlobalEconomy, protectTeamId: string | null): void {
  for (const p of Object.values(world.players) as WorldPlayer[]) {
    if (p.status !== "active") continue;
    p.value = Math.max(40, Math.round(p.value * econ.inflation)); // no compone: el mundo resetea el valor base cada temporada
  }
  const budgetMult = econ.phase === "boom" ? 1.04 : econ.phase === "crisis" ? 0.96 : econ.phase === "cooling" ? 0.99 : 1.01;
  for (const t of Object.values(world.teams)) {
    if (protectTeamId && t.id === protectTeamId) continue; // el usuario gestiona su economía
    t.budget = Math.max(0, Math.round(t.budget * budgetMult));
  }
}
