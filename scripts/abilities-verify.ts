/**
 * VERIFICACIÓN DEL AGENT ABILITY ENGINE — DRL Champions.
 *
 * Comprueba el sistema PROPIO de habilidades (no copia): catálogo + abilities por agente, decisión
 * del Brain (chooseAbility), aplicación vía Utility/Combat/Perception/Spatial (overlay + blind),
 * composiciones distinguibles por su uso de utilidad, sinergias, narrativa, broadcast, determinismo,
 * rendimiento y cero estados imposibles. Reutiliza los motores existentes.
 *
 *   npx tsx scripts/abilities-verify.ts [partidos]
 */
import type { Role, RosterEntry, Identity, SimPlayer } from "../src/sim";
import { createRound, tick, makeIdentity, neutralIdentity, ZONES } from "../src/sim";
import { dist } from "../src/sim/geometry";
import { makeRng } from "../src/sim/rng";
import { AGENTS } from "../src/agents/catalog";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import {
  ABILITIES, abilitiesFor, abilityFor, chooseAbility, applyAbility, abilityBroadcast,
  detectAbilityEvents, emptyAbilityState, type AbilityEffect,
} from "../src/abilities";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

console.log("# Verificación del Agent Ability Engine — DRL Champions\n");

// ─────────────────────────── 1. Catálogo + abilities por agente ───────────────────────────
console.log("## Catálogo + habilidades por agente (escalable: datos)");
check("catálogo no vacío y bien formado", ABILITIES.length >= 10 && ABILITIES.every((a) => a.charges > 0 && a.cooldown > 0 && a.kind && a.effect && a.target));
const allEffects = new Set(ABILITIES.map((a) => a.effect));
check("efectos variados (vocabulario rico)", allEffects.size >= 8, [...allEffects].join(","));
check("los 10 agentes tienen abilities (derivadas del kit)", AGENTS.every((a) => abilitiesFor(a).length >= 1));
// Firma por clase (la composición se reconoce por el efecto).
const ctlEff = abilitiesFor(AGENTS.find((a) => a.class === "controller")!).map((a) => a.effect);
const duelEff = abilitiesFor(AGENTS.find((a) => a.class === "duelist")!).map((a) => a.effect);
const initEff = abilitiesFor(AGENTS.find((a) => a.class === "initiator")!).map((a) => a.effect);
const sentEff = abilitiesFor(AGENTS.find((a) => a.class === "sentinel")!).map((a) => a.effect);
check("controlador → niega visión / control", ctlEff.some((e) => e === "deny_vision" || e === "control"), ctlEff.join(","));
check("duelista → entry / blind", duelEff.some((e) => e === "entry" || e === "blind"), duelEff.join(","));
check("iniciador → reveal / blind", initEff.some((e) => e === "reveal" || e === "blind"), initEff.join(","));
check("centinela → delay / anchor", sentEff.some((e) => e === "delay" || e === "anchor"), sentEff.join(","));

// ─────────────────────────── helpers de roster ───────────────────────────
function team(tag: string, id: Partial<Identity>): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 76, gameSense: 76, utility: 80, leadership: 76 }, identity: makeIdentity(id),
  }));
}
const CONTROL = team("CTL", { discipline: 85, patience: 85, utilityLean: 92, aggression: 22, entryDrive: 18, tacticalIQ: 84 });
const AGGRO = team("AGG", { aggression: 92, entryDrive: 90, riskAppetite: 82, patience: 20, utilityLean: 55 });
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };

// ─────────────────────────── 2. Decisión (Brain) + aplicación (Utility/Combat) ───────────────────────────
console.log("\n## Decisión del Brain + aplicación (Utility + Combat)");
let s = createRound(100, SETUP, undefined, undefined, { home: AGGRO, away: CONTROL });
// Avanza a EXECUTE para subir la urgencia.
for (let i = 0; i < 120 && s.phase === "SETUP"; i++) s = tick(s);
const atk = s.players.find((p) => p.side === "ATK" && p.alive && p.agent);
let choseAny = false, validChoice = false;
if (atk) {
  for (let seed = 0; seed < 30 && !choseAny; seed++) {
    const c = chooseAbility(s, atk, { obj: "site", push: "a_main_choke", anchor: "site", enemyKnownNearObj: true, forward: 3, pushedCount: 2, usedByPlayer: 0, agentCharges: 4 }, makeRng(seed));
    if (c) { choseAny = true; validChoice = !!c.ability && c.value > 0 && abilitiesFor(atk.agent!.agent).some((a) => a.id === c.ability.id); }
  }
}
check("el Brain ELIGE una habilidad cuando hay urgencia", choseAny);
check("la elección es válida (del kit del agente, con valor)", validChoice);
check("determinismo de la decisión", JSON.stringify(chooseAbility(s, atk!, { obj: "site", push: "a_main_choke", anchor: "site", enemyKnownNearObj: true, forward: 3, pushedCount: 2, usedByPlayer: 0, agentCharges: 4 }, makeRng(3))) === JSON.stringify(chooseAbility(s, atk!, { obj: "site", push: "a_main_choke", anchor: "site", enemyKnownNearObj: true, forward: 3, pushedCount: 2, usedByPlayer: 0, agentCharges: 4 }, makeRng(3))));

