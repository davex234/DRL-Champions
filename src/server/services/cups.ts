/**
 * F86 · TORNEOS DE JUGADORES — SERVICIO (solo servidor). Tablas de 0069: `cups`, `cup_registrations`, `cup_matches`.
 *
 * Lecturas AGREGADAS (una petición = el hub, o la ficha entera con el cuadro de hasta 64): 4–5 consultas fijas, nunca
 * una por participante o por cruce. Las escrituras son RPC atómicas (cerrojo de la copa): aquí no se decide ningún
 * ganador, seed, avance ni trofeo; se piden, se traducen y se leen. El `userId` sale SIEMPRE del token.
 *
 * Sin cron. Dos trabajos PEREZOSOS, idempotentes y acotados en las lecturas:
 *   · cerrada la inscripción y sin cuadro → `cup_generate(…, null)` (una vez: 20 lecturas a la vez = 1 cuadro);
 *   · cruces EN JUEGO cuya partida ya terminó → `cup_settle_game` (la red si se perdió el gancho de `duelsPvp`).
 *
 * Privacidad: de cada participante sale su identidad PÚBLICA (nombre, avatar, #TAG) y su seed; nunca su id. Solo el
 * propio jugador recibe, de SU cruce, el id del rival (enlace a su perfil) y el de la partida (para entrar a jugarla).
 * Un borrador no existe para nadie fuera del panel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cupPhase, displayState, type MatchDisplayState } from "@/domain/cups/lifecycle";
import { PLACEMENT_LABEL, PLACEMENT_RANK, roundName } from "@/domain/cups/bracket";
import { CUP_READY_TTL_SECONDS, type CupPhase, type CupPlacement, type CupResolution, type CupStatus, type CupMatchStatus } from "@/domain/cups/types";
import { normalizeTag } from "@/domain/account/tag";
import { createPvpMatch, resolveDeckSnapshot } from "./duelsPvp";
import { settleCupGame } from "./cupSettlement";
import { logEvent } from "@/server/ops/log";

export interface CupResult<T> { ok: boolean; status: number; error?: string; code?: string; data?: T }
const fail = (status: number, error: string, code?: string): CupResult<never> => ({ ok: false, status, error, code });
const done = <T>(data: T): CupResult<T> => ({ ok: true, status: 200, data });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const ARCHIVE_PAGE = 10;
const LIVE_LIMIT = 50;
const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) || null : null);

// ───────────────────────────── filas ─────────────────────────────

export interface CupRow {
  id: string; slug: string; name: string; description: string; rules: string; format: string; visibility: string; status: CupStatus;
  registration_open_at: string; registration_close_at: string; starts_at: string; round_window_minutes: number;
  min_participants: number; max_participants: number; participant_count: number; bracket_size: number | null; rounds: number | null;
  rules_version: number; published_at: string | null; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  cancel_reason: string | null; champion_id: string | null; version: number;
}
export const CUP_COLS = "id, slug, name, description, rules, format, visibility, status, registration_open_at, registration_close_at, starts_at, " +
  "round_window_minutes, min_participants, max_participants, participant_count, bracket_size, rounds, rules_version, published_at, started_at, " +
  "completed_at, cancelled_at, cancel_reason, champion_id, version";

interface RegRow {
  cup_id?: string; user_id: string; status: "REGISTERED" | "WITHDRAWN"; registered_at: string; seed: number | null; seed_rating: number | null;
  username_snapshot: string | null; tag_snapshot: string | null; eliminated_round: number | null; placement: CupPlacement | null;
}
const REG_COLS = "cup_id, user_id, status, registered_at, seed, seed_rating, username_snapshot, tag_snapshot, eliminated_round, placement";

interface MatchRow {
  id: string; cup_id?: string; round: number; slot: number; player_a: string | null; player_b: string | null; seed_a: number | null; seed_b: number | null;
  a_empty: boolean; b_empty: boolean; status: CupMatchStatus; winner_id: string | null; resolution: CupResolution | null; game_match_id: string | null;
  ready_a_until: string | null; ready_b_until: string | null; available_at: string; deadline_at: string; score_a: number | null; score_b: number | null;
}
const MATCH_COLS = "id, cup_id, round, slot, player_a, player_b, seed_a, seed_b, a_empty, b_empty, status, winner_id, resolution, game_match_id, " +
  "ready_a_until, ready_b_until, available_at, deadline_at, score_a, score_b";

interface ProfileRow { id: string; username: string | null; avatar: string | null; public_tag: string | null }

// ───────────────────────────── vistas ─────────────────────────────

/** Identidad PÚBLICA de un participante (sin id). `you` lo marca el servidor. */
export interface CupPlayer { seed: number | null; username: string; avatar: string; tag: string | null; you: boolean }
export type CupMyStatus = "REGISTERED" | "ALIVE" | "ELIMINATED" | "CHAMPION";

