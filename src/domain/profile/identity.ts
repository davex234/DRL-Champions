/**
 * PLAYER IDENTITY 2.0 — DOMINIO PURO (Fase 31).
 *
 * UNA identidad pública por jugador, derivada de lo que ya existe: `profiles` (nombre, avatar, XP,
 * cosméticos equipados), el competitivo de la Fase 28 (rating, posición, récord, forma), la
 * colección real (`user_cards`), los logros reclamados (`user_achievements`), los Pick'ems ya
 * corregidos (`pickem_scores`) y la personalización nueva (vitrina + logros destacados).
 *
 * Aquí se VALIDA la forma de lo que el jugador pide guardar y se CONSTRUYE la foto que ve cada
 * espectador. La foto del propio jugador (SELF) y la de cualquier otro (PUBLIC) salen de funciones
 * distintas: lo privado no viaja para esconderse con CSS, sencillamente no se proyecta.
 *
 * Sin React, sin red, sin reloj implícito.
 */
import { accountLevel } from "@/domain/progression/meta";
import { bucketForRank, BUCKET_LABEL, type RarityBucket } from "@/domain/packs/types";
import { isLowSerial } from "@/domain/collection/showcase";
import { h2hText, type H2HSplit } from "@/domain/social/social";
import { safeAvatar } from "./avatars";
import { ladderStanding, type StandingState } from "@/domain/pvpLadder/ranked";
import { rankChip, type RankChip } from "@/domain/ranked/config";
import type { CompetitiveStanding } from "@/domain/ranked/standing";
import { rankedRecap, type RatingEventFact } from "@/domain/season/recap";
import type { BadgeFact } from "@/domain/collectionSets/badges";
import { normalizeTag } from "@/domain/account/tag";
import type { FavoriteTeamFact } from "./favoriteTeam";
import type { CareerStats, CareerHighlight, HistoryItem } from "./career";
import { ns, td } from "@/i18n/runtime";

const tr = ns("profile");

/* ───────────────────────────── límites ───────────────────────────── */

/** Tres cartas: pequeño y premium. Una protagonista (slot 1) y dos acompañantes. */
export const SHOWCASE_MAX = 3;
/** Tres trofeos destacados. */
export const FEATURED_MAX = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACHIEVEMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/* ───────────────────────────── validación de mutaciones ───────────────────────────── */

export type ShowcaseError = "BAD_BODY" | "TOO_MANY" | "DUPLICATE" | "BAD_UID" | "NOT_OWNED";
export type FeaturedError = "BAD_BODY" | "TOO_MANY" | "DUPLICATE" | "UNKNOWN" | "LOCKED";

export type Parsed<T, E> = { ok: true; value: T } | { ok: false; code: E };

/** Forma de la vitrina: array de UIDs (≤ 3, sin repetir, UUID válidos). El ORDEN es el de los slots. */
export function parseShowcase(input: unknown): Parsed<string[], ShowcaseError> {
  if (!Array.isArray(input)) return { ok: false, code: "BAD_BODY" };
  if (input.length > SHOWCASE_MAX) return { ok: false, code: "TOO_MANY" };
  const out: string[] = [];
  for (const raw of input) {
    if (!isUuid(raw)) return { ok: false, code: "BAD_UID" };
    const uid = raw.toLowerCase();
    if (out.includes(uid)) return { ok: false, code: "DUPLICATE" };
    out.push(uid);
  }
  return { ok: true, value: out };
}

/** Propiedad: TODAS las instancias pedidas deben ser del jugador. Una ajena invalida el guardado entero. */
export function checkShowcaseOwnership(uids: string[], ownedUids: ReadonlySet<string>): Parsed<string[], ShowcaseError> {
  for (const uid of uids) if (!ownedUids.has(uid)) return { ok: false, code: "NOT_OWNED" };
  return { ok: true, value: uids };
}

