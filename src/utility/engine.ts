/**
 * UTILITY ENGINE — el mapa VIVO.
 *
 * Cada tick: (1) cada jugador decide EMERGENTEMENTE si lanza utilidad (sin scripts de
 * tick), (2) se construye el overlay del Spatial Engine, (3) se recalcula el estado de
 * TODAS las zonas (control/visión/info/riesgo/presión/ocupación) reutilizando
 * `computeControl`/`buildOverlay`/`knownEnemyZones`/`dangerAt`. El estado vive en
 * `RoundState.map` y lo consumen Perception, Combat, Tactical, Coach, Broadcast.
 */
import type { Rng } from "../sim/rng";
import type { RoundState, SimPlayer, Side } from "../sim/types";
import { ZONES, ADJ, nearestZone, type ZoneId } from "../sim/map/ascentA";
import { ascentSpatial, computeControl, buildOverlay, knownEnemyZones, dangerAt } from "../spatial";
import type { Occupancy, UtilityEffect } from "../spatial/types";
import type { ActiveUtility, MapState, ZoneState, ZoneStatus } from "./types";
import { chooseAbility, applyAbility } from "../abilities";

const ZONE_IDS = Object.keys(ZONES) as ZoneId[];
const CHOKES: ZoneId[] = ["a_main_choke", "tree_choke", "mid", "generator"];
const other = (s: Side): Side => (s === "ATK" ? "DEF" : "ATK");
const keyz = (a: ZoneId, b: ZoneId) => `${a}|${b}`;

/** Duración (ticks) de cada tipo de utilidad. */
const DUR: Record<string, number> = { smoke: 200, molly: 100, recon: 80, cover: 240, flash: 0 };

const zeroZone = (): ZoneState => ({
  control: 0, vision: { ATK: 0, DEF: 0 }, pressure: 0, info: { ATK: 0, DEF: 0 },
  risk: { ATK: 0, DEF: 0 }, occ: { ATK: 0, DEF: 0 }, lastInfoTick: { ATK: -999, DEF: -999 }, status: [],
});

/** Estado inicial del mapa (cargas por bando = suma de kits de los agentes). */
export function createMapState(players: SimPlayer[]): MapState {
  const zones = {} as Record<ZoneId, ZoneState>;
  for (const z of ZONE_IDS) zones[z] = zeroZone();
  const charges = { ATK: 0, DEF: 0 };
  for (const p of players) charges[p.side] += p.agent?.agent.utility.charges ?? 0;
  return {
    zones, active: [], overlay: { blockedSight: new Set(), deniedZones: new Set(), revealedZones: new Set() },
    used: {}, spent: { ATK: 0, DEF: 0 }, charges, control: { ATK: 0, DEF: 0 },
  };
}

const zoneOf = (p: SimPlayer): ZoneId => nearestZone(p.pos);

function occupancy(s: RoundState): { occ: Occupancy; count: Record<ZoneId, { ATK: number; DEF: number }>; byZone: Record<Side, ZoneId[]> } {
  const count = {} as Record<ZoneId, { ATK: number; DEF: number }>;
  for (const z of ZONE_IDS) count[z] = { ATK: 0, DEF: 0 };
  for (const p of s.players) if (p.alive) count[zoneOf(p)][p.side]++;
  const byZone: Record<Side, ZoneId[]> = {
    ATK: ZONE_IDS.filter((z) => count[z].ATK > 0),
    DEF: ZONE_IDS.filter((z) => count[z].DEF > 0),
  };
  return { occ: { ATK: byZone.ATK, DEF: byZone.DEF }, count, byZone };
}

const objectiveZone = (s: RoundState): ZoneId => (s.spike.planted ? "plant" : "site");

/** Zona enemiga ocupada más cercana al objetivo (a quién hay que cegar/negar). */
function enemyAnchor(byZone: Record<Side, ZoneId[]>, enemy: Side, obj: ZoneId): ZoneId {
  const zs = byZone[enemy];
  if (zs.length === 0) return enemy === "DEF" ? "site" : "a_main_choke";
  return zs.reduce((a, b) => (dist2(ZONES[b], ZONES[obj]) < dist2(ZONES[a], ZONES[obj]) ? b : a));
}
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Carril por el que el ataque presiona más (para que la defensa lo niegue). */
function pushChoke(count: Record<ZoneId, { ATK: number; DEF: number }>): ZoneId {
  return CHOKES.reduce((a, b) => (count[b].ATK > count[a].ATK ? b : a), "a_main_choke");
}

// ---------------------------------------------------------------------------
// Decisión EMERGENTE de despliegue — DELEGADA al Agent Ability Engine.
//
// El Utility Engine sigue siendo dueño del MAPA: calcula el contexto (ocupación, objetivo, carril
// de push, ancla enemiga) y se lo pasa al Ability Engine, que DECIDE (capa Brain) qué habilidad
// usar y la APLICA (crea la ActiveUtility + blind/concuss). Sin scripts; emergente.
// ---------------------------------------------------------------------------
function considerDeploy(
  s: RoundState, map: MapState, p: SimPlayer, ctx: ReturnType<typeof occupancy>, rng: Rng,
): ActiveUtility | null {
  const inst = p.agent;
  if (!inst || inst.agent.utility.kinds.length === 0) return null;
  const usedN = map.used[p.id] ?? 0;
  const charges = inst.agent.utility.charges;
  if (usedN >= charges) return null;

  const enemy = other(p.side);
  const obj = objectiveZone(s);
  const known = knownEnemyZones(ascentSpatial(), ctx.byZone[p.side], ctx.byZone[enemy], [], map.overlay);
  const adjObj = ADJ[obj] as string[];
  const enemyKnownNearObj = known.includes(obj) || known.some((z) => adjObj.includes(z));
  const push = pushChoke(ctx.count);
  const anchor = enemyAnchor(ctx.byZone, enemy, obj);
  const forward = p.side === "ATK" ? ctx.byZone.ATK.filter((z) => CHOKES.includes(z) || z === "site").length : 0;

  const choice = chooseAbility(s, p, {
    obj, push, anchor, enemyKnownNearObj, forward, pushedCount: ctx.count[push].ATK,
    usedByPlayer: usedN, agentCharges: charges,
  }, rng);
  if (!choice) return null;
  return applyAbility(s, p, map, choice, rng);
}

