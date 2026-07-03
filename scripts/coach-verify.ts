/**
 * VERIFICACIÓN DE COACH EXPERIENCE 2.0 — DRL Champions.
 *
 * El entrenador DECIDE y CAMBIA el partido reutilizando los motores existentes (sin
 * duplicar): el Coach Decision Engine (conceptos/obediencia) + el nuevo Coach Command
 * Layer (órdenes en vivo que llegan al Tactical Director, al Brain y al Ability Engine),
 * intervenciones mentales, timeout/briefing/lecturas/momentos especiales, pizarra,
 * narrativa de coach, broadcast, determinismo, rendimiento y cero estados imposibles.
 *
 *   npx tsx scripts/coach-verify.ts [partidos]
 */
import type { Role, RosterEntry, Identity, RoundState } from "../src/sim";
import { createRound, tick, makeIdentity } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { isValidPlan } from "../src/preparation";
import { emptyModel, type TacticalSetup } from "../src/tactics";
import type { CoachConcept, CoachConfig } from "../src/coach";
import {
  applyCommand, setIgl, availableCommands, COACH_COMMANDS, type CoachCommandId,
  detectCoachEvents, compileChalkboard, coachLiveBroadcast, coachEventsBroadcast,
} from "../src/coach";
import { timeoutDossier } from "../src/lib/match/timeoutDossier";
import { roundBriefing } from "../src/lib/match/briefing";
import { liveCoachReads } from "../src/lib/match/coachLive";
import { detectSpecialMoments } from "../src/lib/match/special";

const N = Math.max(4, Number(process.argv[2] ?? 8));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

console.log("# Verificación de Coach Experience 2.0 — DRL Champions\n");