/** Forma de los logros destacados: ids del catálogo real (≤ 3, sin repetir). */
export function parseFeatured(input: unknown, catalogIds: ReadonlySet<string>): Parsed<string[], FeaturedError> {
  if (!Array.isArray(input)) return { ok: false, code: "BAD_BODY" };
  if (input.length > FEATURED_MAX) return { ok: false, code: "TOO_MANY" };
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || !ACHIEVEMENT_ID.test(raw)) return { ok: false, code: "BAD_BODY" };
    if (!catalogIds.has(raw)) return { ok: false, code: "UNKNOWN" };
    if (out.includes(raw)) return { ok: false, code: "DUPLICATE" };
    out.push(raw);
  }
  return { ok: true, value: out };
}

/** Solo logros CONSEGUIDOS (reclamados, semántica de la Fase 27): uno bloqueado no se puede destacar. */
export function checkFeaturedClaimed(ids: string[], claimed: ReadonlySet<string>): Parsed<string[], FeaturedError> {
  for (const id of ids) if (!claimed.has(id)) return { ok: false, code: "LOCKED" };
  return { ok: true, value: ids };
}

/** Versión esperada: entero ≥ 0 o `null` (último en escribir gana, documentado). */
export function parseExpectedVersion(input: unknown): Parsed<number | null, "BAD_BODY"> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) return { ok: false, code: "BAD_BODY" };
  return { ok: true, value: input };
}

export const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * El guardado, en puro, con la MISMA regla que el RPC `player_profile_set` (0049):
 *   · mismo contenido → UNCHANGED (idempotente, la versión no se mueve aunque la esperada sea vieja);
 *   · versión esperada distinta de la actual → CONFLICT (otra pestaña guardó antes);
 *   · si no → SAVED con versión + 1.
 */
export function applySave(current: { uids: string[]; featured: string[]; version: number }, next: { uids: string[] | null; featured: string[] | null; expectedVersion: number | null }):
  { code: "SAVED" | "UNCHANGED" | "CONFLICT"; version: number; uids: string[]; featured: string[] } {
  const uids = next.uids ?? current.uids;
  const featured = next.featured ?? current.featured;
  if (sameList(uids, current.uids) && sameList(featured, current.featured)) return { code: "UNCHANGED", version: current.version, uids: current.uids, featured: current.featured };
  if (next.expectedVersion !== null && next.expectedVersion !== current.version) return { code: "CONFLICT", version: current.version, uids: current.uids, featured: current.featured };
  return { code: "SAVED", version: current.version + 1, uids, featured };
}

/* ───────────────────────────── hechos de entrada ───────────────────────────── */

export interface OwnedInstanceFact {
  uid: string;
  cardId: string;
  serial: number | null;
  mintedVersion: number | null;
  obtainedAt: number;
}

/** Lo que se sabe de una definición de carta (lo resuelve el catálogo del servidor). */
export interface CardFact {
  cardId: string;
  variantId: string;
  variantLabel: string;
  rank: number;
  serialLimit: number | null;
  ovr: number;
  nick: string;
  team: string | null;
  role: string | null;
  /** Color primario de la paleta de la variante: token existente, no extraído de ninguna imagen. */
  glow: string;
}

export type CardLookup = (cardId: string, mintedVersion: number | null) => CardFact | null;

export interface AchievementFact { id: string; name: string; description: string; icon: string }

export interface RankedFact {
  rating: number;
  gamesPlayed: number;
  provisional: boolean;
  wins: number;
  losses: number;
  draws: number;
  position: number | null;
  rankedTotal: number;
  winrate: number | null;
  form: ("W" | "L" | "D")[];
  streak: { kind: "W" | "L" | "D"; n: number } | null;
}

export interface RecentMatchFact {
  matchId: string;
  at: number;
  outcome: string;
  letter: "W" | "L" | "D" | null;
  scoreYou: number;
  scoreRival: number;
  rival: { userId: string; username: string; avatar: string };
}

export interface PickemScoreFact { pickemEventId: string; title: string | null; points: number; correct: number; total: number; scoredAt: number | null }

