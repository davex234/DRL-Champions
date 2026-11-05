/**
 * COMBAT INTEGRATION ENGINE — API pública.
 *
 * Capa de resolución que ENRIQUECE el combate del sim con el Loadout (no lo sustituye).
 * Las armas son modificadores de comportamiento/resolución; nunca control directo. El
 * núcleo sigue siendo `src/sim/combat.ts`, que aplica `loadoutDuelMult` cuando hay
 * loadout (si no, combate clásico intacto).
 */
export { loadoutDuelMult } from "./resolve";
export { WEAPON_PROFILES, profileFor, effectiveValue, type WeaponProfile, type WeaponDamage } from "./weapons";
export { shieldEffect, type ShieldEffect } from "./shield";
export { utilityEffect, type UtilityEffect } from "./utility";
export { teamPosture, type TeamPosture } from "./posture";
export { detectCombatEvents, type CombatEvent, type CombatEventType } from "./narrative";
// — Combat 3.0 —
export { shieldHp, baseDamage, resolveHit, type HitLocation, type ShotDamage } from "./ballistics";
export { movementProfile, type MovementProfile, type Stance } from "./movement";
export { crosshairPlacement, reactionQuality, headshotChance, hitChance, type ShotContext } from "./aim";
export { resolveExchange, type ExchangeResult, type ExchangeInput } from "./duel";
export { emptyStats, adr, accuracy, hsPct, type CombatStats } from "./stats";
export { buildCombatBroadcast, type CombatBroadcast, type CombatBroadcastLine } from "./broadcast";
