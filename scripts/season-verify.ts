/**
 * FASE 34 · VERIFICADOR DE TEMPORADAS — `npm run season:verify` (todas las secciones) o
 *   `season-time:verify` · `season-pass:verify` · `season-security:verify` · `season-recap:verify`.
 *
 * Sin base de datos real: dominio puro + servicio contra `FakeSupabase` (registra escrituras).
 * Lo que requiere Postgres (RLS, PostgREST, `app_rate_take`): NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import { SEASON_CALENDAR } from "../src/data/seasonCalendar";
import { CURRENT_SEASON } from "../src/data/season";
import { resolveCalendar, validateCalendar, statusAt, presentationAt, ENDING_SOON_MS } from "../src/domain/season/calendar";
import { countdown, formatCountdown, estimateServerNow } from "../src/domain/season/time";
import { buildSeasonRecap } from "../src/domain/season/recap";
import { freshPassState } from "../src/battlepass";
import { FakeSupabase } from "../src/server/services/testing/fakeSupabase";
import { getSeasonHub, COLLECTION_WINDOW_RELIABLE } from "../src/server/services/season";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;

const D = 86_400_000;
const S1 = SEASON_CALENDAR[0];
const START = Date.parse(S1.startsAt); const END = Date.parse(S1.endsAt);

async function main() {
  console.log(`# Temporadas · sección ${section}\n`);

  if (want("domain") || section === "all") {
    console.log("## Calendario canónico");
    check("calendario válido (sin solapes, rangos ni fechas ambiguas)", validateCalendar(SEASON_CALENDAR).length === 0);
    check("nexus-s1 es la Temporada 1 y el contenido del pase", S1.id === CURRENT_SEASON.id && S1.passSeasonId === CURRENT_SEASON.id);
    check("duración = durationDays del pase", (END - START) / D === CURRENT_SEASON.durationDays, `${(END - START) / D} días`);
    check("no hay Temporada 2 inventada", SEASON_CALENDAR.length === 1);
    const r = resolveCalendar(SEASON_CALENDAR, START + D);
    check("una sola temporada ACTIVE", r.ok && r.seasons.filter((s) => s.status === "ACTIVE").length === 1);
  }

  if (want("time")) {
    console.log("\n## Tiempo");
    check("UPCOMING / ACTIVE / ENDED en los bordes", statusAt(START, END, START - 1) === "UPCOMING" && statusAt(START, END, START) === "ACTIVE" && statusAt(START, END, END) === "ENDED");
    check("ENDING_SOON a 7 días exactos", presentationAt(START, END, END - ENDING_SOON_MS) === "ENDING_SOON" && presentationAt(START, END, END - ENDING_SOON_MS - 1) === "ACTIVE");
    check("< 24 h en HH:MM:SS", formatCountdown(countdown(END, END - (3 * 3600_000 + 4 * 60_000 + 5_000))).primary === "03:04:05");
    check("reloj local adelantado no adelanta la temporada", statusAt(START, END, estimateServerNow({ serverNow: END - 3600_000, receivedAt: END + 10 * D }, END + 10 * D + 1000)) === "ACTIVE");
  }

  const seedDb = () => {
    const db = new FakeSupabase();
    const state = freshPassState(CURRENT_SEASON.id); state.xp = 7_400; state.claimedFree = [1, 2, 3];
    db.tables = {
      profiles: [{ id: "u1", xp: 12_345, points: 120, packs_opened: 3, email: "x@y.z", is_admin: true, equipped: {} }],
      user_pass: [{ user_id: "u1", season_id: CURRENT_SEASON.id, state }],
      duel_pvp_ratings: [{ user_id: "u1", rating: 1111, games_played: 12, wins: 7, losses: 5, draws: 0, updated_at: new Date(START).toISOString() }],
      duel_pvp_rating_events: [{ user_id: "u1", created_at: new Date(START + D).toISOString(), result: "WIN", old_rating: 1090, delta: 21, new_rating: 1111 }],
      pickem_answers: [{ user_id: "u1", option_key: "HIDDEN_PICK" }],
    };
    return db;
  };

  if (want("pass")) {
    console.log("\n## Pase");
    const db = seedDb();
    const s = (await getSeasonHub(db.client, "u1", { now: START + 2 * D })).data!;
    check("XP de cuenta ≠ XP de pase", s.personal!.account.xp === 12_345 && s.personal!.pass!.xp === 7_400);
    check("carril libre = CURRENT_SEASON.free", s.personal!.pass!.tracks.free.length === Object.keys(CURRENT_SEASON.free).length);
    check("carril competitivo = CURRENT_SEASON.competitive", JSON.stringify(s.personal!.pass!.tracks.competitive.map((l) => l.reward)) === JSON.stringify(Object.values(CURRENT_SEASON.competitive!)));
    check("leer no escribe el pase", db.writes.length === 0, db.writes.join(","));
  }

  if (want("security")) {
    console.log("\n## Seguridad");
    const db = seedDb();
    const anon = (await getSeasonHub(db.client, null, { now: START + 2 * D })).data!;
    check("anónimo sin datos personales", anon.personal === null);
    const me = JSON.stringify((await getSeasonHub(db.client, "u1", { now: START + 2 * D })).data);
    check("sin email, is_admin ni respuestas de Pick'em", !me.includes("x@y.z") && !me.includes("is_admin") && !me.includes("HIDDEN_PICK"));
    const bad = await getSeasonHub(db.client, "u1", { now: START, season: "../x" });
    check("id de temporada estricto (400)", bad.status === 400);
    const endDb = seedDb();
    await getSeasonHub(endDb.client, "u1", { now: END + D, season: "nexus-s1" });
    // `app_content_distribution_snapshot` (0039) es `language sql stable` y solo hace SELECT: lectura del catálogo
    // que hace `serverCatalog` al validar mazos. Cualquier otra RPC (conceder, reclamar, liquidar…) sería un fallo.
    const READ_ONLY_RPC = new Set(["app_content_distribution_snapshot"]);
    const writeRpcs = endDb.rpcs.filter((r) => !READ_ONLY_RPC.has(r));
    check("pasar endsAt: cero escrituras y cero RPC de escritura", endDb.writes.length === 0 && writeRpcs.length === 0, `${endDb.writes.length} escrituras · RPC: ${endDb.rpcs.join(", ") || "ninguna"}`);
    console.log("  · RLS, PostgREST y app_rate_take reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS");
  }

  if (want("recap")) {
    console.log("\n## Resumen");
    const r = buildSeasonRecap({ season: { id: S1.id, name: S1.name, startsAtMs: START, endsAtMs: END, status: "ENDED" }, pass: null, ratingEvents: [{ createdAt: START + D, result: "WIN", oldRating: 1000, newRating: 1030 }, { createdAt: END, result: "WIN", oldRating: 1030, newRating: 1050 }], achievementClaims: [], pickemScores: [], cardsObtainedInWindow: null });
    check("final con hechos de la ventana [inicio, final)", r.kind === "FINAL" && r.ranked!.games === 1 && r.ranked!.finalRating === 1030);
    check("colección omitida si no es fiable", r.cardsObtained === null && COLLECTION_WINDOW_RELIABLE === false);
    check("sin horas, carta favorita ni percentil", !/hours|favorite|percentile/i.test(JSON.stringify(r)));
    const so = buildSeasonRecap({ season: { id: S1.id, name: S1.name, startsAtMs: START, endsAtMs: END, status: "ACTIVE" }, pass: null, ratingEvents: [], achievementClaims: [], pickemScores: [], cardsObtainedInWindow: null });
    check("en curso: «hasta ahora», no «completada»", so.kind === "SO_FAR" && !so.title.includes("completada"));
  }

  console.log(`\n━━━ Resultado: ${ok} ✓ / ${ko} ✗ ━━━`);
  process.exit(ko > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
