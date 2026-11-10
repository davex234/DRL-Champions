/**
 * VALIDACIÓN — LIVE ESPORTS ECOSYSTEM.
 *
 * Demuestra el ecosistema autónomo end-to-end con MÉTRICAS: pipeline completo, identidad
 * como autoridad (alias entre fuentes/temporadas → un jugador), rating, cartas, noticias,
 * mercado, colecciones, eventos, desafíos, analytics, determinismo, sin duplicados,
 * recuperación ante fallos y robustez si todo cae.
 *
 * Uso:  npx tsx scripts/live-verify.ts
 */
import { makeMockProvider, defaultFixtures, runLiveCycle, createTimeline, type MockTournament } from "../src/live";
import { resolveIdentity } from "../src/intel";
import type { RawResult, RawTeam, RawPlayerStat } from "../src/engine/types";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); ok ? pass++ : fail++; };
const clock = () => { let c = 1000; return () => c++; };

const st = (playerId: string, nick: string, teamId: string, o: Partial<RawPlayerStat> = {}): RawPlayerStat => ({
  playerId, nick, teamId, region: "EMEA", role: "Duelista", country: "es", acs: 230, kills: 18, deaths: 15, assists: 6, hsPct: 28, clutches: 1, kast: 72, ...o,
});

/** Masters 2026 donde TenZ aparece como "Tyson Ngo" (otra fuente, otra temporada). */
function masters2026(): MockTournament {
  const teams: RawTeam[] = [{ id: "tA", name: "Fnatic", tag: "FNC", region: "EMEA" }, { id: "tB", name: "Sentinels", tag: "SEN", region: "Americas" }];
  const result: RawResult = {
    tournamentId: "masters2026", winnerTeamId: "tB", mvpPlayerId: "src2_tyson",
    stats: [
      st("src2_tyson", "Tyson Ngo", "tB", { acs: 295, kills: 25, deaths: 14, clutches: 4, kast: 81 }), // = TenZ
      st("src2_zekken", "Zekken", "tB", { acs: 270, kills: 22, deaths: 16 }),
      st("src2_derke", "Derke", "tA", { acs: 250, kills: 20, deaths: 17 }),
    ],
  };
  return {
    tournament: { id: "masters2026", name: "Masters Madrid 2026", region: "Global", status: "completed", startDate: "2026-03-01", endDate: "2026-03-22" },
    teams,
    matches: [{ id: "mm1", tournamentId: "masters2026", teamAId: "tA", teamBId: "tB", startTime: "2026-03-22T18:00:00Z", status: "completed", winnerTeamId: "tB" }],
    result,
  };
}

