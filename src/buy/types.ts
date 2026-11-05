/**
 * BUY PHASE & INVENTORY ENGINE — Tipos.
 *
 * La Buy Phase transforma una DECISIÓN económica (tipo de compra) + el RoundPlan + la
 * CoachDecision + el ADN en un LOADOUT concreto por jugador. Nadie compra objetos a
 * mano: la Buy AI construye el mejor equipamiento posible dentro del presupuesto.
 *
 * Módulo PURO y plano. No modela combate ni gráficos. La economía sigue siendo la
 * única autoridad del dinero; la Buy Phase calcula el gasto y la economía lo aplica.
 */
import type { Role } from "@/sim";
import type { BuyTier } from "@/economy";

export type ItemCategory = "sidearm" | "primary" | "armor" | "utility";
export type WeaponClass = "pistol" | "smg" | "shotgun" | "rifle" | "sniper";

/** Objeto del catálogo (sin efectos gráficos). */
export interface CatalogItem {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  /** Poder de fuego abstracto (0..100) para ranking/valor. */
  power: number;
  /** Clase de arma (solo armas). */
  class?: WeaponClass;
  /** Valor económico (para el valor del loadout). */
  econValue: number;
  /** Roles tácticos recomendados ("any" = cualquiera). */
  roles: "any" | Role[];
}

export type LoadoutState = "save" | "eco" | "half_buy" | "force_buy" | "full_buy";

/** Equipamiento final de un jugador. */
export interface Loadout {
  playerName: string;
  primary: string | null;
  sidearm: string;
  armor: "none" | "light" | "heavy";
  utility: number;
  creditsSpent: number;
  creditsRemaining: number;
  econValue: number;
  buy: BuyTier;
  firepower: number;
  state: LoadoutState;
}

export interface TeamLoadout {
  players: Loadout[];
  totalValue: number;
  totalFirepower: number;
  buy: BuyTier;
}

export interface MatchLoadouts {
  home: TeamLoadout;
  away: TeamLoadout;
}

/** Prioridad de compra que puede indicar el entrenador (nunca objetos sueltos). */
export type BuyPriority = "invest" | "save" | "survival" | "weapons" | "utility" | "balanced";

/** Entrada de la Buy AI para un jugador. */
export interface BuyInput {
  playerName: string;
  role: Role;
  /** Identidad del jugador (ADN → temperamento de compra). */
  identity: import("@/sim").Identity;
  /** Créditos disponibles del jugador (de la economía). */
  credits: number;
  tier: BuyTier;
  priority: BuyPriority;
  /** Nivel de riesgo del plan (low/medium/high). */
  risk: string;
  seed: number;
}

/** Significado de compra detectado por la narrativa (sin frases). */
export type BuyEventType =
  | "perfect_buy"
  | "risky_buy"
  | "heroic_buy"
  | "buy_error"
  | "underequipped"
  | "economic_miracle";

export interface BuyEvent {
  type: BuyEventType;
  round: number;
  team: "home" | "away";
  magnitude: number;
}

/** Resumen compacto de un loadout de equipo (historial/narrativa/broadcast). */
export interface TeamLoadoutSummary {
  buy: BuyTier;
  value: number;
  firepower: number;
}
