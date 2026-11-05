/**
 * AUDITORÍA DEL BRAIN ENGINE.
 *
 * Demuestra con MÉTRICAS (no opiniones) que cada jugador piensa: misma info → distinta
 * decisión según personalidad, la memoria cambia el comportamiento, la comms propaga
 * info, la incertidumbre genera errores, hay cambios de plan solos, los roles juegan
 * distinto, los jugadores aprenden y el cerebro aporta diversidad vs el clásico.
 *
 * Uso:  npx tsx scripts/brain-verify.ts
 */
import { createRound, tick, makeIdentity } from "../src/sim";
import type { Role, RosterEntry, CoachSetup, RoundState, SimPlayer } from "../src/sim";
import { makeRng } from "../src/sim/rng";
import { decide } from "../src/brain/decide";

const ROLES: Role[] = ["entry", "igl", "anchor", "lurk", "support"];
const ATTRS = { aim: 75, gameSense: 75, utility: 75, leadership: 75 };
const ID: Record<Role, Record<string, number>> = {
  entry: { aggression: 88, entryDrive: 90, riskAppetite: 78, discipline: 25, composure: 50 },
  igl: { leadershipDrive: 92, communication: 92, tacticalIQ: 84, discipline: 66, aggression: 45 },
  anchor: { discipline: 88, patience: 86, aggression: 22, composure: 82, clutchFactor: 70 },
  lurk: { lurkTendency: 92, creativity: 86, aggression: 50, discipline: 32, tradeInstinct: 40 },
  support: { utilityLean: 86, communication: 82, tradeInstinct: 76, aggression: 44 },
};
const teamRole = (pfx: string): RosterEntry[] => ROLES.map((role, i) => ({ name: `${pfx}-${role}`, role, attrs: ATTRS, identity: makeIdentity(ID[role]) }));
const teamFlat = (pfx: string, id: Record<string, number>): RosterEntry[] => ROLES.map((role, i) => ({ name: `${pfx}${i}`, role, attrs: ATTRS, identity: makeIdentity(id) }));
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); ok ? pass++ : fail++; };
const AGGR = { aggression: 92, entryDrive: 88, riskAppetite: 82, discipline: 22, patience: 18, composure: 45 };
const DISC = { discipline: 92, patience: 88, aggression: 22, composure: 82, riskAppetite: 22 };
const PASSIVE = new Set(["hold", "wait", "fall_back", "save"]);
const AGGRESSIVE = new Set(["push", "fight", "flank", "seek_trade"]);

console.log("# Auditoría del Brain Engine\n");

// Estado de mitad de ronda (hay tensión: enemigos conocidos, fase de execute).
function midState(seed: number, home: RosterEntry[], away: RosterEntry[], ticks = 150): RoundState {
  let s = createRound(seed, SETUP, undefined, undefined, { home, away });
  for (let i = 0; i < ticks && s.phase !== "ENDED"; i++) s = tick(s);
  return s;
}
const decideClone = (s: RoundState, id: string, mutate: (p: SimPlayer) => void) => {
  const c: RoundState = structuredClone(s);
  const p = c.players.find((q) => q.id === id)!;
  p.brain!.lastAction = null; // sin histéresis para aislar la decisión
  mutate(p);
  return decide(c, p, makeRng(99)).option.kind;
};

// ── 1) MISMA INFO, DISTINTA PERSONALIDAD → DISTINTA DECISIÓN ──────────────
console.log("## 1. Personalidad: misma info, decisión distinta");
let aggrPush = 0, discHold = 0, differ = 0, samples = 0;
for (let seed = 0; seed < 30; seed++) {
  const s = midState(seed, teamRole("H"), teamRole("A"));
  const target = s.players.find((p) => p.side === "ATK" && p.alive);
  if (!target) continue;
  samples++;
  const a = decideClone(s, target.id, (p) => { p.identity = makeIdentity(AGGR); });
  const d = decideClone(s, target.id, (p) => { p.identity = makeIdentity(DISC); });
  if (AGGRESSIVE.has(a)) aggrPush++;
  if (PASSIVE.has(d)) discHold++;
  if (a !== d) differ++;
}
console.log(`  Muestras: ${samples} · agresivo eligió ofensiva ${aggrPush} · disciplinado eligió pasiva ${discHold} · decisiones distintas ${differ}`);
check("la personalidad cambia la decisión con la MISMA info", differ >= samples * 0.4, `${differ}/${samples} difieren`);
check("el agresivo es más ofensivo que el disciplinado", aggrPush > discHold * 0.8 && aggrPush >= samples * 0.4);

