/**
 * COMBAT 3.0 · DUELO — resuelve UN intercambio (un tick) entre atacante y defensor. PURO: no muta
 * el estado; calcula los disparos contra una copia local de escudo/vida y DEVUELVE el desglose.
 * El motor (`sim/combat.ts`) aplica el resultado, lleva las estadísticas y emite los eventos.
 *
 * Reutiliza: weapons (perfil + balística), aim (hit/headshot emergentes), movement (estilos).
 * Nada es binario: spray (varios disparos/tick), localización emergente, falloff, escudo, wallbang.
 */
import type { Rng } from "../sim/rng";
import type { SimPlayer, Phase } from "../sim/types";
import { profileFor } from "./weapons";
import { resolveHit, shieldHp, type HitLocation, type ShotDamage } from "./ballistics";
import { movementProfile } from "./movement";
import { hitChance, headshotChance, type ShotContext } from "./aim";

const MAX_DIST = 600;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface ShotResult extends ShotDamage { headReasons?: { label: string; delta: number }[] }

export interface ExchangeResult {
  shotsFired: number;
  shotsHit: number;
  damageToHp: number;
  damageToShield: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  killed: boolean;
  overkill: number;
  firstShotHead: boolean;
  wallbang: boolean;
  /** Explicación del headshot decisivo (para narrativa/broadcast). */
  headReasons: { label: string; delta: number }[];
}

export interface ExchangeInput {
  att: SimPlayer;
  def: SimPlayer;
  /** Ventaja combinada del duelo ya calculada por el motor (aim/mental/holder/flash/loadout/agente). */
  edge: number;
  /** Distancia en px. */
  distancePx: number;
  phase: Phase;
  /** Primer disparo del enfrentamiento (pre-apuntado). */
  firstShot: boolean;
  /** Supresión sobre el atacante (0..1). */
  suppression: number;
  /** ¿El disparo cruza humo/pared (wallbang)? */
  wallbang: boolean;
}

/** Reparte un impacto contra escudo/vida locales y devuelve el desglose + nuevos valores. */
function applyLocal(hit: ShotDamage, shield: number, hp: number): { shield: number; hp: number } {
  return { shield: shield - hit.toShield, hp: hp - hit.toHp };
}

/** Resuelve el intercambio de un tick. Determinista dado el `rng`. */
export function resolveExchange(inp: ExchangeInput, rng: Rng): ExchangeResult {
  const { att, def, edge, phase } = inp;
  const weapon = profileFor(att.loadout!);
  const attMove = movementProfile(att);
  const defMove = movementProfile(def);
  const distance = clamp(inp.distancePx / MAX_DIST, 0, 1);

  let shield = Math.max(0, def.shield ?? shieldHp(def.loadout?.armor ?? "none"));
  let hp = def.hp;

  const res: ExchangeResult = {
    shotsFired: 0, shotsHit: 0, damageToHp: 0, damageToShield: 0,
    headshots: 0, bodyshots: 0, legshots: 0, killed: false, overkill: 0,
    firstShotHead: false, wallbang: inp.wallbang, headReasons: [],
  };

  const shots = Math.max(1, Math.round(weapon.shots * (phase === "POSTPLANT" ? 1 : 1)));
  for (let i = 0; i < shots && hp > 0; i++) {
    const ctx: ShotContext = {
      att, def, weapon, distance, attMove, defMove,
      firstShot: inp.firstShot && i === 0, sprayIndex: i, suppression: inp.suppression, edge,
    };
    res.shotsFired++;
    if (!rng.chance(hitChance(ctx))) continue;
    res.shotsHit++;

    // Localización emergente: cabeza (prob. explicable) → si no, pierna pequeña → cuerpo.
    const head = headshotChance(ctx);
    let location: HitLocation;
    if (rng.chance(head.p)) { location = "head"; res.headshots++; if (i === 0 && inp.firstShot) res.firstShotHead = true; if (!res.headReasons.length) res.headReasons = head.reasons.slice(0, 3); }
    else if (rng.chance(0.12)) { location = "leg"; res.legshots++; }
    else { location = "body"; res.bodyshots++; }

    const hit = resolveHit(weapon, location, distance, shield, inp.wallbang);
    ({ shield, hp } = applyLocal(hit, shield, hp));
    res.damageToShield += hit.toShield;
    res.damageToHp += hit.toHp;
    if (hp <= 0) { res.killed = true; res.overkill = Math.max(0, -hp); break; }
  }
  return res;
}