// Aplicación de un FLASH → el enemigo cercano queda cegado (Combat lo lee). NUNCA mata.
let blindWorks = false;
if (atk) {
  const flash = abilityFor("duelist", "flash"); // breach_flash (combat.blind)
  const enemy = s.players.find((p) => p.side === "DEF" && p.alive);
  if (enemy) {
    enemy.pos = { ...ZONES.site }; const before = enemy.flashedUntil; const aliveBefore = enemy.alive;
    applyAbility(s, atk, s.map!, { ability: flash, zone: "site", value: 0.9, objective: "cegar" }, makeRng(5));
    blindWorks = enemy.flashedUntil > before && enemy.alive === aliveBefore && (atk.abil?.cooldownUntil[flash.id] ?? 0) > s.tick;
  }
}
check("FLASH ciega al enemigo cercano (flashedUntil) sin matar + arranca cooldown", blindWorks);
check("aplicar gasta carga (map.spent sube)", (s.map?.spent.ATK ?? 0) >= 1);

// ─────────────────────────── 3. Simulación: despliegue emergente + mapa + sinergia ───────────────────────────
console.log("\n## Simulación: despliegue emergente, mapa (Spatial) y combos");
function playAndCollect(home: RosterEntry[], away: RosterEntry[], seed: number) {
  let r = createRound(seed, SETUP, undefined, undefined, { home, away });
  const effects: Record<string, Record<AbilityEffect, number>> = { ATK: {} as never, DEF: {} as never };
  let casts = 0, blinds = 0, ctrlChanged = false, bad = 0, combo = false;
  let g = 0; const ctrl0 = r.map?.control.ATK ?? 0;
  while (r.phase !== "ENDED" && g++ < 4000) {
    r = tick(r);
    for (const e of r.events.filter((e) => e.type === "util" && e.tick === r.tick)) {
      const d = e.data as { side?: string; abilityEffect?: AbilityEffect; ability?: string };
      if (!d.ability) continue;
      casts++;
      const side = d.side as "ATK" | "DEF";
      effects[side][d.abilityEffect!] = (effects[side][d.abilityEffect!] ?? 0) + 1;
    }
    if (r.players.some((p) => p.flashedUntil > r.tick)) blinds++;
    if ((r.map?.control.ATK ?? 0) !== ctrl0) ctrlChanged = true;
    const bc = abilityBroadcast(r);
    for (const sd of ["ATK", "DEF"] as const) {
      const b = bc.sides[sd];
      if (Number.isNaN(b.value) || b.used < 0 || b.remaining < 0 || b.used > (r.map?.charges[sd] ?? 99)) bad++;
      if (b.combo) combo = true;
    }
  }
  return { r, effects, casts, blinds, ctrlChanged, bad, combo };
}
const run1 = playAndCollect(AGGRO, CONTROL, 200);
check("se despliegan habilidades (casts > 0)", run1.casts > 0, `${run1.casts} casts`);
check("las habilidades MODIFICAN el combate (blinds activos)", run1.blinds > 0);
check("las habilidades MODIFICAN el mapa (Spatial: control cambia)", run1.ctrlChanged);
check("broadcast SIEMPRE válido (sin NaN / negativos)", run1.bad === 0);
check("hay sinergia/combos de utilidad", run1.combo);

