/**
 * F84 · QA EN PRODUCCIÓN DEL RANKED 2.0 (instrumento, fuera de CI). SOLO cuentas QA (A = f45, B = qa352, K = f69).
 *
 *   BASE_URL=https://valorosters.com npx tsx C:/NEXUS-CENTRAL/DRLCards/scripts/_f84-prod-qa.mts [--match]   (cwd = prodqa)
 *
 * Lecturas: 0065 aplicada, temporada competitiva activa, centro competitivo por cuenta, clasificación honesta (sin filas
 * fabricadas), perfil público sin datos privados, resultado de una partida ANTERIOR a F84 = solo rating (frontera),
 * cuenta ajena 404, privado 404, nada que se pueda escribir. Con `--match`: UNA partida ranked real entre A y B (las dos
 * QA) — cola → emparejamiento → partida jugada por API → liquidación una vez → colocación 1/5 sellada en la temporada.
 * Nada toca a usuarios reales ni la cuenta personal (los helpers abortan si la ven).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const qa = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/multiplayer/_qa.ts");
const lib = await import("file:///C:/NEXUS-CENTRAL/DRLCards/scripts/_fase68-lib.ts");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { login, api, mm, pvpGet, validDeck, legalMove, uuid, sleep } = qa;
const { openBrowser, loginUi, waitFor, PERSONA_FILES } = lib;
const TMP = process.env.TEMP ?? "C:/Users/david/AppData/Local/Temp";
PERSONA_FILES.QA = join(TMP, "claude/C--NEXUS-CENTRAL-DRLCards/287155d6-0740-47dd-baa7-edb43491b4e3/scratchpad/f45-qa-creds.json");
const BASE = process.env.BASE_URL ?? "";
if (BASE !== "https://valorosters.com") throw new Error("BASE_URL=https://valorosters.com");
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/f84-ranked/prod";
mkdirSync(`${OUT}/shots`, { recursive: true });
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 700) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`); };
const sql = (q: string): string => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -v ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const C = "/api/game/competitive";
// «credits» SÍ aparece legítimamente en la definición de recompensas del carril del pase (2.000 créditos al nivel 5): lo privado
// sería el SALDO de la cuenta, un correo o datos de cuenta.
const noPII = (j: unknown) => !/@[a-z0-9-]+\.[a-z]{2,}|"email"|"is_admin"|"balance"|"password"|"phone"/i.test(JSON.stringify(j)) && (j as any)?.credits === undefined;

/* ── 1 · cabeza y temporada ── */
const ready = await api(null, "/api/ready");
// F86 · se exige que 0065 esté APLICADA (cabeza ≥ 0065 por estado real y su capacidad «ranked» en verde), no que sea la
// última: cada migración posterior compatible (0066…) rompía aquí sin que F84 hubiera cambiado.
const headN = Number(String(ready.json?.migrationHead ?? "").slice(0, 4));
check("ready + 0065 aplicada (cabeza ≥ 0065) + check «ranked»", ready.status === 200 && headN >= 65 && (ready.json?.checks ?? []).some((c: any) => c.id === "ranked" && c.ok), { head: ready.json?.migrationHead, status: ready.json?.status });
check("anónimo → 401", (await api(null, C)).status === 401);
check("POST al competitivo → 405 (solo lectura)", [404, 405].includes((await api(null, C, { rating: 9999 })).status));

