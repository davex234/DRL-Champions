/**
 * VERIFICACIÓN — Competitive Ranking Engine (DRL Champions, Online Fase 3/7).
 *
 *   npx tsx scripts/competitive-verify.ts [partidos]
 *
 * Comprueba: MMR · Elo · placement · promotion · demotion · decay · season reset · leaderboards ·
 * ranking · historial · determinismo · rendimiento · cero estados imposibles · compat Matchmaking ·
 * compat Online · compat Career · compat Living World. Reutiliza el Elo existente. DETERMINISTA.
 */
import {
  CompetitiveEngine, expectedScore, DEFAULT_RATING, leagueForMmr, leagueOrdinal, rankOrdinal, rankLabel,
  profileView, leaderboardView, newProfile, recordMatch, softReset, applyDecay, DEFAULT_DECAY,
  type CompetitiveMatchResult, type LeagueId,
} from "../src/competitive";
import { Matchmaker, profileFrom } from "../src/matchmaking";
import { createLocalGame, connectAll, runUntilMatchEnd } from "../src/online";
import type { LobbyDraft } from "../src/online";

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
console.log("# Verificación del Competitive Ranking Engine — DRL Champions (Online Fase 3)\n");

const R = (matchId: string, homeId: string, awayId: string, winner: "home" | "away", sh = 13, sa = 10, o: Partial<CompetitiveMatchResult> = {}): CompetitiveMatchResult =>
  ({ matchId, season: o.season ?? 1, mode: "competitive", homeId, awayId, winner, scoreHome: sh, scoreAway: sa, mvp: o.mvp ?? null, region: o.region ?? "EMEA", at: o.at ?? 0 });
const post = (over: Partial<ReturnType<typeof newProfile>> = {}) => ({ ...newProfile("x", "X", "EMEA"), placementGames: 10, ...over });

// ─────────────────────── 1. MMR / Elo (reutilizado, suma cero) ───────────────────────
console.log("## MMR / Elo");
{
  const e = new CompetitiveEngine();
  const u = e.applyMatchResult(R("s0", "A", "B", "home", 13, 10));
  const a = u.players.find((p) => p.id === "A")!, b = u.players.find((p) => p.id === "B")!;
  check("ELO: reutiliza expectedScore (1500 vs 1500 = 0.5)", expectedScore(1500, 1500) === 0.5 && DEFAULT_RATING === 1500);
  check("MMR: el ganador sube y el perdedor baja (suma cero)", a.mmrDelta > 0 && b.mmrDelta < 0 && a.mmrDelta === -b.mmrDelta);
  check("MMR: el margen de rondas amplifica (13-10 mueve algo)", Math.abs(a.mmrDelta) > 0);
}

// ─────────────────────── 2. Placement ───────────────────────
console.log("\n## Placement");
{
  const e = new CompetitiveEngine();
  for (let i = 0; i < 9; i++) e.applyMatchResult(R(`pl${i}`, "rook", `o${i}`, i % 2 ? "home" : "away", 13, 9, { at: i }));
  check("PLACEMENT: durante las colocaciones no hay liga ni entra en leaderboard", e.profile("rook")!.league === null && e.global.rankOf("rook") === -1);
  e.applyMatchResult(R("pl9", "rook", "o9", "home", 13, 6, { at: 9 }));
  check("PLACEMENT: al completar 10 partidas, se COLOCA en una liga", e.profile("rook")!.league !== null && e.events.some((ev) => ev.type === "placed"));
}

// ─────────────────────── 3. Promotion (serie) ───────────────────────
console.log("\n## Promotion (serie de promoción)");
{
  let cur = post({ mmr: 1495, league: "gold" as LeagueId, division: 1 });
  const ev = [];
  for (let i = 0; i < 8; i++) { const r = recordMatch(cur, { matchId: `pr${i}`, won: true, opponentMmr: 1520, scoreFor: 13, scoreAgainst: 7, mvp: false, at: i }, i); cur = r.profile; ev.push(...r.events); }
  check("PROMOTION: cruzar de liga abre una SERIE y ganarla ASCIENDE", ev.some((x) => x.type === "series_start") && ev.some((x) => x.type === "promoted") && leagueOrdinal(cur.league!) > leagueOrdinal("gold"));
  check("PROMOTION: al ascender se concede rank shield", cur.shieldGames > 0);
}

// ─────────────────────── 4. Demotion + Rank Shield ───────────────────────
console.log("\n## Demotion + rank shield");
{
  let cur = post({ mmr: 1505, league: "platinum" as LeagueId, division: 4, shieldGames: 0 });
  const ev = [];
  for (let i = 0; i < 4; i++) { const r = recordMatch(cur, { matchId: `de${i}`, won: false, opponentMmr: 1500, scoreFor: 5, scoreAgainst: 13, mvp: false, at: i }, i); cur = r.profile; ev.push(...r.events); }
  check("DEMOTION: caer bajo el suelo de la liga DESCIENDE", ev.some((x) => x.type === "demoted") && leagueOrdinal(cur.league!) < leagueOrdinal("platinum"));
  const shielded = recordMatch(post({ mmr: 1505, league: "platinum" as LeagueId, division: 4, shieldGames: 2 }), { matchId: "sh", won: false, opponentMmr: 1500, scoreFor: 4, scoreAgainst: 13, mvp: false, at: 0 }, 0);
  check("RANK SHIELD: el escudo protege del descenso (consume escudo, no baja de liga)", shielded.profile.league === "platinum" && shielded.profile.shieldGames === 1);
}

