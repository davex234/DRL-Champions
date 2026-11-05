/**
 * BUY PHASE × BROADCAST — alimenta al Broadcast con el equipamiento.
 * No modifica el Broadcast Engine: produce el contexto opcional (arma principal,
 * escudo, tipo de compra, valor económico, comparativa entre equipos).
 */
import type { Side } from "@/sim";
import { getItem } from "./catalog";
import type { MatchLoadouts, TeamLoadout } from "./types";

export interface LoadoutBroadcastSide {
  buy: string;
  value: number;
  firepower: number;
  /** Arma principal más representativa del equipo (mayor poder). */
  topWeapon: string;
  /** Nº de jugadores con escudo pesado. */
  heavyShields: number;
}

export interface LoadoutBroadcastContext {
  atk: LoadoutBroadcastSide;
  def: LoadoutBroadcastSide;
  /** Ventaja de valor económico del lado ATK respecto al DEF. */
  advantage: number;
}

function sideView(team: TeamLoadout): LoadoutBroadcastSide {
  let top = "classic", topPow = -1;
  for (const p of team.players) {
    const id = p.primary ?? p.sidearm;
    const pow = getItem(id)?.power ?? 0;
    if (pow > topPow) { topPow = pow; top = id; }
  }
  return {
    buy: team.buy,
    value: team.totalValue,
    firepower: team.totalFirepower,
    topWeapon: getItem(top)?.name ?? top,
    heavyShields: team.players.filter((p) => p.armor === "heavy").length,
  };
}

export function loadoutBroadcastContext(loadouts: MatchLoadouts, homeSide: Side): LoadoutBroadcastContext {
  const home = sideView(loadouts.home);
  const away = sideView(loadouts.away);
  const atkIsHome = homeSide === "ATK";
  return {
    atk: atkIsHome ? home : away,
    def: atkIsHome ? away : home,
    advantage: (atkIsHome ? home.value - away.value : away.value - home.value),
  };
}
