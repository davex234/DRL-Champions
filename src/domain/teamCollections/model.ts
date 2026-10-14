/**
 * COLECCIONES POR EQUIPO E INSIGNIAS REGIONALES — dominio PURO, derivado del catálogo.
 *
 * Sustituye, de cara al jugador, a los sets congelados de F82 («una carta por jugador»):
 *
 *   · La colección de un equipo son TODAS las cartas publicadas que llevan ese equipo IMPRESO (`canonicalCardTeam`, la
 *     misma regla que agrupa maestría, logros y Team Packs). Cada edición es una carta distinta: tres cartas de un
 *     jugador son tres requisitos, y diez copias de una no sustituyen a otra que falte.
 *   · No hay cantidades fijas ni lista de equipos escrita aquí: equipos, cartas y totales salen del catálogo que se le
 *     pase. Una carta nueva mueve la meta; un equipo nuevo aparece solo.
 *   · La región de un equipo es la de su identidad: la del registro de código (`teamIdentities.ts`) o, para un equipo
 *     impreso que ese registro no conoce (alta desde el CMS), la que un admin le da en `/admin/teams` (0076). Un equipo
 *     sin región NO es una colección del jugador: no se enseña, no da XP ni cuenta para ninguna insignia, y se devuelve
 *     en `unassigned` para que alguien lo complete. Nunca se le adjudica una región por parecido.
 *   · Una insignia regional se desbloquea con TODAS las cartas de TODOS los equipos de esa región. Una región sin
 *     equipos o sin cartas no se desbloquea nunca (no hay insignias vacías).
 *
 * El progreso es estado derivado: lo que tienes hoy es lo que cuenta. Dos cosas, en cambio, se guardan en el servidor
 * (migración 0075) y este módulo solo las recibe como hechos (`Persisted`):
 *   · la PRIMERA compleción de cada equipo, que da 300 XP de temporada una sola vez por cuenta y equipo;
 *   · las insignias regionales ya desbloqueadas, que no se pierden aunque después se desguacen cartas.
 * Aquí se decide QUÉ hay que liquidar (`settlePlan`); quién lo comprueba y lo escribe, de forma atómica, es la base.
 */
import type { CardDef, Player, Region } from "@/domain/cards/types";
import { canonicalCardTeam, TEAM_CANONICAL_IDS } from "@/data/teamIdentities";
import { hintTeamLogoSrc } from "@/data/teamLogos";

/** Las cuatro regiones competitivas, en el orden en que se enseñan. */
export const BADGE_REGIONS: readonly Region[] = ["Americas", "EMEA", "Pacific", "China"];
/** Acento de cada región (el texto y el emblema dicen cuál es; el color solo acompaña). */
export const REGION_TINT: Readonly<Record<Region, string>> = { Americas: "#ff8a4c", EMEA: "#b6f24a", Pacific: "#19e3ff", China: "#ff4d6d" };
const isRegion = (v: unknown): v is Region => typeof v === "string" && (BADGE_REGIONS as readonly string[]).includes(v);

export interface TeamCollectionCard {
  id: string;
  playerId: string;
  nick: string;
  variantId: string;
  ovr: number;
  image: string | null;
}

export interface TeamCollectionDef {
  /** Clave canónica del equipo (`g2`) o `raw:<texto>` si no tiene identidad en el registro. */
  id: string;
  title: string;
  /** Etiqueta corta, para el escudo de los equipos sin logo. */
  tag: string;
  region: Region | null;
  /** Logo real del equipo, si el producto lo tiene. Nunca uno inventado. */
  logo: string | null;
  /** Todas las cartas de la colección, ordenadas por jugador y, dentro, de mayor a menor media. */
  cards: TeamCollectionCard[];
}

/** Lo que el modelo necesita del mundo. El servidor pasa su catálogo publicado; los tests, uno propio. */
export interface TeamCollectionsContext {
  cards: readonly CardDef[];
  player: (id: string) => Player | undefined;
  /** Equipo de una carta. Por defecto, el impreso (`canonicalCardTeam`). */
  teamOf?: (card: CardDef, player: Player | undefined) => { key: string; label: string; identity?: { tag: string; region: unknown } };
  logo?: (teamId: string) => string | null;
}

/** Clave de «carta sin equipo»: no es un equipo, no forma colección. */
const NO_TEAM = "raw:?";

// ───────────────────────────── Equipos dados de alta desde el panel (0076) ─────────────────────────────

/** Identidad de un equipo impreso que el registro de código no conoce, mantenida desde `/admin/teams`. */
export interface ManagedTeamIdentity {
  /** Texto impreso exacto (recortado) de sus cartas. */
  printedTeam: string;
  /** Clave de la colección. Inmutable: es la de la primera compleción guardada. */
  teamId: string;
  name: string;
  tag: string;
  region: string;
  rev: number;
}