/** F84 · estado competitivo PÚBLICO de la temporada activa (del servidor: `getCompetitivePlayer`). */
export interface CompetitiveFact { seasonName: string | null; standing: CompetitiveStanding }

/** F84 · lo que el perfil enseña del rango: emblema + rango + división + rating + puesto Top + mejor rango de la temporada. */
export interface ProfileCompetitive {
  seasonName: string | null;
  state: CompetitiveStanding["state"];
  rank: RankChip | null;
  placement: { played: number; total: number };
  peakRank: RankChip | null;
  rating: number;
  record: CompetitiveStanding["record"];
}

export interface IdentityFacts {
  /** 0068 · `tag` = el TAG PÚBLICO canónico (`profiles.public_tag`); ausente/nulo solo antes de 0068. */
  profile: { id: string; username: string; avatar: string | null; xp: number; equipped: Record<string, string> | null; packsOpened: number | null; tag?: string | null };
  cosmetics: { title: { label: string; color: string } | null; frame: { color: string } | null; banner: { label: string; color: string } | null };
  ranked: RankedFact | null;
  highestRating: number | null;
  /** F84 · rango de la temporada competitiva activa (opcional: sin temporada o sin lectura, no se pinta). */
  competitive?: CompetitiveFact | null;
  recentMatches: RecentMatchFact[];
  /** Ids de carta de TODAS las instancias (para el resumen). */
  instanceCardIds: string[];
  /** Solo las instancias que la vitrina referencia (y que siguen siendo del jugador). */
  showcaseInstances: OwnedInstanceFact[];
  teams: { total: number; ownedDistinct: number }[];
  totalCards: number;
  customization: { showcaseUids: string[]; featuredIds: string[]; version: number; updatedAt: number | null } | null;
  /** Logros reclamados del catálogo real, con su fecha. */
  claimed: { id: string; claimedAt: number | null }[];
  catalog: AchievementFact[];
  pickems: PickemScoreFact[];
  h2h: H2HSplit | null;
  privateDuels: number | null;
  /**
   * FASE 56 · vecinos PÚBLICOS en la escalera (el de delante y el de detrás: nombre, rating, puesto, id de su perfil).
   * Salen del mismo orden que la clasificación de `/competitivo`. Sin puesto, `null`.
   */
  neighbors?: { above: LadderNeighborFact | null; below: LadderNeighborFact | null } | null;
  /** FASE 56 · temporada ACTIVA del calendario canónico + asientos de rating del jugador dentro de su ventana. */
  season?: { id: string; displayName: string; startsAtMs: number; endsAtMs: number; remainingMs: number; events: RatingEventFact[] } | null;
  /**
   * F82 · insignias. `featured` = las que el jugador eligió enseñar (ya filtradas a las que POSEE); `owned` = todas las
   * suyas (solo se usa en SELF, para el editor). Las bloqueadas nunca viajan a un perfil.
   */
  badges?: { featured: BadgeFact[]; featuredIds: string[]; owned: BadgeFact[] } | null;
  /** F89 · alta de la cuenta (`profiles.created_at`); se publica solo el MES. */
  createdAt?: number | null;
  /** F89 · equipo esports favorito (validado contra las identidades reales; logo resuelto por el servidor). */
  favoriteTeam?: FavoriteTeamFact | null;
  /** F89 · carrera calculada en el servidor con los modos que este espectador puede ver. */
  career?: ProfileCareer | null;
  /** F89 · Collection Sets (F82): lo COMPLETADO es un trofeo público; el progreso de lo no completado no viaja. */
  collections?: ProfileCollections | null;
  /** F83 · nivel de la ruta de temporada (activa o en reclamo): solo nombre y nivel; nada del libro de XP. */
  seasonTrack?: ProfileSeasonTrack | null;
}

