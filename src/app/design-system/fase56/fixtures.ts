/**
 * FIXTURES QA SYNTHETIC · FASE 56 — solo para el arnés `/design-system/fase56` y sus capturas.
 *
 * Reutiliza los hechos del arnés de la Fase 31 (cartas REALES del catálogo, uids/series ficticios) y añade lo de
 * la Fase 56: vecinos de escalera, temporada con asientos de rating y logros recientes. La foto sale de la MISMA
 * función del servidor (`buildPlayerIdentity`). Nunca se escribe ni se envía: la cuenta real no se toca.
 */
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { resolveCalendar } from "@/domain/season/calendar";
import { buildPlayerIdentity, type IdentityFacts, type PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { facts, lookup, rankOf, QA_NOW, SELF_ID, RIVAL_ID } from "../fase31/fixtures";
// F84 · el rango de la temporada competitiva sale de la MISMA función pura que usa el servidor.
import { competitiveStanding } from "@/domain/ranked/standing";
import { QA_CSEASON } from "../fase28/fixtures";

export { QA_NOW, SELF_ID, RIVAL_ID };

const D = 86_400_000;
const snap = (f: IdentityFacts, viewerId: string | null): PlayerIdentitySnapshot => buildPlayerIdentity(f, { viewerId, now: QA_NOW, lookup, rankOf });
const nb = (n: number, username: string, position: number, rating: number) => ({ userId: `00000000-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`, username, position, rating });

function season(results: ("WIN" | "LOSS" | "DRAW")[], start: number): IdentityFacts["season"] {
  const cal = resolveCalendar(SEASON_CALENDAR, QA_NOW);
  if (!cal.ok || !cal.current) return null;
  const s = cal.current;
  let r = start;
  const events = results.map((res, i) => {
    const delta = res === "WIN" ? 18 : res === "LOSS" ? -14 : 0;
    const e = { createdAt: s.startsAtMs + (i + 1) * 0.3 * D, result: res, oldRating: r, newRating: r + delta };
    r += delta;
    return e;
  });
  return { id: s.id, displayName: s.displayName, startsAtMs: s.startsAtMs, endsAtMs: s.endsAtMs, remainingMs: s.remainingMs, events };
}

const RANKED_NEIGHBORS = { above: nb(1, "Vortex", 123, 1262), below: nb(2, "Lume", 125, 1251) };

/** F84 · hecho competitivo sintético: `matches` partidas de temporada (colocación = 5) y mejor rating desde la colocación. */
function comp(rating: number, matches: number, wins: number, peakRanked: number | null): IdentityFacts["competitive"] {
  const record = matches > 0 ? {
    matches, wins, losses: matches - wins, draws: 0, seedRating: rating, placementCompletedAt: matches >= 5 ? QA_NOW - 3 * D : null,
    peakRating: Math.max(rating, peakRanked ?? rating), peakRankedRating: matches >= 5 ? Math.max(rating, peakRanked ?? rating) : null, lastMatchAt: QA_NOW - D,
  } : null;
  return { seasonName: QA_CSEASON.name, standing: competitiveStanding({ rating, season: QA_CSEASON, record }) };
}
const SEASON_FULL = season(["WIN", "WIN", "LOSS", "WIN", "DRAW", "WIN", "LOSS", "WIN"], 1190);

/** Perfil propio completo: clasificado #124, vitrina, logros destacados, temporada. */
export const OWN = snap({ ...facts(), neighbors: RANKED_NEIGHBORS, season: SEASON_FULL, competitive: comp(1256, 12, 7, 1268) }, SELF_ID);
/** Perfil ajeno visto con sesión (H2H incluido). */
export const OTHER = snap({
  ...facts({ profileId: RIVAL_ID, username: "QA · Kaelis" }), neighbors: RANKED_NEIGHBORS, season: SEASON_FULL,
  h2h: { ranked: { wins: 3, losses: 2, draws: 0, matches: 5 }, private: { wins: 1, losses: 1, draws: 0, matches: 2 }, total: { wins: 4, losses: 3, draws: 0, matches: 7 } },
}, SELF_ID);
/** Clasificado alto (#3), ajeno. */
export const RANKED_PLAYER = snap({
  ...facts({ profileId: RIVAL_ID, username: "QA · Sable" }),
  ranked: { rating: 1488, gamesPlayed: 61, provisional: false, wins: 40, losses: 19, draws: 2, position: 3, rankedTotal: 512, winrate: 66, form: ["W", "W", "W", "L", "W"], streak: { kind: "W", n: 3 } },
  highestRating: 1502, neighbors: { above: nb(3, "Vortex", 2, 1501), below: nb(4, "Orion", 4, 1470) }, season: season(["WIN", "WIN", "WIN", "LOSS"], 1420),
  competitive: comp(1488, 14, 10, 1502),
}, SELF_ID);
/** En colocación: 7 / 10. */
export const PLACEMENT_PLAYER = snap({
  ...facts({ profileId: RIVAL_ID, username: "QA · Nyra" }),
  ranked: { rating: 1062, gamesPlayed: 7, provisional: true, wins: 4, losses: 3, draws: 0, position: 41, rankedTotal: 512, winrate: 57, form: ["W", "L", "W", "W", "L"], streak: null },
  highestRating: 1080, neighbors: { above: nb(5, "Rook", 40, 1063), below: nb(6, "Ivy", 42, 1058) }, season: season(["WIN", "LOSS", "WIN", "WIN", "LOSS", "WIN", "LOSS"], 1000),
  competitive: comp(1062, 3, 2, null),
}, SELF_ID);
/** Nunca jugó ranked. */
export const NO_RANKED = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Sin ranked" }), ranked: null, highestRating: null, recentMatches: [], neighbors: null, season: season([], 1000) }, SELF_ID);
/** Sin logros destacados, con logros conseguidos → «últimos conseguidos». */
export const RECENT_ACHIEVEMENTS = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Kaelis", featured: [] }), neighbors: RANKED_NEIGHBORS, season: SEASON_FULL }, SELF_ID);
/** Nombre muy largo (nombres de BD admiten hasta 40). */
export const LONG_NAME = snap({ ...facts({ profileId: RIVAL_ID, username: "QA_Nombre_De_Jugador_Larguisimo_Extremo" }), neighbors: RANKED_NEIGHBORS, season: SEASON_FULL }, SELF_ID);
/** Perfil vacío: sin cartas, sin vitrina, sin logros, sin ranked, sin Pick'ems. */
export const EMPTY = snap({
  ...facts({ profileId: RIVAL_ID, username: "QA · Recién llegado", showcase: [], featured: [] }),
  cosmetics: { title: null, frame: null, banner: null }, ranked: null, highestRating: null, recentMatches: [], instanceCardIds: [], showcaseInstances: [],
  teams: [], claimed: [], pickems: [], customization: null, neighbors: null, season: season([], 1000),
}, SELF_ID);
/** Visto sin sesión (PUBLIC anónimo). */
export const ANON = snap({ ...facts({ profileId: RIVAL_ID, username: "QA · Kaelis" }), neighbors: RANKED_NEIGHBORS, season: SEASON_FULL }, null);
/** Nombre inválido guardado (vacío o con forma de correo) → presentación segura. */
export const EMAIL_NAME = snap({ ...facts({ profileId: RIVAL_ID, username: "alguien@example.com" }), neighbors: null, season: null }, SELF_ID);
