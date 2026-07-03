/**
 * VERIFICACIÓN DEL PLAYER DEVELOPMENT ENGINE — DRL Champions.
 *
 * Comprueba que los jugadores EVOLUCIONAN de forma emergente reutilizando los motores:
 * progresión/regresión real desde la experiencia (PlayerArc), techo de potencial, edad,
 * química, entrenamiento, fatiga persistente, decisión del coach, scouting, historia,
 * narrativa, broadcast, evolución de la IA (live esports), determinismo, rendimiento y
 * cero estados imposibles.
 *
 *   npx tsx scripts/development-verify.ts [partidos]
 */
import type { Role, RosterEntry, Identity, TraitKey } from "../src/sim";
import { makeIdentity } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import {
  deriveInnate, freshDevState, extractExperience, evolveAfterMatch, train, advanceSeasonFor, autoProgress,
  applyDevelopment, progress, scoutPlayer, detectDevelopmentEvents, developmentBroadcast, developmentEventsBroadcast,
  freshRelationship, updateChemistry, teamChemistry, relKey,
  type DevState, type InnateProfile, type ExperienceSignals, type DevTransition, type SkillId,
} from "../src/development";

const N = Math.max(4, Number(process.argv[2] ?? 6));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Player Development Engine — DRL Champions\n");

// ─────────────────────────── rosters ───────────────────────────
function team(tag: string, id: Partial<Identity>, aim: number): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim, gameSense: aim, utility: 78, leadership: 76 }, identity: makeIdentity(id),
  }));
}
const STRONG = team("S", { aggression: 80, entryDrive: 78, clutchFactor: 70, composure: 70, utilityLean: 60 }, 88);
const WEAK = team("W", { aggression: 85, entryDrive: 88, riskAppetite: 85, patience: 20 }, 58); // entra y muere

const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const idOf = (e: RosterEntry) => e.meta?.playerId ?? e.name;

interface World { dev: Record<string, DevState>; inn: Record<string, InnateProfile> }
const ensure = (w: World, id: string) => {
  if (!w.inn[id]) w.inn[id] = deriveInnate(id);
  if (!w.dev[id]) w.dev[id] = freshDevState(w.inn[id]);
};
const developed = (w: World, roster: RosterEntry[]) =>
  roster.map((e) => { const id = idOf(e); return w.dev[id] ? applyDevelopment(e, w.dev[id]) : e; });

/** Juega una temporada de K partidos evolucionando a todos. Determinista. */
function playSeason(w: World, K: number, seed0: number, season: number): DevTransition[] {
  const transitions: DevTransition[] = [];
  for (let m = 0; m < K; m++) {
    const cfg = makeMatchConfig({
      seed: (seed0 + m * 7919) >>> 0, rosters: { home: developed(w, STRONG), away: developed(w, WEAK) },
      homeSetup: SETUP, win: { firstTo: 4, winBy: 1 }, switchAfter: 3, maxRounds: 12,
    });
    const match = simulateMatch(cfg);
    for (const sig of extractExperience(match)) {
      ensure(w, sig.playerId);
      const { state, transition } = evolveAfterMatch(w.dev[sig.playerId], w.inn[sig.playerId], sig, season);
      w.dev[sig.playerId] = state;
      transitions.push(transition);
    }
  }
  return transitions;
}

// ─────────────────────────── 1. Progresión / regresión (real, emergente) ───────────────────────────
console.log("## Progresión y regresión emergentes (desde la experiencia real)");
const w: World = { dev: {}, inn: {} };
for (const e of [...STRONG, ...WEAK]) ensure(w, idOf(e));
const before = Object.fromEntries(Object.keys(w.dev).map((id) => [id, progress(w.dev[id])]));
const seasonTransitions = playSeason(w, N, 1000, 1);
const after = Object.fromEntries(Object.keys(w.dev).map((id) => [id, progress(w.dev[id])]));

const strongGain = STRONG.map(idOf).reduce((a, id) => a + (after[id] - before[id]), 0);
const weakConfDrop = WEAK.map(idOf).some((id) => w.dev[id].condition.confidence < 55 || (w.dev[id].traitDelta.selfBelief ?? 0) < 0);
check("PROGRESIÓN: el equipo fuerte mejora a lo largo de la temporada", strongGain > 0.5, `Δ=${strongGain.toFixed(2)}`);
check("PROGRESIÓN: aprende habilidades (algún skill sube de 50)", STRONG.map(idOf).some((id) => Object.values(w.dev[id].skill).some((v) => v > 51)));
check("REGRESIÓN: el que muere primero pierde confianza", weakConfDrop);
check("se generan transiciones de desarrollo", seasonTransitions.length >= N * 5, `${seasonTransitions.length}`);