/** Clave de un equipo del panel: corta, en minúsculas, sin parecerse a `raw:` ni a un set antiguo (`team-g2-v1`). */
export const MANAGED_TEAM_ID = /^(?!raw)(?!team-.+-v\d+$)[a-z0-9][a-z0-9-]{1,31}$/;
export const TEAM_TAG = /^[A-Za-z0-9.]{1,6}$/;
/** Claves que ya usa el registro de código: un equipo del panel nunca puede tomar una. */
export const CODE_TEAM_IDS: ReadonlySet<string> = TEAM_CANONICAL_IDS;

/**
 * Equipo de una carta con las identidades del panel: el registro de código manda; solo un equipo impreso que él no
 * resuelve (`raw:<texto>`) toma la identidad del panel que tenga ese mismo texto. Una fila con una clave ya usada por el
 * código, con una clave mal formada o sin región válida se ignora (el equipo sigue sin identidad, y se avisa).
 */
export function teamResolver(managed: readonly ManagedTeamIdentity[]): NonNullable<TeamCollectionsContext["teamOf"]> {
  const byPrinted = new Map(managed.filter((m) => MANAGED_TEAM_ID.test(m.teamId) && !CODE_TEAM_IDS.has(m.teamId) && isRegion(m.region)).map((m) => [m.printedTeam, m]));
  return (card, player) => {
    const base = canonicalCardTeam(card, player);
    if (!base.key.startsWith("raw:") || base.key === NO_TEAM) return base;
    const m = byPrinted.get(base.key.slice(4));
    return m ? { key: m.teamId, label: m.name, identity: { tag: m.tag, region: m.region } } : base;
  };
}

export interface TeamCollectionsModel {
  /** Las colecciones del jugador: equipos con cartas Y con región. */
  teams: TeamCollectionDef[];
  /**
   * Equipos con cartas pero SIN región: no se enseñan al jugador ni liquidan nada hasta que tengan identidad.
   * `printed` = el texto impreso que hay que dar de alta en el panel (null si el fallo es del registro de código).
   */
  unassigned: { id: string; title: string; cards: number; printed: string | null }[];
  /** Cartas publicadas que no llevan ningún equipo. */
  teamless: string[];
}

export function buildTeamCollections(ctx: TeamCollectionsContext): TeamCollectionsModel {
  const teamOf = ctx.teamOf ?? canonicalCardTeam;
  const logo = ctx.logo ?? hintTeamLogoSrc;
  const byTeam = new Map<string, TeamCollectionDef>();
  const teamless: string[] = [];
  const seen = new Set<string>();
  for (const c of ctx.cards) {
    if (seen.has(c.id)) continue; // una carta cuenta una vez, venga como venga el catálogo
    seen.add(c.id);
    const player = ctx.player(c.playerId);
    const t = teamOf(c, player);
    if (t.key === NO_TEAM) { teamless.push(c.id); continue; }
    let def = byTeam.get(t.key);
    if (!def) {
      const raw = t.key.startsWith("raw:");
      def = {
        id: t.key, title: t.label, tag: t.identity?.tag ?? t.label,
        region: !raw && isRegion(t.identity?.region) ? t.identity.region : null,
        logo: raw ? null : logo(t.key), cards: [],
      };
      byTeam.set(t.key, def);
    }
    def.cards.push({ id: c.id, playerId: c.playerId, nick: player?.nick ?? c.playerId, variantId: c.variantId, ovr: c.ovr, image: c.image ?? null });
  }
  const all = [...byTeam.values()].sort((a, b) => a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id));
  for (const t of all) t.cards.sort((a, b) => a.nick.localeCompare(b.nick, "es") || a.playerId.localeCompare(b.playerId) || b.ovr - a.ovr || a.id.localeCompare(b.id));
  return {
    teams: all.filter((t) => t.region !== null), teamless: teamless.sort(),
    unassigned: all.filter((t) => t.region === null).map((t) => ({ id: t.id, title: t.title, cards: t.cards.length, printed: t.id.startsWith("raw:") ? t.id.slice(4) : null })),
  };
}

// ───────────────────────────── Progreso ─────────────────────────────

export type TeamState = "LOCKED" | "IN_PROGRESS" | "COMPLETED";

export interface Progress {
  total: number;
  owned: number;
  missing: number;
  /** 0–100, entero hacia abajo: 27/28 = 96, nunca 100 sin estar completa. */
  pct: number;
  complete: boolean;
}

function progress(total: number, owned: number): Progress {
  const complete = total > 0 && owned === total;
  return { total, owned, missing: total - owned, complete, pct: total === 0 ? 0 : complete ? 100 : Math.min(99, Math.floor((owned / total) * 100)) };
}