const toEffect = (u: ActiveUtility): UtilityEffect => ({ kind: u.kind, zone: u.zone, sightline: u.sightline, untilTick: u.untilTick, side: u.side });

// ---------------------------------------------------------------------------
// Tick principal del Utility Engine
// ---------------------------------------------------------------------------
export function tickUtility(s: RoundState, rng: Rng): void {
  if (!s.map) return;
  const map = s.map;
  const sm = ascentSpatial();

  // 1) Caducan las utilidades vencidas.
  map.active = map.active.filter((u) => u.untilTick > s.tick);

  // 2) Ocupación actual.
  const ctx = occupancy(s);

  // 3) Despliegue emergente (un intento por jugador y tick).
  for (const p of s.players) {
    if (!p.alive) continue;
    const u = considerDeploy(s, map, p, ctx, rng);
    if (u) map.active.push(u);
  }

  // 4) Overlay del Spatial Engine (smokes/mollies/recon) → lo consumen perception/combat.
  map.overlay = buildOverlay(map.active.map(toEffect), s.tick);

  // 5) Control del mapa (reutiliza el Spatial Engine, respeta el overlay).
  const control = computeControl(sm, ctx.occ, map.overlay);
  const knownATK = new Set(knownEnemyZones(sm, ctx.byZone.ATK, ctx.byZone.DEF, [], map.overlay));
  const knownDEF = new Set(knownEnemyZones(sm, ctx.byZone.DEF, ctx.byZone.ATK, [], map.overlay));
  const coverZones = new Set(map.active.filter((u) => u.kind === "cover" && u.zone).map((u) => u.zone!));

  let ctrlA = 0, ctrlD = 0;
  for (const z of ZONE_IDS) {
    const zs = map.zones[z];
    const sc = control.score[z] ?? { ATK: 0, DEF: 0 };
    const max = Math.max(1, sc.ATK + sc.DEF);
    zs.occ = ctx.count[z];
    zs.control = Math.max(-1, Math.min(1, (sc.ATK - sc.DEF) / max));
    zs.vision = { ATK: Math.min(1, sc.ATK / max), DEF: Math.min(1, sc.DEF / max) };
    zs.risk = {
      ATK: dangerAt(sm, z, ctx.byZone.DEF, map.overlay),
      DEF: dangerAt(sm, z, ctx.byZone.ATK, map.overlay),
    };
    // Info: conocer presencia enemiga en la zona (visión/recon).
    if (zs.occ.DEF > 0 && knownATK.has(z)) { zs.info.ATK = 1; zs.lastInfoTick.ATK = s.tick; } else zs.info.ATK *= 0.97;
    if (zs.occ.ATK > 0 && knownDEF.has(z)) { zs.info.DEF = 1; zs.lastInfoTick.DEF = s.tick; } else zs.info.DEF *= 0.97;
    // Presión: enemigo en zona adyacente (avance inminente) + denegación activa.
    const enemyAdjATK = ADJ[z].reduce((m, a) => Math.max(m, ctx.count[a].DEF), 0);
    const enemyAdjDEF = ADJ[z].reduce((m, a) => Math.max(m, ctx.count[a].ATK), 0);
    zs.pressure = Math.min(1, Math.max(enemyAdjATK, enemyAdjDEF) * 0.34 + (map.overlay.deniedZones.has(z) ? 0.4 : 0));

    if (control.owner[z] === "ATK") ctrlA++; else if (control.owner[z] === "DEF") ctrlD++;
    zs.status = deriveStatus(z, zs, map, control.owner[z], coverZones);
  }
  map.control = { ATK: ctrlA, DEF: ctrlD };
}

function deriveStatus(z: ZoneId, zs: ZoneState, map: MapState, owner: Side | null, cover: Set<ZoneId>): ZoneStatus[] {
  const st: ZoneStatus[] = [];
  const smoked = map.active.some((u) => u.kind === "smoke" && u.sightline && (u.sightline[0] === z || u.sightline[1] === z));
  if (Math.abs(zs.control) > 0.4 || owner) st.push("controlled");
  if (map.overlay.revealedZones.has(z) || (owner === "ATK" ? zs.info.ATK > 0.6 : zs.info.DEF > 0.6)) st.push("revealed");
  if (smoked) { st.push("smoked"); st.push("blocked"); }
  if (map.overlay.deniedZones.has(z)) st.push("closed");
  if (Math.max(zs.risk.ATK, zs.risk.DEF) > 0.6) st.push("dangerous");
  if (zs.pressure > 0.5) st.push("pressured");
  if (cover.has(z)) st.push("controlled");
  if (owner && (owner === "ATK" ? zs.vision.DEF : zs.vision.ATK) > 0.5) st.push("threatened");
  if (owner && zs.occ[other(owner)] === 0 && (owner === "ATK" ? zs.risk.ATK : zs.risk.DEF) < 0.3) st.push("cleared");
  if (!owner && (z === "site" || z === "mid" || CHOKES.includes(z))) st.push("open");
  return [...new Set(st)];
}