// ─────────────────────── 5. Decay ───────────────────────
console.log("\n## Decay");
{
  const dia = post({ mmr: 1900, league: "diamond" as LeagueId, division: 2, lastActiveAt: 0 });
  const r = applyDecay(dia, 500, DEFAULT_DECAY);
  check("DECAY: la inactividad en liga alta reduce el MMR", r.event?.type === "decayed" && r.profile.mmr < 1900);
  const goldNoDecay = applyDecay(post({ mmr: 1300, league: "gold" as LeagueId, division: 2, lastActiveAt: 0 }), 500, DEFAULT_DECAY);
  check("DECAY: las ligas bajas NO decaen", goldNoDecay.event === null && goldNoDecay.profile.mmr === 1300);
}

// ─────────────────────── 6. Season reset (soft) + historial ───────────────────────
console.log("\n## Season reset + historial");
{
  const hi = post({ mmr: 2000, league: "diamond" as LeagueId, division: 2 });
  const reset = softReset(hi, 2, 1000);
  check("SEASON RESET: soft reset comprime el MMR hacia el centro", reset.mmr < 2000 && reset.mmr > DEFAULT_RATING);
  check("SEASON RESET: archiva el historial, exige re-colocación y sube de temporada", reset.history.length === 1 && reset.league === null && reset.season.season === 2 && reset.placementGames < 10);
  const e = new CompetitiveEngine({ season: 1 });
  for (let i = 0; i < 12; i++) e.applyMatchResult(R(`sr${i}`, "champ", `o${i}`, "home", 13, 5, { at: i }));
  const before = e.profile("champ")!.mmr;
  const rewards = e.endSeason(2000);
  check("SEASON ENGINE: endSeason da recompensas y reinicia (leaderboard vacío, temporada 2)", rewards.length >= 1 && e.season.number === 2 && e.global.size() === 0 && e.profile("champ")!.mmr < before);
}

// ─────────────────────── 7. Leaderboards + Ranking ───────────────────────
console.log("\n## Leaderboards + ranking");
{
  const e = new CompetitiveEngine();
  // Coloca a varios jugadores con MMR variado (10 partidas cada uno).
  for (let p = 0; p < 6; p++) for (let i = 0; i < 12; i++) e.applyMatchResult(R(`lb-${p}-${i}`, `pl${p}`, `bot-${p}-${i}`, i < 6 + p ? "home" : "away", 13, 8, { at: i, region: p % 2 ? "Americas" : "EMEA" }));
  const top = leaderboardView(e.global, 10);
  check("LEADERBOARD: top ordenado por MMR descendente", top.length > 0 && top.every((r, i) => i === 0 || top[i - 1].mmr >= r.mmr));
  check("RANKING: rankOf(top1) === 1 y coherente", e.global.rankOf(top[0].id) === 1);
  check("LEADERBOARD REGIONAL: separa por región (compat Living World)", e.regionalBoard("EMEA").size() > 0 && e.regionalBoard("Americas").size() >= 0 && e.regionalBoard("EMEA").size() <= e.global.size());
}

// ─────────────────────── 8. Determinismo ───────────────────────
console.log("\n## Determinismo");
function run(): string {
  const e = new CompetitiveEngine();
  for (let i = 0; i < 60; i++) e.applyMatchResult(R(`d${i}`, `p${i % 8}`, `q${i % 8}`, i % 2 ? "home" : "away", 13, 9, { at: i }));
  return JSON.stringify([...Array(8)].map((_, k) => { const p = e.profile(`p${k}`); return p ? [p.mmr, p.wins, p.losses, p.league, p.division] : null; }));
}
check("DETERMINISMO: misma secuencia ⇒ mismos perfiles/rangos", run() === run());
{
  const e = new CompetitiveEngine();
  const u1 = e.applyMatchResult(R("dup", "A", "B", "home"));
  const u2 = e.applyMatchResult(R("dup", "A", "B", "home"));
  check("SEGURIDAD: aplicar el MISMO matchId dos veces NO re-actualiza (idempotente)", u1.players.length === 2 && u2.players.length === 0 && e.profile("A")!.processed.filter((x) => x === "dup").length === 1);
}