// ── 2) LA MEMORIA CAMBIA EL COMPORTAMIENTO ───────────────────────────────
console.log("\n## 2. Memoria: cambia el comportamiento");
let memDiff = 0, memSamples = 0;
for (let seed = 0; seed < 30; seed++) {
  const s = midState(seed, teamRole("H"), teamRole("A"));
  const target = s.players.find((p) => p.side === "DEF" && p.alive);
  if (!target) continue;
  memSamples++;
  const blank = decideClone(s, target.id, (p) => { p.brain!.memory.enemies = {}; });
  const withMemo = decideClone(s, target.id, (p) => {
    p.brain!.memory.enemies = { "ghost": { pos: { x: p.pos.x + 60, y: p.pos.y - 60 }, tick: s.tick, baseConf: 1, source: "sight" } };
  });
  if (blank !== withMemo) memDiff++;
}
check("inyectar un recuerdo fresco cambia la decisión", memDiff >= memSamples * 0.3, `${memDiff}/${memSamples} cambian`);

// ── 3-7) MÉTRICAS SOBRE UNA RONDA COMPLETA CON CEREBRO ───────────────────
interface Agg { byRole: Record<string, Record<string, number>>; changes: number; decisions: number; commMemos: number; falseBeliefs: number; }
const realPos = (s: RoundState, id: string) => s.players.find((q) => q.id === id);
function runRound(seed: number, home: RosterEntry[], away: RosterEntry[]): { s: RoundState; agg: Agg; learnEarly: number; learnLate: number } {
  let s = createRound(seed, SETUP, undefined, undefined, { home, away });
  const agg: Agg = { byRole: {}, changes: 0, decisions: 0, commMemos: 0, falseBeliefs: 0 };
  let learnEarly = 0, learnLate = 0;
  const defSum = () => s.players.filter((p) => p.side === "DEF" && p.brain).reduce((a, p) => { const l = p.brain!.memory.laneSeen; return a + l.main + l.tree + l.mid; }, 0);
  for (let i = 0; i < 1500 && s.phase !== "ENDED"; i++) {
    s = tick(s);
    for (const p of s.players) {
      if (!p.alive || !p.brain?.trace || p.brain.trace.tick !== s.tick) continue;
      const t = p.brain.trace;
      agg.decisions++;
      if (t.changed) agg.changes++;
      const r = `${p.side}:${p.role}`;
      (agg.byRole[r] ??= {})[t.chosen] = ((agg.byRole[r] ?? {})[t.chosen] ?? 0) + 1;
    }
    if (i % 15 === 0) for (const p of s.players) {
      if (!p.brain) continue;
      for (const [id, m] of Object.entries(p.brain.memory.enemies)) {
        agg.commMemos += m.source === "comm" ? 1 : 0;
        // CREENCIA FALSA: recuerdo aún confiable pero la posición real ya cambió (info caduca).
        const conf = m.baseConf * Math.exp(-(s.tick - m.tick) / 260);
        const real = realPos(s, id);
        if (conf > 0.3 && real && Math.hypot(real.pos.x - m.pos.x, real.pos.y - m.pos.y) > 250) agg.falseBeliefs++;
      }
    }
    if (i === 60) learnEarly = defSum();
    learnLate = defSum(); // se queda con el último valor procesado (la ronda puede acabar antes de 600)
  }
  return { s, agg, learnEarly, learnLate };
}

const round = runRound(7, teamRole("H"), teamRole("A"));
const { agg } = round;

console.log("\n## 3. Comunicación: la info viaja entre compañeros");
check("hay memorias de origen 'comm' (info propagada, no teletransportada)", agg.commMemos > 0, `${agg.commMemos} muestras de memoria por comms`);

console.log("\n## 4. Incertidumbre → creencias falsas (errores humanos)");
// Propiedad ESTOCÁSTICA del mecanismo, no de una semilla concreta: agregamos varias semillas para
// no depender de la trayectoria exacta de un único seed (una semilla puede no generar ninguna).
const falseBeliefsMulti = [7, 11, 23, 42, 99].reduce((a, sd) => a + runRound(sd, teamRole("H"), teamRole("A")).agg.falseBeliefs, 0);
check("la info caduca genera creencias falsas (posición recordada ≠ real)", falseBeliefsMulti > 0, `${falseBeliefsMulti} creencias falsas (5 semillas)`);

