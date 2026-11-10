/**
 * ECONOMY ENGINE × TACTICAL — el Tactical Engine consume la economía.
 *
 * Mapea el estado económico a la `TeamEconomy` que el planner táctico YA entiende
 * (eco→eco_rush/agrupados; force→duelos rápidos/explosivo; full→control/defaults/
 * utilidad). No modifica el Tactical Engine: le entrega su economía y una postura.
 */
import type { Side } from "@/sim";
import type { Buy, ConceptOrder, MatchTacticalMemory, TacticalSetup, TeamEconomy, TeamSeed } from "@/tactics";
import { emptyModel } from "@/tactics";
import type { BuyDecision, BuyTier, EconomyState, TeamEconomyState } from "./types";

const TIER_TO_BUY: Record<BuyTier, Buy> = {
  save: "eco", eco: "eco", half: "force", force: "force", full: "full",
};

/** Postura táctica que sugiere la economía (significado para Tactical/Broadcast). */
export interface EconomyPosture {
  /** Jugar agrupados (eco). */
  grouped: boolean;
  /** Reducir riesgo (eco/save). */
  lowRisk: boolean;
  /** Buscar sorpresas (eco). */
  surprises: boolean;
  /** Más defaults y control del mapa (full). */
  mapControl: boolean;
  /** Mayor uso de utilidad (full). */
  utility: boolean;
  /** Buscar duelos rápidos / rondas explosivas (force). */
  fastDuels: boolean;
}

export function economyPosture(decision: BuyDecision): EconomyPosture {
  const t = decision.tier;
  const eco = t === "eco" || t === "save";
  const full = t === "full";
  const force = t === "force";
  return {
    grouped: eco,
    lowRisk: eco,
    surprises: eco,
    mapControl: full,
    utility: full,
    fastDuels: force,
  };
}

/** Convierte la economía de un equipo a la `TeamEconomy` del Tactical Engine. */
export function toTacticalEconomy(team: TeamEconomyState): TeamEconomy {
  const credits = Object.values(team.players).reduce((s, c) => s + c, 0);
  const buy: Buy = team.bonus ? "bonus" : TIER_TO_BUY[team.plannedBuy ?? "eco"];
  return { credits, buy, lossStreak: team.lossStreak };
}

/**
 * Construye un `TacticalSetup` desde la economía, mapeando home/away a ATK/DEF según el lado actual
 * del equipo home. Tactical Director 2.0: REALIMENTA el modelo de rival PERSISTIDO (memory) → el
 * Director adapta de verdad; activa la inteligencia ESPACIAL; y pasa la ORDEN del coach al home
 * (el coach PROPONE, el Director ejecuta). El away usa su propia lectura/composición.
 */
export interface TacticalSetupOpts {
  memory?: MatchTacticalMemory;
  /** Orden del coach para el equipo HOME (ya mapeada a concepto, según su lado). */
  homeOrder?: ConceptOrder | null;
  /** Inteligencia espacial (crossfires/rutas/rotaciones del Spatial Engine). Por defecto ON. */
  useSpatial?: boolean;
}
export function buildTacticalSetup(econ: EconomyState, homeSide: Side, opts: TacticalSetupOpts = {}): TacticalSetup {
  const { memory, homeOrder = null, useSpatial = true } = opts;
  const seed = (team: TeamEconomyState, model: TeamSeed["model"], order: ConceptOrder | null): TeamSeed => ({
    economy: toTacticalEconomy(team),
    model: model ?? emptyModel(),
    order,
    useSpatial,
  });
  const home = seed(econ.home, memory?.home ?? emptyModel(), homeOrder);
  const away = seed(econ.away, memory?.away ?? emptyModel(), null);
  return homeSide === "ATK" ? { ATK: home, DEF: away } : { ATK: away, DEF: home };
}