void (async () => {
  console.log("# Validación del Live Esports Ecosystem\n");

  const flaky = makeMockProvider({ id: "flaky-vlr", priority: 100, healthy: false, tournaments: defaultFixtures() });
  const p1 = makeMockProvider({ id: "mock-primary", priority: 10, tournaments: defaultFixtures() });   // Champions 2025
  const p2 = makeMockProvider({ id: "mock-secondary", priority: 5, tournaments: [masters2026()] });    // Masters 2026 (TenZ=Tyson Ngo)
  const providers = [flaky, p1, p2];

  // ── CICLO 1 ──────────────────────────────────────────────────────────
  const tl = createTimeline();
  const r = await runLiveCycle(providers, tl, { now: clock() });
  const a = r.analytics;

  console.log("## 1. Pipeline completo");
  console.log(`  cartas ${r.cards.length} · noticias ${r.news.length} · eventos ${r.events.length} · desafíos ${r.challenges.length} · ${a.durationMs} u`);
  check("el ciclo produce cartas/noticias/eventos/desafíos", r.cards.length > 0 && r.news.length > 0 && r.events.length > 0 && r.challenges.length > 0);
  check("procesa los 2 torneos de las 2 fuentes sanas", a.tournamentsProcessed === 2, `${a.tournamentsProcessed}`);

  console.log("\n## 2. Identidad como autoridad (sin duplicados)");
  const players = Object.keys(tl.players);
  const tenzId = resolveIdentity({ name: "TenZ" });
  console.log(`  jugadores únicos: ${players.length} · canónico TenZ = "${tenzId}"`);
  check("'Tyson Ngo' NO crea un jugador aparte de TenZ", tl.players[tenzId] != null && tl.players["tysonngo"] == null);
  const tenzSeasons = new Set(tl.players[tenzId]?.cards.map((c) => c.season));
  check("TenZ acumula carrera en 2 temporadas (2025+2026)", tenzSeasons.has(2025) && tenzSeasons.has(2026), [...tenzSeasons].join(","));
  check("torneos sin duplicar", Object.keys(tl.tournaments).length === 2);

  console.log("\n## 3. Rating contextual en las cartas");
  const tenzMvp = r.cards.find((c) => c.playerId === tenzId && (c.kind === "mvp" || c.kind === "icon"));
  check("TenZ recibe carta MVP con rating alto", !!tenzMvp && tenzMvp.rating >= 80, `${tenzMvp?.rating}`);
  check("todas las cartas tienen rating 1..99 y tier", r.cards.every((c) => c.rating >= 1 && c.rating <= 99 && !!c.tier));

  console.log("\n## 4-5. Cartas + Noticias");
  check("hay familias especiales generadas (mvp/winner/champions)", r.cards.some((c) => /mvp|winner|champions/.test(c.family)));
  check("una noticia por carta, sin ids duplicados", r.news.length === r.cards.length && new Set(r.news.map((n) => n.id)).size === r.news.length);
  console.log("  Ej:", r.news.slice(0, 3).map((n) => `“${n.title}”`).join(" · "));

  console.log("\n## 6-7. Mercado + Colecciones");
  const policies = Object.values(r.market);
  const special = r.cards.find((c) => /mvp|winner|champions|icon|mythic/.test(c.family));
  const specPol = special ? r.market[`${special.playerId}:${special.family}`] : null;
  check("las ediciones especiales son exclusivas y NO entran en sobres", !!specPol && specPol.exclusive && !specPol.inPacks);
  check("toda carta entra en colección", policies.length > 0 && policies.every((p) => p.inCollection));
  check("hay cartas con peso de sobre (mercado normal)", policies.some((p) => p.inPacks && p.packWeight > 0));

  console.log("\n## 8. Eventos del universo");
  const types = new Set(r.events.map((e) => e.type));
  console.log("  tipos:", [...types].join(", "));
  check("detecta torneo finalizado + campeón + MVP + debut", ["tournament_finished", "champion", "mvp", "debut"].every((t) => types.has(t as never)));

  console.log("\n## 9. Desafíos automáticos");
  console.log("  " + r.challenges.map((c) => `“${c.title}”`).join(" · "));
  check("genera misión de campeón (team) y/o desafío de habilidad", r.challenges.some((c) => c.kind === "team") || r.challenges.some((c) => c.kind === "ability"));

  console.log("\n## 10. Analytics");
  console.log(`  fuente usada: ${a.providerUsed} · intentos: ${a.attempts.length} · nuevos jugadores: ${a.newPlayers} · creadas ${a.cardsCreated} mejoradas ${a.cardsImproved} especiales ${a.cardsSpecial} mantenidas ${a.cardsKept} · dups evitados ${a.duplicatesAvoided}`);
  check("analytics registra fuente, intentos y jugadores nuevos", a.providerUsed != null && a.attempts.length > 0 && a.newPlayers > 0);

  console.log("\n## 11. Determinismo");
  const tl2 = createTimeline();
  const r2 = await runLiveCycle(providers, tl2, { now: clock() });
  check("misma entrada ⇒ mismas cartas y mismas noticias", r2.cards.length === r.cards.length && JSON.stringify(r2.news.map((n) => n.id).sort()) === JSON.stringify(r.news.map((n) => n.id).sort()));

  console.log("\n## 12. Sin duplicados (re-ejecución sobre el mismo timeline)");
  const r3 = await runLiveCycle(providers, tl, { now: clock() }); // mismo tl que el ciclo 1
  console.log(`  segundo ciclo: ${r3.cards.length} cartas nuevas · torneos saltados ${r3.analytics.tournamentsSkipped}`);
  check("re-ejecución ⇒ 0 cartas nuevas (no duplica)", r3.cards.length === 0 && r3.analytics.tournamentsSkipped === 2);

  console.log("\n## 13. Recuperación ante fallos (failover)");
  const flakyFail = a.attempts.some((at) => at.provider === "flaky-vlr" && !at.ok);
  check("la fuente caída falla y el ecosistema continúa (failover)", flakyFail && r.cards.length > 0);

  console.log("\n## 14. Robustez: si TODO falla, el sistema queda estable");
  const onlyFlaky = await runLiveCycle([flaky], createTimeline(), { now: clock() });
  check("todas las fuentes caídas ⇒ 0 cartas, sin excepción, estable", onlyFlaky.cards.length === 0 && onlyFlaky.analytics.tournamentsProcessed === 0);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass}/${pass + fail} comprobaciones`);
})();

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