const A = await login("A"), B = await login("B");
const K = { ...(await (async () => { const t = await lib.token("K"); return { token: t }; })()), name: "K", userId: lib.creds("K").userId, email: "", password: "" };
const snapA = await api(A, C);
check("A · centro competitivo 200", snapA.status === 200, snapA.status);
const cA = snapA.json?.competitive;
check("A · temporada competitiva 1 activa (rank-v1, 5 de colocación, Top 500, abierta)", cA?.season?.id === "competitiva-1" && cA?.season?.rankConfigVersion === "rank-v1" && cA?.season?.placementGames === 5 && cA?.season?.top?.size === 500 && cA?.season?.endsAt === null, cA?.season);
const dbRatingA = Number(sql(`select rating from public.duel_pvp_ratings where user_id='${A.userId}';`) || "1000");
check("A · rating = el canónico de la BD (una sola fuente)", snapA.json?.self?.rating?.rating === dbRatingA, { api: snapA.json?.self?.rating?.rating, db: dbRatingA });
const preMatchesA = Number(sql(`select coalesce((select matches from public.competitive_season_players where season_id='competitiva-1' and user_id='${A.userId}'),0);`));
check("A · estado coherente con sus partidas de temporada (rango solo tras 5)", preMatchesA >= 5 ? cA?.standing?.state === "RANKED" && !!cA?.standing?.rank : cA?.standing?.rank === null && cA?.standing?.placement?.played === preMatchesA, { state: cA?.standing?.state, seasonMatches: preMatchesA });
check("A · sin correos ni datos privados en el cable", noPII(snapA.json));
const lad = await api(A, `${C}?ladder=1&offset=0`);
const eligible = Number(sql("select count(*) from public.competitive_ladder where season_id='competitiva-1';"));
check("clasificación = elegibles reales de la vista (nunca filas fabricadas)", lad.status === 200 && lad.json?.total === Math.min(eligible, 500) && (lad.json?.entries ?? []).length === Math.min(eligible, 25), { total: lad.json?.total, eligible });
check("clasificación: tamaño de página acotado aunque se pida 5000", (await api(A, `${C}?ladder=1&offset=0&size=5000`)).json?.size <= 50);
const pos = await api(A, `${C}?position=1`);
check("foto barata: posición, partidas de temporada y etiqueta", pos.status === 200 && typeof pos.json?.seasonMatches === "number" && typeof pos.json?.rankLabel === "string", pos.json);
const pv = await api(K as any, `${C}?player=${A.userId}`);
check("perfil competitivo público (K mira a A): estado de temporada y sin datos privados", pv.status === 200 && !!pv.json?.competitive?.standing && noPII(pv.json), { state: pv.json?.competitive?.standing?.state });
const prof = await api(K as any, `/api/game/player?id=${A.userId}`);
check("perfil F89 (K mira a A): bloque competitivo sin versión ni correo", prof.status === 200 && (prof.json?.competitive === null || (!!prof.json?.competitive && !/"version"/.test(JSON.stringify(prof.json.competitive)))) && noPII(prof.json?.competitive ?? {}), prof.json?.competitive);

/* ── 2 · frontera histórica, cuenta ajena, privado ── */
const oldMatch = sql(`select e.match_id from public.duel_pvp_rating_events e where e.user_id='${A.userId}' and e.competitive_season_id is null order by e.created_at desc limit 1;`);
if (oldMatch) {
  const o = await pvpGet(A, oldMatch, "&outcome=1");
  check("partida ANTERIOR a F84: rating real, movimiento de rango UNSEASONED (no se reconstruyen colocaciones)", o.status === 200 && o.json?.rank?.kind === "UNSEASONED" && typeof o.json?.outcome?.delta === "number", { kind: o.json?.rank?.kind });
  check("partida ajena → 404 (K no jugó)", (await pvpGet(K as any, oldMatch, "&outcome=1")).status === 404);
}
const privMatch = sql(`select id from public.duel_matches where mode='PVP_PRIVATE' and (user_id='${A.userId}' or player_b_id='${A.userId}') order by created_at desc limit 1;`);
if (privMatch) {
  const p = await pvpGet(A, privMatch, "&outcome=1");
  check("duelo privado: sin rating ni rango", p.status === 200 ? p.json?.outcome === null && p.json?.rank === null : p.status === 404, { status: p.status, outcome: p.json?.outcome ?? null });
}
check("parámetros de cliente ignorados (?rating=9999 no cambia nada)", (await api(A, `${C}?rating=9999&delta=500`)).json?.self?.rating?.rating === dbRatingA);