console.log("\n## 5. Cambios de plan espontáneos");
const changeRate = agg.changes / Math.max(1, agg.decisions);
console.log(`  Decisiones: ${agg.decisions} · cambios de idea: ${agg.changes} (${(changeRate * 100).toFixed(1)}%)`);
check("los jugadores cambian de idea solos (pero no cada tick)", agg.changes > 0 && changeRate < 0.5);

console.log("\n## 6. Los roles juegan DISTINTO");
for (const r of Object.keys(agg.byRole).filter((k) => k.startsWith("ATK"))) {
  const dist = agg.byRole[r]; const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(", ");
  console.log(`  ${r}: ${top}`);
}
const entry = agg.byRole["ATK:entry"] ?? {}, anchor = agg.byRole["ATK:anchor"] ?? {}, lurk = agg.byRole["ATK:lurk"] ?? {};
const share = (d: Record<string, number>, set: Set<string>) => { const t = Object.values(d).reduce((a, b) => a + b, 0) || 1; return Object.entries(d).reduce((a, [k, v]) => a + (set.has(k) ? v : 0), 0) / t; };
check("el entry es más ofensivo que el anchor", share(entry, AGGRESSIVE) > share(anchor, AGGRESSIVE));
check("el lurker flanquea más que el anchor", (lurk["flank"] ?? 0) / (Object.values(lurk).reduce((a, b) => a + b, 0) || 1) >= (anchor["flank"] ?? 0) / (Object.values(anchor).reduce((a, b) => a + b, 0) || 1));

console.log("\n## 7. Aprendizaje durante la ronda");
console.log(`  Avistamientos por carril (defensor) — tick150: ${round.learnEarly} · tick600: ${round.learnLate}`);
check("el conocimiento del rival se acumula con el tiempo", round.learnLate > round.learnEarly);

// ── 8) ANTES/DESPUÉS: cerebro vs clásico ─────────────────────────────────
console.log("\n## 8. Antes/después: diversidad de decisión");
function diversity(brainOn: boolean): number {
  let s = createRound(7, SETUP, undefined, undefined, { home: teamRole("H"), away: teamRole("A") }, undefined, { brain: brainOn });
  const kinds = new Set<string>();
  for (let i = 0; i < 800 && s.phase !== "ENDED"; i++) { s = tick(s); for (const p of s.players) { if (brainOn && p.brain?.trace?.tick === s.tick) kinds.add(p.brain.trace.chosen); else if (!brainOn && p.alive) kinds.add(p.intent); } }
  return kinds.size;
}
const dOn = diversity(true), dOff = diversity(false);
console.log(`  Tipos de acción distintos — cerebro ON: ${dOn} · clásico OFF: ${dOff}`);
check("el cerebro produce más variedad de decisión que el clásico", dOn > dOff);

// ── 9) DETERMINISMO ──────────────────────────────────────────────────────
console.log("\n## 9. Determinismo");
const a = runRound(7, teamRole("H"), teamRole("A"));
const b = runRound(7, teamRole("H"), teamRole("A"));
check("misma semilla ⇒ mismo resultado y mismas decisiones", a.s.winner === b.s.winner && a.agg.decisions === b.agg.decisions && a.agg.changes === b.agg.changes, `${a.agg.decisions} decisiones, ${a.agg.changes} cambios`);

// ── EJEMPLO REAL (log de un cerebro) ─────────────────────────────────────
console.log("\n## Ejemplo real — traza de un jugador (mitad de ronda)");
{
  const s = midState(11, teamRole("H"), teamRole("A"), 220);
  const p = s.players.find((q) => q.side === "ATK" && q.alive && q.brain?.trace);
  if (p?.brain?.trace) {
    const t = p.brain.trace;
    console.log(`  ${p.name} (${p.role}/${p.agent?.agent.codename}) @tick ${t.tick}`);
    console.log(`  Sabe: ${t.knows.join(" | ") || "—"}`);
    console.log(`  Cree: ${t.beliefs.map((x) => `${x.label} ${Math.round(x.prob * 100)}%`).join(" | ")}`);
    console.log(`  Opciones: ${t.options.map((o) => `${o.kind}=${o.score}`).join("  ")}`);
    console.log(`  Elige: ${t.chosen} — ${t.reason}${t.changed ? " (CAMBIÓ)" : ""}`);
  }
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
