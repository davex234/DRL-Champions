/**
 * F84 · RANKED 2.0 — servicio sobre MemorySupabase: temporada competitiva activa, clasificación (vista `competitive_ladder`
 * sembrada como tabla), Top acotado, alrededor de mí, paginación, elegibilidad, resultado post-partida desde el asiento,
 * perfil público, privacidad y aislamiento entre cuentas.
 *
 * Lo que solo puede probar PostgreSQL (liquidación exactamente una vez, carreras, tope de pareja, inmutabilidad del libro,
 * guardia de escritura del rating, RLS, vista con `now()`) está en el ENSAYO de 0065 sobre una copia del backup de
 * producción (`scripts/ops/_f84-dryrun.sh`, informe F84). Aquí: el código TypeScript que lee y proyecta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemorySupabase, type Row } from "./testing/memorySupabase";
import {
  getCompetitiveSnapshot, getCompetitiveLadderPage, getCompetitivePlayer, getCompetitivePosition, readActiveCompetitiveSeason, readCompetitivePosition,
} from "./competitive";
import { getMatchRatingOutcome } from "./duelsRating";
import { getPlayerIdentity } from "./playerIdentity";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEASON: Row = {
  id: "competitiva-1", number: 1, name: "Temporada competitiva 1", status: "PUBLISHED", starts_at: iso(NOW - 10 * DAY), ends_at: null, game_season_id: null,
  rank_config_version: "rank-v1", formula_version: "ranked-rating-v1", placement_games: 5,
  config: { top: { size: 500, minSeasonMatches: 5, activeDays: 14 }, pairCap: { matches: 5, hours: 24 }, reset: null },
};

/** n jugadores elegibles con ratings descendentes desde `top`; `self` (si se da) entra con `selfRating`. */
function world(opts: { n: number; top?: number; size?: number; self?: { rating: number; matches: number; inLadder: boolean; peak?: number | null } } = { n: 0 }) {
  const db = new MemorySupabase();
  db.tables.competitive_seasons = [{ ...SEASON, config: { ...(SEASON.config as object), top: { size: opts.size ?? 500, minSeasonMatches: 5, activeDays: 14 } } }];
  db.tables.profiles = [];
  db.tables.duel_pvp_ratings = [];
  db.tables.competitive_season_players = [];
  db.tables.competitive_ladder = [];
  db.tables.duel_pvp_rating_events = [];
  db.tables.duel_matches = [];
  for (let i = 1; i <= opts.n; i++) {
    const id = uid(i), rating = (opts.top ?? 1400) - i * 10;
    db.tables.profiles.push({ id, username: `Jugador${i}`, avatar: "🐺", email: `p${i}@example.com` });
    const r = { user_id: id, rating, games_played: 20, wins: 12, losses: 8, draws: 0, updated_at: iso(NOW - i * 1000) };
    db.tables.duel_pvp_ratings.push(r);
    db.tables.competitive_season_players.push({ season_id: "competitiva-1", user_id: id, matches: 8, wins: 5, losses: 3, draws: 0, seed_rating: 1000, placement_completed_at: iso(NOW - DAY), peak_rating: rating, peak_ranked_rating: rating, last_match_at: iso(NOW - DAY) });
    db.tables.competitive_ladder.push({ season_id: "competitiva-1", ...r, season_matches: 8, season_wins: 5, season_losses: 3, season_draws: 0, last_match_at: iso(NOW - DAY), peak_ranked_rating: rating, placement_completed_at: iso(NOW - DAY) });
  }
  if (opts.self) {
    const id = uid(999), s = opts.self;
    db.tables.profiles.push({ id, username: "Yo", avatar: "🎮", email: "yo@example.com" });
    const r = { user_id: id, rating: s.rating, games_played: 30, wins: 15, losses: 15, draws: 0, updated_at: iso(NOW - 500) };
    db.tables.duel_pvp_ratings.push(r);
    if (s.matches > 0) db.tables.competitive_season_players.push({ season_id: "competitiva-1", user_id: id, matches: s.matches, wins: Math.ceil(s.matches / 2), losses: Math.floor(s.matches / 2), draws: 0, seed_rating: 1000, placement_completed_at: s.matches >= 5 ? iso(NOW - DAY) : null, peak_rating: s.peak ?? s.rating, peak_ranked_rating: s.matches >= 5 ? s.peak ?? s.rating : null, last_match_at: iso(NOW - DAY) });
    if (s.inLadder) db.tables.competitive_ladder.push({ season_id: "competitiva-1", ...r, season_matches: s.matches, season_wins: 4, season_losses: s.matches - 4, season_draws: 0, last_match_at: iso(NOW - DAY), peak_ranked_rating: s.peak ?? s.rating, placement_completed_at: iso(NOW - DAY) });
  }
  return db;
}
const ME = uid(999);