/** Progreso de un equipo contra los ids de carta DISTINTOS que posee el jugador (las copias no cuentan dos veces). */
export function teamProgress(team: Pick<TeamCollectionDef, "cards">, owned: ReadonlySet<string>): Progress {
  return progress(team.cards.length, team.cards.reduce((n, c) => n + (owned.has(c.id) ? 1 : 0), 0));
}

export const teamState = (p: Progress): TeamState => (p.complete ? "COMPLETED" : p.owned > 0 ? "IN_PROGRESS" : "LOCKED");

/** Tarjeta de un equipo: lo justo para la rejilla (sin la lista de cartas). */
export interface TeamTileView extends Progress {
  id: string;
  title: string;
  tag: string;
  region: Region | null;
  logo: string | null;
  state: TeamState;
  /** Jugadores con carta en la colección (para buscar por jugador). */
  players: string[];
  /** Primera vez que la cuenta completó este equipo (guardado en el servidor), o null. */
  firstCompletedAt: string | null;
  /** XP de temporada cobrados por esa primera compleción; null = aún no cobrados (sin completar, o pendientes). */
  xpAwarded: number | null;
}

export function teamTile(team: TeamCollectionDef, owned: ReadonlySet<string>, persisted: Persisted = NOTHING_PERSISTED): TeamTileView {
  const p = teamProgress(team, owned);
  const done = persisted.teams.get(team.id);
  return {
    id: team.id, title: team.title, tag: team.tag, region: team.region, logo: team.logo, state: teamState(p),
    players: [...new Set(team.cards.map((c) => c.nick))], firstCompletedAt: done?.completedAt ?? null, xpAwarded: done?.xpGranted ? done.xpAmount : null, ...p,
  };
}

export interface TeamDetailView extends TeamTileView {
  cards: (TeamCollectionCard & { owned: boolean; copies: number })[];
}

export function teamDetail(team: TeamCollectionDef, counts: Readonly<Record<string, number>>, persisted: Persisted = NOTHING_PERSISTED): TeamDetailView {
  const owned = new Set(Object.keys(counts).filter((id) => (counts[id] ?? 0) > 0));
  return { ...teamTile(team, owned, persisted), cards: team.cards.map((c) => ({ ...c, owned: owned.has(c.id), copies: counts[c.id] ?? 0 })) };
}

// ───────────────────────────── Insignias regionales ─────────────────────────────

export interface RegionBadgeView extends Progress {
  region: Region;
  /** Equipos de la región con cartas en el catálogo. */
  teams: number;
  teamsCompleted: number;
  /** Hay algo que completar. Sin equipos o sin cartas, la insignia no existe todavía y no se concede. */
  configured: boolean;
  /** Tiene AHORA todas las cartas de todos los equipos de la región. */
  completeNow: boolean;
  /** Desbloqueo guardado en el servidor: ya no depende del inventario. */
  permanent: boolean;
  /** Cuándo se desbloqueó (si está guardado). */
  unlockedAt: string | null;
  /** Desbloqueada: guardada, o completa ahora mismo (a punto de guardarse). Nunca con cartas pendientes sin guardar. */
  unlocked: boolean;
}

/** Lo que el servidor tiene guardado de una cuenta (0075). Vacío = nada guardado, o la migración aún no está. */
export interface Persisted {
  /** equipo → primera compleción. `xpGranted: false` = sus XP siguen pendientes (no había temporada activa). */
  teams: ReadonlyMap<string, { completedAt: string; xpGranted: boolean; xpAmount: number }>;
  /** región → cuándo se desbloqueó su insignia. */
  regions: ReadonlyMap<string, string>;
}
export const NOTHING_PERSISTED: Persisted = { teams: new Map(), regions: new Map() };

/** XP de temporada por completar por primera vez la colección de un equipo. Una vez por cuenta y equipo. */
export const TEAM_COLLECTION_XP = 300;

/** Id del cosmético con el que se guarda una insignia regional (familia `insignia` de `user_cosmetics`). */
export const REGION_BADGE_PREFIX = "insignia:regional:";
export const regionBadgeId = (region: Region): string => `${REGION_BADGE_PREFIX}${region.toLowerCase()}`;
/** `insignia:regional:emea` → `EMEA`. Cualquier otra cosa, null. */
export const regionOfBadgeId = (id: string): Region | null =>
  (id.startsWith(REGION_BADGE_PREFIX) ? BADGE_REGIONS.find((r) => regionBadgeId(r) === id) ?? null : null);