/** F83 · resumen PÚBLICO de la ruta de temporada en el perfil. */
export interface ProfileSeasonTrack { seasonId: string; name: string; level: number; maxLevel: number; phase: "ACTIVE" | "GRACE" }

/** F89 · carrera del perfil: estadísticas, momentos y la primera página del historial. */
export interface ProfileCareer {
  stats: CareerStats;
  highlights: CareerHighlight[];
  history: { items: HistoryItem[]; nextBefore: number | null };
}

/** F89 · resumen de F82 en el perfil. Números de F82 (mismas tablas), no un recálculo distinto. */
export interface ProfileCollections {
  /** Sets PUBLICADOS hoy (denominador). */
  publishedSets: number;
  /** De esos publicados, cuántos completó (numerador). */
  publishedCompleted: number;
  /** Todas sus compleciones (incluye sets ya retirados: el trofeo es suyo). */
  setsCompleted: number;
  teamSetsCompleted: number;
  /** Insignias desbloqueadas (familia `insignia` de `user_cosmetics`). */
  badgesUnlocked: number;
  /** Colecciones completadas, más recientes primero (día). */
  completed: { setId: string; title: string; kind: "TEAM" | "EDITION"; logo: string | null; day: number }[];
}

export interface LadderNeighborFact { userId: string; username: string; position: number; rating: number }

/* ───────────────────────────── foto pública ───────────────────────────── */

export interface ShowcaseSlot {
  slot: number;
  uid: string;
  cardId: string;
  serial: number | null;
  serialLimit: number | null;
  lowSerial: boolean;
  variantId: string;
  variantLabel: string;
  rarity: RarityBucket;
  rarityLabel: string;
  ovr: number;
  nick: string;
  team: string | null;
  role: string | null;
  glow: string;
}

export interface CollectionSummary {
  instances: number;
  distinct: number;
  totalCards: number;
  percent: number;
  teamsComplete: number;
  teamsStarted: number;
}

export interface RaritySlice { bucket: RarityBucket; label: string; count: number }

export interface PickemsSummary {
  events: number;
  points: number;
  correct: number;
  total: number;
  accuracy: number | null;
  recent: { pickemEventId: string; title: string; points: number; correct: number; total: number }[];
}

export type ActivityKind = "RANKED_RESULT" | "ACHIEVEMENT" | "PICKEM_SCORED";

export interface ActivityItem { id: string; kind: ActivityKind; at: number; title: string; detail: string }

