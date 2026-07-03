/**
 * Combate: resolución de duelos por ticks.
 *
 * Combat 3.0: cuando hay loadout, el duelo deja de ser binario y pasa por un modelo de DAÑO real
 * (vida + escudo + localización emergente + balística), reutilizando el Combat Integration Engine
 * (`src/combat2`: armas, balística, puntería, movimiento, estadísticas). Sin loadout → combate
 * clásico intacto (muerte por probabilidad). Letal pero con VENTANA DE TRADE. Emergente y
 * determinista (todo el azar entra por el `Rng` del motor).
 */
import type { Rng } from "./rng";
import { dist } from "./geometry";
import { nearestZone } from "./map/ascentA";
import { aimFactor } from "./attributes";
import { allies, canSee } from "./perception";
import { aimMult, onKillMental, tradeRadius } from "./identity/modifiers";
import { clampTrait } from "./identity/traits";
import { loadoutDuelMult } from "../combat2";
import { resolveExchange, type ExchangeResult } from "../combat2/duel";
import { shieldHp } from "../combat2/ballistics";
import { emptyStats } from "../combat2/stats";
import type { RoundState, SimPlayer } from "./types";

const BASE_KILL = 0.17;     // prob. base por tick de cerrar el duelo (clásico, sin loadout)
const HOLDER_EDGE = 1.45;   // ventaja de quien mantiene el ángulo
const PEEKER_PENALTY = 0.8; // desventaja de quien abre (wide swing)
const FLASH_SELF = 0.18;    // cegado: casi no puedes disparar
const FLASH_ENEMY = 1.7;    // disparar a un enemigo cegado
const NEAR = 240;           // radio de "apoyo local" para el aislamiento
const TPS = 20;
const ASSIST_MIN = 25;      // daño mínimo para contar asistencia

/** ¿Está `p` actualmente cegado? */
const blinded = (p: SimPlayer, tick: number) => p.flashedUntil > tick;
const ensureStats = (p: SimPlayer) => (p.cstat ??= emptyStats());

/**
 * AGENT ENGINE en el duelo: el resultado ya no es solo arma>arma. La composición y el
 * agente aportan ESPACIO, CONTROL, AISLAMIENTO y VENTAJA TEMPORAL (todo abstracto,
 * derivado de capacidades + estado; NO habilidades concretas). Sin agentes ⇒ 1.
 */
function agentEdge(s: RoundState, p: SimPlayer, target: SimPlayer): number {
  const comp = s.composition?.[p.side];
  if (!p.agent || !comp) return 1;
  const caps = p.agent.agent.capabilities;
  let m = 1;

  const myMates = s.players.filter((q) => q.alive && q.side === p.side && q.id !== p.id && dist(q.pos, p.pos) < NEAR).length;
  const foeMates = s.players.filter((q) => q.alive && q.side === target.side && q.id !== target.id && dist(q.pos, target.pos) < NEAR).length;
  const iso = Math.max(-2, Math.min(2, myMates - foeMates));
  m *= 1 + iso * 0.05 * (0.6 + caps.trading / 250);

  m *= 1 + ((comp.ratings.control - 50) / 100) * 0.10 * (caps.space / 100 + 0.4);

  if (s.phase === "EXECUTE" && s.executeTick != null && s.tick - s.executeTick < 3 * TPS && p.side === "ATK") {
    m *= 1 + ((comp.ratings.entry - 50) / 100) * 0.12 * (caps.entry / 100 + 0.4);
  }
  if (s.phase === "POSTPLANT" && p.side === "ATK") {
    m *= 1 + ((comp.ratings.postplant - 50) / 100) * 0.10;
  }

  const map = s.map;
  if (map) {
    const zp = nearestZone(p.pos), zt = nearestZone(target.pos);
    const blocked = map.overlay.blockedSight.has(`${zp}|${zt}`) || map.overlay.blockedSight.has(`${zt}|${zp}`);
    const infoOnTarget = map.zones[zt]?.info[p.side] ?? 0;
    if (blocked) m *= infoOnTarget > 0.5 ? 0.95 : 0.7;
    else if (infoOnTarget > 0.6) m *= 1.1;
    if (map.overlay.deniedZones.has(zt)) m *= 1.12;
    if (map.overlay.deniedZones.has(zp)) m *= 0.9;
    if ((map.zones[zp]?.risk[p.side] ?? 0) > 0.7) m *= 0.94;
  }
  return Math.max(0.75, Math.min(1.35, m));
}