export function regionBadges(teams: readonly TeamCollectionDef[], owned: ReadonlySet<string>, persisted: Persisted = NOTHING_PERSISTED): RegionBadgeView[] {
  return BADGE_REGIONS.map((region) => {
    const mine = teams.filter((t) => t.region === region && t.cards.length > 0);
    const each = mine.map((t) => teamProgress(t, owned));
    const p = progress(each.reduce((n, x) => n + x.total, 0), each.reduce((n, x) => n + x.owned, 0));
    const configured = mine.length > 0 && p.total > 0;
    // Todas las cartas de todos los equipos: se exige equipo a equipo, no solo la suma.
    const completeNow = configured && each.every((x) => x.complete);
    const unlockedAt = persisted.regions.get(region) ?? null;
    return { region, teams: mine.length, teamsCompleted: each.filter((x) => x.complete).length, configured, completeNow, permanent: unlockedAt !== null, unlockedAt, unlocked: unlockedAt !== null || completeNow, ...p };
  });
}

// ───────────────────────────── Vista completa ─────────────────────────────

export interface TeamCollectionsView {
  teams: TeamTileView[];
  regions: RegionBadgeView[];
  totals: { teams: number; teamsCompleted: number; cards: number; owned: number; badges: number; badgesUnlocked: number };
  /** Hay algo que el servidor debe liquidar (una primera compleción, sus XP o una insignia). El cliente lo pide con un POST. */
  pending: boolean;
}

/** Qué hay que pedirle a la base que compruebe y guarde. Solo lo que HOY se cumple y aún no consta. */
export interface SettlePlan {
  teams: { id: string; cards: string[] }[];
  regions: { region: Region; teams: number; cards: string[] }[];
}

/**
 * `seasonActive`: hay una temporada donde cobrar los XP. Sin ella, una compleción ya guardada con XP pendientes no
 * genera trabajo (no hay dónde apuntarlos); en cuanto haya temporada, vuelve a entrar en el plan.
 */
export function settlePlan(model: Pick<TeamCollectionsModel, "teams">, owned: ReadonlySet<string>, persisted: Persisted, seasonActive: boolean): SettlePlan {
  const teams = model.teams.filter((t) => {
    const done = persisted.teams.get(t.id);
    if (done) return !done.xpGranted && seasonActive;
    return teamProgress(t, owned).complete;
  }).map((t) => ({ id: t.id, cards: t.cards.map((c) => c.id) }));
  const regions = regionBadges(model.teams, owned, persisted).filter((r) => r.completeNow && !r.permanent).map((r) => {
    const mine = model.teams.filter((t) => t.region === r.region && t.cards.length > 0);
    return { region: r.region, teams: mine.length, cards: mine.flatMap((t) => t.cards.map((c) => c.id)) };
  });
  return { teams, regions };
}

export function teamCollectionsView(model: Pick<TeamCollectionsModel, "teams">, owned: ReadonlySet<string>, persisted: Persisted = NOTHING_PERSISTED, pending = false): TeamCollectionsView {
  const teams = model.teams.map((t) => teamTile(t, owned, persisted));
  const regions = regionBadges(model.teams, owned, persisted);
  return {
    teams, regions, pending,
    totals: {
      teams: teams.length, teamsCompleted: teams.filter((t) => t.complete).length,
      cards: teams.reduce((n, t) => n + t.total, 0), owned: teams.reduce((n, t) => n + t.owned, 0),
      // Una insignia guardada cuenta aunque hoy su región no tenga equipos: es del jugador.
      badges: regions.filter((r) => r.configured || r.permanent).length, badgesUnlocked: regions.filter((r) => r.unlocked).length,
    },
  };
}

// ───────────────────────────── Rejilla progresiva ─────────────────────────────

/** Tres equipos al entrar; cada «Ver más equipos» añade seis. */
export const FIRST_TEAMS = 3;
export const MORE_TEAMS = 6;

/** Cuántos equipos se ven tras `clicks` pulsaciones de «Ver más equipos», de un total de `total`. */
export const visibleTeamCount = (total: number, clicks: number): number => Math.max(0, Math.min(total, FIRST_TEAMS + Math.max(0, clicks) * MORE_TEAMS));

/**
 * Orden por defecto: primero lo que llevas empezado (lo que menos cartas le faltan delante), luego lo que no has
 * empezado y al final lo completado, que ya no es un objetivo. Estable: a igualdad, por nombre.
 */
export function sortTeams<T extends Pick<TeamTileView, "state" | "missing" | "pct" | "title" | "id">>(list: readonly T[], sort: "closest" | "alpha" = "closest"): T[] {
  const out = [...list];
  const byName = (a: T, b: T) => a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id);
  if (sort === "alpha") return out.sort(byName);
  const rank = (s: T) => (s.state === "IN_PROGRESS" ? 0 : s.state === "LOCKED" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.state === "IN_PROGRESS" ? a.missing - b.missing || b.pct - a.pct : 0) || byName(a, b));
}

/** Un enlace antiguo a un set de equipo de F82 (`team-g2-v1`) lleva al equipo (`g2`). Cualquier otra cosa, tal cual. */
export const legacySetTeamId = (id: string): string => /^team-([a-z0-9-]+)-v\d+$/.exec(id)?.[1] ?? id;
