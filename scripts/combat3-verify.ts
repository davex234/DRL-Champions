/**
 * VERIFICACIÓN DEL COMBAT ENGINE 3.0 — DRL Champions.
 *
 * Comprueba el modelo de daño emergente (HP/escudo/headshots/balística/movimiento/trade/
 * asistencia), su integración en el partido (narrativa/broadcast), el determinismo, el
 * rendimiento y la AUSENCIA de estados imposibles. Reutiliza los motores existentes.
 *
 * Ejecutar: `npx tsx scripts/combat3-verify.ts [partidos]`
 */
import type { Role, RosterEntry, SimPlayer, SimLoadout, Identity } from "../src/sim";
import { PROFILES, neutralIdentity } from "../src/sim";
import { makeRng } from "../src/sim/rng";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import {
  WEAPON_PROFILES, profileFor, shieldHp, baseDamage, resolveHit, movementProfile,
  headshotChance, hitChance, resolveExchange, emptyStats, accuracy, hsPct, buildCombatBroadcast,
  type ShotContext,
} from "../src/combat2";

const N = Math.max(4, Number(process.argv[2] ?? 16));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

console.log("# Verificación del Combat Engine 3.0 — DRL Champions\n");

// ─────────────────────────── helpers ───────────────────────────
function loadout(over: Partial<SimLoadout> = {}): SimLoadout {
  return { primary: "vandal", sidearm: "classic", armor: "heavy", utility: 1, firepower: 90, econValue: 3900, buy: "full", ...over };
}
function player(over: Partial<SimPlayer> = {}): SimPlayer {
  return {
    id: "ATK-0", name: "X", side: "ATK", role: "entry",
    attrs: { aim: 78, gameSense: 78, utility: 78, leadership: 78 },
    identity: neutralIdentity(), mental: { confidence: 60, tilt: 0, morale: 55, momentum: 0, fatigue: 0, pressure: 0 },
    pos: { x: 0, y: 0 }, facing: 0, alive: true, hp: 100, shield: 50, cstat: emptyStats(), dmgFrom: {},
    targetZone: "site", holdPos: { x: 0, y: 0 }, intent: "fight", targetEnemyId: null, lastSeen: {},
    flashedUntil: -1, movedThisTick: false, actionProgress: 0, reactBuffer: 0, loadout: loadout(), ...over,
  };
}
function ctx(over: Partial<ShotContext> = {}): ShotContext {
  const att = player(), def = player({ id: "DEF-0", side: "DEF" });
  return { att, def, weapon: profileFor(att.loadout!), distance: 0.25, attMove: movementProfile(att), defMove: movementProfile(def), firstShot: true, sprayIndex: 0, suppression: 0, edge: 1, ...over };
}

// ─────────────────────────── 1. Armas (14, con personalidad) ───────────────────────────
console.log("## Armas");
const WANTED = ["operator", "marshal", "vandal", "phantom", "bulldog", "guardian", "spectre", "stinger", "judge", "bucky", "sheriff", "ghost", "classic", "frenzy"];
check("las 14 armas pedidas existen", WANTED.every((w) => WEAPON_PROFILES[w]), WANTED.filter((w) => !WEAPON_PROFILES[w]).join(",") || "ok");
check("cada arma tiene daño distinto (personalidad)", new Set(WANTED.map((w) => WEAPON_PROFILES[w].damage.body)).size >= 8);
check("el operator pega más fuerte que la classic", WEAPON_PROFILES.operator.damage.body > WEAPON_PROFILES.classic.damage.body * 4);

// ─────────────────────────── 2. HP / escudo / daño / balística ───────────────────────────
console.log("\n## HP · escudo · daño · penetración");
check("escudo: heavy>light>none", shieldHp("heavy") === 50 && shieldHp("light") === 25 && shieldHp("none") === 0);
const vandal = WEAPON_PROFILES.vandal;
check("headshot > bodyshot > legshot", vandal.damage.head > vandal.damage.body && vandal.damage.body > vandal.damage.leg);
const near = baseDamage(vandal, "body", 0.1), far = baseDamage(WEAPON_PROFILES.phantom, "body", 0.95);
check("falloff: el phantom cae a distancia", far < WEAPON_PROFILES.phantom.damage.body);
check("el vandal NO tiene falloff (falloffStart=1)", baseDamage(vandal, "body", 0.95) === vandal.damage.body, `${near}`);
const hit = resolveHit(vandal, "body", 0.1, 50);
check("el daño se reparte escudo→vida", hit.toShield === 40 && hit.toHp === 0, JSON.stringify(hit));
const hit2 = resolveHit(vandal, "head", 0.1, 25);
check("headshot atraviesa escudo a la vida", hit2.toShield === 25 && hit2.toHp === vandal.damage.head - 25);
const wb = resolveHit(vandal, "body", 0.1, 0, true);
check("wallbang reduce el daño (penetración)", wb.toHp < vandal.damage.body && wb.wallbang);