// ─────────────────────────── helpers de roster ───────────────────────────
function team(tag: string, id: Partial<Identity>): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 78, gameSense: 78, utility: 80, leadership: 78 }, identity: makeIdentity(id),
  }));
}
const AGGRO = team("AGG", { aggression: 90, entryDrive: 88, riskAppetite: 80, patience: 22, utilityLean: 60, discipline: 70 });
const CONTROL = team("CTL", { discipline: 88, patience: 86, utilityLean: 92, aggression: 24, entryDrive: 18, tacticalIQ: 84 });
const SETUP_ATK = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const SETUP_DEF = { side: "DEF" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const tacSetup = (): TacticalSetup => ({
  ATK: { economy: { credits: 4000, buy: "full", lossStreak: 0 }, model: emptyModel(), useSpatial: true },
  DEF: { economy: { credits: 4000, buy: "full", lossStreak: 0 }, model: emptyModel(), useSpatial: true },
});
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const coachedMental = (r: RoundState, key: "confidence" | "tilt" | "morale" | "pressure") =>
  avg(r.players.filter((p) => p.side === r.coachSide).map((p) => p.mental[key]));

// ─────────────────────────── 0. Coach Decision Engine (base, reutilizado) ───────────────────────────
console.log("## Coach Decision Engine (conceptos · influencia · obediencia)");
{
  // Rosters que ENGANCHAN (evitan el turtle-timeout) pero con ADN de obediencia contrastado.
  const home = AGGRO;
  const away = team("MIX", { aggression: 70, tacticalIQ: 80, leadershipDrive: 80, entryDrive: 60 });
  const disc = team("DIS", { discipline: 92, creativity: 12, ego: 20, aggression: 72, entryDrive: 70 });
  const cre = team("CRE", { creativity: 92, discipline: 25, ego: 70, aggression: 78, entryDrive: 75 });
  const cfg = (h: RosterEntry[], a: RosterEntry[], coach: CoachConfig, seed: number) =>
    makeMatchConfig({ seed, rosters: { home: h, away: a }, homeSetup: SETUP_ATK, coach, win: { firstTo: 4, winBy: 1 }, switchAfter: 3, maxRounds: 10 });
  const REPS = Math.min(N, 5);
  const run = (h: RosterEntry[], a: RosterEntry[], coach: CoachConfig) => {
    const t = { concepts: new Set<string>(), changed: 0, deviated: 0, plans: 0, invalid: 0 };
    for (let i = 0; i < REPS; i++) {
      const m = simulateMatch(cfg(h, a, coach, 4000 + i * 11));
      for (const hh of m.history) {
        t.plans++; if (!isValidPlan(hh.plan!)) t.invalid++;
        if (hh.coach) { t.concepts.add(hh.coach.concept); if (hh.coach.changes.length) t.changed++; if (hh.coach.deviated) t.deviated++; }
      }
    }
    return t;
  };
  const ai = run(home, away, { mode: "ai" });
  const discM = run(disc, away, { mode: "manual", concept: "explode_a" as CoachConcept });
  const creM = run(cre, away, { mode: "manual", concept: "explode_a" as CoachConcept });
  check("el Coach IA decide cada ronda + influye en el plan", ai.concepts.size > 0 && ai.changed > 0);
  check("ningún plan imposible", ai.invalid + discM.invalid + creM.invalid === 0);
  check("el ADN modula la obediencia (creativo se desvía más que disciplinado)",
    creM.deviated / Math.max(1, creM.plans) > discM.deviated / Math.max(1, discM.plans),
    `${creM.deviated}/${creM.plans} vs ${discM.deviated}/${discM.plans}`);
}

// ─────────────────────────── 1. Vocabulario de órdenes ───────────────────────────
console.log("\n## Coach Command Layer (vocabulario de órdenes en vivo)");
const ids = Object.keys(COACH_COMMANDS) as CoachCommandId[];
check("vocabulario rico de órdenes (≥ 15)", ids.length >= 15, `${ids.length} órdenes`);
check("toda orden tiene metadatos válidos", ids.every((id) => { const m = COACH_COMMANDS[id]; return !!m.label && !!m.desc && !!m.category && m.voz >= 0; }));
{
  const r = createRound(10, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  const avail = availableCommands(r);
  check("siempre hay decisiones relevantes (availableCommands)", avail.length >= 3, `${avail.length} disponibles`);
  check("la intervención mental siempre está disponible", avail.includes("motivate") && avail.includes("calm"));
}

// ─────────────────────────── 2. Cambios tácticos / ritmo / objetivo ───────────────────────────
console.log("\n## Cambios tácticos, de ritmo y de objetivo (llegan al Director)");
{
  let r = createRound(20, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  r = applyCommand(r, "focus_tree");
  r = tick(r);
  check("cambio de OBJETIVO: el Director reorienta el carril (laneFocus → tactical.lane)", r.tactical?.ATK?.lane === "tree", `lane=${r.tactical?.ATK?.lane}`);

  let r2 = createRound(21, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  r2 = applyCommand(r2, "tempo_up");
  check("cambio de RITMO: tempo del plan = fast + sesgo", r2.plans.ATK.tempo === "fast" && r2.coachFlags.tempoBias === 1);

  // FIX del hueco "coachFlags inerte para el lado táctico": stack agrupa la defensa.
  let d = createRound(22, SETUP_DEF, undefined, tacSetup(), { home: CONTROL, away: AGGRO });
  d = applyCommand(d, "focus_main");
  d = applyCommand(d, "stack");
  d = tick(d);
  const zones = d.players.filter((p) => p.side === "DEF" && p.alive && p.role !== "anchor").map((p) => p.targetZone);
  const stacked = Math.max(0, ...Object.values(zones.reduce<Record<string, number>>((m, z) => { m[z] = (m[z] ?? 0) + 1; return m; }, {})));
  check("cambio TÁCTICO: 'stack' agrupa a la defensa (coachFlags llega al assign táctico)", stacked >= 3, `${stacked} en el mismo choke`);

  let d2 = createRound(23, SETUP_DEF, undefined, tacSetup(), { home: CONTROL, away: AGGRO });
  d2 = applyCommand(d2, "rotate");
  check("orden de ROTACIÓN registrada (forceRotation)", d2.coachFlags.forceRotation === true);
}

// ─────────────────────────── 3. Intervención mental (Brain) ───────────────────────────
console.log("\n## Intervención mental (escribe MentalState → Brain)");
{
  let r = createRound(30, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  const conf0 = coachedMental(r, "confidence");
  r = applyCommand(r, "motivate");
  check("MOTIVAR sube confianza del equipo", coachedMental(r, "confidence") > conf0, `${conf0.toFixed(0)} → ${coachedMental(r, "confidence").toFixed(0)}`);

  let r2 = createRound(31, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  for (const p of r2.players) if (p.side === r2.coachSide) { p.mental.tilt = 60; p.mental.pressure = 60; }
  const tilt0 = coachedMental(r2, "tilt");
  r2 = applyCommand(r2, "calm");
  check("CALMAR baja el tilt del equipo", coachedMental(r2, "tilt") < tilt0, `${tilt0.toFixed(0)} → ${coachedMental(r2, "tilt").toFixed(0)}`);

  let mot = createRound(32, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  let base = createRound(32, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  mot = applyCommand(mot, "motivate");
  for (let i = 0; i < 40; i++) { mot = tick(mot); base = tick(base); }
  check("la confianza motivada sigue por encima tras 40 ticks (llega al Brain)", coachedMental(mot, "confidence") > coachedMental(base, "confidence"));
}

// ─────────────────────────── 4. Utilidad: guardar / usar (Abilities) ───────────────────────────
console.log("\n## Utilidad: guardar vs usar (orden → Ability Engine)");
{
  let save = createRound(40, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  save = applyCommand(save, "save_utility");
  for (let i = 0; i < 240 && save.phase !== "ENDED"; i++) save = tick(save);
  check("GUARDAR utilidad: el lado entrenado no gasta (Abilities lo lee)", (save.map?.spent.ATK ?? 0) === 0, `spent=${save.map?.spent.ATK}`);

  let push = createRound(40, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  push = applyCommand(push, "use_utility");
  for (let i = 0; i < 240 && push.phase !== "ENDED"; i++) push = tick(push);
  check("USAR utilidad: con la orden se despliega (spent > guardar)", (push.map?.spent.ATK ?? 0) > (save.map?.spent.ATK ?? 0), `push=${push.map?.spent.ATK} vs save=${save.map?.spent.ATK}`);
}

// ─────────────────────────── 5. Timeout, briefing, lecturas, momentos ───────────────────────────
console.log("\n## Timeout · Briefing · Lecturas IA · Momentos especiales");
const matchCfg = (seed: number, win = 4) => makeMatchConfig({
  seed, rosters: { home: AGGRO, away: AGGRO }, homeSetup: SETUP_ATK,
  useEconomyTactics: true, coach: { mode: "ai" }, win: { firstTo: win, winBy: 1 }, switchAfter: 3, maxRounds: 12,
});
{
  const m = simulateMatch(matchCfg(50));
  const lastRound = m.rounds[m.rounds.length - 1];
  const dossier = timeoutDossier(m, lastRound);
  check("TIMEOUT: dossier completo (economía + forma + últimas rondas + stats + propuesta)",
    dossier.economy != null && dossier.form.length === 5 && dossier.lastRounds.length > 0 &&
    !!dossier.proposal && dossier.diagnosis.length > 0 && typeof dossier.stats.executes.attempts === "number");
  check("TIMEOUT: sugiere órdenes para tras la pausa", dossier.suggestedCommands.length > 0, dossier.suggestedCommands.join(","));

  const brief = roundBriefing(m, lastRound);
  check("BRIEFING: secciones completas (bien/mal/aprendido/cambió/rival/recomienda/puede)",
    brief.wentWell.length > 0 && brief.wentWrong.length > 0 && brief.learned.length > 0 &&
    brief.changed.length > 0 && brief.rivalExpects.length > 0 && !!brief.aiRecommends.concept && brief.canDo.length > 0);

  const reads = liveCoachReads(m, lastRound);
  check("LECTURAS IA: feed priorizado con sugerencias", reads.length > 0 && reads.some((r) => r.suggests != null) && reads[0].priority >= reads[reads.length - 1].priority);

  const moments = detectSpecialMoments(m, lastRound);
  check("MOMENTOS ESPECIALES: generan decisiones", moments.length > 0 && moments.every((mm) => mm.options.length > 0), `${moments.length} momentos`);
}

// ─────────────────────────── 6. Pizarra táctica ───────────────────────────
console.log("\n## Pizarra táctica (plan paso a paso → ConceptOrder)");
{
  const plan = compileChalkboard([
    { kind: "split", lane: "main" }, { kind: "lurk", count: 1, lane: "tree" },
    { kind: "flash" }, { kind: "smoke" }, { kind: "execute", lane: "main" }, { kind: "post_plant" },
  ]);
  check("la pizarra compila a una orden válida para el Director", plan.valid && !!plan.order.intent && plan.order.lane === "main");
  check("deriva utilidad/lurkers/resumen sin nombres", plan.utility === "entry" && plan.lurkers === 1 && plan.summary.length > 0, plan.summary);
}

// ─────────────────────────── 7. Narrativa de coach + broadcast ───────────────────────────
console.log("\n## Narrativa de entrenador + Broadcast (datos)");
function coachedRunner(round: RoundState): RoundState {
  let r = round, g = 0;
  while (r.phase !== "ENDED" && g++ < 4000) {
    r = tick(r);
    // Órdenes que NO estancan la ronda (evita el turtle-timeout): agresivo + utilidad + calmar.
    if (g === 25 && r.phase !== "ENDED" && r.voz.left > 0) r = applyCommand(r, "aggression");
    if (g === 55 && r.phase !== "ENDED" && r.voz.left > 0) r = applyCommand(r, "use_utility");
    if (g === 95 && r.phase !== "ENDED" && r.voz.left > 0) r = applyCommand(r, "calm");
  }
  return r;
}
{
  const m = simulateMatch(matchCfg(60, 5), coachedRunner);
  check("se generan eventos de ENTRENADOR (narrativa) + el Match los guarda", m.coachEvents.length > 0, [...new Set(m.coachEvents.map((e) => e.type))].join(","));
  const events = detectCoachEvents(m.rounds);
  const kinds = new Set(events.map((e) => e.type));
  check("variedad de eventos de coach (≥ 3 tipos)", kinds.size >= 3, [...kinds].join(","));
  check("BROADCAST: resumen de eventos de coach", coachEventsBroadcast(events).length > 0);

  let r = createRound(61, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  r = applyCommand(r, "aggression");
  r = applyCommand(r, "focus_mid");
  const lb = coachLiveBroadcast(r);
  check("BROADCAST en vivo: órdenes + voz + sesgos activos", lb.orders.total === 2 && lb.voz.left === 1 && lb.activeBiases.length >= 2, lb.activeBiases.join(","));
}

// ─────────────────────────── 8. Cambio de IGL (liderazgo) ───────────────────────────
console.log("\n## Cambio de IGL (liderazgo)");
{
  let r = createRound(70, SETUP_ATK, undefined, tacSetup(), { home: AGGRO, away: CONTROL });
  const target = r.players.find((p) => p.side === "ATK" && p.role !== "igl")!;
  r = setIgl(r, target.id);
  check("el entrenador designa IGL (iglOverrideId)", r.coachFlags.iglOverrideId === target.id);
}

// ─────────────────────────── 9. Determinismo, rendimiento, estados imposibles ───────────────────────────
console.log("\n## Determinismo, rendimiento y seguridad");
{
  const a = simulateMatch(matchCfg(80, 5), coachedRunner);
  const b = simulateMatch(matchCfg(80, 5), coachedRunner);
  check("determinismo: misma config + mismas órdenes ⇒ mismo resultado",
    a.score.home === b.score.home && a.score.away === b.score.away && a.coachEvents.length === b.coachEvents.length);

  let bad = 0, sampled = 0;
  for (let i = 0; i < N; i++) {
    const m = simulateMatch(matchCfg(800 + i, 4), coachedRunner);
    for (const round of m.rounds) {
      if (round.voz.left < 0 || round.voz.left > round.voz.total) bad++;
      for (const p of round.players) {
        sampled++;
        const me = p.mental;
        if (p.hp < 0 || me.confidence < 0 || me.confidence > 100 || me.tilt < 0 || me.tilt > 100 ||
            me.morale < 0 || me.morale > 100 || me.pressure < 0 || me.pressure > 100 ||
            me.momentum < -100 || me.momentum > 100) bad++;
      }
    }
  }
  check("CERO estados imposibles (voz/mental/hp)", bad === 0, `${bad} sobre ${sampled} jugadores`);

  const t0 = Date.now();
  for (let i = 0; i < N; i++) simulateMatch(matchCfg(900 + i, 5), coachedRunner);
  const ms = (Date.now() - t0) / N;
  check("rendimiento aceptable", ms < 2500, `${ms.toFixed(0)} ms/partido`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
