/**
 * F82 · FIXTURES DEL ARNÉS — QA SYNTHETIC sobre datos REALES: los sets salen del generador sobre el catálogo real (equipos,
 * jugadores, cartas y logos reales); lo único sintético es QUÉ cartas «posee» el jugador de la escena. Las vistas se
 * construyen con `buildSetView`, la MISMA función que usa el servidor. Nunca se escribe ni se envía nada.
 */
import { generateEditionDrafts, generateTeamDrafts, isSkip, type DraftProposal } from "@/domain/collectionSets/generator";
import { badgeFact, badgeIndex } from "@/domain/collectionSets/badges";
import { buildSetView, type SetView, type TrophyRoomView } from "@/domain/collectionSets/view";
import type { CollectionSetDef } from "@/domain/collectionSets/types";
import { buildPlayerIdentity, type PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { facts, lookup, rankOf, QA_NOW, SELF_ID, RIVAL_ID } from "../fase31/fixtures";

const PUBLISHED_TEAMS = ["g2", "team-heretics", "fnatic", "leviatan", "team-liquid", "karmine-corp", "nrg", "loud", "furia", "m8", "vitality", "fut", "100t", "navi", "bbl", "c9", "eg", "giantx", "kru", "mibr", "pcific", "dragon-ranger-gaming", "eternal-fire"];

const asSet = (p: DraftProposal): CollectionSetDef => ({ ...p, status: "PUBLISHED", checksum: "qa", publishedAt: "2026-10-03T12:00:00Z", retiredAt: null, rowVersion: 2 });
const TEAM = generateTeamDrafts().filter((d): d is DraftProposal => !isSkip(d) && PUBLISHED_TEAMS.includes(d.subjectId)).map(asSet);
const EDITION = generateEditionDrafts().filter((d): d is DraftProposal => !isSkip(d)).map(asSet);
export const SETS: CollectionSetDef[] = [...TEAM, ...EDITION];
const byTeam = (id: string) => SETS.find((s) => s.subjectId === id)!;
const INDEX = badgeIndex(SETS);

/** Lo que «posee» el jugador de la escena (sintético): ids REALES del catálogo. */
const owned = new Set<string>();
const take = (s: CollectionSetDef, n: number, variant = 0) => s.requirements.slice(0, n).forEach((r) => owned.add(r.cardIds[Math.min(variant, r.cardIds.length - 1)]));
take(byTeam("g2"), 4); take(byTeam("g2"), 2, 1);            // G2 4/5 (dos jugadores con dos variantes)
take(byTeam("team-heretics"), 6);                             // Heretics completo SIN reclamar
take(byTeam("fnatic"), 5);                                    // Fnatic completado (reclamado)
take(byTeam("leviatan"), 3); take(byTeam("loud"), 1); take(byTeam("nrg"), 2);
take(byTeam("champions-s"), 7);
const COMPLETED: Record<string, string> = { [byTeam("fnatic").id]: "2026-10-02T19:12:00Z", [byTeam("karmine-corp").id]: "2026-09-30T10:00:00Z" };
take(byTeam("karmine-corp"), 3); // completada el 30-09 y luego desguazó una: sigue COMPLETED, «hoy 3/4»

export const VIEWS: SetView[] = SETS.map((s) => buildSetView(s, owned, COMPLETED[s.id] ?? null, INDEX));
const unlocked = Object.keys(COMPLETED).map((id) => badgeFact(SETS.find((s) => s.id === id)!.reward.badgeId, INDEX)!).concat([badgeFact("insignia:equipo:g2-medio", INDEX)!, badgeFact("insignia:region:emea-25", INDEX)!]);

export function room(empty = false): TrophyRoomView {
  const views = empty ? VIEWS.map((v) => buildSetView(SETS.find((s) => s.id === v.id)!, new Set(), null, INDEX)) : VIEWS;
  const ul = empty ? [] : unlocked;
  const ulIds = new Set(ul.map((b) => b.id));
  return {
    totals: {
      teamSets: views.filter((v) => v.kind === "TEAM").length, teamsCompleted: views.filter((v) => v.kind === "TEAM" && v.completedAt).length,
      sets: views.length, setsCompleted: views.filter((v) => v.completedAt).length, claimable: views.filter((v) => v.state === "CLAIMABLE").length,
      badgesUnlocked: ul.length, collectionBadges: ul.filter((b) => b.kind !== "MASTERY").length,
      ownedDistinct: empty ? 0 : owned.size, catalogCards: 331, collectionPct: empty ? 0 : Math.floor((owned.size / 331) * 100),
    },
    sets: views,
    badges: { unlocked: ul, locked: views.filter((v) => v.badge && !ulIds.has(v.badge.id)).map((v) => v.badge!) },
    recent: empty ? [] : views.filter((v) => v.completedAt).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)).map((v) => ({ setId: v.id, title: v.title, completedAt: v.completedAt!, badge: v.badge })),
    featuredBadgeIds: [], profileVersion: 1,
  };
}

export const view = (subject: string) => VIEWS.find((v) => v.subjectId === subject)!;

const badgeSet = (ids: string[]) => ids.map((id) => badgeFact(id, INDEX)!).filter(Boolean);
export function profile(kind: "own" | "public" | "own-empty"): PlayerIdentitySnapshot {
  const featured = kind === "own-empty" ? [] : badgeSet([byTeam("fnatic").reward.badgeId, byTeam("karmine-corp").reward.badgeId, "insignia:equipo:g2-medio"]);
  const ownedB = kind === "own-empty" ? unlocked : unlocked;
  const f = { ...facts(kind === "public" ? { profileId: RIVAL_ID, username: "QA · Kaelis" } : {}), badges: { featured, featuredIds: featured.map((b) => b.id), owned: ownedB } };
  return buildPlayerIdentity(f, { viewerId: SELF_ID, now: QA_NOW, lookup, rankOf });
}