/* ── 3 · partida ranked REAL entre dos cuentas QA (opcional) ── */
if (process.argv.includes("--match")) {
  const live = Number(sql("select count(*) from public.duel_pvp_queue where state in ('QUEUED','PAIRING');"));
  check("cola vacía antes de empezar (no emparejar con un jugador real)", live === 0, live);
  if (live === 0) {
    const [dA, dB] = await Promise.all([validDeck(A), validDeck(B)]);
    check("A y B con equipo legal", !!dA && !!dB, { a: !!dA, b: !!dB });
    const before = sql(`select string_agg(user_id||':'||rating||':'||games_played, ',' order by user_id) from public.duel_pvp_ratings where user_id in ('${A.userId}','${B.userId}');`);
    await Promise.all([mm(A, { action: "enqueue", deckId: dA!.id }), mm(B, { action: "enqueue", deckId: dB!.id })]);
    let id: string | null = null;
    for (let i = 0; i < 20 && !id; i++) { const [a, b] = await Promise.all([mm(A), mm(B)]); if (a.json?.entry?.state === "MATCHED" && b.json?.entry?.state === "MATCHED" && a.json.entry.matchId === b.json.entry.matchId) id = a.json.entry.matchId; else await sleep(1500); }
    check("emparejados A-B (cola humana, sin bots)", !!id, id);
    if (id) {
      const mu = await api(A, `${C}?matchup=${id}`);
      check("rival encontrado: etiqueta de rango de los dos lados", mu.status === 200 && typeof mu.json?.you?.rankLabel === "string" && typeof mu.json?.rival?.rankLabel === "string", { you: mu.json?.you?.rankLabel, rival: mu.json?.rival?.rankLabel });
      const snapOf = async (w: any) => (await pvpGet(w, id!)).json?.snapshot;
      for (let i = 0; i < 80; i++) {
        const [x, y] = await Promise.all([snapOf(A), snapOf(B)]);
        if (["FINISHED", "ABANDONED", "EXPIRED"].includes(x?.lifecycle)) break;
        const w = x?.isYourTurn ? A : y?.isYourTurn ? B : null;
        if (!w) { await sleep(400); continue; }
        const s = w === A ? x : y;
        await api(w, "/api/game/duel/pvp", { action: "play", matchId: id, actionId: uuid(), expectedVersion: s.stateVersion, ...legalMove(s)! });
      }
      let oa: any = null, ob: any = null;
      for (let i = 0; i < 10; i++) { oa = (await pvpGet(A, id, "&outcome=1")).json; ob = (await pvpGet(B, id, "&outcome=1")).json; if (oa?.outcome && ob?.outcome) break; await sleep(800); }
      check("partida terminada y liquidada para los dos", !!oa?.outcome && !!ob?.outcome, { a: oa?.outcome?.delta, b: ob?.outcome?.delta });
      const ledger = sql(`select count(*)||'|'||min(competitive_season_id)||'|'||min(formula_version)||'|'||string_agg(rule, ',') from public.duel_pvp_rating_events where match_id='${id}';`);
      check("libro: 2 asientos sellados en competitiva-1 con ranked-rating-v1", ledger.startsWith("2|competitiva-1|ranked-rating-v1|"), ledger);
      check("resultado del servidor: colocación de la temporada (rango oculto hasta 5)", ["PLACEMENT_PROGRESS", "PLACEMENT_COMPLETE", "PROMOTION", "DEMOTION", "SAME"].includes(oa?.rank?.kind) && (oa?.rank?.kind !== "PLACEMENT_PROGRESS" || oa?.rank?.after === null), { kind: oa?.rank?.kind, placement: oa?.rank?.placement });
      const again = await Promise.all(Array.from({ length: 6 }, () => pvpGet(A, id!, "&outcome=1")));
      check("6 lecturas del resultado (F5 / pestañas): mismo movimiento y sin doble liquidación", again.every((r) => JSON.stringify(r.json?.rank) === JSON.stringify(oa?.rank)) && sql(`select count(*) from public.duel_pvp_rating_events where match_id='${id}';`) === "2");
      const csp = sql(`select string_agg(matches::text, ',' order by user_id) from public.competitive_season_players where season_id='competitiva-1' and user_id in ('${A.userId}','${B.userId}');`);
      const seq = sql(`select string_agg(season_match_number::text, ',' order by user_id) from public.duel_pvp_rating_events where match_id='${id}';`);
      check("récord de temporada = número sellado en el asiento (exactamente una vez)", csp === seq && csp.length > 0, { csp, seq });
      const after = sql(`select string_agg(user_id||':'||rating||':'||games_played, ',' order by user_id) from public.duel_pvp_ratings where user_id in ('${A.userId}','${B.userId}');`);
      const chain = sql(`with e as (select user_id, old_rating, lag(new_rating) over (partition by user_id order by created_at, seq) prev from public.competitive_rating_ledger where user_id in ('${A.userId}','${B.userId}')) select count(*) from e where prev is not null and prev <> old_rating;`);
      check("cadena old = new anterior intacta (A y B)", chain === "0", { before, after, chain });
      writeFileSync(`${OUT}/match.json`, JSON.stringify({ matchId: id, before, after, ledger, csp, rankA: oa?.rank, rankB: ob?.rank }, null, 1));
    }
  }
}