export interface CupCard {
  slug: string; name: string; phase: CupPhase; format: "SINGLE_ELIMINATION";
  participants: number; max: number; min: number;
  registrationOpenAt: string; registrationCloseAt: string; startsAt: string; completedAt: string | null; cancelledAt: string | null;
  champion: CupPlayer | null;
  /** Mi situación en este torneo (solo con sesión y si me inscribí). */
  mine: CupMyStatus | null;
  placement: CupPlacement | null;
}

export interface CupMatchView {
  round: number; slot: number;
  a: CupPlayer | null; b: CupPlayer | null; aEmpty: boolean; bEmpty: boolean;
  state: MatchDisplayState; winner: "A" | "B" | null; resolution: CupResolution | null;
  /** Marcador del motor, solo si la partida se jugó entera (no se inventa en un abandono o una resolución admin). */
  score: { a: number; b: number } | null;
  you: boolean;
}
export interface CupRoundView { round: number; name: string; availableAt: string; deadlineAt: string; matches: CupMatchView[] }

export interface CupMyMatch {
  round: number; slot: number; roundName: string; state: MatchDisplayState;
  opponent: (CupPlayer & { userId: string }) | null;
  availableAt: string; deadlineAt: string;
  youReady: boolean; opponentReady: boolean;
  /** La partida PvP de este cruce, cuando existe (para entrar a jugarla). */
  gameMatchId: string | null;
  /** Ronda de la que saldrá mi rival, si todavía no se sabe. */
  waitingFor: string | null;
  /** F86.1 · ronda que acabo de GANAR para llegar aquí («Has ganado Semifinal»), o null. */
  advancedFrom: string | null;
  /** F86.1 · sin rival aún: cómo está el cruce del que saldrá (EN JUEGO ahora, listo o esperando). */
  rivalSource: "ACTIVE" | "READY" | "WAITING" | null;
}
export interface CupMe {
  status: CupMyStatus | null; withdrawn: boolean; seed: number | null;
  placement: CupPlacement | null; placementLabel: string | null; eliminatedRound: number | null;
  match: CupMyMatch | null;
  canRegister: boolean; canWithdraw: boolean;
}
export interface CupDetail {
  card: CupCard; description: string; rules: string; rulesVersion: number; roundWindowMinutes: number;
  cancelled: { reason: string } | null;
  schedule: { round: number; name: string; availableAt: string; deadlineAt: string }[];
  bracket: CupRoundView[] | null; bracketSize: number | null; rounds: number | null;
  participants: CupPlayer[]; participantsTotal: number;
  me: CupMe | null; serverNow: number; unlisted: boolean;
}
export interface CupReadyNotice { slug: string; name: string; round: number; slot: number; roundName: string; opponent: CupPlayer | null; state: MatchDisplayState; deadlineAt: string }
export interface CupHistory { participations: number; titles: number; best: CupPlacement | null; bestLabel: string | null; entries: { slug: string; name: string; placement: CupPlacement | null; label: string | null; completedAt: string | null }[] }
export interface CupHub {
  serverNow: number;
  open: CupCard[]; upcoming: CupCard[]; live: CupCard[];
  finished: CupCard[]; finishedOffset: number; finishedHasMore: boolean;
  mine: CupCard[] | null; ready: CupReadyNotice | null; history: CupHistory | null;
}

// ───────────────────────────── piezas ─────────────────────────────