/**
 * Ventaja COMBINADA del duelo (sin la prob. base): aim, mente, ángulo, flash, equipamiento y
 * agente. El combate clásico la multiplica por BASE_KILL; el de daño la usa como `edge`.
 */
function combatEdge(s: RoundState, p: SimPlayer, target: SimPlayer, rng: Rng): number {
  let mult = aimFactor(p.attrs.aim) / aimFactor(target.attrs.aim);
  mult *= aimMult(s, p, rng) / aimMult(s, target, rng);
  if (!p.movedThisTick && target.movedThisTick) mult *= HOLDER_EDGE;
  else if (p.movedThisTick && !target.movedThisTick) mult *= PEEKER_PENALTY;
  if (blinded(p, s.tick)) mult *= FLASH_SELF;
  if (blinded(target, s.tick)) mult *= FLASH_ENEMY;
  // Refrag: quien va a tradear llega cebado (sabe dónde está el rival).
  if (p.intent === "trade") mult *= 1.12;
  if (p.loadout && target.loadout) {
    mult *= loadoutDuelMult(p, target, dist(p.pos, target.pos), s.phase);
    // El PODER DE FUEGO agregado (arma+escudo+utilidad) inclina el duelo: mejor equipado, ventaja.
    mult *= Math.pow((p.loadout.firepower + 30) / (target.loadout.firepower + 30), 0.4);
  }
  mult *= agentEdge(s, p, target);
  return mult;
}

/** Supresión sobre `p` (0..1): fuego/riesgo entrante en su zona (Utility Engine). */
function suppressionOn(s: RoundState, p: SimPlayer): number {
  const z = s.map?.zones[nearestZone(p.pos)];
  if (!z) return 0;
  return Math.max(0, Math.min(1, z.risk[p.side] ?? 0));
}

/**
 * Procesa todos los enfrentamientos de este tick. Devuelve los eventos de muerte.
 * Muta el estado (ya clonado por el motor).
 */
export function resolveCombat(s: RoundState, rng: Rng): void {
  // Tiempo vivo (estadística persistente de la ronda).
  for (const p of s.players) if (p.alive) ensureStats(p).ticksAlive++;

  // Orden aleatorio sembrado → simultaneidad justa (permite trades).
  const order = [...s.players].filter((p) => p.alive && p.targetEnemyId)
    .sort(() => (rng.next() < 0.5 ? -1 : 1));

  for (const p of order) {
    if (!p.alive || !p.targetEnemyId) continue;
    const target = s.players.find((q) => q.id === p.targetEnemyId);
    if (!target || !target.alive) { p.targetEnemyId = null; continue; }
    if (!canSee(p, target)) continue;

    // Reacción: hay que "fijar" el objetivo antes de disparar (gameSense).
    if (p.reactBuffer > 0) { p.reactBuffer = Math.max(0, p.reactBuffer - 1); continue; }

    const edge = combatEdge(s, p, target, rng);

    if (p.loadout && target.loadout) {
      // ── Combat 3.0: modelo de DAÑO real ──
      const firstShot = p.engage?.id !== target.id;
      if (firstShot) {
        // "Forma" del duelo: un día rindes y otro no. Todo el mundo tiene altibajos; la
        // INCONSISTENCIA (ADN) los amplía → upsets que dan variedad a rondas y partidos
        // (el mejor mecánico no gana SIEMPRE). Sembrado por el Rng del motor.
        const spread = 0.1 + (1 - clampTrait(p.identity.consistency) / 100) * 0.35;
        p.engage = { id: target.id, since: s.tick, luck: 1 + (rng.next() * 2 - 1) * spread };
      }
      const luck = p.engage?.luck ?? 1;
      const zp = nearestZone(p.pos), zt = nearestZone(target.pos);
      const wallbang = !!s.map && (s.map.overlay.blockedSight.has(`${zp}|${zt}`) || s.map.overlay.blockedSight.has(`${zt}|${zp}`));
      const ex = resolveExchange({
        att: p, def: target, edge: edge * luck, distancePx: dist(p.pos, target.pos),
        phase: s.phase, firstShot, suppression: suppressionOn(s, p), wallbang,
      }, rng);
      applyExchange(s, p, target, ex);
    } else {
      // ── Combate clásico (sin loadout): muerte por probabilidad ──
      if (rng.chance(Math.min(0.92, BASE_KILL * edge))) kill(s, p, target, null);
    }
  }
}