// ─────────────────────────── 3. Headshots emergentes + explicables ───────────────────────────
console.log("\n## Headshots (emergente y explicable, no binario)");
const goodAim = headshotChance(ctx({ att: player({ identity: { ...neutralIdentity(), discipline: 90, tacticalIQ: 90, composure: 90 }, attrs: { aim: 90, gameSense: 92, utility: 70, leadership: 70 } } as Partial<SimPlayer> as SimPlayer) }));
const badAim = headshotChance(ctx({ att: player({ attrs: { aim: 40, gameSense: 35, utility: 40, leadership: 40 }, movedThisTick: true }) }));
check("mejor crosshair/reacción → más headshot", goodAim.p > badAim.p, `${goodAim.p.toFixed(2)} > ${badAim.p.toFixed(2)}`);
check("headshot acotado (0.03..0.6), nunca binario", goodAim.p <= 0.6 && badAim.p >= 0.03);
check("la probabilidad viene EXPLICADA (razones con deltas)", goodAim.reasons.length >= 2 && goodAim.reasons.every((r) => typeof r.delta === "number"));
const moveCtx = headshotChance(ctx({ defMove: movementProfile(player({ movedThisTick: true })) }));
check("rival entrando en movimiento aporta razón", moveCtx.reasons.some((r) => r.label.includes("movimiento")));

// ─────────────────────────── 4. Movimiento (modificadores, no binario) ───────────────────────────
console.log("\n## Movimiento");
check("quieto = stance hold, máxima precisión", movementProfile(player({ movedThisTick: false })).stance === "hold");
const disc = movementProfile(player({ movedThisTick: true, intent: "fight", identity: { ...neutralIdentity(), discipline: 90 } as Identity }));
const aggro = movementProfile(player({ movedThisTick: true, intent: "fight", identity: { ...neutralIdentity(), aggression: 90, discipline: 20 } as Identity }));
check("disciplinado counter-strafea (más precisión que wide swing)", disc.stance === "counterstrafe" && aggro.stance === "wide" && disc.accuracyMult > aggro.accuracyMult);
check("peek edge acotado (0..0.12)", aggro.peekEdge <= 0.12 && disc.peekEdge >= 0);

// ─────────────────────────── 5. hitChance + intercambio + recoil ───────────────────────────
console.log("\n## Intercambio de duelo");
check("hitChance acotado", hitChance(ctx({ edge: 5 })) <= 0.9 && hitChance(ctx({ edge: 0.01 })) >= 0.03);
check("recoil: el spray pierde precisión (sprayIndex↑ → menos hit)", hitChance(ctx({ sprayIndex: 3 })) < hitChance(ctx({ sprayIndex: 0 })));
const rng = makeRng(12345);
const ex = resolveExchange({ att: player(), def: player({ id: "DEF-0", side: "DEF" }), edge: 1.2, distancePx: 150, phase: "EXECUTE", firstShot: true, suppression: 0, wallbang: false }, makeRng(7));
check("resolveExchange determinista", JSON.stringify(ex) === JSON.stringify(resolveExchange({ att: player(), def: player({ id: "DEF-0", side: "DEF" }), edge: 1.2, distancePx: 150, phase: "EXECUTE", firstShot: true, suppression: 0, wallbang: false }, makeRng(7))));
check("un intercambio puede hacer daño (no binario)", ex.shotsFired > 0);
// TTK: cuántos ticks tarda en matar (debe ser varios, no 1)
let hp = 100, sh = 50, ticks = 0;
const a = player(), d = player({ id: "DEF-0", side: "DEF" });
while (hp > 0 && ticks < 200) {
  d.hp = hp; d.shield = sh;
  const e = resolveExchange({ att: a, def: d, edge: 1, distancePx: 150, phase: "EXECUTE", firstShot: ticks === 0, suppression: 0, wallbang: false }, makeRng(1000 + ticks));
  sh -= e.damageToShield; hp -= e.damageToHp; ticks++;
}
check("TTK realista (mata en varios ticks, no instantáneo)", ticks >= 2 && ticks < 60, `${ticks} ticks`);