async function profilesOf(sb: SupabaseClient, ids: (string | null)[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, ProfileRow>();
  if (!unique.length) return out;
  const { data, error } = await sb.from("profiles").select("id, username, avatar, public_tag").in("id", unique);
  if (error) throw new Error(error.message);
  for (const p of (data ?? []) as ProfileRow[]) out.set(p.id, p);
  return out;
}

const playerOf = (id: string | null, seed: number | null, profiles: Map<string, ProfileRow>, viewer: string | null, snap?: RegRow | null): CupPlayer | null => {
  if (!id) return null;
  const p = profiles.get(id);
  return {
    seed,
    username: p?.username ?? snap?.username_snapshot ?? "Jugador",
    avatar: p?.avatar ?? "🎮",
    tag: normalizeTag(p?.public_tag ?? snap?.tag_snapshot ?? null),
    you: !!viewer && id === viewer,
  };
};

const timingOf = (c: CupRow) => ({
  status: c.status, registrationOpenAt: Date.parse(c.registration_open_at), registrationCloseAt: Date.parse(c.registration_close_at),
  startsAt: Date.parse(c.starts_at), startedAt: ms(c.started_at),
});

function myStatus(reg: RegRow | null | undefined, c: CupRow): CupMyStatus | null {
  if (!reg || reg.status !== "REGISTERED") return null;
  if (reg.placement === "CHAMPION") return "CHAMPION";
  if (reg.placement || reg.eliminated_round) return "ELIMINATED";
  return c.started_at ? "ALIVE" : "REGISTERED";
}

function cardOf(c: CupRow, now: number, champion: CupPlayer | null, reg: RegRow | null | undefined): CupCard {
  return {
    slug: c.slug, name: c.name, phase: cupPhase(timingOf(c), now), format: "SINGLE_ELIMINATION",
    participants: c.participant_count, max: c.max_participants, min: c.min_participants,
    registrationOpenAt: c.registration_open_at, registrationCloseAt: c.registration_close_at, startsAt: c.starts_at,
    completedAt: c.completed_at, cancelledAt: c.cancelled_at, champion,
    mine: myStatus(reg, c), placement: reg?.status === "REGISTERED" ? reg.placement : null,
  };
}

/**
 * Trabajo perezoso de UNA copa: generar el cuadro si ya cerró la inscripción; liquidar cruces cuya partida terminó.
 * Devuelve la fila releída si algo pudo cambiar. Idempotente: 20 lecturas a la vez = 1 cuadro, 1 avance.
 */
async function progress(sb: SupabaseClient, c: CupRow, now: number): Promise<CupRow> {
  let changed = false;
  if (c.status === "PUBLISHED" && !c.started_at && now >= Date.parse(c.registration_close_at)) {
    const { data, error } = await sb.rpc("cup_generate", { p_cup: c.id, p_actor: null });
    if (error) logEvent("error", "cups.generate", error.message, { cup: c.slug });
    else {
      const code = String((data as { code?: string } | null)?.code ?? "");
      if (code === "GENERATED" || code === "UNDERFILLED") logEvent("info", "cups.generate", code, { cup: c.slug, participants: c.participant_count });
      changed = true;
    }
  }
  if (c.status === "IN_PROGRESS" || changed) {
    const { data: active } = await sb.from("cup_matches").select("game_match_id").eq("cup_id", c.id).eq("status", "ACTIVE").limit(32);
    const games = ((active ?? []) as { game_match_id: string | null }[]).map((r) => r.game_match_id).filter((g): g is string => !!g);
    if (games.length) {
      const { data: ended } = await sb.from("duel_matches").select("id").in("id", games)
        .or("status.in.(COMPLETED,DRAW,UNRESOLVED),closed_reason.not.is.null");
      for (const g of (ended ?? []) as { id: string }[]) { await settleCupGame(sb, g.id); changed = true; }
    }
  }
  if (!changed) return c;
  const { data } = await sb.from("cups").select(CUP_COLS).eq("id", c.id).maybeSingle();
  return (data as unknown as CupRow | null) ?? c;
}

async function cupBySlug(sb: SupabaseClient, slug: unknown): Promise<CupRow | null> {
  if (typeof slug !== "string" || !SLUG.test(slug)) return null;
  const { data, error } = await sb.from("cups").select(CUP_COLS).eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  const c = data as unknown as CupRow | null;
  return c && c.status !== "DRAFT" ? c : null;
}

// ───────────────────────────── hub ─────────────────────────────

export async function getCupHub(sb: SupabaseClient, viewer: string | null, opts: { now?: number; offset?: unknown } = {}): Promise<CupResult<CupHub>> {
  const now = opts.now ?? Date.now();
  const offset = Math.min(Math.max(Math.trunc(Number(opts.offset) || 0), 0), 500);
  try {
    const [liveRes, doneRes, regsRes] = await Promise.all([
      sb.from("cups").select(CUP_COLS).in("status", ["PUBLISHED", "IN_PROGRESS"]).eq("visibility", "PUBLIC").order("starts_at", { ascending: true }).limit(LIVE_LIMIT),
      sb.from("cups").select(CUP_COLS).in("status", ["COMPLETED", "CANCELLED"]).eq("visibility", "PUBLIC").not("published_at", "is", null)
        .order("updated_at", { ascending: false }).range(offset, offset + ARCHIVE_PAGE),
      viewer ? sb.from("cup_registrations").select(REG_COLS).eq("user_id", viewer).eq("status", "REGISTERED").order("registered_at", { ascending: false }).limit(40)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [liveRes, doneRes, regsRes]) if (r.error) throw new Error(r.error.message);
    let live = (liveRes.data ?? []) as unknown as CupRow[];
    // Perezoso y acotado: como mucho 3 cuadros por lectura del hub (el resto, en la siguiente).
    const due = live.filter((c) => c.status === "PUBLISHED" && now >= Date.parse(c.registration_close_at)).slice(0, 3);
    if (due.length) {
      const fresh = new Map((await Promise.all(due.map((c) => progress(sb, c, now)))).map((c) => [c.id, c]));
      live = live.map((c) => fresh.get(c.id) ?? c).filter((c) => c.status === "PUBLISHED" || c.status === "IN_PROGRESS");
    }
    const finishedRows = (doneRes.data ?? []) as unknown as CupRow[];
    const regs = (regsRes.data ?? []) as unknown as RegRow[];
    const myRegs = new Map(regs.map((r) => [r.cup_id as string, r]));

    // Mis torneos: también los no listados (inscrito por enlace directo).
    const knownIds = new Set([...live, ...finishedRows].map((c) => c.id));
    const missing = [...myRegs.keys()].filter((id) => !knownIds.has(id));
    let mineRows: CupRow[] = [];
    if (missing.length) {
      const { data, error } = await sb.from("cups").select(CUP_COLS).in("id", missing).neq("status", "DRAFT");
      if (error) throw new Error(error.message);
      mineRows = (data ?? []) as unknown as CupRow[];
    }
    const all = new Map([...live, ...finishedRows, ...mineRows].map((c) => [c.id, c]));
    const profiles = await profilesOf(sb, [...all.values()].map((c) => c.champion_id));
    const champ = (c: CupRow) => playerOf(c.champion_id, null, profiles, viewer);
    const card = (c: CupRow) => cardOf(c, now, champ(c), myRegs.get(c.id));

    const cards = live.map(card);
    let ready: CupReadyNotice | null = null;
    if (viewer) {
      const { data: mm, error } = await sb.from("cup_matches").select(MATCH_COLS)
        .in("status", ["READY", "ACTIVE", "ACTION_REQUIRED"]).or(`player_a.eq.${viewer},player_b.eq.${viewer}`).order("deadline_at", { ascending: true }).limit(10);
      if (error) throw new Error(error.message);
      // El filtro por jugador se repite aquí a propósito: un cruce ajeno nunca puede colarse como «mi partida».
      const mine = ((mm ?? []) as unknown as MatchRow[]).find((m) => (m.player_a === viewer || m.player_b === viewer) && all.get(m.cup_id as string)?.status === "IN_PROGRESS");
      if (mine) {
        const c = all.get(mine.cup_id as string)!;
        const oppId = mine.player_a === viewer ? mine.player_b : mine.player_a;
        const ps = await profilesOf(sb, [oppId]);
        ready = {
          slug: c.slug, name: c.name, round: mine.round, slot: mine.slot, roundName: roundName(mine.round, c.rounds ?? mine.round),
          opponent: playerOf(oppId, mine.player_a === viewer ? mine.seed_b : mine.seed_a, ps, viewer),
          state: displayState(mine.status, Date.parse(mine.available_at), Date.parse(mine.deadline_at), now), deadlineAt: mine.deadline_at,
        };
      }
    }
    let history: CupHistory | null = null;
    if (viewer) {
      const completed = regs.filter((r) => all.get(r.cup_id as string)?.status === "COMPLETED" && r.seed !== null);
      const best = completed.map((r) => r.placement).filter((p): p is CupPlacement => !!p).sort((a, b) => PLACEMENT_RANK[a] - PLACEMENT_RANK[b])[0] ?? null;
      history = {
        participations: completed.length,
        titles: completed.filter((r) => r.placement === "CHAMPION").length,
        best, bestLabel: best ? PLACEMENT_LABEL[best] : null,
        entries: completed.slice(0, 10).map((r) => {
          const c = all.get(r.cup_id as string)!;
          return { slug: c.slug, name: c.name, placement: r.placement, label: r.placement ? PLACEMENT_LABEL[r.placement] : null, completedAt: c.completed_at };
        }),
      };
    }
    return done({
      serverNow: now,
      open: cards.filter((c) => c.phase === "REGISTRATION_OPEN"),
      upcoming: cards.filter((c) => c.phase === "SCHEDULED" || c.phase === "REGISTRATION_CLOSED"),
      live: cards.filter((c) => c.phase === "IN_PROGRESS"),
      finished: finishedRows.slice(0, ARCHIVE_PAGE).map(card),
      finishedOffset: offset, finishedHasMore: finishedRows.length > ARCHIVE_PAGE,
      mine: viewer ? [...myRegs.keys()].map((id) => all.get(id)).filter((c): c is CupRow => !!c).map(card) : null,
      ready, history,
    });
  } catch (e) {
    logEvent("error", "cups.hub", e instanceof Error ? e.message : String(e));
    return fail(500, "No se pudieron leer los torneos");
  }
}

// ───────────────────────────── ficha ─────────────────────────────

const CANCEL_TEXT = (c: CupRow): string => (c.cancel_reason === "NOT_ENOUGH_PARTICIPANTS"
  ? `No se alcanzó el mínimo de ${c.min_participants} inscritos.` : "La organización canceló el torneo.");

export async function getCupDetail(sb: SupabaseClient, viewer: string | null, slug: unknown, opts: { now?: number } = {}): Promise<CupResult<CupDetail>> {
  const now = opts.now ?? Date.now();
  try {
    const found = await cupBySlug(sb, slug);
    if (!found) return fail(404, "Torneo no encontrado", "NOT_FOUND");
    const c = await progress(sb, found, now);
    const [regsRes, matchesRes] = await Promise.all([
      sb.from("cup_registrations").select(REG_COLS).eq("cup_id", c.id).eq("status", "REGISTERED").order("registered_at", { ascending: true }).limit(64),
      c.started_at ? sb.from("cup_matches").select(MATCH_COLS).eq("cup_id", c.id).order("round", { ascending: true }).order("slot", { ascending: true }).limit(63)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (regsRes.error) throw new Error(regsRes.error.message);
    if (matchesRes.error) throw new Error(matchesRes.error.message);
    const regs = (regsRes.data ?? []) as unknown as RegRow[];
    const matches = (matchesRes.data ?? []) as unknown as MatchRow[];
    const regBy = new Map(regs.map((r) => [r.user_id, r]));
    const myReg: RegRow | null = viewer ? regBy.get(viewer) ?? null : null;
    let withdrawn = false;
    if (viewer && !myReg) {
      const { data } = await sb.from("cup_registrations").select("status").eq("cup_id", c.id).eq("user_id", viewer).maybeSingle();
      withdrawn = (data as { status?: string } | null)?.status === "WITHDRAWN";
    }
    const profiles = await profilesOf(sb, [...regs.map((r) => r.user_id), c.champion_id]);
    const seeded = c.started_at !== null;
    const participants = [...regs]
      .sort((a, b) => (seeded ? (a.seed ?? 99) - (b.seed ?? 99) : Date.parse(a.registered_at) - Date.parse(b.registered_at)))
      .map((r) => playerOf(r.user_id, seeded ? r.seed : null, profiles, viewer, r)!);
    const rounds = c.rounds;
    const P = (id: string | null, seed: number | null) => playerOf(id, seed, profiles, viewer, id ? regBy.get(id) : null);

    let bracket: CupRoundView[] | null = null;
    if (seeded && rounds) {
      bracket = [];
      for (let r = 1; r <= rounds; r++) {
        const ms2 = matches.filter((m) => m.round === r);
        if (!ms2.length) continue;
        bracket.push({
          round: r, name: roundName(r, rounds), availableAt: ms2[0].available_at, deadlineAt: ms2[0].deadline_at,
          matches: ms2.map((m) => ({
            round: m.round, slot: m.slot, a: P(m.player_a, m.seed_a), b: P(m.player_b, m.seed_b), aEmpty: m.a_empty, bEmpty: m.b_empty,
            state: displayState(m.status, Date.parse(m.available_at), Date.parse(m.deadline_at), now),
            winner: m.winner_id === null ? null : m.winner_id === m.player_a ? "A" : "B",
            resolution: m.resolution,
            score: m.resolution === "PLAYED" && m.score_a !== null && m.score_b !== null ? { a: m.score_a, b: m.score_b } : null,
            you: !!viewer && (m.player_a === viewer || m.player_b === viewer),
          })),
        });
      }
    }
    const schedule = bracket ? bracket.map((r) => ({ round: r.round, name: r.name, availableAt: r.availableAt, deadlineAt: r.deadlineAt })) : [];

    let me: CupMe | null = null;
    if (viewer) {
      const phase = cupPhase(timingOf(c), now);
      let match: CupMyMatch | null = null;
      if (myReg && seeded) {
        // El ganador ya está escrito en el cruce siguiente (lo hace la BD al propagar): mi cruce es el de ronda más alta.
        const cur = matches.filter((m) => m.player_a === viewer || m.player_b === viewer).sort((a, b) => b.round - a.round)[0];
        if (cur) {
          const side: "A" | "B" = cur.player_a === viewer ? "A" : "B";
          const oppId = side === "A" ? cur.player_b : cur.player_a;
          const until = (iso: string | null) => !!iso && Date.parse(iso) > now;
          match = {
            round: cur.round, slot: cur.slot, roundName: roundName(cur.round, rounds ?? cur.round),
            state: displayState(cur.status, Date.parse(cur.available_at), Date.parse(cur.deadline_at), now),
            opponent: oppId ? { ...(P(oppId, side === "A" ? cur.seed_b : cur.seed_a) as CupPlayer), userId: oppId } : null,
            availableAt: cur.available_at, deadlineAt: cur.deadline_at,
            youReady: until(side === "A" ? cur.ready_a_until : cur.ready_b_until),
            opponentReady: until(side === "A" ? cur.ready_b_until : cur.ready_a_until),
            gameMatchId: cur.game_match_id && cur.status !== "READY" ? cur.game_match_id : null,
            waitingFor: !oppId && cur.status === "PENDING" && cur.round > 1
              ? `Ganador del cruce ${(side === "A" ? cur.slot * 2 + 1 : cur.slot * 2) + 1} de ${roundName(cur.round - 1, rounds ?? cur.round)}` : null,
            advancedFrom: (() => {
              const prev = matches.find((x) => x.round === cur.round - 1 && x.slot >> 1 === cur.slot && (x.player_a === viewer || x.player_b === viewer));
              return prev && prev.winner_id === viewer && prev.status !== "BYE" ? roundName(prev.round, rounds ?? cur.round) : null;
            })(),
            rivalSource: (() => {
              if (oppId || cur.status !== "PENDING" || cur.round < 2) return null;
              const src = matches.find((x) => x.round === cur.round - 1 && x.slot === (side === "A" ? cur.slot * 2 + 1 : cur.slot * 2));
              return src?.status === "ACTIVE" ? "ACTIVE" : src?.status === "READY" ? "READY" : "WAITING";
            })(),
          };
        }
      }
      me = {
        status: myStatus(myReg, c), withdrawn, seed: myReg?.seed ?? null,
        placement: myReg?.placement ?? null, placementLabel: myReg?.placement ? PLACEMENT_LABEL[myReg.placement] : null,
        eliminatedRound: myReg?.eliminated_round ?? null, match,
        canRegister: phase === "REGISTRATION_OPEN" && !myReg && c.participant_count < c.max_participants,
        canWithdraw: phase === "REGISTRATION_OPEN" && !!myReg,
      };
    }
    return done({
      card: cardOf(c, now, playerOf(c.champion_id, regBy.get(c.champion_id ?? "")?.seed ?? null, profiles, viewer), myReg),
      description: c.description, rules: c.rules, rulesVersion: c.rules_version, roundWindowMinutes: c.round_window_minutes,
      cancelled: c.status === "CANCELLED" ? { reason: CANCEL_TEXT(c) } : null,
      schedule, bracket, bracketSize: c.bracket_size, rounds: c.rounds,
      participants, participantsTotal: c.participant_count,
      me, serverNow: now, unlisted: c.visibility === "UNLISTED",
    });
  } catch (e) {
    logEvent("error", "cups.detail", e instanceof Error ? e.message : String(e));
    return fail(500, "No se pudo leer el torneo");
  }
}

/**
 * F86.1 · NIVEL DE SONDEO que necesita ESTE jugador ahora mismo (lo decide el servidor, una sola regla):
 *   hot   · mi cruce es jugable y alguno de los dos ya está listo (esperando al otro): descubrir la partida en ~3 s
 *   warm  · mi cruce es jugable (nadie listo) o mi próximo rival sale de un cruce EN JUEGO ahora mismo: ~5 s
 *   idle  · tengo un cruce pero no pide nada inmediato (ventana aún cerrada, en juego, en revisión, rival lejos): ~20 s
 *   cold  · ningún cruce vivo (fuera de torneos o inscrito antes del cuadro): ~60 s, como antes
 */
export type CupPollTier = "hot" | "warm" | "idle" | "cold";
export interface CupStatusMatch {
  slug: string; name: string; round: number; slot: number; roundName: string; state: MatchDisplayState;
  youReady: boolean; opponentReady: boolean;
  /** La partida PvP del cruce cuando ya existe (solo a sus dos jugadores). */
  gameMatchId: string | null;
  availableAt: string; deadlineAt: string;
  opponent: { username: string; avatar: string; tag: string | null } | null;
  /** Sin rival aún: cómo está el cruce del que saldrá (EN JUEGO, LISTO o esperando). */
  rivalSource: "ACTIVE" | "READY" | "WAITING" | null;
}
export interface CupLiveStatus { ready: number; tier: CupPollTier; match: CupStatusMatch | null; serverNow: number }

const STATUS_RANK: Record<string, number> = { ACTIVE: 0, READY: 1, ACTION_REQUIRED: 2, PENDING: 3 };

export function cupPollTier(m: CupStatusMatch | null): CupPollTier {
  if (!m) return "cold";
  if (m.state === "READY") return m.youReady || m.opponentReady ? "hot" : "warm";
  if (m.state === "PENDING") return m.rivalSource === "ACTIVE" ? "warm" : "idle";
  return "idle";
}

/**
 * F86.1 · ESTADO LIGERO de mis torneos (`GET /api/game/cups?status=1`, y `?badge=1` por compatibilidad): sin cuadro,
 * sin participantes. Sin cruces vivos = UNA consulta. Con cruce: 2–5 lecturas pequeñas por índice. Es lo que sondea el
 * armazón (indicador, aviso global) y la espera del rival: lo caro (la ficha con 64 jugadores) solo se relee cuando
 * algo de aquí cambia.
 */
export async function getCupStatus(sb: SupabaseClient, viewer: string, opts: { now?: number } = {}): Promise<CupResult<CupLiveStatus>> {
  const nowMs = opts.now ?? Date.now();
  const empty: CupLiveStatus = { ready: 0, tier: "cold", match: null, serverNow: nowMs };
  try {
    const { data, error } = await sb.from("cup_matches").select(MATCH_COLS)
      .in("status", ["PENDING", "READY", "ACTIVE", "ACTION_REQUIRED"]).or(`player_a.eq.${viewer},player_b.eq.${viewer}`).limit(20);
    if (error) {
      if (/cup_matches|does not exist|PGRST/i.test(error.message)) return done(empty);
      throw new Error(error.message);
    }
    const mine = ((data ?? []) as unknown as MatchRow[]).filter((r) => r.player_a === viewer || r.player_b === viewer);
    if (!mine.length) return done(empty);
    const { data: cupsData, error: ce } = await sb.from("cups").select("id, slug, name, rounds, status").in("id", [...new Set(mine.map((r) => r.cup_id as string))]).eq("status", "IN_PROGRESS");
    if (ce) throw new Error(ce.message);
    const cups = new Map(((cupsData ?? []) as { id: string; slug: string; name: string; rounds: number | null }[]).map((c) => [c.id, c]));
    const live = mine.filter((r) => cups.has(r.cup_id as string));
    const open = (r: MatchRow) => Date.parse(r.available_at) <= nowMs && Date.parse(r.deadline_at) > nowMs;
    const ready = live.filter((r) => r.status === "ACTIVE" || (r.status === "READY" && open(r))).length;
    const cur = [...live].sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (Date.parse(a.deadline_at) - Date.parse(b.deadline_at)))[0];
    if (!cur) return done(empty);
    const c = cups.get(cur.cup_id as string)!;
    const side: "A" | "B" = cur.player_a === viewer ? "A" : "B";
    const oppId = side === "A" ? cur.player_b : cur.player_a;
    let opponent: CupStatusMatch["opponent"] = null;
    if (oppId) {
      const { data: p } = await sb.from("profiles").select("username, avatar, public_tag").eq("id", oppId).maybeSingle();
      const pr = p as { username: string | null; avatar: string | null; public_tag: string | null } | null;
      opponent = { username: pr?.username ?? "Jugador", avatar: pr?.avatar ?? "🎮", tag: normalizeTag(pr?.public_tag ?? null) };
    }
    let rivalSource: CupStatusMatch["rivalSource"] = null;
    if (!oppId && cur.status === "PENDING" && cur.round > 1) {
      const srcSlot = side === "A" ? cur.slot * 2 + 1 : cur.slot * 2;
      const { data: src } = await sb.from("cup_matches").select("status").eq("cup_id", cur.cup_id as string).eq("round", cur.round - 1).eq("slot", srcSlot).maybeSingle();
      const st = (src as { status?: string } | null)?.status ?? "";
      rivalSource = st === "ACTIVE" ? "ACTIVE" : st === "READY" ? "READY" : "WAITING";
    }
    const fresh = (iso: string | null) => !!iso && Date.parse(iso) > nowMs;
    const match: CupStatusMatch = {
      slug: c.slug, name: c.name, round: cur.round, slot: cur.slot, roundName: roundName(cur.round, c.rounds ?? cur.round),
      state: displayState(cur.status, Date.parse(cur.available_at), Date.parse(cur.deadline_at), nowMs),
      youReady: fresh(side === "A" ? cur.ready_a_until : cur.ready_b_until),
      opponentReady: fresh(side === "A" ? cur.ready_b_until : cur.ready_a_until),
      gameMatchId: cur.status === "ACTIVE" ? cur.game_match_id : null,
      availableAt: cur.available_at, deadlineAt: cur.deadline_at, opponent, rivalSource,
    };
    return done({ ready, tier: cupPollTier(match), match, serverNow: nowMs });
  } catch (e) {
    logEvent("error", "cups.status", e instanceof Error ? e.message : String(e));
    return fail(500, "No se pudo leer el estado de tus torneos");
  }
}

/** Compatibilidad: el indicador del menú es el estado ligero (lleva `ready`). */
export const getCupBadge = getCupStatus;

// ───────────────────────────── inscripción ─────────────────────────────

const REGISTER_ERRORS: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Torneo no encontrado"],
  CANCELLED: [409, "El torneo se ha cancelado"],
  CLOSED: [409, "La inscripción está cerrada"],
  NOT_OPEN: [409, "La inscripción todavía no ha abierto"],
  NO_PROFILE: [409, "Tu cuenta no tiene perfil de jugador"],
  SANCTIONED: [403, "Tu cuenta tiene una sanción activa: no puedes inscribirte"],
  FULL: [409, "Torneo completo"],
  NOT_REGISTERED: [409, "No estabas inscrito"],
};

export async function registerCup(sb: SupabaseClient, me: string, slug: unknown, join: boolean): Promise<CupResult<{ code: string; participants: number }>> {
  try {
    const c = await cupBySlug(sb, slug);
    if (!c) return fail(404, "Torneo no encontrado", "NOT_FOUND");
    const { data, error } = await sb.rpc(join ? "cup_register" : "cup_withdraw", { p_user: me, p_cup: c.id });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { code?: string; count?: number };
    const code = String(r.code ?? "");
    logEvent("info", "cups.registration", code, { cup: c.slug, join });
    if (code === "REGISTERED" || code === "ALREADY_REGISTERED" || code === "WITHDRAWN") return done({ code, participants: Number(r.count ?? c.participant_count) });
    const known = REGISTER_ERRORS[code];
    return known ? fail(known[0], known[1], code) : fail(500, "Respuesta inesperada", code);
  } catch (e) {
    logEvent("error", "cups.registration", e instanceof Error ? e.message : String(e));
    return fail(500, "No se pudo completar la inscripción");
  }
}

// ───────────────────────────── jugar mi cruce ─────────────────────────────

export interface CupReadyResult { code: "WAITING" | "STARTED"; gameMatchId: string | null; readyUntil: string | null }

const READY_ERRORS: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Partida no encontrada"],
  CANCELLED: [409, "El torneo se ha cancelado"],
  CLOSED: [409, "El torneo ya no admite partidas"],
  NOT_READY: [409, "Tu partida aún no está lista: falta tu rival"],
  NOT_YET: [409, "Todavía no se puede jugar esta ronda"],
  DEADLINE_PASSED: [409, "El plazo de esta ronda terminó: la organización resolverá el cruce"],
  DECK_REQUIRED: [400, "Elige un equipo para jugar"],
  BUSY: [409, "Ya estás en otra partida: termínala antes de jugar la del torneo"],
  IN_QUEUE: [409, "Sal de la cola ranked para jugar tu partida de torneo"],
};

/**
 * «Estoy listo» con un equipo. La partida nace SOLO cuando los dos están listos a la vez (la BD reserva su id una vez);
 * el servidor la crea con el motor canónico (`createPvpMatch`, mode PVP_PRIVATE), revalidando los DOS equipos. Si la
 * reserva ya existía (doble pestaña, reintento, el rival llegó a la vez) se crea con el MISMO id: nunca dos partidas.
 */
export async function readyCupMatch(
  sb: SupabaseClient, me: string, input: { slug: unknown; round: unknown; slot: unknown; deckId: unknown },
): Promise<CupResult<CupReadyResult>> {
  const round = Number(input.round), slot = Number(input.slot);
  if (!Number.isInteger(round) || round < 1 || round > 6 || !Number.isInteger(slot) || slot < 0 || slot > 31) return fail(400, "Cruce no válido", "BAD_MATCH");
  if (typeof input.deckId !== "string" || !UUID.test(input.deckId)) return fail(400, "Elige un equipo para jugar", "DECK_REQUIRED");
  const deckId = input.deckId;
  try {
    const c = await cupBySlug(sb, input.slug);
    if (!c) return fail(404, "Torneo no encontrado", "NOT_FOUND");
    const { data: mrow, error: me1 } = await sb.from("cup_matches").select("id").eq("cup_id", c.id).eq("round", round).eq("slot", slot).maybeSingle();
    if (me1) throw new Error(me1.message);
    if (!mrow) return fail(404, "Partida no encontrada", "NOT_FOUND");
    const matchId = (mrow as { id: string }).id;
    const deck = await resolveDeckSnapshot(sb, me, deckId);
    if (!deck.ok) return fail(deck.status === 404 ? 404 : 409, deck.error, "DECK_INVALID");
    const { data, error } = await sb.rpc("cup_ready", { p_user: me, p_match: matchId, p_deck: deckId, p_ttl_seconds: CUP_READY_TTL_SECONDS });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { code?: string; gameMatchId?: string; status?: string; readyUntil?: string; playerA?: string; deckA?: string; playerB?: string; deckB?: string };
    const code = String(r.code ?? "");
    if (code === "WAITING") return done({ code: "WAITING", gameMatchId: null, readyUntil: r.readyUntil ?? null });
    if (code === "START" || code === "ALREADY") {
      const game = String(r.gameMatchId);
      if (code === "ALREADY" && r.status === "ACTIVE") return done({ code: "STARTED", gameMatchId: game, readyUntil: null });
      if (!r.deckA || !r.deckB) return fail(409, "Tu rival todavía no ha elegido equipo", "NOT_READY");
      const made = await createPvpMatch(sb, { playerId: String(r.playerA), deckId: String(r.deckA) }, { playerId: String(r.playerB), deckId: String(r.deckB) },
        { matchId: game, mode: "PVP_PRIVATE" });
      if (!made.ok) {
        // ¿La creó otra petición con el mismo id (los dos llegaron a la vez)? Entonces existe y vale.
        const { data: exists } = await sb.from("duel_matches").select("id").eq("id", game).maybeSingle();
        if (!exists) {
          await sb.rpc("cup_start_failed", { p_match: matchId, p_game: game, p_offender: made.offenderId ?? null });
          logEvent("warn", "cups.match", "START_FAILED", { cup: c.slug, round, slot, code: made.code ?? null });
          const theirs = made.offenderId && made.offenderId !== me;
          return fail(made.status === 500 ? 500 : 409, theirs ? "El equipo de tu rival ya no es válido: tiene que elegir otro" : made.error ?? "No se pudo crear la partida", made.code ?? "MATCH_FAILED");
        }
      }
      await sb.rpc("cup_mark_active", { p_match: matchId, p_game: game });
      logEvent("info", "cups.match", "STARTED", { cup: c.slug, round, slot });
      return done({ code: "STARTED", gameMatchId: game, readyUntil: null });
    }
    const known = READY_ERRORS[code];
    return known ? fail(known[0], known[1], code) : fail(500, "Respuesta inesperada", code);
  } catch (e) {
    logEvent("error", "cups.ready", e instanceof Error ? e.message : String(e));
    return fail(500, "No se pudo preparar la partida");
  }
}
