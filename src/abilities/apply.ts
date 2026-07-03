/**
 * AGENT ABILITY ENGINE — APLICACIÓN.
 *
 * Realiza una habilidad ELEGIDA REUTILIZANDO los motores existentes: crea una `ActiveUtility` del
 * Utility Engine (humo/molly/recon/cover → overlay que consumen Perception/Combat/Spatial), aplica
 * el BLIND vía `flashedUntil` (Combat ya lo lee) y el CONCUSS vía `reactBuffer`. NUNCA mata: solo
 * modula. Gasta carga, arranca cooldown y emite el evento de cast (narrativa/broadcast).
 */
import type { Rng } from "../sim/rng";
import type { RoundState, SimPlayer, Side } from "../sim/types";
import { dist } from "../sim/geometry";
import { ZONES, type ZoneId } from "../sim/map/ascentA";
import type { ActiveUtility, EffectType, MapState } from "../utility/types";
import type { AbilityChoice } from "./types";
import { emptyAbilityState } from "./types";

/** Efecto agregado en el mapa según mecánica + lado + fase (mismo lenguaje que el Utility Engine). */
function mapEffectOf(kind: string, side: Side, planted: boolean): EffectType {
  if (kind === "smoke") return side === "ATK" ? "open_execute" : "close_execute";
  if (kind === "recon") return "give_info";
  if (kind === "molly") return side === "DEF" ? "delay" : "create_space";
  if (kind === "flash") return side === "ATK" ? "open_execute" : "close_execute";
  return planted ? "protect_postplant" : "create_space"; // cover
}

/**
 * Aplica la habilidad. Muta el estado (ya clonado por el motor) y DEVUELVE la `ActiveUtility`
 * (el Utility Engine la añade a `map.active`). Determinista dado el `rng`.
 */
export function applyAbility(s: RoundState, p: SimPlayer, map: MapState, choice: AbilityChoice, rng: Rng): ActiveUtility {
  const { ability: ab } = choice;
  const planted = s.spike.planted;
  const effect = mapEffectOf(ab.kind, p.side, planted);
  const target: ZoneId | undefined = choice.zone ?? choice.sightline?.[0];

  // — BLIND (flash): ciega a los enemigos cercanos al objetivo (Combat lee `flashedUntil`). —
  if (ab.combat?.blind && target) {
    const blind = ab.combat.blind;
    for (const e of s.players) {
      if (e.side === p.side || !e.alive) continue; // solo enemigos vivos
      if (dist(e.pos, ZONES[target]) < 220) {
        e.flashedUntil = Math.max(e.flashedUntil, s.tick + Math.round(blind * (rng.next() * 0.4 + 0.8)));
      }
    }
  }
  // — CONCUSS: aturde (sube el buffer de reacción de los enemigos en la zona). —
  if (ab.combat?.concuss && target) {
    for (const e of s.players) {
      if (e.side === p.side || !e.alive) continue;
      if (dist(e.pos, ZONES[target]) < 200) e.reactBuffer += Math.round(ab.combat.concuss * 6);
    }
  }
  // (deny_vision/reveal/suppress/delay se realizan SOLOS vía el overlay: smoke→blockedSight,
  //  recon→revealedZones, molly→deniedZones; Perception/Combat ya los consumen.)

  // Gasto + cooldown.
  map.used[p.id] = (map.used[p.id] ?? 0) + 1;
  map.spent[p.side]++;
  (p.abil ??= emptyAbilityState()).cooldownUntil[ab.id] = s.tick + ab.cooldown;

  s.events.push({
    tick: s.tick, type: "util",
    data: {
      kind: ab.kind, effect, ability: ab.id, abilityName: ab.name, abilityEffect: ab.effect,
      by: p.id, byName: p.name, side: p.side, zone: choice.zone ?? null, value: choice.value, objective: choice.objective,
    },
  });

  return {
    id: `${p.id}-${s.tick}`, by: p.id, side: p.side, kind: ab.kind, effect,
    zone: choice.zone, sightline: choice.sightline,
    startTick: s.tick, untilTick: s.tick + ab.duration, objective: choice.objective,
  };
}