// ─────────────────────────── 6. Simulación de partidos (integración) ───────────────────────────
console.log("\n## Integración en partido (HP/trade/asistencia/narrativa/broadcast)");
function roster(profile: keyof typeof PROFILES, tag: string): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 76, gameSense: 76, utility: 76, leadership: 76 }, identity: PROFILES[profile] ?? neutralIdentity(),
  }));
}
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
// Matchup COMPETITIVO (espejo): rondas reñidas → se generan trades/comebacks reales.
const cfg = (seed: number) => makeMatchConfig({ seed, rosters: { home: roster("aggressive-duelist", "AGG"), away: roster("aggressive-duelist", "RIV") }, homeSetup: SETUP, useLoadoutCombat: true });

let dmgSeen = false, absorbedSeen = false, assistsSeen = false, tradesSeen = false, partialHpSeen = false, impossible = 0, allStats = 0;
const eventTypes = new Set<string>();
let t0 = Date.now();
for (let i = 0; i < N; i++) {
  const m: MatchState = simulateMatch(cfg(4200 + i * 13));
  for (const e of m.combatEvents) eventTypes.add(e.type);
  for (const round of m.rounds) {
    for (const p of round.players) {
      const c = p.cstat!;
      allStats++;
      if (c.damageDealt > 0) dmgSeen = true;
      if (c.damageAbsorbed > 0) absorbedSeen = true;
      if (c.assists > 0) assistsSeen = true;
      if (p.alive && p.hp > 0 && p.hp < 100) partialHpSeen = true;
      // Estados imposibles
      if (p.hp < 0 || p.hp > 100) impossible++;
      if ((p.shield ?? 0) < 0 || (p.shield ?? 0) > 50) impossible++;
      if (p.alive && p.hp <= 0) impossible++;
      if (!p.alive && p.hp > 0) impossible++;
      if (c.shotsHit > c.shotsFired) impossible++;
      if (c.headshots + c.bodyshots + c.legshots !== c.shotsHit) impossible++;
      if (c.damageDealt < 0 || c.damageTaken < 0 || c.kills < 0 || c.assists < 0) impossible++;
    }
    if (round.events.some((e) => e.type === "kill" && (e.data as { traded?: boolean }).traded)) tradesSeen = true;
  }
}
const simMs = Date.now() - t0;

check("HP real: hay jugadores que reciben daño parcial y siguen vivos", partialHpSeen);
check("se contabiliza daño hecho", dmgSeen);
check("el escudo absorbe daño (damageAbsorbed>0)", absorbedSeen);
check("hay asistencias", assistsSeen);
check("hay trades reales", tradesSeen);
check("CERO estados imposibles", impossible === 0, `${impossible} sobre ${allStats} jugadores-ronda`);

// Narrativa
console.log("\n## Narrativa de combate (eventos nuevos)");
const NEW_EVENTS = ["one_tap", "entry_kill", "trade", "spray_transfer"];
check("se generan eventos de combate 3.0", eventTypes.size >= 4, [...eventTypes].join(", "));
check("incluye eventos emergentes nuevos", NEW_EVENTS.some((t) => eventTypes.has(t)), NEW_EVENTS.filter((t) => eventTypes.has(t)).join(", "));

// Broadcast
console.log("\n## Broadcast (datos)");
const sample = simulateMatch(cfg(99));
const bc = buildCombatBroadcast(sample.rounds[0], 1);
check("broadcast: 10 líneas con HP/escudo/daño/HS/accuracy", bc.lines.length === 10 && bc.lines.every((l) => typeof l.hp === "number" && typeof l.damageDealt === "number" && typeof l.hsPct === "number"));
check("broadcast: totales (kills/headshots/daño)", typeof bc.totals.kills === "number" && bc.totals.damage >= 0);

// Determinismo
console.log("\n## Determinismo y rendimiento");
const sig = (m: MatchState) => `${m.score.home}-${m.score.away}:${m.combatEvents.length}:${m.rounds.reduce((s, r) => s + r.players.reduce((a, p) => a + (p.cstat?.damageDealt ?? 0), 0), 0)}`;
check("misma config ⇒ mismo resultado (daño incluido)", sig(simulateMatch(cfg(31337))) === sig(simulateMatch(cfg(31337))));
check("rendimiento aceptable", simMs / N < 2500, `${Math.round(simMs / N)} ms/partido`);

// Estadísticas agregadas
console.log("\n## Métricas");
const mm = simulateMatch(cfg(7));
const tot = mm.rounds.reduce((acc, r) => { for (const p of r.players) { const c = p.cstat!; acc.dmg += c.damageDealt; acc.hs += c.headshots; acc.hits += c.shotsHit; } return acc; }, { dmg: 0, hs: 0, hits: 0 });
console.log(`  daño total: ${tot.dmg} · headshots: ${tot.hs} · accuracy media: ${tot.hits ? "(con impactos)" : "—"}`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
void rng; void accuracy; void hsPct;
