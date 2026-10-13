/**
 * F89 · FIXTURES DEL ARNÉS DEL PERFIL 2.0 — QA SYNTHETIC sobre datos REALES del catálogo: cartas, equipos, logos y sets
 * de colección salen del catálogo y del generador de F82; lo sintético es el historial de partidas y qué tiene cada
 * jugador de la escena. Las fotos se construyen con `buildPlayerIdentity` + `careerStats`/`careerHighlights`/
 * `historyItem`, las MISMAS funciones del servidor. Nunca se escribe ni se envía nada.
 */
import { buildPlayerIdentity, type IdentityFacts, type PlayerIdentitySnapshot, type ProfileCollections } from "@/domain/profile/identity";
import { careerHighlights, careerStats, historyItem, PUBLIC_MODES, SELF_MODES, HISTORY_PAGE, type CareerMode, type HistoryRowFact } from "@/domain/profile/career";
import { teamFact } from "@/domain/profile/favoriteTeam";
import { badgeFact, badgeIndex } from "@/domain/collectionSets/badges";
import { generateTeamDrafts, isSkip, type DraftProposal } from "@/domain/collectionSets/generator";
import type { CollectionSetDef } from "@/domain/collectionSets/types";
import { facts, lookup, rankOf, QA_NOW, SELF_ID, RIVAL_ID } from "../fase31/fixtures";

export { QA_NOW, SELF_ID, RIVAL_ID };
const D = 86_400_000;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* ───────────── sets reales (F82) ───────────── */
const TEAMS = ["g2", "team-heretics", "fnatic", "leviatan", "team-liquid", "eternal-fire"];
const SETS: CollectionSetDef[] = generateTeamDrafts().filter((d): d is DraftProposal => !isSkip(d) && TEAMS.includes(d.subjectId))
  .map((p) => ({ ...p, status: "PUBLISHED", checksum: "qa", publishedAt: "2026-10-03T12:00:00Z", retiredAt: null, rowVersion: 2 }));
const INDEX = badgeIndex(SETS);
const set = (team: string) => SETS.find((s) => s.subjectId === team)!;

function collections(done: { team: string; at: number }[]): ProfileCollections {
  const completed = done.map(({ team, at }) => ({ setId: set(team).id, title: set(team).title, kind: "TEAM" as const, logo: set(team).logo, day: Math.floor(at / D) * D }));
  return { publishedSets: SETS.length, publishedCompleted: completed.length, setsCompleted: completed.length, teamSetsCompleted: completed.length, badgesUnlocked: completed.length + 1, completed };
}

/* ───────────── partidas (sintéticas) ───────────── */
const RIVALS = [
  { userId: uid(901), username: "Kaelis", avatar: "🐉" }, { userId: uid(902), username: "Nyra", avatar: "🦉" },
  { userId: uid(903), username: "Brann", avatar: "🐺" }, { userId: uid(904), username: "Sable", avatar: "🦅" },
];
const MODES: CareerMode[] = ["RANKED", "PVE", "PVE", "DRAFT", "PRIVATE", "RANKED", "PVE"];
const DIFF = ["EASY", "NORMAL", "HARD"];

/** 60 partidas terminadas (más 2 en curso que NO deben contar) del jugador `me`, de la más reciente a la más antigua. */
export function matchesOf(me: string, n = 60): HistoryRowFact[] {
  const out: HistoryRowFact[] = [];
  for (let i = 0; i < n; i++) {
    const mode = MODES[i % MODES.length];
    const human = mode === "RANKED" || mode === "PRIVATE";
    const rival = RIVALS[i % RIVALS.length];
    const meIsA = !human || i % 2 === 0;
    const win = [0, 1, 2, 4, 5, 7, 9, 10].includes(i % 11);
    const abandoned = i === 13;
    out.push({
      matchId: uid(5000 + i), mode, at: QA_NOW - (i + 1) * 7 * 3600_000,
      status: abandoned ? "IN_PROGRESS" : "COMPLETED", winner: abandoned ? null : (win === meIsA ? "A" : "B"),
      closedReason: abandoned ? "ABANDONED" : null, closedBy: abandoned ? rival.userId : null,
      playerAId: meIsA ? me : rival.userId, playerBId: human ? (meIsA ? rival.userId : me) : "",
      scoreA: win === meIsA ? 6 : 3 + (i % 3), scoreB: win === meIsA ? 3 + (i % 3) : 6, difficulty: human ? "NORMAL" : DIFF[i % 3],
    });
  }
  // En curso: nunca cuentan (ni en el denominador del % de victorias).
  out.push({ matchId: uid(5900), mode: "RANKED", at: QA_NOW - 1000, status: "IN_PROGRESS", winner: null, closedReason: null, closedBy: null, playerAId: me, playerBId: RIVALS[0].userId, scoreA: 2, scoreB: 1, difficulty: "NORMAL" });
  return out.sort((a, b) => b.at - a.at);
}