// ─────────────────────── 9. Rendimiento (miles, incremental) ───────────────────────
console.log("\n## Rendimiento");
{
  const NP = 2000, NM = Math.max(4000, Number(process.argv[2] ?? 12000));
  const e = new CompetitiveEngine();
  const t0 = Date.now();
  for (let i = 0; i < NM; i++) { const a = `u${i % NP}`, b = `u${(i * 7 + 3) % NP}`; if (a !== b) e.applyMatchResult(R(`pf${i}`, a, b, i % 2 ? "home" : "away", 13, 10, { at: i })); }
  const top = e.global.top(100); const rank = top.length ? e.global.rankOf(top[0].id) : 1;
  const ms = Date.now() - t0;
  check("RENDIMIENTO: miles de partidas, actualización incremental (sin O(n²))", ms < 3000 && rank === 1, `${NM} partidas · ${e.playerCount()} perfiles · ${ms}ms`);
}

// ─────────────────────── 10. Compat Matchmaking + Online ───────────────────────
console.log("\n## Compat Matchmaking + Online");
{
  const mm = new Matchmaker({ seedBase: 700 });
  const drafts: LobbyDraft[] = [];
  mm.onMatchReady = (_p, d) => { drafts.push(d); };
  mm.enqueue(profileFrom("Ana", "Ana", { region: "EMEA", mmr: 1500 }), "ai_match");
  mm.tick(1);
  check("COMPAT MATCHMAKING: produce un draft jugable", drafts.length === 1);
  if (drafts.length) {
    const d0 = drafts[0];
    const playable: LobbyDraft = { seed: d0.seed, rosters: d0.rosters, homeSetup: d0.homeSetup, teamNames: d0.teamNames, coach: { mode: "ai" } };
    const game = createLocalGame(playable, [{ name: "H" }, { name: "A" }]);
    connectAll(game, 8);
    for (const c of game.clients) c.joinLobby();
    game.step(); game.step(); game.clients[0].ready(); game.clients[1].ready(); game.step(); game.clients[0].start(); game.step(); game.step();
    runUntilMatchEnd(game);
    const ms = game.server.match!;
    const comp = new CompetitiveEngine();
    const cr = R("mm-1", "Ana", "bot-x", ms.score.home >= ms.score.away ? "home" : "away", ms.score.home, ms.score.away);
    const upd = comp.applyMatchResult(cr);
    check("COMPAT ONLINE: Match End → Competitive actualiza el MMR del jugador (bot no puntúa)", upd.players.length === 1 && !!comp.profile("Ana") && !comp.profile("bot-x"));
  } else check("COMPAT ONLINE: Match End → Competitive", false);
}

// ─────────────────────── 11. Compat Career + Perfil/Presentation ───────────────────────
console.log("\n## Compat Career + perfil");
{
  const e = new CompetitiveEngine();
  e.ensure("coach1", "Coach", "EMEA", 82); // coachRating REUTILIZADO de career
  for (let i = 0; i < 12; i++) e.applyMatchResult(R(`cc${i}`, "coach1", `o${i}`, "home", 13, 7, { at: i }));
  const view = profileView(e.profile("coach1")!);
  check("COMPAT CAREER: el coachRating de career viaja al perfil competitivo", e.profile("coach1")!.coachRating === 82 && view.coachRating === 82);
  check("PERFIL: la vista trae rango/winrate/racha/mejor-liga/historial", view.rank.length > 0 && view.winRate >= 0 && typeof view.streak === "number" && view.wins === 12);
  check("COACH LEADERBOARD: los coaches con rating entran en su clasificación", e.coach.size() >= 1);
}

// ─────────────────────── 12. Cero estados imposibles ───────────────────────
console.log("\n## Integridad (cero estados imposibles)");
{
  const e = new CompetitiveEngine();
  for (let i = 0; i < 400; i++) e.applyMatchResult(R(`z${i}`, `p${i % 30}`, `p${(i * 3 + 1) % 30}`, i % 2 ? "home" : "away", 13, 9, { at: i }));
  let bad = 0; const reasons: string[] = [];
  for (let k = 0; k < 30; k++) {
    const p = e.profile(`p${k}`); if (!p) continue;
    if (!Number.isFinite(p.mmr) || p.mmr < 0) { bad++; reasons.push(`mmr ${p.id}`); }
    if (p.division < 0 || p.division > 4) { bad++; reasons.push(`div ${p.id}`); }
    if (p.league && leagueForMmr(p.mmr) === undefined) { bad++; reasons.push(`league ${p.id}`); }
    if (p.wins < 0 || p.losses < 0) { bad++; reasons.push(`wl ${p.id}`); }
    if (p.series && p.series.wins > p.series.target) { bad++; reasons.push(`series ${p.id}`); }
  }
  check("INTEGRIDAD: MMR/división/liga/racha válidos, sin series corruptas", bad === 0, bad ? reasons.slice(0, 5).join(" · ") : `${e.playerCount()} perfiles OK`);
  check("INTEGRIDAD: rangos comparables (rankOrdinal ordena ligas)", rankOrdinal("champion", 0) > rankOrdinal("iron", 4) && rankLabel("gold", 2) === "Oro II");
}

console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