/* ── 4 · UI con sesión (cuenta QA): centro competitivo y perfil ── */
for (const w of [1440, 1024, 390]) {
  const c = await openBrowser("QA", w, { label: `f84-prod-${w}` });
  try {
    await loginUi(c, "QA");
    await c.tab.goto(`${BASE}/competitivo`, 3500);
    await waitFor(c.tab, `!!document.querySelector('[data-scene="ranked-hero"]')`, 30000).catch(() => null); await sleep(1200);
    const hero = await c.tab.js<{ state: string | null; emblem: string | null }>(`(() => ({ state: document.querySelector('[data-scene="ranked-hero"]')?.getAttribute('data-state') ?? null, emblem: document.querySelector('[data-scene="ranked-hero"] [data-testid="competitive-emblem"]')?.getAttribute('aria-label') ?? null }))()`);
    check(`/competitivo ${w}: héroe con estado y emblema accesible`, !!hero.state && !!hero.emblem, hero);
    check(`/competitivo ${w}: sin desbordamiento`, (await c.tab.js<number>("document.documentElement.scrollWidth - window.innerWidth")) <= 0);
    await c.tab.shot(`${OUT}/shots/competitivo-${w}.png`).catch(() => null);
    await c.tab.goto(`${BASE}/jugador/${A.userId}`, 3500);
    // Desde 2026-10-05 el perfil es UNA tarjeta de identidad: el rango vive en `profile-rank` (antes `hero-ranked` del héroe).
    await waitFor(c.tab, `!!document.querySelector('[data-testid="profile-card"]')`, 30000).catch(() => null); await sleep(1000);
    // F87.1 · contrato de la tarjeta (EMPTY_OWN): el bloque de rango SOLO existe con estado RANKED o PLACEMENT. Una QA
    // nueva sin historial ranked no lo tiene; el arnés compara con el estado REAL que da el servidor en ese momento.
    const stNow = (await api(A, C)).json?.competitive?.state ?? null;
    const wantRank = stNow === "RANKED" || stNow === "PLACEMENT";
    const hasRank = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="profile-rank"]')`);
    const hasCard = await c.tab.js<boolean>(`!!document.querySelector('[data-testid="profile-card"]')`);
    check(`perfil propio ${w}: bloque ranked ${wantRank ? "presente" : "ausente"} según el estado del servidor (${stNow})`, hasCard && hasRank === wantRank, { stNow, hasRank, hasCard });
    await c.tab.shot(`${OUT}/shots/perfil-${w}.png`).catch(() => null);
    if (w === 1440) {
      await c.tab.goto(`${BASE}/duelos?modo=RANKED`, 3500); await sleep(2500);
      check("/duelos ranked: tarjeta con emblema competitivo", await c.tab.js<boolean>(`!!document.querySelector('[data-testid="duel-ranked-inline"] [data-testid="competitive-emblem"]')`));
      await c.tab.shot(`${OUT}/shots/duelos-ranked-1440.png`).catch(() => null);
    }
  } finally { await c.browser.close().catch(() => null); }
}

/* ── 5 · regresión de superficie (F76/F79/F80/F81/F82/F83/F89) ── */
for (const p of ["/", "/competitivo", "/duelos", "/temporada", "/coleccion", "/coleccion/trofeos", "/tienda", "/misiones/crafting", "/progresion", "/admin/competitive", `/jugador/${A.userId}`]) {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  check(`página ${p} → 200`, r.status === 200, r.status);
}
for (const p of ["/api/game/state", "/api/game/me", "/api/game/competitive", "/api/game/forge", "/api/game/missions", "/api/game/crafting", "/api/game/collection-sets", "/api/game/daily-loop", "/api/game/season-track", "/api/game/duel/matchmaking"]) {
  const r = await api(K as any, p);
  check(`API ${p} (K) → 2xx`, r.status >= 200 && r.status < 300, r.status);
}
/*
 * F86.1 · GUARDIA «RANKED NO TOCA LA ECONOMÍA» (sustituye a la de hashes congelados).
 *   Antes: los 8 ficheros de economía, forja, sobres, sets y temporada de la release ACTIVA tenían que ser byte a byte
 *   los de la release de F83 (22c509c6). Protegía que el despliegue de F84 (Ranked 2.0) no hubiera tocado nada de eso.
 *   Quedó obsoleta: cualquier fase POSTERIOR que mejore legítimamente uno de esos ficheros (F86 añadió los trofeos de
 *   torneo a collectionSets.ts) la rompía sin que Ranked hubiera cambiado. Un hash eterno no distingue «Ranked tocó la
 *   economía» de «otra fase evolucionó su propio fichero».
 *   Ahora: se comprueba la INTENCIÓN con invariantes de la release y de la BD en producción:
 *     · la liquidación ranked (`duel_pvp_settle_match`, BD) exige ranked y solo escribe rating/temporada competitiva:
 *       ninguna tabla o función de créditos, sobres, cartas, cosméticos, forja, crafteo, misiones ni XP de temporada;
 *     · los servicios ranked de la release activa no importan ningún módulo de economía, sobres, forja, tienda,
 *       crafteo, misiones, sets ni de escritura de la temporada;
 *     · (aparte, más abajo) los seis precios de sobres de F80 siguen en el fichero de sobres activo.
 */
