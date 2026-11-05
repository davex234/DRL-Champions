/**
 * AGENT ABILITY ENGINE — CATÁLOGO (datos).
 *
 * Habilidades PROPIAS (inspiradas en shooters tácticos, NO copia de Valorant). Cada una DESCRIBE
 * qué consigue; el motor decide cuándo/cómo. Una habilidad por (clase × mecánica) con sabor, más
 * genéricas de respaldo. Añadir una habilidad nueva = añadir un objeto aquí; añadir un agente =
 * añadir su kit (sus abilities salen de aquí). El núcleo NO se toca.
 */
import type { AgentClass } from "../agents/types";
import type { UtilityKind } from "../spatial/types";
import type { Ability } from "./types";

const TPS = 20;

export const ABILITIES: Ability[] = [
  // ── Controlador ──
  { id: "smoke_screen", name: "Smoke Screen", class: "controller", kind: "smoke", effect: "deny_vision", charges: 2, cooldown: 6 * TPS, duration: 10 * TPS, target: "objective_sightline", priority: 0.9, tags: ["humo", "corta visión"] },
  { id: "containment", name: "Containment", class: "controller", kind: "cover", effect: "control", charges: 1, cooldown: 8 * TPS, duration: 12 * TPS, target: "self_zone", priority: 0.7, tags: ["control", "espacio"] },
  // ── Iniciador ──
  { id: "recon_pulse", name: "Recon Pulse", class: "initiator", kind: "recon", effect: "reveal", charges: 2, cooldown: 5 * TPS, duration: 4 * TPS, target: "objective_zone", priority: 0.85, combat: { reveal: true }, tags: ["recon", "info"] },
  { id: "flashpoint", name: "Flashpoint", class: "initiator", kind: "flash", effect: "blind", charges: 2, cooldown: 4 * TPS, duration: 0, target: "enemy_anchor", priority: 0.88, combat: { blind: Math.round(1.2 * TPS) }, tags: ["flash", "abre ventana"] },
  // ── Duelista ──
  { id: "breach_flash", name: "Breach Flash", class: "duelist", kind: "flash", effect: "entry", charges: 2, cooldown: 4 * TPS, duration: 0, target: "enemy_anchor", priority: 0.9, combat: { blind: Math.round(1.0 * TPS) }, tags: ["entry", "flash propio"] },
  { id: "blitz_smoke", name: "Blitz Veil", class: "duelist", kind: "smoke", effect: "create_space", charges: 1, cooldown: 6 * TPS, duration: 8 * TPS, target: "objective_sightline", priority: 0.6, tags: ["espacio", "rompe línea"] },
  // ── Centinela ──
  { id: "incendiary", name: "Incendiary", class: "sentinel", kind: "molly", effect: "delay", charges: 2, cooldown: 5 * TPS, duration: 5 * TPS, target: "push_choke", priority: 0.85, combat: { suppress: 0.18 }, tags: ["molly", "ralentiza"] },
  { id: "trapwire", name: "Trapwire", class: "sentinel", kind: "cover", effect: "anchor", charges: 2, cooldown: 6 * TPS, duration: 14 * TPS, target: "self_zone", priority: 0.8, combat: { reveal: true }, tags: ["trampa", "ancla"] },
  // ── Flex ──
  { id: "phantom_smoke", name: "Phantom Veil", class: "flex", kind: "smoke", effect: "fake", charges: 1, cooldown: 6 * TPS, duration: 8 * TPS, target: "push_choke", priority: 0.65, tags: ["fake", "humo móvil"] },
  { id: "ghost_recon", name: "Ghost Recon", class: "flex", kind: "recon", effect: "reveal", charges: 1, cooldown: 5 * TPS, duration: 4 * TPS, target: "objective_zone", priority: 0.7, combat: { reveal: true }, tags: ["recon", "flanco"] },
  { id: "decoy_flash", name: "Decoy Flash", class: "flex", kind: "flash", effect: "decoy", charges: 1, cooldown: 4 * TPS, duration: 0, target: "enemy_anchor", priority: 0.7, combat: { blind: Math.round(0.9 * TPS) }, tags: ["decoy", "flash"] },

  // ── Genéricas de respaldo (cualquier clase con esa mecánica) ──
  { id: "gen_smoke", name: "Veil", class: "flex", kind: "smoke", effect: "deny_vision", charges: 1, cooldown: 6 * TPS, duration: 9 * TPS, target: "objective_sightline", priority: 0.7, tags: ["humo"] },
  { id: "gen_recon", name: "Scan", class: "flex", kind: "recon", effect: "reveal", charges: 1, cooldown: 5 * TPS, duration: 4 * TPS, target: "objective_zone", priority: 0.7, combat: { reveal: true }, tags: ["recon"] },
  { id: "gen_flash", name: "Flash", class: "flex", kind: "flash", effect: "blind", charges: 1, cooldown: 4 * TPS, duration: 0, target: "enemy_anchor", priority: 0.75, combat: { blind: Math.round(1.0 * TPS) }, tags: ["flash"] },
  { id: "gen_molly", name: "Molly", class: "flex", kind: "molly", effect: "delay", charges: 1, cooldown: 5 * TPS, duration: 5 * TPS, target: "push_choke", priority: 0.7, combat: { suppress: 0.15 }, tags: ["molly"] },
  { id: "gen_cover", name: "Cover", class: "flex", kind: "cover", effect: "protect", charges: 1, cooldown: 6 * TPS, duration: 12 * TPS, target: "objective_zone", priority: 0.65, tags: ["cobertura"] },
];

const BY_ID = new Map(ABILITIES.map((a) => [a.id, a]));
export const getAbility = (id: string): Ability | undefined => BY_ID.get(id);

/** La mejor habilidad para una (clase, mecánica): la con sabor de su clase, o la genérica. */
export function abilityFor(cls: AgentClass, kind: UtilityKind): Ability {
  const flavored = ABILITIES.find((a) => a.class === cls && a.kind === kind);
  if (flavored) return flavored;
  const generic = ABILITIES.find((a) => a.id.startsWith("gen_") && a.kind === kind);
  return generic ?? ABILITIES.find((a) => a.kind === kind) ?? ABILITIES[ABILITIES.length - 1];
}