test("S1 · temporada activa: publicada, empezada y sin terminar; DRAFT, futura, terminada o sin tabla → ninguna", async () => {
  const db = world({ n: 0 });
  assert.equal((await readActiveCompetitiveSeason(db.client, NOW))?.id, "competitiva-1");
  db.tables.competitive_seasons = [{ ...SEASON, status: "DRAFT" }];
  assert.equal(await readActiveCompetitiveSeason(db.client, NOW), null);
  db.tables.competitive_seasons = [{ ...SEASON, starts_at: iso(NOW + DAY) }];
  assert.equal(await readActiveCompetitiveSeason(db.client, NOW), null, "futura");
  db.tables.competitive_seasons = [{ ...SEASON, ends_at: iso(NOW - 1000) }];
  assert.equal(await readActiveCompetitiveSeason(db.client, NOW), null, "terminada");
  db.missing.add("competitive_seasons");
  assert.equal(await readActiveCompetitiveSeason(db.client, NOW), null, "sin 0065 el competitivo sirve sin temporada (degradado)");
});

test("S2 · snapshot clasificado: rango derivado, puesto del Top por la vista, alrededor de mí, sin correos", async () => {
  const db = world({ n: 30, top: 1400, self: { rating: 1155, matches: 9, inLadder: true, peak: 1172 } });
  const r = await getCompetitiveSnapshot(db.client, ME);
  assert.ok(r.ok, r.error);
  const s = r.data!;
  assert.equal(s.competitive.standing.state, "RANKED");
  assert.equal(s.competitive.standing.rank?.label, "Capitán III", "1155 → Capitán III (rank-v1)");
  assert.equal(s.competitive.standing.peakRank?.label, "Capitán II", "pico guardado 1172 → Capitán II");
  // 30 por encima con ratings 1390..1100: por delante de 1155 están los de 1390..1160 = 24.
  assert.equal(s.self.position, 25);
  assert.equal(s.self.rankedTotal, 31);
  assert.ok([...s.leaderboardTop, ...s.aroundMe].some((e) => e.isSelf && e.position === 25), "mi fila (top o alrededor) en el 25");
  assert.ok(s.leaderboardTop.every((e) => e.rank && e.season.matches === (e.isSelf ? 9 : 8)), "cada fila con rango y récord de TEMPORADA");
  assert.equal(s.competitive.eligibility?.eligible, true);
  assert.ok(!JSON.stringify(s).includes("@example.com"), "nunca correos");
});

test("S3 · en colocación (3/5): sin rango, fuera del Top, qué falta; sin partidas de temporada: sin clasificar", async () => {
  const db = world({ n: 5, self: { rating: 1089, matches: 3, inLadder: false } });
  const s = (await getCompetitiveSnapshot(db.client, ME)).data!;
  assert.equal(s.competitive.standing.state, "PLACEMENT");
  assert.equal(s.competitive.standing.rank, null);
  assert.deepEqual(s.competitive.standing.placement, { played: 3, total: 5, remaining: 2 });
  assert.equal(s.self.position, null);
  assert.equal(s.self.rating.rating, 1089, "el rating histórico se conserva (semilla oculta)");
  assert.match(s.competitive.eligibility!.missing.join(" "), /colocación/);
  const u = (await getCompetitiveSnapshot(world({ n: 2, self: { rating: 1000, matches: 0, inLadder: false } }).client, ME)).data!;
  assert.equal(u.competitive.standing.state, "UNRANKED");
});

