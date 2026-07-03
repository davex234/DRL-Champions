/**
 * ECONOMY ENGINE × BROADCAST — alimenta al Broadcast con datos económicos reales.
 * No modifica el Broadcast Engine: produce el contexto que este acepta de forma
 * opcional (créditos, tipo de compra, estado, ventaja económica).
 */
import type { Side } from "@/sim";
import type { EconomyState } from "./types";
import { teamEconomyView, economicAdvantage } from "./metrics";

export interface EconomyBroadcastSide {
  credits: number;
  buy: string;
  status: string;
  risk: number;
}

export interface EconomyBroadcastContext {
  atk: EconomyBroadcastSide;
  def: EconomyBroadcastSide;
  /** Ventaja económica del lado ATK respecto al DEF (créditos). */
  advantage: number;
}

/** Contexto económico por LADO (lo que muestra el broadcast), según el lado de home. */
export function economyBroadcastContext(econ: EconomyState, homeSide: Side): EconomyBroadcastContext {
  const hv = teamEconomyView(econ.home, econ.rules);
  const av = teamEconomyView(econ.away, econ.rules);
  const side = (v: typeof hv): EconomyBroadcastSide => ({
    credits: v.total,
    buy: v.buy ?? "—",
    status: String(v.status),
    risk: v.risk,
  });
  const atkIsHome = homeSide === "ATK";
  const adv = economicAdvantage(econ.home, econ.away) * (atkIsHome ? 1 : -1);
  return {
    atk: side(atkIsHome ? hv : av),
    def: side(atkIsHome ? av : hv),
    advantage: adv,
  };
}
