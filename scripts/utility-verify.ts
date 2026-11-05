/**
 * VALIDACIÓN DEL UTILITY ENGINE.
 *
 * Comprueba que la utilidad EXISTE en el mapa: despliegue emergente, overlay activo,
 * zonas con estado, lecturas tácticas, probabilidad de execute y determinismo.
 *
 * Uso:  npx tsx scripts/utility-verify.ts
 */
import { createRound, tick, makeIdentity } from "../src/sim";
import type { Attributes, Role, RosterEntry, RoundState, CoachSetup } from "../src/sim";
import { mapReads, executeProbability, utilitySummary } from "../src/utility";

const ROLES: Role[] = ["entry", "igl", "anchor", "lurk", "support"];
const ATTRS: Attributes = { aim: 75, gameSense: 75, utility: 75, leadership: 75 };
const team = (pfx: string, id: Partial<Parameters<typeof makeIdentity>[0]>): RosterEntry[] =>
  ROLES.map((role, i) => ({ name: `${pfx}${i + 1}`, role, attrs: ATTRS, identity: makeIdentity(id) }));

const HOME = team("H", { utilityLean: 80, discipline: 70 });
const AWAY = team("A", { utilityLean: 70, aggression: 60 });
const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); ok ? pass++ : fail++; };

console.log("# Verificación del Utility Engine\n");

function run(seed: number): { s: RoundState; overlayEverActive: boolean; statusesSeen: Set<string>; reads: string[]; execSamples: number[] } {
  let s = createRound(seed, SETUP, undefined, undefined, { home: HOME, away: AWAY });
  let overlayEverActive = false;
  const statusesSeen = new Set<string>();
  const execSamples: number[] = [];
  let reads: string[] = [];
  for (let i = 0; i < 1400 && s.phase !== "ENDED"; i++) {
    s = tick(s);
    const m = s.map!;
    if (m.overlay.blockedSight.size + m.overlay.deniedZones.size + m.overlay.revealedZones.size > 0) overlayEverActive = true;
    for (const z of Object.values(m.zones)) for (const st of z.status) statusesSeen.add(st);
    reads = mapReads(s); // se queda con la última lectura (la ronda puede acabar antes de 600)
    if (i % 50 === 0) execSamples.push(executeProbability(s));
  }
  return { s, overlayEverActive, statusesSeen, reads, execSamples };
}

const r1 = run(12345);
const m = r1.s.map!;
const utilEvents = r1.s.events.filter((e) => e.type === "util" && (e.data as { effect?: string }).effect);

console.log("## Despliegue de utilidad");
console.log(`  Cargas: ATK ${m.charges.ATK} / DEF ${m.charges.DEF} · gastadas ATK ${m.spent.ATK} / DEF ${m.spent.DEF}`);
console.log(`  Eventos de utilidad con efecto: ${utilEvents.length}`);
const sampleEvents = utilEvents.slice(0, 4).map((e) => `${(e.data as Record<string, unknown>).side}:${(e.data as Record<string, unknown>).kind}→${(e.data as Record<string, unknown>).effect}`);
console.log("  Ejemplos:", sampleEvents.join(" · ") || "(ninguno)");
check("se despliega utilidad emergente (cargas gastadas)", m.spent.ATK + m.spent.DEF > 0, `${m.spent.ATK + m.spent.DEF} cargas`);
check("hay efectos con objetivo (no 'habilidades')", utilEvents.length > 0);
check("el overlay del mapa se activa en algún momento", r1.overlayEverActive);

console.log("\n## Estado vivo del mapa");
console.log("  Estados de zona observados:", [...r1.statusesSeen].join(", "));
check("las zonas adquieren estado (control/visión/utilidad…)", r1.statusesSeen.size >= 4, `${r1.statusesSeen.size} estados`);
check("hay control de mapa por bando", m.control.ATK + m.control.DEF > 0, `ATK ${m.control.ATK} / DEF ${m.control.DEF} zonas`);

console.log("\n## Lecturas tácticas (coach) @tick600");
r1.reads.forEach((x) => console.log("  ·", x));
check("mapReads produce lectura táctica", r1.reads.length > 0);
const exec = r1.execSamples[0] ?? 50;
console.log(`  Probabilidad de execute: ${exec}%`);
check("executeProbability en rango 5..95", exec >= 5 && exec <= 95);

console.log("\n## Determinismo");
const r2 = run(12345);
check("misma semilla ⇒ mismo gasto de utilidad", r2.s.map!.spent.ATK === m.spent.ATK && r2.s.map!.spent.DEF === m.spent.DEF);
check("misma semilla ⇒ mismo control de mapa", r2.s.map!.control.ATK === m.control.ATK && r2.s.map!.control.DEF === m.control.DEF);

const su = utilitySummary(m, "ATK");
console.log(`\n  Utilidad ATK restante: ${su.remaining}/${su.charges} (${Math.round(su.fraction * 100)}% gastada)`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