test("S4 · Top acotado: con 83 elegibles se enseñan 83; con tope 10 y 25 elegibles, 10 (nunca se fabrican filas)", async () => {
  const p = (await getCompetitiveLadderPage(world({ n: 83 }).client, ME, { offset: 75, size: 25 })).data!;
  assert.equal(p.total, 83); assert.equal(p.entries.length, 8); assert.equal(p.entries[p.entries.length - 1].position, 83); assert.equal(p.hasNext, false);
  const capped = (await getCompetitiveLadderPage(world({ n: 25, size: 10 }).client, ME, { offset: 0, size: 25 })).data!;
  assert.equal(capped.total, 10); assert.equal(capped.entries.length, 10);
  const pos = await readCompetitivePosition(world({ n: 25, size: 10, self: { rating: 1000, matches: 9, inLadder: true } }).client, ME);
  assert.equal(pos.data?.position, null, "puesto 26 con Top de 10 → fuera del Top (sin número inventado)");
  assert.equal(pos.data?.rankedTotal, 10);
});

test("S5 · paginación: ≤ 50 por página, offset alineado, y la fila propia marcada", async () => {
  const db = world({ n: 120, self: { rating: 1110, matches: 6, inLadder: true } });
  const p = (await getCompetitiveLadderPage(db.client, ME, { offset: 999, size: 500 })).data!;
  assert.ok(p.size <= 50);
  assert.equal(p.offset % p.size, 0);
  const mine = (await getCompetitiveLadderPage(db.client, ME, { offset: p.selfPageOffset ?? 0, size: p.size })).data!;
  assert.ok(mine.entries.some((e) => e.isSelf));
});

test("S6 · población 0 / sin temporada: clasificación vacía y honesta (sin posiciones)", async () => {
  const empty = (await getCompetitiveSnapshot(world({ n: 0, self: { rating: 1000, matches: 0, inLadder: false } }).client, ME)).data!;
  assert.equal(empty.leaderboardTop.length, 0); assert.equal(empty.self.position, null); assert.equal(empty.self.rankedTotal, 0);
  const db = world({ n: 5, self: { rating: 1000, matches: 6, inLadder: true } });
  db.tables.competitive_seasons = [];
  const off = (await getCompetitiveSnapshot(db.client, ME)).data!;
  assert.equal(off.competitive.season, null); assert.equal(off.self.position, null); assert.equal(off.leaderboardTop.length, 0);
});

test("S7 · resultado post-partida: rango antes/después DEL ASIENTO; cuenta ajena 404; duelo privado 404", async () => {
  const db = world({ n: 0, self: { rating: 1229, matches: 9, inLadder: true } });
  const M = "00000000-0000-4000-9000-000000000001";
  db.tables.duel_matches = [{ id: M, mode: "PVP", user_id: ME, player_b_id: uid(1) }];
  db.tables.duel_pvp_rating_events = [{ match_id: M, user_id: ME, old_rating: 1211, delta: 18, new_rating: 1229, opponent_rating: 1236, k_factor: 24, result: "WIN", created_at: iso(NOW), competitive_season_id: "competitiva-1", season_match_number: 9, rule: "STANDARD" }];
  db.rpcHandlers.duel_pvp_ensure_rating = () => ({ data: { user_id: ME, rating: 1229, games_played: 30, wins: 15, losses: 15, draws: 0, updated_at: iso(NOW) }, error: null });
  const r = await getMatchRatingOutcome(db.client, ME, M);
  assert.ok(r.ok);
  assert.equal(r.data!.rank?.kind, "PROMOTION");
  assert.equal(r.data!.rank?.after?.label, "Estrella III");
  assert.equal(r.data!.rank?.before?.label, "Capitán I");
  const again = await getMatchRatingOutcome(db.client, ME, M);
  assert.deepEqual(again.data!.rank, r.data!.rank, "F5 / otra pestaña: idéntico");
  assert.equal((await getMatchRatingOutcome(db.client, uid(77), M)).status, 404, "quien no jugó no ve nada");
  db.tables.duel_matches = [{ id: M, mode: "PVP_PRIVATE", user_id: ME, player_b_id: uid(1) }];
  assert.equal((await getMatchRatingOutcome(db.client, ME, M)).status, 404, "un duelo privado no tiene rating");
});

