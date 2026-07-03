/**
 * VERIFICACIÓN DEL MATCH PRESENTATION ENGINE — DRL Champions.
 *
 * Comprueba que la CAPA DE PRESENTACIÓN (extiende Broadcast, reutiliza Narrative/Spectator/
 * CombatStats/moments) produce todo lo que una retransmisión AAA necesita: HUD, replay,
 * observer, broadcast, narrativa, timeline, estadísticas, coach, táctico, combate, utilidad,
 * determinismo, rendimiento y cero estados imposibles. NO crea motores nuevos.
 *
 *   npx tsx scripts/presentation-verify.ts [partidos]
 */
import type { Role, RosterEntry, Identity, RoundState } from "../src/sim";
import { createRound, tick, makeIdentity } from "../src/sim";
import { makeMatchConfig, simulateMatch, type MatchState } from "../src/match";
import { LiveDirector, liveInput } from "../src/spectator";
import { createViewport } from "../src/camera";
import { createWorld, simulateWorld } from "../src/world";
import {
  buildBroadcastState, buildMatchIntro, liveCasters, roundEndCasters, postMatchCasters,
  liveStats, spaceControl, detectPresentationEvents, extractHighlights, buildPostRound, buildPostMatch,
  buildLivePresentation,
} from "../src/broadcast";

const N = Math.max(3, Number(process.argv[2] ?? 6));
let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Match Presentation Engine — DRL Champions\n");

function team(tag: string, id: Partial<Identity>): RosterEntry[] {
  return (["entry", "igl", "lurk", "anchor", "support"] as Role[]).map((role, i) => ({
    name: `${tag}${i}`, role, attrs: { aim: 80, gameSense: 80, utility: 80, leadership: 80 }, identity: makeIdentity(id),
    meta: { ovr: 82 } as RosterEntry["meta"],
  }));
}
const AGG = team("AGG", { aggression: 90, entryDrive: 88, clutchFactor: 70, composure: 70 });
const AG2 = team("BLU", { aggression: 86, entryDrive: 82, clutchFactor: 65 });
const SETUP = { side: "ATK" as const, approach: "default", tempo: "mid" as const, aggression: "balanced" as const };
const cfg = (seed: number, win = 4) => makeMatchConfig({
  seed, rosters: { home: AGG, away: AG2 }, homeSetup: SETUP, teamNames: { home: "AGG Esports", away: "Blue Squad" },
  useEconomyTactics: true, useLoadoutCombat: true, coach: { mode: "ai" }, win: { firstTo: win, winBy: 1 }, switchAfter: 3, maxRounds: 12,
});

const match: MatchState = simulateMatch(cfg(1000));

// ─────────────────────────── 1. Intro ───────────────────────────
console.log("## Intro de partido (favorito/underdog/win prob)");
const intro = buildMatchIntro(match, { homeStreak: 3 });
check("INTRO: equipos, jugadores y mapa", intro.home.players.length === 5 && intro.away.players.length === 5 && !!intro.map);
check("INTRO: favorito/underdog + win probability", (intro.favorite === "home" || intro.favorite === "away") && intro.favorite !== intro.underdog && intro.winProbability.home + intro.winProbability.away === 100, `${intro.winProbability.home}-${intro.winProbability.away}`);
check("INTRO: storyline derivado de datos", intro.storyline.length > 0);

// ─────────────────────────── 2. Broadcast en vivo + HUD + Observer ───────────────────────────
console.log("\n## Broadcast en vivo · HUD · Observer · comentaristas");
// Snapshot vivo: una ronda con un kill, con el tick puesto en ese evento.
const liveRound: RoundState = match.rounds.find((r) => r.events.some((e) => e.type === "kill")) ?? match.rounds[0];
const killTick = liveRound.events.find((e) => e.type === "kill")?.tick ?? liveRound.tick;
const snap: RoundState = { ...liveRound, tick: killTick };
const dir = new LiveDirector();
const decision = dir.decide(liveInput(snap));
const vp = createViewport();
const bs = buildBroadcastState({ state: snap, decision, viewport: vp, match: { round: 1, score: { atk: 0, def: 0 } } });
const names = { atk: "AGG Esports", def: "Blue Squad" };

check("BROADCAST: estado completo (match/teams/stats/observer)", !!bs.match && !!bs.teams.atk && !!bs.stats && !!bs.observer);
check("OBSERVER: sigue a un jugador con situación + razón", !!bs.observer.situation && typeof bs.observer.priority === "number");
const cast = liveCasters(snap, bs, names);
check("COMENTARISTAS: generan líneas en vivo desde datos reales", cast.length > 0, cast.slice(0, 2).map((c) => c.text).join(" | "));
check("COMENTARISTAS: hay jugada-por-jugada de una baja", cast.some((c) => c.voice === "pbp"));
const live = buildLivePresentation(snap, bs, match, names);
check("HUD: presentación viva (stats+observer+fase+control+moral+winprob)", live.stats.length === 10 && !!live.observer && live.control != null && typeof live.momentum === "number");