export interface PlayerIdentitySnapshot {
  view: "SELF" | "PUBLIC";
  player: {
    userId: string;
    username: string;
    /** 0068 · TAG PÚBLICO permanente (canónico, sin «#»): público, como el nombre; `null` si aún no existe. */
    tag: string | null;
    avatar: string;
    level: number;
    title: { label: string; color: string } | null;
    frame: { color: string } | null;
    banner: { label: string; color: string } | null;
  };
  /** Solo en SELF: lo que el jugador ve de sí mismo y nadie más. */
  self: {
    xpIntoLevel: number;
    xpForNext: number;
    progress: number;
    version: number;
    showcaseUids: string[];
    featuredIds: string[];
    /** Slots guardados que ya no se pueden enseñar (carta vendida, desguazada o transferida). */
    unavailableSlots: number;
    claimedAchievements: AchievementFact[];
    /** F82 · ids destacados y TODAS las insignias propias (para elegir). */
    featuredBadgeIds: string[];
    ownedBadges: BadgeFact[];
    privateDuels: number | null;
    packsOpened: number | null;
  } | null;
  accent: { color: string; rarity: RarityBucket | null };
  ranked: (RankedFact & { highestRating: number | null }) | null;
  showcase: ShowcaseSlot[];
  featured: AchievementFact[];
  /** F82 · insignias destacadas (hasta 3), públicas por decisión del jugador. */
  badges: BadgeFact[];
  achievements: { completed: number; total: number };
  collection: CollectionSummary;
  rarity: RaritySlice[];
  recentMatches: RecentMatchFact[];
  h2h: (H2HSplit & { text: { ranked: string; private: string; total: string } }) | null;
  pickems: PickemsSummary | null;
  activity: ActivityItem[];
  /**
   * FASE 56 · el ranked contado como en `/competitivo`: sin clasificar → colocación (X / 10) → clasificado, con el
   * puesto de delante y el de detrás (públicos). `null` si nunca jugó ranked. Sin rangos con nombre: no existen.
   */
  standing: {
    state: StandingState;
    placement: { played: number; total: number; remaining: number };
    above: (LadderNeighborFact & { gap: number }) | null;
    below: LadderNeighborFact | null;
  } | null;
  /** FASE 56 · temporada actual: nombre, días que quedan y el tramo ranked (misma función que `/temporada`). */
  season: { id: string; displayName: string; remainingMs: number; ranked: { games: number; wins: number; losses: number; draws: number; net: number | null; best: number | null } } | null;
  /**
   * FASE 56 · si el jugador no ha elegido logros destacados, los últimos CONSEGUIDOS (regla objetiva: fecha de
   * reclamo, más recientes primero, máx. 3). Se rotulan como «últimos», nunca como favoritos.
   */
  recentAchievements: (AchievementFact & { claimedAt: number })[];
  /** F89 · «Miembro desde» (primer día del MES de alta, UTC). */
  memberSince: number | null;
  /** F89 · equipo favorito (equipo esports real). */
  favoriteTeam: FavoriteTeamFact | null;
  /** F89 · carrera (público: ranked + IA + draft; propio: además duelos privados). */
  career: ProfileCareer | null;
  /** F89 · colecciones F82 completadas. */
  collections: ProfileCollections | null;
  /** F83 · nivel de temporada (ruta en BD), si hay temporada activa o en periodo de reclamo. */
  seasonTrack: ProfileSeasonTrack | null;
  /** F84 · rango competitivo de la temporada activa (`null` si no hay temporada competitiva). Rating ≠ XP de temporada. */
  competitive: ProfileCompetitive | null;
  serverNow: number;
}

/** F89 · el mes de alta, nunca el instante (no hace falta más para «miembro desde»). */
export const monthOf = (ms: number | null | undefined): number | null => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/**
 * FASE 56 · nombre público de presentación. `profiles.username` lo pone el trigger de alta y nunca es el correo;
 * si llegara vacío, «Jugador NEXUS · xxxx» con 4 caracteres del id PÚBLICO (el mismo de la URL): distingue perfiles
 * sin revelar nada nuevo. Nunca se deriva de un correo: si el nombre tiene forma de correo, se descarta.
 */
export function publicName(username: string | null | undefined, userId: string): string {
  const u = (username ?? "").trim();
  if (u.length > 0 && !/@/.test(u)) return u.slice(0, 40);
  return tr("Jugador NEXUS · {v}", { v: userId.replace(/-/g, "").slice(0, 4).toUpperCase() });
}

/** Acento del perfil: la paleta de la carta destacada (slot 1). Sin carta, el acento de la casa. */
export const DEFAULT_ACCENT = "#19e3ff";

const RARITY_ORDER: RarityBucket[] = ["legendary", "epic", "rare", "uncommon", "common"];

export function collectionSummary(instanceCardIds: string[], totalCards: number, teams: { total: number; ownedDistinct: number }[]): CollectionSummary {
  // Fase 27: «distintas» cuenta DEFINICIONES, no ejemplares.
  const distinct = new Set(instanceCardIds).size;
  return {
    instances: instanceCardIds.length,
    distinct,
    totalCards,
    percent: totalCards > 0 ? Math.round((distinct / totalCards) * 100) : 0,
    teamsComplete: teams.filter((t) => t.total > 0 && t.ownedDistinct >= t.total).length,
    teamsStarted: teams.filter((t) => t.ownedDistinct > 0).length,
  };
}