/** Aplica el resultado del intercambio: daño, estadísticas y, si procede, la baja. */
function applyExchange(s: RoundState, att: SimPlayer, def: SimPlayer, ex: ExchangeResult): void {
  const as = ensureStats(att), ds = ensureStats(def);
  as.shotsFired += ex.shotsFired; as.shotsHit += ex.shotsHit;
  as.headshots += ex.headshots; as.bodyshots += ex.bodyshots; as.legshots += ex.legshots;
  const dealt = ex.damageToHp + ex.damageToShield;
  as.damageDealt += dealt;
  ds.damageTaken += ex.damageToHp; ds.damageAbsorbed += ex.damageToShield;
  def.shield = Math.max(0, (def.shield ?? shieldHp(def.loadout?.armor ?? "none")) - ex.damageToShield);
  def.hp = Math.max(0, def.hp - ex.damageToHp);
  def.dmgFrom ??= {};
  def.dmgFrom[att.id] = (def.dmgFrom[att.id] ?? 0) + dealt;

  if (ex.killed || def.hp <= 0) {
    as.overkill += ex.overkill;
    kill(s, att, def, ex);
  }
}

const TRADE_WINDOW = 60; // ticks (~3 s): ventana de refrag (Combat 3.0 alarga el TTK)

function kill(s: RoundState, killer: SimPlayer, victim: SimPlayer, ex: ExchangeResult | null): void {
  victim.alive = false;
  victim.hp = 0;
  victim.shield = 0;
  victim.targetEnemyId = null;
  ensureStats(killer).kills++;

  // Asistencias: aliados del asesino que hicieron daño suficiente a la víctima.
  if (victim.dmgFrom) {
    for (const [id, dmg] of Object.entries(victim.dmgFrom)) {
      if (id === killer.id || dmg < ASSIST_MIN) continue;
      const helper = s.players.find((q) => q.id === id && q.side === killer.side);
      if (helper) ensureStats(helper).assists++;
    }
  }

  const traded = s.events.some(
    (e) => e.type === "kill" && e.tick >= s.tick - TRADE_WINDOW
      && e.data.by === victim.id && e.data.bySide === victim.side,
  );
  const first = !s.events.some((e) => e.type === "kill");
  if (first) {
    s.events.push({ tick: s.tick, type: "firstblood", data: { by: killer.id, side: killer.side, victim: victim.id } });
  }
  s.events.push({
    tick: s.tick, type: "kill",
    data: {
      by: killer.id, byName: killer.name, bySide: killer.side,
      victim: victim.id, victimName: victim.name,
      aimBy: killer.attrs.aim, aimVic: victim.attrs.aim,
      held: !killer.movedThisTick,
      fpBy: killer.loadout?.firepower ?? null,
      fpVic: victim.loadout?.firepower ?? null,
      // Combat 3.0: metadatos del duelo (para narrativa/broadcast).
      weapon: killer.loadout?.primary ?? killer.loadout?.sidearm ?? null,
      headshot: ex?.firstShotHead ?? false,
      oneShot: ex ? ex.shotsHit === 1 : false,
      wallbang: ex?.wallbang ?? false,
      overkill: ex?.overkill ?? 0,
      damage: Math.round(victim.dmgFrom?.[killer.id] ?? 0),
      assists: victim.dmgFrom ? Object.entries(victim.dmgFrom).filter(([id, d]) => id !== killer.id && d >= ASSIST_MIN).length : 0,
      headReasons: ex?.headReasons ?? [],
      traded,
    },
  });

  // Tras matar, el asesino re-adquiere (breve exposición): abre la VENTANA DE TRADE.
  killer.reactBuffer = Math.max(killer.reactBuffer, 2);
  killer.engage = undefined;
  for (const mate of allies(s, victim)) {
    // El que cae "canta" la posición del asesino (comunicación): sus compañeros pueden
    // tradear o rotar hacia esa pista aunque no lo vieran caer.
    mate.lastSeen[killer.id] = { pos: { ...killer.pos }, tick: s.tick };
    if (dist(mate.pos, killer.pos) < tradeRadius(mate)) {
      mate.targetEnemyId = killer.id;
      mate.reactBuffer = 0;
      mate.intent = "trade";
    }
  }
  onKillMental(s, killer, victim, traded);
}
