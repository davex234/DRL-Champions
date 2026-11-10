/**
 * BUY AI — construye automáticamente el mejor LOADOUT posible.
 *
 * Nadie compra objetos a mano: a partir del tipo de compra (economía), la prioridad
 * (entrenador), el rol, el ADN y el riesgo, la IA asigna el presupuesto entre arma
 * principal, escudo, utilidad y secundaria. Determinista. Nunca deja créditos negativos.
 */
import { neutralIdentity, type Identity, type Role, type RosterEntry } from "@/sim";
import type { BuyTier } from "@/economy";
import {
  ABILITY_CHARGE, CLASSIC_ID, HEAVY_SHIELD, LIGHT_SHIELD, getItem,
  primariesOfClasses, sidearms,
} from "./catalog";
import { playerBuyTemperament } from "./identity";
import type {
  BuyInput, BuyPriority, CatalogItem, Loadout, LoadoutState, TeamLoadout, WeaponClass,
} from "./types";

const STATE: Record<BuyTier, LoadoutState> = {
  full: "full_buy", force: "force_buy", half: "half_buy", eco: "eco", save: "save",
};

export function priorityFromConcept(concept: string): BuyPriority {
  switch (concept) {
    case "force": return "invest";
    case "save": return "save";
    case "play_retake":
    case "slow": return "survival";
    case "explode_a":
    case "explode_b":
    case "fake":
    case "play_picks": return "weapons";
    default: return "balanced";
  }
}

export function priorityFromTier(tier: BuyTier): BuyPriority {
  switch (tier) {
    case "force": return "invest";
    case "eco":
    case "save": return "save";
    default: return "balanced";
  }
}

const roleOk = (item: CatalogItem, role: Role): boolean => item.roles === "any" || item.roles.includes(role);

function pickPrimary(classes: WeaponClass[], role: Role, budget: number, variability: number, seed: number): CatalogItem | null {
  const all = primariesOfClasses(classes).filter((i) => i.price <= budget); // ya ordenado por poder desc
  if (all.length === 0) return null;
  const preferred = all.filter((i) => roleOk(i, role));
  const pool = preferred.length ? preferred : all;
  // La creatividad introduce picks menos convencionales (segundo mejor) de forma determinista.
  if (variability > 0.5 && pool.length > 1 && seed % 3 === 0) return pool[1];
  return pool[0];
}

const armorPower = (a: Loadout["armor"]): number => (a === "heavy" ? HEAVY_SHIELD.power : a === "light" ? LIGHT_SHIELD.power : 0);
const armorValue = (a: Loadout["armor"]): number => (a === "heavy" ? HEAVY_SHIELD.econValue : a === "light" ? LIGHT_SHIELD.econValue : 0);

/** Construye el loadout de UN jugador. */
export function buildLoadout(input: BuyInput): Loadout {
  const { credits, tier, priority, role, identity, seed } = input;
  const temp = playerBuyTemperament(identity);
  let remaining = credits;
  let primary: CatalogItem | null = null;
  let sidearm = CLASSIC_ID;
  let armor: Loadout["armor"] = "none";
  let utility = 0;

  if (tier === "save") {
    // No gastar: pistola gratis, sin escudo.
  } else if (tier === "eco") {
    const ecoBudget = Math.floor(credits * (priority === "invest" || temp.invest > 0.2 ? 0.7 : 0.5));
    const sa = sidearms().find((i) => i.price > 0 && i.price <= Math.min(remaining, ecoBudget));
    if (sa) { sidearm = sa.id; remaining -= sa.price; }
    if ((priority === "survival" || temp.invest > 0.2) && remaining >= LIGHT_SHIELD.price) { armor = "light"; remaining -= LIGHT_SHIELD.price; }
  } else if (tier === "half") {
    if (remaining >= LIGHT_SHIELD.price) { armor = "light"; remaining -= LIGHT_SHIELD.price; }
    primary = pickPrimary(["smg", "shotgun"], role, remaining, temp.variability, seed);
    if (primary) remaining -= primary.price;
    if (priority === "utility" && remaining >= ABILITY_CHARGE.price) { utility++; remaining -= ABILITY_CHARGE.price; }
  } else if (tier === "force") {
    const weaponBudget = Math.floor(remaining * (priority === "survival" ? 0.7 : 1));
    primary = pickPrimary(["rifle", "smg", "shotgun"], role, weaponBudget, temp.variability, seed);
    if (primary) remaining -= primary.price;
    else { const sh = getItem("sheriff"); if (sh && sh.price <= remaining) { sidearm = sh.id; remaining -= sh.price; } }
    if (remaining >= LIGHT_SHIELD.price) { armor = "light"; remaining -= LIGHT_SHIELD.price; }
  } else {
    // full
    const reserve = priority === "invest" || temp.invest > 0.3 ? 0 : Math.floor(credits * temp.reserveFactor * 0.3);
    if (remaining - HEAVY_SHIELD.price >= reserve) { armor = "heavy"; remaining -= HEAVY_SHIELD.price; }
    else if (remaining >= LIGHT_SHIELD.price) { armor = "light"; remaining -= LIGHT_SHIELD.price; }
    const classes: WeaponClass[] = (role === "anchor" || role === "lurk") && priority !== "utility" ? ["rifle", "sniper"] : ["rifle"];
    primary = pickPrimary(classes, role, remaining - reserve, temp.variability, seed);
    if (primary) remaining -= primary.price;
    const utilTarget = priority === "utility" ? 2 : 1;
    while (utility < utilTarget && remaining >= ABILITY_CHARGE.price) { utility++; remaining -= ABILITY_CHARGE.price; }
  }

  const creditsSpent = credits - remaining;
  const weaponPower = primary ? primary.power : getItem(sidearm)!.power;
  const firepower = Math.round(weaponPower + armorPower(armor) + utility * ABILITY_CHARGE.power);
  const sidearmValue = sidearm !== CLASSIC_ID ? getItem(sidearm)!.econValue : 0;
  const econValue = (primary?.econValue ?? 0) + sidearmValue + armorValue(armor) + utility * ABILITY_CHARGE.econValue;

  return {
    playerName: input.playerName,
    primary: primary?.id ?? null,
    sidearm,
    armor,
    utility,
    creditsSpent,
    creditsRemaining: remaining,
    econValue,
    buy: tier,
    firepower,
    state: STATE[tier],
  };
}

const hash = (s: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Construye el loadout de un EQUIPO a partir de los créditos por jugador. */
export function buildTeamLoadout(
  roster: RosterEntry[],
  creditsByName: Record<string, number>,
  tier: BuyTier,
  priority: BuyPriority,
  risk: string,
  seed: number,
): TeamLoadout {
  const players: Loadout[] = roster.map((r) => buildLoadout({
    playerName: r.name,
    role: r.role,
    identity: r.identity ?? neutralIdentity(),
    credits: creditsByName[r.name] ?? 0,
    tier, priority, risk,
    seed: (seed ^ hash(r.name)) >>> 0,
  }));
  return {
    players,
    totalValue: players.reduce((s, p) => s + p.econValue, 0),
    totalFirepower: players.reduce((s, p) => s + p.firepower, 0),
    buy: tier,
  };
}

/** Gasto por jugador (para que la economía lo aplique vía commitBuy). */
export function spentByName(team: TeamLoadout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of team.players) out[p.playerName] = p.creditsSpent;
  return out;
}

// Re-export de un tipo usado por `Identity` en BuyInput.
export type { Identity };