test("S8 · perfil competitivo PÚBLICO de otro jugador: rango solo tras colocación; nada privado", async () => {
  const db = world({ n: 10, self: { rating: 1240, matches: 7, inLadder: true } });
  const v = (await getCompetitivePlayer(db.client, uid(1), ME)).data!;
  assert.equal(v.competitive.standing.rank?.label, "Estrella III");
  assert.equal(v.position, 11, "los 10 de 1390..1300 van por delante de 1240 → 11.º");
  const j = JSON.stringify(v);
  assert.ok(!/@example\.com|"email"|credits/.test(j));
  const placing = world({ n: 3, self: { rating: 1240, matches: 2, inLadder: false } });
  const p = (await getCompetitivePlayer(placing.client, uid(1), ME)).data!;
  assert.equal(p.competitive.standing.state, "PLACEMENT"); assert.equal(p.competitive.standing.rank, null);
});

test("S9 · foto barata del post-partida: rating, puesto del Top, partidas de temporada y etiqueta de rango", async () => {
  const r = await getCompetitivePosition(world({ n: 3, self: { rating: 1010, matches: 6, inLadder: true } }).client, ME);
  assert.deepEqual({ position: r.data!.position, seasonMatches: r.data!.seasonMatches, rankLabel: r.data!.rankLabel }, { position: 4, seasonMatches: 6, rankLabel: "Titular I" });
});

test("S10 · el perfil F89 integra el rango sin campos privados (ni versión ni correo)", async () => {
  const db = world({ n: 3, self: { rating: 1131, matches: 6, inLadder: true, peak: 1140 } });
  for (const t of ["player_profile_customization", "user_cards", "user_achievements", "pickem_scores", "user_cosmetics", "collection_sets", "user_collection_completions", "user_game", "game_seasons"]) db.tables[t] = [];
  db.tables.profiles = db.tables.profiles.map((p) => ({ ...p, xp: 100, equipped: null, packs_opened: 0, created_at: "2026-07-01T00:00:00Z" }));
  const r = await getPlayerIdentity(db.client, uid(1), ME);
  assert.ok(r.ok, r.error);
  const c = r.data!.competitive!;
  assert.equal(c.state, "RANKED"); assert.equal(c.rank?.label, "Capitán III"); assert.equal(c.peakRank?.label, "Capitán III");
  assert.ok(!/"version"|@example\.com/.test(JSON.stringify(c)));
});

/* ═══════════════════ contratos de código: autoridad, spoofing, una sola fuente ═══════════════════ */

const SETTLE_0035 = (() => { const s = read("supabase", "migrations", "0035_pvp_turn_timeout.sql"); const a = s.indexOf("create or replace function public.duel_pvp_settle_match"); return s.slice(a, s.indexOf("end $$;", a)); })();
const MIG65 = read("supabase", "migrations", "0065_ranked_competitive.sql");

