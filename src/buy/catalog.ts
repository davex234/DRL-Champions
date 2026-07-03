/**
 * BUY PHASE — Catálogo de objetos (data-driven, independiente del motor).
 *
 * Define precio, categoría, clase, poder de fuego y rol recomendado. Sin gráficos,
 * sin mecánicas de habilidades. Ampliar el catálogo = añadir entradas aquí; la Buy AI
 * no hardcodea ningún objeto.
 */
import type { CatalogItem } from "./types";

export const CATALOG: CatalogItem[] = [
  // Sidearms (pistolas)
  { id: "classic", name: "Classic", category: "sidearm", price: 0, power: 20, class: "pistol", econValue: 0, roles: "any" },
  { id: "ghost", name: "Ghost", category: "sidearm", price: 500, power: 35, class: "pistol", econValue: 500, roles: "any" },
  { id: "sheriff", name: "Sheriff", category: "sidearm", price: 800, power: 48, class: "pistol", econValue: 800, roles: "any" },
  // Primarios — SMG / escopetas (half/eco fuerte)
  { id: "spectre", name: "Spectre", category: "primary", price: 1600, power: 60, class: "smg", econValue: 1600, roles: "any" },
  { id: "bucky", name: "Bucky", category: "primary", price: 850, power: 46, class: "shotgun", econValue: 850, roles: ["anchor"] },
  { id: "judge", name: "Judge", category: "primary", price: 1850, power: 58, class: "shotgun", econValue: 1850, roles: ["anchor"] },
  // Primarios — rifles
  { id: "bulldog", name: "Bulldog", category: "primary", price: 2050, power: 70, class: "rifle", econValue: 2050, roles: "any" },
  { id: "guardian", name: "Guardian", category: "primary", price: 2250, power: 74, class: "rifle", econValue: 2250, roles: ["support", "igl"] },
  { id: "phantom", name: "Phantom", category: "primary", price: 2900, power: 88, class: "rifle", econValue: 2900, roles: "any" },
  { id: "vandal", name: "Vandal", category: "primary", price: 2900, power: 88, class: "rifle", econValue: 2900, roles: "any" },
  // Primario — sniper
  { id: "operator", name: "Operator", category: "primary", price: 4700, power: 95, class: "sniper", econValue: 4700, roles: ["anchor", "lurk"] },
  // Armaduras
  { id: "light_shield", name: "Light Shield", category: "armor", price: 400, power: 12, econValue: 400, roles: "any" },
  { id: "heavy_shield", name: "Heavy Shield", category: "armor", price: 1000, power: 28, econValue: 1000, roles: "any" },
  // Utilidad (abstracta: una carga; sin mecánica de habilidades)
  { id: "ability_charge", name: "Ability Charge", category: "utility", price: 200, power: 4, econValue: 200, roles: "any" },
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function getItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}
export function itemsByCategory(category: CatalogItem["category"]): CatalogItem[] {
  return CATALOG.filter((i) => i.category === category);
}
export const CLASSIC_ID = "classic";
export const LIGHT_SHIELD = getItem("light_shield")!;
export const HEAVY_SHIELD = getItem("heavy_shield")!;
export const ABILITY_CHARGE = getItem("ability_charge")!;

/** Primarios de una clase, ordenados por poder descendente. */
export function primariesOfClasses(classes: CatalogItem["class"][]): CatalogItem[] {
  return CATALOG
    .filter((i) => i.category === "primary" && i.class && classes.includes(i.class))
    .sort((a, b) => b.power - a.power);
}
/** Pistolas (sidearms) ordenadas por poder descendente. */
export function sidearms(): CatalogItem[] {
  return itemsByCategory("sidearm").sort((a, b) => b.power - a.power);
}