// ─────────────────────────── 2. Potencial (techo) ───────────────────────────
console.log("\n## Potencial: el techo limita el crecimiento");
{
  const id = "capTest";
  const inn = { ...deriveInnate(id), potential: 60, growthRate: 1.5, workEthic: 99, durability: 99 };
  let st = freshDevState(inn);
  const big: ExperienceSignals = { playerId: id, name: id, rounds: 24, kills: 30, deaths: 8, firstBloods: 6, firstDeaths: 1, multikills: 4, aces: 1, clutches: 3, clutchWins: 3, tradeKills: 6, impactScore: 240, roundsDecisive: 8, form: 0.8, tiltPeak: 10, confidenceEnd: 90, states: ["hot"], utilityCasts: 12, won: true, mvp: true, role: "entry" };
  for (let i = 0; i < 40; i++) { st = evolveAfterMatch(st, inn, big, 1).state; st.condition.fatigue = 10; } // sin fatiga, machaca
  check("el progreso NO supera el potencial", progress(st) <= inn.potential + 2.5, `prog=${progress(st).toFixed(1)} ≤ pot=${inn.potential}`);
  // Potencial mayor llega más alto con la misma experiencia.
  const innHi = { ...inn, potential: 92 };
  let hi = freshDevState(innHi);
  for (let i = 0; i < 40; i++) { hi = evolveAfterMatch(hi, innHi, big, 1).state; hi.condition.fatigue = 10; }
  check("mayor potencial llega más alto", progress(hi) > progress(st) + 5, `${progress(hi).toFixed(1)} vs ${progress(st).toFixed(1)}`);
}

// ─────────────────────────── 3. Edad ───────────────────────────
console.log("\n## Edad: joven crece, veterano declina (gana cabeza)");
{
  const innY = { ...deriveInnate("young"), startAge: 17, peakAge: 24, declineAge: 29, potential: 95 };
  const young = advanceSeasonFor(freshDevState(innY), innY, 1).state;
  const innV = { ...deriveInnate("vet"), startAge: 31, peakAge: 24, declineAge: 29, potential: 95 };
  const vet = advanceSeasonFor({ ...freshDevState(innV), age: 31 }, innV, 1).state;
  check("JOVEN: mejora con la edad (aim sube)", young.attrDelta.aim > 0, `Δaim=${young.attrDelta.aim.toFixed(2)}`);
  check("VETERANO: pierde físico (aim baja) pero gana cabeza (gameSense/IQ)", vet.attrDelta.aim < 0 && (vet.attrDelta.gameSense > 0 || (vet.traitDelta.tacticalIQ ?? 0) > 0), `Δaim=${vet.attrDelta.aim.toFixed(2)}`);
}

// ─────────────────────────── 4. Química ───────────────────────────
console.log("\n## Química: relaciones que evolucionan");
{
  let r = freshRelationship("a", "b", 70, 72);
  const t0 = r.trust;
  for (let i = 0; i < 5; i++) r = updateChemistry(r, { won: true, impactX: 80, impactY: 70, egoX: 40, egoY: 45 });
  check("ganar juntos sube la confianza/sinergia", r.trust > t0 && r.synergy > 50, `trust ${t0.toFixed(0)}→${r.trust.toFixed(0)}`);
  let c = freshRelationship("x", "y", 30, 80); // incompatibles + egos altos
  const conf0 = c.conflict;
  for (let i = 0; i < 6; i++) c = updateChemistry(c, { won: false, impactX: 20, impactY: 30, egoX: 90, egoY: 88 });
  check("perder con egos altos genera conflicto", c.conflict > conf0, `conflict ${conf0.toFixed(0)}→${c.conflict.toFixed(0)}`);
  const tc = teamChemistry({ [relKey("a", "b")]: r }, ["a", "b"]);
  check("química de equipo calculable (0..100)", tc >= 0 && tc <= 100, `${tc}`);
}

// ─────────────────────────── 5. Entrenamiento + coach + fatiga ───────────────────────────
console.log("\n## Entrenamiento (coach decide), fatiga persistente");
{
  const inn = deriveInnate("trainee");
  let st = freshDevState(inn);
  const f0 = st.condition.fatigue;
  const aim0 = st.attrDelta.aim;
  st = train(st, inn, { id: "aim", intensity: "hard" }, 1).state;
  check("ENTRENAR aim sube la puntería y CANSA (fatiga sube)", st.attrDelta.aim > aim0 && st.condition.fatigue > f0, `Δaim=${st.attrDelta.aim.toFixed(2)} fatiga ${f0}→${st.condition.fatigue.toFixed(0)}`);
  const fatHigh = st.condition.fatigue;
  st = train(st, inn, { id: "rest", intensity: "normal" }, 1).state;
  check("DESCANSO recupera (fatiga baja)", st.condition.fatigue < fatHigh, `${fatHigh.toFixed(0)}→${st.condition.fatigue.toFixed(0)}`);
  // COACH: la intensidad importa.
  const light = train(freshDevState(inn), inn, { id: "utility", intensity: "light" }, 1).state.attrDelta.utility;
  const hard = train(freshDevState(inn), inn, { id: "utility", intensity: "hard" }, 1).state.attrDelta.utility;
  check("COACH: intensidad dura mejora más que ligera", hard > light, `hard=${hard.toFixed(2)} light=${light.toFixed(2)}`);
  // FATIGA persiste entre partidos (en el estado de desarrollo).
  const w2: World = { dev: {}, inn: {} };
  for (const e of STRONG) ensure(w2, idOf(e));
  playSeason(w2, 3, 50, 1);
  check("FATIGA persiste y se acumula entre partidos", STRONG.map(idOf).some((id) => w2.dev[id].condition.fatigue > 8));
}