/** Distribución por rareza REAL (`RarityBucket`), sobre cartas DISTINTAS. Solo cubos con cartas. */
export function raritySummary(instanceCardIds: string[], rankOf: (cardId: string) => number | null): RaritySlice[] {
  const counts = new Map<RarityBucket, number>();
  for (const id of new Set(instanceCardIds)) {
    const rank = rankOf(id);
    if (rank === null) continue;
    const b = bucketForRank(rank);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return RARITY_ORDER.filter((b) => (counts.get(b) ?? 0) > 0).map((b) => ({ bucket: b, label: BUCKET_LABEL[b], count: counts.get(b)! }));
}

/**
 * La vitrina, en el ORDEN guardado. Un UID que ya no pertenece al jugador (o cuya carta ya no
 * resuelve) se salta: nunca se enseña una carta ajena ni un hueco roto a otro jugador.
 */
export function resolveShowcase(uids: string[], instances: OwnedInstanceFact[], lookup: CardLookup): { slots: ShowcaseSlot[]; unavailable: number } {
  const byUid = new Map(instances.map((i) => [i.uid.toLowerCase(), i]));
  const slots: ShowcaseSlot[] = [];
  let unavailable = 0;
  for (const raw of uids.slice(0, SHOWCASE_MAX)) {
    const inst = byUid.get(raw.toLowerCase());
    const fact = inst ? lookup(inst.cardId, inst.mintedVersion) : null;
    if (!inst || !fact) { unavailable++; continue; }
    const rarity = bucketForRank(fact.rank);
    slots.push({
      slot: slots.length + 1, uid: inst.uid, cardId: inst.cardId, serial: inst.serial, serialLimit: fact.serialLimit,
      lowSerial: isLowSerial(inst.serial, fact.serialLimit), variantId: fact.variantId, variantLabel: fact.variantLabel,
      rarity, rarityLabel: BUCKET_LABEL[rarity], ovr: fact.ovr, nick: fact.nick, team: fact.team, role: fact.role, glow: fact.glow,
    });
  }
  return { slots, unavailable };
}

export function pickemsSummary(rows: PickemScoreFact[]): PickemsSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.scoredAt ?? 0) - (a.scoredAt ?? 0));
  const correct = rows.reduce((s, r) => s + r.correct, 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return {
    events: rows.length,
    points: rows.reduce((s, r) => s + r.points, 0),
    correct, total,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
    recent: sorted.slice(0, 3).map((r) => ({ pickemEventId: r.pickemEventId, title: r.title ?? tr("Pick'em"), points: r.points, correct: r.correct, total: r.total })),
  };
}

/** Día de un instante (UTC). La actividad pública no enseña horas exactas, solo el día. */
export const dayOf = (ms: number): number => Math.floor(ms / 86_400_000) * 86_400_000;

const LETTER_TEXT: Record<"W" | "L" | "D", string> = { W: "Victoria", L: "Derrota", D: "Empate" };

/**
 * Actividad del jugador, SOLO con hechos públicos y fechados de verdad: resultados ranked (ya
 * públicos en su historial), logros conseguidos y Pick'ems corregidos. Sin compras, créditos,
 * recompensas, objetivos, amistades ni mazos. Las fechas públicas se redondean al día.
 */
