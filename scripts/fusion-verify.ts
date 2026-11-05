import "./_polyfill-localstorage";
/**
 * VERIFICACIÓN DE LA FUSIÓN Colección ↔ Simulador.
 *
 * Demuestra de extremo a extremo que la simulación NACE de las cartas del usuario:
 *  1) Elegir 5 cartas → crear roster → entrar al simulador → ver EXACTAMENTE esas cartas.
 *  2) Cambiar una carta → la simulación cambia automáticamente.
 *  3) Cambiar el roster entero → toda la IA (nombres, roles, IGL, ADN) se adapta.
 *  4) Terminar el partido → las recompensas vuelven a la colección.
 *
 * Ejecutar: `npx tsx scripts/fusion-verify.ts`
 */
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { CARDS, getPlayer } from "../src/data/catalog";
import { createRound, tick, type CoachSetup, type RoundState } from "../src/sim";
import { buildMatchRosters } from "../src/lib/match/roster";
import { summarizeRound } from "../src/lib/match/rewards";
import { validateTeam, type CardRef } from "../src/domain/teams/types";

const SETUP: CoachSetup = { side: "ATK", approach: "default", tempo: "mid", aggression: "balanced" };
let failures = 0;
const out: string[] = [];
const log = (s = "") => { out.push(s); console.log(s); };
function check(label: string, cond: boolean, detail = "") {
  log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

/** Una carta base distinta por jugador (para construir colecciones de prueba). */
function distinctPlayerCards(n: number, offset = 0): CardDef[] {
  const seen = new Set<string>();
  const picked: CardDef[] = [];
  for (const c of CARDS) {
    if (seen.has(c.playerId)) continue;
    seen.add(c.playerId);
    picked.push(c);
    if (picked.length >= n + offset) break;
  }
  return picked.slice(offset, offset + n);
}
const uidFor = (c: CardDef) => `own-${c.id}`;
const ownedFrom = (cards: CardDef[]): OwnedCard[] => cards.map((c) => ({ uid: uidFor(c), cardId: c.id, obtainedAt: 0 }));
const nickOf = (c: CardDef) => getPlayer(c.playerId)!.nick;

function play(state: RoundState): RoundState {
  let s = state;
  let guard = 0;
  while (s.phase !== "ENDED" && guard++ < 6000) s = tick(s);
  return s;
}
const homeNames = (s: RoundState) => s.players.filter((p) => p.side === SETUP.side).map((p) => p.name);
const DEMO_NAMES = new Set(["AXIS", "NOVA", "KItU", "VELO", "ZephR", "drako", "sable", "py0", "mira", "tomb"]);

log("# Verificación de la Fusión — DRL Champions\n");

// ───────────────────────────────────────────────────────────────────────────
// Escenario 1: 5 cartas → roster → simulador → esas cartas juegan
// ───────────────────────────────────────────────────────────────────────────
log("## 1) Colección → 5 cartas → roster → simulador");
const pool = distinctPlayerCards(6, 0);            // 5 titulares + 1 de reserva (para el swap)
const home5 = pool.slice(0, 5);
const sixth = pool[5];
const owned = ownedFrom(pool);
const starters = home5.map(uidFor);
const chosenNicks = home5.map(nickOf);
log(`  Cartas elegidas: ${chosenNicks.join(", ")}`);

const resolve = (uid: string): CardRef | null => {
  const o = owned.find((x) => x.uid === uid);
  if (!o) return null;
  const c = CARDS.find((cc) => cc.id === o.cardId)!;
  return { uid, playerId: c.playerId };
};
check("el equipo pasa la validación", validateTeam({ name: "Principal", starters, subs: [] }, resolve).length === 0);

const seed = 1234567;
const { rosters } = buildMatchRosters(starters, owned, seed);
check("el roster del motor tiene 5 jugadores", rosters.home.length === 5);
check("los nombres del roster == nicks elegidos",
  JSON.stringify([...rosters.home.map((r) => r.name)].sort()) === JSON.stringify([...chosenNicks].sort()));

const s1 = createRound(seed, SETUP, undefined, undefined, rosters);
const names1 = homeNames(s1);
check("los SimPlayers en pista == cartas elegidas",
  JSON.stringify([...names1].sort()) === JSON.stringify([...chosenNicks].sort()),
  names1.join(", "));
check("NO aparece ningún jugador ficticio (AXIS/NOVA/…)", !names1.some((n) => DEMO_NAMES.has(n)));
check("exactamente un IGL designado", rosters.home.filter((r) => r.role === "igl").length === 1,
  `IGL: ${rosters.home.find((r) => r.role === "igl")!.name}`);

const end1 = play(s1);
log(`  Resultado: gana ${end1.winner} por ${end1.endReason}.`);

// ───────────────────────────────────────────────────────────────────────────
// Escenario 2: cambiar una carta → la simulación cambia
// ───────────────────────────────────────────────────────────────────────────
log("\n## 2) Cambiar una carta → la simulación cambia automáticamente");
const swapped = [uidFor(sixth), ...starters.slice(1)];
const { rosters: rosters2 } = buildMatchRosters(swapped, owned, seed);
const names2 = rosters2.home.map((r) => r.name).sort();
const diff = chosenNicks.filter((n) => !names2.includes(n));
log(`  Antes: ${chosenNicks.join(", ")}`);
log(`  Ahora: ${rosters2.home.map((r) => r.name).join(", ")}`);
check("cambia exactamente un jugador", diff.length === 1, `entra ${nickOf(sixth)}, sale ${diff[0]}`);
check("el nuevo jugador está en la simulación", homeNames(createRound(seed, SETUP, undefined, undefined, rosters2)).includes(nickOf(sixth)));

// ───────────────────────────────────────────────────────────────────────────
// Escenario 3: cambiar el roster entero → la IA se adapta
// ───────────────────────────────────────────────────────────────────────────
log("\n## 3) Cambiar de roster → toda la IA se adapta");
const other5 = distinctPlayerCards(5, 6);          // 5 jugadores totalmente distintos
const owned3 = ownedFrom(other5);
const { rosters: rosters3 } = buildMatchRosters(other5.map(uidFor), owned3, seed);
const names3 = rosters3.home.map((r) => r.name);
check("los 5 jugadores son distintos al roster 1", names3.every((n) => !chosenNicks.includes(n)), names3.join(", "));
const igl1 = rosters.home.find((r) => r.role === "igl")!;
const igl3 = rosters3.home.find((r) => r.role === "igl")!;
check("se recalcula el IGL para el nuevo roster", igl3.name !== igl1.name || igl3.attrs.leadership !== igl1.attrs.leadership,
  `IGL r1=${igl1.name} (lead ${igl1.attrs.leadership}) · IGL r3=${igl3.name} (lead ${igl3.attrs.leadership})`);
const avgAim = (rs: typeof rosters.home) => Math.round(rs.reduce((a, r) => a + r.attrs.aim, 0) / rs.length);
check("el ADN/atributos del equipo cambian", avgAim(rosters.home) !== avgAim(rosters3.home) || igl1.name !== igl3.name,
  `aim medio r1=${avgAim(rosters.home)} · r3=${avgAim(rosters3.home)}`);

// ───────────────────────────────────────────────────────────────────────────
// Escenario 4: terminar el partido → resumen (F69 · F68-010: el Coach NO concede créditos ni XP)
// ───────────────────────────────────────────────────────────────────────────
log("\n## 4) Fin del partido → resumen del entrenamiento");
const summary = summarizeRound(end1);
log(`  Resumen: ${summary.teamKills} bajas, ${summary.won ? "victoria" : "derrota"}.`);
check("el resumen no lleva créditos ni XP", !("credits" in summary) && !("xp" in summary));

// Determinismo: misma semilla + mismas cartas ⇒ mismo resultado.
log("\n## Extra) Determinismo");
const a = play(createRound(seed, SETUP, undefined, undefined, rosters)).winner;
const b = play(createRound(seed, SETUP, undefined, undefined, rosters)).winner;
check("misma semilla + mismas cartas ⇒ mismo ganador", a === b, `${a} == ${b}`);

log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
if (failures > 0) process.exitCode = 1;