test("C1 · la fórmula de 0035 se conserva LITERAL en la liquidación de 0065 (expected_score, K por jugador, recorte, delta efectivo)", () => {
  for (const line of [
    "delta_a := round(k_a * (score_a       - public.duel_pvp_expected_score(ra.rating, rb.rating)));",
    "delta_b := round(k_b * ((1 - score_a) - public.duel_pvp_expected_score(rb.rating, ra.rating)));",
    "new_a := least(5000, greatest(0, ra.rating + delta_a));",
    "new_b := least(5000, greatest(0, rb.rating + delta_b));",
    "k_a := public.duel_pvp_k_factor(ra.games_played);",
    "if inserted <> 2 then",
    "perform 1 from public.duel_pvp_ratings\n   where user_id in (m.user_id, m.player_b_id) order by user_id for update;",
  ]) { assert.ok(SETTLE_0035.includes(line), `0035: ${line}`); assert.ok(MIG65.includes(line), `0065: ${line}`); }
  assert.ok(!/duel_pvp_k_factor|duel_pvp_expected_score/.test(MIG65.replace(/public\.duel_pvp_(k_factor|expected_score)\(/g, "")), "0065 no redefine la K ni la esperanza");
});

test("C2 · exactamente una vez: el récord de temporada se escribe DETRÁS de la puerta del libro; números de partida bajo el bloqueo", () => {
  const settle = MIG65.slice(MIG65.indexOf("create or replace function public.duel_pvp_settle_match"), MIG65.indexOf("create or replace function public._competitive_season_record"));
  assert.ok(settle.indexOf("if inserted <> 2 then") < settle.indexOf("perform public._competitive_season_record("));
  assert.ok(settle.indexOf("for update;") < settle.indexOf("select coalesce(max(p.matches), 0) + 1 into num_a"));
  assert.ok(settle.indexOf("for update;") < settle.indexOf("select count(*) into v_pair"), "el tope de pareja se cuenta con las fichas bloqueadas");
  assert.ok(MIG65.includes("COMPETITIVE_SEASON_DRIFT"), "si el récord se desincroniza del libro, la transacción revienta");
});

test("C3 · el cliente no manda ganador, delta, rango ni colocación: ninguna ruta acepta esos campos ni llama a la liquidación", () => {
  const routes = [read("src", "app", "api", "game", "competitive", "route.ts"), read("src", "app", "api", "game", "duel", "pvp", "route.ts")].join("\n");
  assert.ok(!/body\.(rating|delta|winner|rank|placement|seasonMatch)/.test(routes));
  assert.ok(!/duel_pvp_settle_match|competitive_rating_correct|competitive_season_seed|competitive_season_close/.test(routes));
  const comp = read("src", "app", "api", "game", "competitive", "route.ts");
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(comp), "el competitivo es solo lectura");
});

test("C4 · una sola fuente de rating: perfil, clasificación, emparejamiento y rango leen duel_pvp_ratings / su vista", () => {
  const svc = read("src", "server", "services", "competitive.ts");
  assert.ok(svc.includes('from("competitive_ladder")') && svc.includes("deriveRank(r.rating, version)"));
  assert.ok(MIG65.includes("join public.duel_pvp_ratings r on r.user_id = p.user_id"), "la vista une el rating canónico (no lo copia)");
  assert.ok(!/rating\s+int[^,]*,\s*--\s*copia/i.test(MIG65));
  assert.ok(!/alter table public\.duel_pvp_ratings add column/i.test(MIG65), "no se añade un segundo rating");
  assert.ok(read("supabase", "migrations", "0033_pvp_rating.sql").includes("v_rating := (public.duel_pvp_ensure_rating(p_user)).rating;"), "la cola sella el rating canónico (0033, intacto)");
});

test("C5 · F83 intacta: 0065 no publica temporadas F83 ni toca XP; temporada competitiva sin enlace", () => {
  assert.ok(!/update public\.game_seasons|insert into public\.game_seasons|season_xp_ledger|user_pass/i.test(MIG65.replace(/--.*$/gm, "")));
  assert.ok(MIG65.includes("'competitiva-1', 1, 'Temporada competitiva 1', 'DRAFT', now(), null, null, 'rank-v1'"));
});

test("C6 · sin recompensas económicas por rango (F84): ni créditos ni sobres en 0065 ni en el dominio ranked", () => {
  const dom = read("src", "domain", "ranked", "standing.ts") + read("src", "domain", "ranked", "config.ts");
  assert.ok(!/app_grant_reward|credit_transactions|user_packs/i.test(MIG65 + dom));
});