export function profileActivity(input: { matches: RecentMatchFact[]; claimed: { id: string; claimedAt: number | null }[]; catalog: AchievementFact[]; pickems: PickemScoreFact[]; max?: number }): ActivityItem[] {
  const byId = new Map(input.catalog.map((a) => [a.id, a]));
  const items: ActivityItem[] = [];
  for (const m of input.matches) {
    if (!m.letter) continue;
    items.push({ id: `m:${m.matchId}`, kind: "RANKED_RESULT", at: m.at, title: tr("{v} en ranked", { v: td(LETTER_TEXT[m.letter]) }), detail: tr("contra {rival} · {you}–{them}", { rival: m.rival.username, you: m.scoreYou, them: m.scoreRival }) });
  }
  for (const c of input.claimed) {
    const a = byId.get(c.id);
    if (!a || c.claimedAt === null) continue;
    items.push({ id: `a:${c.id}`, kind: "ACHIEVEMENT", at: dayOf(c.claimedAt), title: tr("Logro conseguido: {name}", { name: a.name }), detail: a.description });
  }
  for (const p of input.pickems) {
    if (p.scoredAt === null || p.total === 0) continue;
    items.push({ id: `p:${p.pickemEventId}`, kind: "PICKEM_SCORED", at: dayOf(p.scoredAt), title: tr("Pick'em corregido: {v}", { v: td(p.title) ?? "Pick'em" }), detail: tr("{correct} / {total} aciertos · {points} puntos", { correct: p.correct, total: p.total, points: p.points }) });
  }
  return items.sort((a, b) => b.at - a.at).slice(0, input.max ?? 6);
}

/**
 * LA FOTO. `viewerId === profile.id` → SELF; cualquier otro (o sin sesión) → PUBLIC.
 *
 * La construcción es la misma función, pero cada campo privado se decide AQUÍ: la vista pública
 * no recibe XP exacta, versión, uids guardados, logros reclamables, duelos privados, sobres
 * abiertos ni fechas exactas. El H2H solo existe con un espectador que no sea el propio jugador.
 */
export function buildPlayerIdentity(facts: IdentityFacts, ctx: { viewerId: string | null; now: number; lookup: CardLookup; rankOf: (cardId: string) => number | null }): PlayerIdentitySnapshot {
  const isSelf = ctx.viewerId !== null && ctx.viewerId === facts.profile.id;
  const level = accountLevel(Math.max(0, facts.profile.xp ?? 0));
  const cust = facts.customization ?? { showcaseUids: [], featuredIds: [], version: 0, updatedAt: null };
  const { slots, unavailable } = resolveShowcase(cust.showcaseUids, facts.showcaseInstances, ctx.lookup);
  const catalogById = new Map(facts.catalog.map((a) => [a.id, a]));
  const claimedSet = new Set(facts.claimed.map((c) => c.id));
  const featured = cust.featuredIds.filter((id) => claimedSet.has(id)).map((id) => catalogById.get(id)).filter((a): a is AchievementFact => !!a).slice(0, FEATURED_MAX);
  const lead = slots[0] ?? null;

  const h2h = !isSelf && ctx.viewerId !== null && facts.h2h
    ? { ...facts.h2h, text: { ranked: h2hText(facts.h2h.ranked), private: h2hText(facts.h2h.private), total: h2hText(facts.h2h.total) } }
    : null;

  return {
    view: isSelf ? "SELF" : "PUBLIC",
    player: {
      userId: facts.profile.id,
      username: publicName(facts.profile.username, facts.profile.id),
      tag: normalizeTag(facts.profile.tag ?? null),
      avatar: safeAvatar(facts.profile.avatar),
      level: level.level,
      title: facts.cosmetics.title, frame: facts.cosmetics.frame, banner: facts.cosmetics.banner,
    },
    self: isSelf ? {
      xpIntoLevel: level.xpIntoLevel, xpForNext: level.xpForNext, progress: level.progress,
      version: cust.version, showcaseUids: cust.showcaseUids, featuredIds: cust.featuredIds, unavailableSlots: unavailable,
      claimedAchievements: facts.catalog.filter((a) => claimedSet.has(a.id)),
      featuredBadgeIds: facts.badges?.featuredIds ?? [], ownedBadges: facts.badges?.owned ?? [],
      privateDuels: facts.privateDuels, packsOpened: facts.profile.packsOpened,
    } : null,
    accent: { color: lead?.glow ?? DEFAULT_ACCENT, rarity: lead?.rarity ?? null },
    ranked: facts.ranked && facts.ranked.gamesPlayed > 0 ? { ...facts.ranked, highestRating: facts.highestRating } : null,
    showcase: slots,
    featured,
    badges: (facts.badges?.featured ?? []).slice(0, FEATURED_MAX),
    achievements: { completed: facts.catalog.filter((a) => claimedSet.has(a.id)).length, total: facts.catalog.length },
    collection: collectionSummary(facts.instanceCardIds, facts.totalCards, facts.teams),
    rarity: raritySummary(facts.instanceCardIds, ctx.rankOf),
    recentMatches: facts.recentMatches.slice(0, 5),
    h2h,
    pickems: pickemsSummary(facts.pickems),
    activity: profileActivity({
      matches: facts.recentMatches.slice(0, 5),
      claimed: facts.claimed.map((c) => ({ id: c.id, claimedAt: c.claimedAt })),
      catalog: facts.catalog, pickems: facts.pickems,
    }),
    standing: standingOf(facts),
    season: seasonOf(facts),
    recentAchievements: cust.featuredIds.length > 0 ? [] : facts.claimed
      .filter((c): c is { id: string; claimedAt: number } => c.claimedAt !== null && catalogById.has(c.id))
      .sort((a, b) => b.claimedAt - a.claimedAt || a.id.localeCompare(b.id))
      .slice(0, FEATURED_MAX)
      .map((c) => ({ ...catalogById.get(c.id)!, claimedAt: dayOf(c.claimedAt) })),
    memberSince: monthOf(facts.createdAt),
    favoriteTeam: facts.favoriteTeam ?? null,
    career: facts.career ?? null,
    collections: facts.collections ?? null,
    seasonTrack: facts.seasonTrack ?? null,
    competitive: competitiveOf(facts),
    serverNow: ctx.now,
  };
}