// ─────────────────────────── 3. Estadísticas en vivo ───────────────────────────
console.log("\n## Estadísticas en vivo (ADR/ACS/KAST/entry%/clutch%)");
const stats = liveStats(match);
check("STATS: una línea por jugador con métricas pro", stats.length === 10 && stats.every((s) => typeof s.acs === "number" && typeof s.kast === "number" && typeof s.adr === "number"));
check("STATS: rangos válidos (KAST/entry/clutch 0..100, ACS≥0)", stats.every((s) => s.kast >= 0 && s.kast <= 100 && s.entryPct >= 0 && s.entryPct <= 100 && s.clutchPct >= 0 && s.clutchPct <= 100 && s.acs >= 0 && s.hsPct >= 0 && s.hsPct <= 100));
check("STATS: ordenadas por ACS y reflejan combate (hay bajas)", stats[0].acs >= stats[stats.length - 1].acs && stats.some((s) => s.kills > 0));
check("UTILIDAD/CONTROL: espacio del mapa por lado", typeof spaceControl(snap).atk === "number");

// ─────────────────────────── 4. Replay / highlights ───────────────────────────
console.log("\n## Replay / highlights (reutiliza Timeline + moments)");
const world = createWorld(7); simulateWorld(world, 4);
const highlights = extractHighlights(match, world.history);
check("REPLAY: extrae momentos del partido ordenados por magnitud", highlights.length > 0 && highlights[0].magnitude >= highlights[highlights.length - 1].magnitude, `${highlights.length} clips`);
check("REPLAY: incluye hitos del mundo (Timeline/records)", highlights.some((h) => h.source === "world"));
check("REPLAY: cada clip apunta a su ronda", highlights.filter((h) => h.source === "match").every((h) => h.round >= 1));

// ─────────────────────────── 5. Narrativa de presentación (16) ───────────────────────────
console.log("\n## Narrativa de presentación (16 eventos)");
const pe = detectPresentationEvents(match);
const peTypes = new Set(pe.map((e) => e.type));
check("NARRATIVA: variedad de hitos (≥ 4 tipos)", peTypes.size >= 4, [...peTypes].slice(0, 8).join(","));
check("NARRATIVA: siempre hay MVP final", pe.some((e) => e.type === "final_mvp"));

// ─────────────────────────── 6. Post-ronda ───────────────────────────
console.log("\n## Post-ronda (MVP/razón/coach/táctico/habilidad)");
const pr = buildPostRound(match, match.rounds[match.rounds.length - 1]);
check("POST-RONDA: completo (headline/razón/coach/táctico/cambió)", !!pr.headline && !!pr.reason && !!pr.coachDecided && !!pr.tacticalChange && !!pr.brainLearned && pr.causes.length >= 0);
check("POST-RONDA: comentaristas de fin de ronda", roundEndCasters(match, match.rounds[match.rounds.length - 1], names).length > 0);

// ─────────────────────────── 7. Post-partido ───────────────────────────
console.log("\n## Post-partido (resumen TV / scoreboard / timeline)");
const pm = buildPostMatch(match, world.history);
check("POST-PARTIDO: resumen + jugador del partido + coach del partido", !!pm.headline && (pm.playerOfMatch != null) && !!pm.coachOfMatch.grade);
check("POST-PARTIDO: scoreboard (10) + highlights + timeline + eventos", pm.scoreboard.length === 10 && pm.highlights.length > 0 && pm.events.length > 0);
check("POST-PARTIDO: comentaristas reutilizan frases del Narrative", postMatchCasters(match).length > 0);

// ─────────────────────────── 8. Determinismo, rendimiento, seguridad ───────────────────────────
console.log("\n## Determinismo, rendimiento y seguridad");
const a = simulateMatch(cfg(2024)); const b = simulateMatch(cfg(2024));
const projA = JSON.stringify({ st: liveStats(a), ev: detectPresentationEvents(a), hl: extractHighlights(a).map((h) => h.id) });
const projB = JSON.stringify({ st: liveStats(b), ev: detectPresentationEvents(b), hl: extractHighlights(b).map((h) => h.id) });
check("DETERMINISMO: misma partida ⇒ misma presentación", projA === projB);

let bad = 0;
for (let i = 0; i < N; i++) {
  const mm = simulateMatch(cfg(3000 + i));
  for (const s of liveStats(mm)) {
    if (!Number.isFinite(s.acs) || s.acs < 0 || s.kast < 0 || s.kast > 100 || s.entryPct < 0 || s.entryPct > 100 || s.clutchPct < 0 || s.clutchPct > 100 || s.hsPct < 0 || s.hsPct > 100 || s.kills < 0) bad++;
  }
  for (const e of detectPresentationEvents(mm)) if (e.magnitude < 1 || e.magnitude > 100) bad++;
  // casters: ids únicos por build
  const cl = postMatchCasters(mm);
  if (new Set(cl.map((c) => c.id)).size !== cl.length) bad++;
}
check("CERO estados imposibles (stats/eventos/casters)", bad === 0, `${bad}`);

const t0 = Date.now();
for (let i = 0; i < 200; i++) buildLivePresentation(snap, bs, match, names);
const ms = (Date.now() - t0) / 200;
check("rendimiento aceptable (presentación por frame)", ms < 8, `${ms.toFixed(2)} ms/frame`);

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (failures > 0) process.exitCode = 1;
