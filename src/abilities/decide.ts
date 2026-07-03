/**
 * AGENT ABILITY ENGINE — DECISIÓN (capa Brain).
 *
 * Cada tick, para un jugador, decide USAR / GUARDAR / ESPERAR una habilidad mediante evaluación
 * CONTINUA del valor esperado: urgencia (fase + estado del mapa) + relevancia del efecto al
 * objetivo + ADN + estado mental + maestría, respetando cargas (presupuesto de ronda) y cooldowns.
 * PURO/determinista (el azar entra por el Rng). No mueve ni mata: solo elige la habilidad.
 */
import type { Rng } from "../sim/rng";
import type { RoundState, SimPlayer, Side } from "../sim/types";
import { nearestZone, type ZoneId } from "../sim/map/ascentA";
import { clampTrait } from "../sim/identity/traits";
import { abilitiesFor } from "./agentAbilities";
import type { Ability, AbilityChoice, AbilityEffect } from "./types";

/** Contexto de despliegue que entrega el Utility Engine (reutiliza su lectura del mapa). */
export interface DeployCtx {
  obj: ZoneId;
  push: ZoneId;
  anchor: ZoneId;
  enemyKnownNearObj: boolean;
  forward: number;
  pushedCount: number;
  usedByPlayer: number;
  agentCharges: number;
}

/** Relevancia del efecto dado fase/lado/objetivo (0..1). De aquí emerge el ESTILO por composición. */
function relevance(effect: AbilityEffect, phase: RoundState["phase"], side: Side, planted: boolean): number {
  const exec = phase === "EXECUTE", setup = phase === "SETUP";
  switch (effect) {
    case "deny_vision": case "create_space": case "control": case "fake": case "entry": case "block":
      return side === "ATK" ? (exec ? 1 : setup ? 0.6 : 0.4) : (setup ? 0.7 : 0.4);
    case "reveal":
      return setup ? 0.9 : planted ? (side === "DEF" ? 0.8 : 0.4) : 0.6;
    case "blind": case "decoy": case "concuss":
      return side === "ATK" ? (exec ? 1 : 0.4) : (planted ? 0.85 : 0.45);
    case "delay": case "suppress": case "slow": case "force_rotation": case "pressure":
      return side === "DEF" ? (planted ? 0.55 : 0.85) : (planted ? 0.7 : 0.35);
    case "protect": case "anchor": case "post_plant": case "retake": case "bait": case "trade":
      return planted ? 0.9 : 0.45;
    case "escape":
      return 0.3;
    default: return 0.5;
  }
}

/** Urgencia EMERGENTE (sin reloj): nace del estado del mapa + ADN + mente + maestría. */
function urgency(s: RoundState, p: SimPlayer, ctx: DeployCtx): number {
  const planted = s.spike.planted;
  const id = p.identity;
  let urge: number;
  if (p.side === "ATK") {
    urge = (s.phase === "EXECUTE" ? 0.6 : 0.1) + ctx.forward * 0.12 + (ctx.enemyKnownNearObj ? 0.2 : 0);
    if (planted) urge = 0.55;
  } else {
    urge = (ctx.pushedCount > 0 ? 0.3 + ctx.pushedCount * 0.12 : 0.08) + (planted ? 0.5 : 0);
  }
  if (clampTrait(id.creativity) > 66) urge += 0.12;                       // el creativo se adelanta
  if (clampTrait(id.discipline) > 62 && !ctx.enemyKnownNearObj && s.phase !== "EXECUTE" && !planted) urge *= 0.6; // el disciplinado guarda
  urge += (p.mental.confidence - 50) / 250;                                // confianza adelanta
  urge -= (p.mental.pressure / 100) * 0.1;                                 // presión retrae
  urge *= p.agent?.mastery ?? 1;
  // ÓRDENES DEL ENTRENADOR (Coach Command Layer) — punto único de inserción.
  if (p.side === s.coachSide) {
    if (s.coachFlags.saveUtility) return 0;          // "guardar utilidad" → no gastar
    if (s.coachFlags.pushUtility) urge += 0.4;       // "usar utilidad ya" → adelantar
  }
  return urge;
}

/** Resuelve el objetivo (zona/sightline) de la habilidad sobre el mapa. */
function resolveTarget(ab: Ability, s: RoundState, p: SimPlayer, ctx: DeployCtx): { zone?: ZoneId; sightline?: [ZoneId, ZoneId] } {
  switch (ab.target) {
    case "objective_sightline": return { sightline: [ctx.anchor, ctx.obj] };
    case "objective_zone": return { zone: ctx.obj };
    case "push_choke": return { zone: p.side === "ATK" ? ctx.obj : ctx.push };
    case "enemy_anchor": return { zone: ctx.anchor };
    case "self_zone": return { zone: nearestZone(p.pos) };
    case "plant": return { zone: "plant" };
  }
}

/**
 * Elige la habilidad a usar AHORA (o null = guardar/esperar). El Brain decide por VALOR.
 */
export function chooseAbility(s: RoundState, p: SimPlayer, ctx: DeployCtx, rng: Rng): AbilityChoice | null {
  if (!p.agent) return null;
  if (ctx.usedByPlayer >= ctx.agentCharges) return null; // presupuesto de ronda agotado

  const urge = urgency(s, p, ctx);
  if (urge < 0.55 || rng.next() > 0.5) return null; // guardar/esperar (humaniza, sembrado)

  const planted = s.spike.planted;
  const cdUntil = p.abil?.cooldownUntil ?? {};
  let best: Ability | null = null, bestVal = 0;
  for (const ab of abilitiesFor(p.agent.agent)) {
    if ((cdUntil[ab.id] ?? -1) > s.tick) continue;     // en recuperación
    const val = ab.priority * relevance(ab.effect, s.phase, p.side, planted);
    if (val > bestVal) { bestVal = val; best = ab; }
  }
  if (!best || bestVal < 0.45) return null;

  const tgt = resolveTarget(best, s, p, ctx);
  return { ability: best, ...tgt, value: Math.round(bestVal * 100) / 100, objective: objectiveText(best, p.side, planted) };
}

function objectiveText(ab: Ability, side: Side, planted: boolean): string {
  const map: Partial<Record<AbilityEffect, string>> = {
    deny_vision: "cortar visión", reveal: "sacar información", blind: "cegar para abrir",
    delay: "ralentizar el avance", create_space: "crear espacio", control: "controlar la zona",
    anchor: "anclar el sitio", protect: "proteger el espacio", fake: "vender una finta",
    entry: "abrir la entrada", post_plant: "proteger el post-plant", decoy: "señuelo", suppress: "suprimir el ángulo",
  };
  return map[ab.effect] ?? (planted ? "jugar el post-plant" : side === "ATK" ? "tomar espacio" : "defender");
}