/** F84 · rango del perfil: lo que ya derivó el servidor (rango del rating con la versión de la temporada, colocación). */
export function competitiveOf(facts: Pick<IdentityFacts, "competitive">): ProfileCompetitive | null {
  const c = facts.competitive ?? null;
  if (!c) return null;
  const s = c.standing;
  return {
    seasonName: c.seasonName, state: s.state, rank: s.rank ? rankChip(s.rank) : null,
    placement: { played: s.placement.played, total: s.placement.total }, peakRank: s.peakRank ? rankChip(s.peakRank) : null,
    rating: s.rating, record: s.record,
  };
}

/** FASE 56 · el ranked como en `/competitivo` (reutiliza `ladderStanding` de la Fase 55). */
export function standingOf(facts: Pick<IdentityFacts, "ranked" | "neighbors">): PlayerIdentitySnapshot["standing"] {
  const r = facts.ranked;
  if (!r || r.gamesPlayed <= 0) return null;
  const n = facts.neighbors ?? null;
  const rows = [n?.above, n?.below].filter((x): x is LadderNeighborFact => !!x).map((x) => ({ position: x.position, rating: x.rating, username: x.username, isSelf: false }));
  const st = ladderStanding({ rating: r.rating, gamesPlayed: r.gamesPlayed, position: r.position, rankedTotal: r.rankedTotal, pointsToAbove: null }, rows);
  const above = st.above && n?.above ? { ...n.above, gap: st.above.gap } : null;
  const below = st.below && n?.below ? n.below : null;
  return { state: st.state, placement: st.placement, above, below };
}

/** FASE 56 · temporada: el tramo ranked sale de `rankedRecap`, la MISMA función que usa `/temporada`. */
export function seasonOf(facts: Pick<IdentityFacts, "season">): PlayerIdentitySnapshot["season"] {
  const s = facts.season ?? null;
  if (!s) return null;
  const r = rankedRecap(s.events, s.startsAtMs, s.endsAtMs) ?? { games: 0, wins: 0, losses: 0, draws: 0, startRating: null, finalRating: null, highestRating: null };
  return {
    id: s.id, displayName: s.displayName, remainingMs: s.remainingMs,
    ranked: { games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, net: r.startRating !== null && r.finalRating !== null ? r.finalRating - r.startRating : null, best: r.highestRating },
  };
}