// ─────────────────────────── 6. Scouting + historia ───────────────────────────
console.log("\n## Scouting e historia");
{
  const id = STRONG.map(idOf)[0];
  const rep = scoutPlayer(w.inn[id], w.dev[id]);
  check("SCOUTING: informe completo (potencial/edad/fuertes/débiles/riesgos)", rep.potential > 0 && !!rep.ageBand && rep.strengths.length > 0 && rep.weaknesses.length > 0 && rep.risks.length > 0 && !!rep.recommendation);
  const burned = { ...w.dev[id], condition: { ...w.dev[id].condition, burnout: 70 } };
  check("SCOUTING detecta riesgo de burnout", scoutPlayer(w.inn[id], burned).risks.some((r) => r.includes("burnout")));
  check("HISTORIA: el jugador recuerda sus partidos", w.dev[id].history.length >= N, `${w.dev[id].history.length} entradas`);
}

// ─────────────────────────── 7. Narrativa + broadcast ───────────────────────────
console.log("\n## Narrativa de desarrollo + Broadcast (datos)");
{
  const evs = detectDevelopmentEvents(seasonTransitions);
  const kinds = new Set(evs.map((e) => e.type));
  check("NARRATIVA: se generan eventos de desarrollo", evs.length > 0, [...kinds].join(","));
  check("BROADCAST: resumen de eventos (top-N)", developmentEventsBroadcast(evs).length > 0);
  const id = STRONG.map(idOf)[0];
  const info = developmentBroadcast(w.dev[id], w.inn[id], id);
  check("BROADCAST: datos de progresión (rating/edad/techo/topSkills)", info.rating > 0 && !!info.ageBand && info.topSkills.length === 3 && info.potential > 0);
}

// ─────────────────────────── 8. Live Esports: la IA también evoluciona ───────────────────────────
console.log("\n## Live Esports: todo el mundo progresa");
{
  const id = "aiPlayer";
  const inn = deriveInnate(id);
  const fresh = freshDevState(inn);
  const a = autoProgress(fresh, inn, 1, 12345).state;
  check("la IA no participante EVOLUCIONA (auto-progresión)", Math.abs(progress(a) - progress(fresh)) > 0.1 || a.matchesPlayed > fresh.matchesPlayed);
  const b = autoProgress(freshDevState(inn), inn, 1, 12345).state;
  check("auto-progresión determinista", JSON.stringify(a) === JSON.stringify(b));
}

// ─────────────────────────── 9. Determinismo, rendimiento, seguridad ───────────────────────────
console.log("\n## Determinismo, rendimiento y seguridad");
{
  const wa: World = { dev: {}, inn: {} }; for (const e of [...STRONG, ...WEAK]) ensure(wa, idOf(e));
  const wb: World = { dev: {}, inn: {} }; for (const e of [...STRONG, ...WEAK]) ensure(wb, idOf(e));
  playSeason(wa, 4, 777, 1); playSeason(wb, 4, 777, 1);
  check("DETERMINISMO: misma temporada ⇒ mismo desarrollo", JSON.stringify(wa.dev) === JSON.stringify(wb.dev));

  // Estados imposibles.
  const TRAITS: TraitKey[] = ["aggression", "patience", "riskAppetite", "composure", "selfBelief", "resilience", "consistency", "ego", "tacticalIQ", "adaptability", "discipline", "creativity", "entryDrive", "lurkTendency", "tradeInstinct", "utilityLean", "clutchFactor", "leadershipDrive", "communication"];
  let bad = 0, sampled = 0;
  for (const st of Object.values(w.dev)) {
    sampled++;
    const c = st.condition;
    const condOk = [c.fatigue, c.burnout, c.form, c.motivation, c.confidence, c.morale, c.stress].every((v) => v >= 0 && v <= 100 && Number.isFinite(v));
    const attrOk = (["aim", "gameSense", "utility", "leadership"] as const).every((k) => Math.abs(st.attrDelta[k]) <= 25.001 && Number.isFinite(st.attrDelta[k]));
    const traitOk = TRAITS.every((k) => Math.abs(st.traitDelta[k] ?? 0) <= 30.001);
    const skillOk = (Object.values(st.skill) as number[]).every((v) => v >= 0 && v <= 100);
    const ageOk = st.age >= 15 && st.age <= 45;
    if (!(condOk && attrOk && traitOk && skillOk && ageOk)) bad++;
  }
  check("CERO estados imposibles (deltas/condición/edad)", bad === 0, `${bad} sobre ${sampled} jugadores`);

  const t0 = Date.now();
  const wp: World = { dev: {}, inn: {} }; for (const e of [...STRONG, ...WEAK]) ensure(wp, idOf(e));
  playSeason(wp, N, 4242, 1);
  const ms = Date.now() - t0;
  check("rendimiento aceptable (temporada)", ms / N < 2500, `${(ms / N).toFixed(0)} ms/partido`);
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