const rivalBy = new Map(RIVALS.map((r) => [r.userId, r]));
function career(me: string, isSelf: boolean, rows: HistoryRowFact[], done: { team: string; at: number }[]): IdentityFacts["career"] {
  const modes = isSelf ? SELF_MODES : PUBLIC_MODES;
  const visible = rows.filter((r) => modes.includes(r.mode) && (r.status !== "IN_PROGRESS" || r.closedReason !== null));
  const page = visible.slice(0, HISTORY_PAGE);
  return {
    stats: careerStats(visible, me, modes, { read: visible.length, capped: false }),
    highlights: careerHighlights({ matches: visible, userId: me, modes, capped: false, completions: collections(done).completed.map((c) => ({ setId: c.setId, title: c.title, kind: c.kind, logo: c.logo, completedAt: c.day })) }),
    history: { items: page.map((r) => historyItem(r, me, rivalBy.get(r.playerAId === me ? r.playerBId : r.playerAId) ?? null, isSelf)), nextBefore: visible.length > HISTORY_PAGE ? page[page.length - 1].at : null },
  };
}

const DONE = [{ team: "fnatic", at: QA_NOW - 1 * D }, { team: "team-heretics", at: QA_NOW - 6 * D }, { team: "g2", at: QA_NOW - 15 * D }];
const badges = (ids: string[], owned: string[]) => ({ featured: ids.map((id) => badgeFact(id, INDEX)!).filter(Boolean), featuredIds: ids, owned: owned.map((id) => badgeFact(id, INDEX)!).filter(Boolean) });
const BADGE = (team: string) => set(team).reward.badgeId;

const snap = (f: IdentityFacts, viewer: string | null): PlayerIdentitySnapshot => buildPlayerIdentity(f, { viewerId: viewer, now: QA_NOW, lookup, rankOf });

function full(profileId: string, viewer: string | null, username: string, over: Partial<IdentityFacts> = {}): PlayerIdentitySnapshot {
  const isSelf = viewer === profileId;
  const owned = DONE.map((d) => BADGE(d.team));
  return snap({
    ...facts({ profileId, username }),
    createdAt: Date.UTC(2026, 6, 17, 10, 30),
    favoriteTeam: teamFact("team-heretics"),
    badges: badges(owned, isSelf ? [...owned, "insignia:equipo:g2-medio"] : []),
    career: career(profileId, isSelf, matchesOf(profileId), DONE),
    collections: collections(DONE),
    ...over,
  }, viewer);
}

export const OWN_FULL = full(SELF_ID, SELF_ID, "QA · David");
export const PUBLIC_FULL = full(RIVAL_ID, SELF_ID, "QA · Kaelis");
export const PUBLIC_ANON = full(RIVAL_ID, null, "QA · Kaelis");
export const NO_BADGES_PUBLIC = full(RIVAL_ID, SELF_ID, "QA · Sin insignias", { badges: { featured: [], featuredIds: [], owned: [] } });
export const NO_TEAM_LOGO = full(RIVAL_ID, SELF_ID, "QA · Equipo sin logo", { favoriteTeam: teamFact("paper-rex") });
export const LONG_TEXT = full(SELF_ID, SELF_ID, "QA·NombreLarguísimoDeJugadorParaRomperElLayout123", { favoriteTeam: teamFact("dragon-ranger-gaming") });
export const XSS_NAME = full(RIVAL_ID, SELF_ID, `<img src=x onerror=alert(1)><script>alert(2)</script>`);

/** Perfil NUEVO: sin partidas, sin cartas, sin insignias, sin equipo, sin colecciones. */
function empty(profileId: string, viewer: string | null, username: string): PlayerIdentitySnapshot {
  return snap({
    ...facts({ profileId, username, showcase: [], featured: [] }),
    profile: { id: profileId, username, avatar: "🎮", xp: 0, equipped: {}, packsOpened: 0 },
    cosmetics: { title: null, frame: null, banner: null }, ranked: null, highestRating: null, recentMatches: [], instanceCardIds: [], showcaseInstances: [],
    teams: [], claimed: [], pickems: [], privateDuels: 0, customization: null,
    createdAt: Date.UTC(2026, 9, 2), favoriteTeam: null, badges: { featured: [], featuredIds: [], owned: [] },
    career: career(profileId, viewer === profileId, [], []), collections: collections([]),
  }, viewer);
}
export const EMPTY_OWN = empty(SELF_ID, SELF_ID, "QA · Nuevo");
export const EMPTY_PUBLIC = empty(RIVAL_ID, SELF_ID, "QA · Recién llegado");