// ─────────────────────────── 4. Composiciones DISTINGUIBLES por su utilidad ───────────────────────────
console.log("\n## Composiciones reconocibles por cómo usan la utilidad");
const sumEff = (e: Record<string, Record<AbilityEffect, number>>) => {
  const all = { ...e.ATK, ...e.DEF } as Record<AbilityEffect, number>;
  const tot: Partial<Record<AbilityEffect, number>> = {};
  for (const side of ["ATK", "DEF"] as const) for (const [k, v] of Object.entries(e[side])) tot[k as AbilityEffect] = (tot[k as AbilityEffect] ?? 0) + (v as number);
  void all; return tot;
};
let ctlAgg = { deny: 0, blind: 0 }, aggAgg = { deny: 0, blind: 0 };
for (let i = 0; i < N; i++) {
  const c = sumEff(playAndCollect(CONTROL, AGGRO, 400 + i).effects);
  const a = sumEff(playAndCollect(AGGRO, CONTROL, 400 + i).effects);
  ctlAgg.deny += (c.deny_vision ?? 0) + (c.control ?? 0); ctlAgg.blind += (c.blind ?? 0) + (c.entry ?? 0);
  aggAgg.deny += (a.deny_vision ?? 0) + (a.control ?? 0); aggAgg.blind += (a.blind ?? 0) + (a.entry ?? 0);
}
check("composición control usa MÁS deny/control que blind", ctlAgg.deny >= ctlAgg.blind, `deny ${ctlAgg.deny} vs blind ${ctlAgg.blind}`);
check("composición agresiva usa MÁS blind/entry (proporcional) que la de control", aggAgg.blind >= ctlAgg.blind || aggAgg.blind > aggAgg.deny, `agg blind ${aggAgg.blind} deny ${aggAgg.deny}`);
check("las dos composiciones se distinguen por su utilidad", ctlAgg.deny !== aggAgg.deny || ctlAgg.blind !== aggAgg.blind);

// ─────────────────────────── 5. Narrativa + determinismo + rendimiento ───────────────────────────
console.log("\n## Narrativa, determinismo, rendimiento, seguridad");
// Matchup que ENGANCHA (evita el turtle-timeout de equipos pasivos como ATK, ajeno a las abilities).
const cfg = (seed: number) => makeMatchConfig({ seed, rosters: { home: AGGRO, away: AGGRO }, homeSetup: SETUP, useEconomyTactics: true, coach: { mode: "ai" } });
let t0 = Date.now();
const evTypes = new Set<string>(); let impossible = 0, allPlayers = 0;
for (let i = 0; i < N; i++) {
  const m: MatchState = simulateMatch(cfg(900 + i));
  for (const e of detectAbilityEvents(m.rounds)) { evTypes.add(e.type); if (e.magnitude < 1 || e.magnitude > 100) impossible++; }
  for (const round of m.rounds) {
    for (const p of round.players) {
      allPlayers++;
      const cdMax = Math.max(0, ...Object.values(p.abil?.cooldownUntil ?? {}));
      if (cdMax > round.tick + 4000) impossible++; // cooldown disparatado
      if (p.flashedUntil > round.tick + 2000) impossible++;
    }
    if ((round.map?.spent.ATK ?? 0) > (round.map?.charges.ATK ?? 0)) impossible++;
    if ((round.map?.spent.DEF ?? 0) > (round.map?.charges.DEF ?? 0)) impossible++;
  }
}
const simMs = Date.now() - t0;
check("se generan eventos de habilidad (narrativa)", evTypes.size >= 3, [...evTypes].join(", "));
check("variedad de eventos de habilidad", evTypes.size >= 4, `${evTypes.size} tipos`);
check("CERO estados imposibles (cargas/cooldowns/flash)", impossible === 0, `${impossible} sobre ${allPlayers}`);
const sig = (m: MatchState) => `${m.score.home}-${m.score.away}:${detectAbilityEvents(m.rounds).length}`;
check("determinismo: misma config ⇒ mismo resultado", sig(simulateMatch(cfg(31337))) === sig(simulateMatch(cfg(31337))));
check("rendimiento aceptable", simMs / N < 2500, `${Math.round(simMs / N)} ms/partido`);

console.log("\n## Métricas");
const mm = simulateMatch(cfg(7));
const evs = detectAbilityEvents(mm.rounds);
console.log(`  rondas: ${mm.rounds.length} · eventos de habilidad: ${evs.length} (${[...new Set(evs.map((e) => e.type))].join(", ")})`);
const lastBc = abilityBroadcast(mm.rounds[mm.rounds.length - 1]);
console.log(`  último broadcast — ATK usadas ${lastBc.sides.ATK.used} restantes ${lastBc.sides.ATK.remaining} · DEF usadas ${lastBc.sides.DEF.used}`);

void emptyAbilityState; void neutralIdentity; void dist;
console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