const ssh = (cmd: string) => execFileSync("ssh", ["-i", `${process.env.USERPROFILE}/.ssh/id_ed25519`, "nexusadmin@212.95.40.144", cmd], { encoding: "utf8" }).trim();
const V = "/opt/nexus/projects/valorosters";
const settleRefs = sql("select coalesce(string_agg(distinct m[1], ',' order by m[1]),'') from pg_proc p, regexp_matches(p.prosrc, 'public[.]([a-z_]+)', 'g') m where p.proname = 'duel_pvp_settle_match';").split(",").filter(Boolean);
const settleSrc = sql("select prosrc from pg_proc where proname = 'duel_pvp_settle_match';");
const ECONOMY_DB = /^(credit_transactions|_ledger_apply|app_grant_reward|user_packs|user_cards|user_cosmetics|forge_config|craft_recipes|app_craft_\w+|app_salvage_\w+|mission_events|user_mission_progress|season_xp_ledger|app_season_apply|app_season_claim|user_pass|cups|cup_\w+)$/;
const rankedImports = ssh(`cd $(readlink -f ${V}/current) && grep -h -e "^import" -e "^} from" src/server/services/duelsRating.ts src/server/services/competitive.ts src/server/services/duelsMatchmaking.ts`);
const ECONOMY_TS = /from "\.\/(packs|store|forge|forgeConfig|credits|rewards|economy|seasonTrack|crafting|missionEngine|collectionSets|cups)"|from "@\/server\/services\/(packs|store|forge|credits|rewards|economy|seasonTrack|crafting|missionEngine|collectionSets|cups)"/;
const badDb = settleRefs.filter((t) => ECONOMY_DB.test(t));
check("Ranked no toca la economía (invariantes, no hashes): la liquidación exige ranked y solo escribe rating/temporada competitiva; los servicios ranked no importan economía, sobres, forja, tienda, crafteo, misiones, sets ni escritura de temporada",
  settleRefs.includes("duel_pvp_ratings") && /NOT_PVP/.test(settleSrc) && badDb.length === 0 && !ECONOMY_TS.test(rankedImports),
  { tablas: settleRefs.join(","), prohibidas: badDb, importEconomia: (rankedImports.match(ECONOMY_TS) ?? [])[0] ?? null });
const packsSrc = ssh(`cat $(readlink -f ${V}/current)/src/data/packs.ts`);
check("F80 · los seis precios en el fichero de sobres activo", [2500, 6000, 12000, 20000, 35000, 60000].every((p) => new RegExp(`price: ${p}\\b`).test(packsSrc)));
const st = sql("select (select status from public.game_seasons where id='temporada-2')||'|'||(select count(*) from public.season_xp_ledger)||'|'||(select count(*) from public.competitive_rating_adjustments)||'|'||(select count(*) from public.competitive_season_snapshots);");
check("F83 T2 DRAFT, 0 XP de temporada; F84 sin ajustes ni fotos (nada otorgado ni reiniciado)", st === "DRAFT|0|0|0", st);
const flags = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
check("health 200", !!flags);

writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, pass: rows.filter((r) => r.ok).length, fail: rows.filter((r) => !r.ok).length, rows }, null, 1));
console.log(`\nTOTAL ${rows.filter((r) => r.ok).length}/${rows.length}`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
