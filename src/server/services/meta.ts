/**
 * META GAME — SNAPSHOT DE LECTURA (Fase 27, SOLO SERVIDOR).
 *
 * Una sola lectura para el Meta Hub, la home y el post-partida: reúne lo que YA calculan otros
 * servicios (pase/misiones/logros → `progression`, pasos del bucle → `loop`, libro mayor, perfil,
 * sobres, mazos, rating PvP) en un `MetaSnapshot`. **No es autoridad de nada**: no concede, no
 * completa, no reclama, no escribe. FASE 42 · CERO ESCRITURAS: antes usaba `getProgression` (rotaba misiones y
 * abría el carril competitivo al leer) y `getRating` (creaba la ficha 1000/0). Ahora `peekProgression` (el estado que
 * corresponde a `now`, rotación pura) y `readCompetitivePosition` (la ficha tal cual).
 *
 * Batching a propósito: la home leía el estado, los mazos, el bucle y el libro mayor en cuatro
 * viajes; el hub los necesita todos. Aquí se hacen en paralelo y el pase se lee UNA vez (el
 * bucle lo recibe ya leído).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { peekProgression, type ProgressionView } from "./progression";
import { readCompetitivePosition } from "./competitive";
import { getLoop, type LoopView } from "./loop";
import { listDecks } from "./duels";
import { isProvisional, type DuelRating } from "@/domain/cardgame/rating/types";
import { CURRENT_SEASON } from "@/data/season";
import { SEASON_CALENDAR } from "@/data/seasonCalendar";
import { resolveCalendar } from "@/domain/season/calendar";
import { CARDS } from "@/data/catalog";
import { collectionProgress, type CollectionProgress } from "@/domain/progression/hub";
import {
  accountLevel, ftueState, rewardHistory, sortObjectives,
  type MetaLevel, type MetaObjective, type FtueState, type RewardEntry, type LedgerLike,
} from "@/domain/progression/meta";

export interface MetaSnapshot {
  /** Reloj del servidor. El cliente solo cuenta hacia atrás desde aquí. */
  serverNow: number;
  account: {
    xp: number;
    credits: number;
    points: number;
    packsOpened: number;
    region: string | null;
    /** Alta de la cuenta (perfil). Sirve para decir «desde cuándo», no para conceder nada. */
    createdAt: string | null;
  };
  /** Nivel de cuenta: SIEMPRE `levelFromXp(profiles.xp)`. */
  level: MetaLevel;
  /** Pase de temporada, misiones, logros y carriles, tal y como los sirve `getProgression`. */
  pass: ProgressionView;
  /** Misiones como objetivos del meta (misma información, ordenada para la pantalla). */
  objectives: MetaObjective[];
  /** Pasos del bucle («qué hacer ahora»), con el pase ya leído. */
  loop: LoopView;
  /** Últimos asientos del libro mayor (todas las clases) y su lectura como recompensas. */
  ledger: LedgerLike[];
  rewards: RewardEntry[];
  unopenedPacks: number;
  decks: { total: number; valid: number };
  duels: { played: number; won: number };
  /** Rating PvP si el jugador tiene ficha; `null` si no se pudo leer. Nunca se calcula aquí. */
  rating: DuelRating | null;
  /** Fase 28 · posición en la escalera PvP (recuento sobre el rating persistido) o `null` si no ha jugado. */
  ladder: { position: number | null; rankedTotal: number } | null;
  ftue: FtueState;
  /**
   * FASE 62 · COLECCIÓN: cartas DISTINTAS del catálogo vigente que posee (`card_id` únicos, de la misma lectura de
   * `loadFacts`), tamaño del catálogo y ejemplares. Lectura pura; sin recompensa propia.
   */
  collection?: CollectionProgress;
  /**
   * La temporada REAL: constante de contenido sin fechas persistidas. `endsAt` es `null` a
   * propósito: no hay cierre publicado y no se inventa uno. La tabla `seasons` no la lee nadie.
   */
  season: {
    id: string;
    name: string;
    maxLevel: number;
    level: number;
    xpIntoLevel: number;
    xpForNext: number;
    progress: number;
    missionsCompleted: number;
    durationDays: number | null;
    endsAt: number | null;
  };
}

export interface MetaResult { ok: boolean; status: number; error?: string; data?: MetaSnapshot }

export async function getMetaSnapshot(admin: SupabaseClient, userId: string): Promise<MetaResult> {
  const now = Date.now();
  const prog = await peekProgression(admin, userId, now);
  if (!prog.ok || !prog.data) return { ok: false, status: prog.status, error: prog.error ?? "No se pudo leer la progresión" };
  const pass = prog.data.view;

  const [profileRes, packsRes, decksRes, ledgerRes, passRowRes, ratingRes, loop, gameRes] = await Promise.all([
    admin.from("profiles").select("xp, credits, points, packs_opened, region, created_at").eq("id", userId).maybeSingle(),
    admin.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0),
    listDecks(admin, userId),
    admin.from("credit_transactions").select("id, delta, reason, ref, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
    admin.from("user_pass").select("state").eq("user_id", userId).maybeSingle(),
    readCompetitivePosition(admin, userId).catch(() => null),
    getLoop(admin, userId, now, pass),
    // Fase 37 · sobres abiertos = `user_game.packs_opened` (la fuente canónica de la Fase 36.1), no `profiles.packs_opened`.
    admin.from("user_game").select("packs_opened").eq("user_id", userId).maybeSingle(),
  ]);

  const p = (profileRes.data ?? null) as {
    xp: number; credits: number; points: number; packs_opened: number; region: string | null; created_at: string | null;
  } | null;
  const packsOpened = (gameRes.data as { packs_opened: number } | null)?.packs_opened ?? 0;
  const xp = p?.xp ?? 0;
  const unopenedPacks = ((packsRes.data ?? []) as { qty: number }[]).reduce((s, r) => s + r.qty, 0);
  const decks = decksRes.ok ? (decksRes.data?.decks ?? []) : [];
  const ledger = ((ledgerRes.data ?? []) as LedgerLike[]);
  const missionsCompleted = ((passRowRes.data as { state?: { missionsCompleted?: number } } | null)?.state?.missionsCompleted) ?? 0;
  const level = accountLevel(xp);
  const objectives = sortObjectives(pass.missions as MetaObjective[]);
  const calendar = resolveCalendar(SEASON_CALENDAR, now);
  const seasonEntry = calendar.ok ? calendar.seasons.find((s) => s.passSeasonId === pass.season.id) ?? null : null;

  return {
    ok: true,
    status: 200,
    data: {
      serverNow: now,
      account: {
        xp, credits: p?.credits ?? 0, points: p?.points ?? 0, packsOpened,
        region: p?.region ?? null, createdAt: p?.created_at ?? null,
      },
      level,
      pass,
      objectives,
      loop,
      ledger,
      rewards: rewardHistory(ledger, 8),
      unopenedPacks,
      decks: { total: decks.length, valid: decks.filter((d) => d.valid).length },
      duels: loop.duels,
      rating: ratingRes && ratingRes.ok && ratingRes.data?.row ? {
        rating: ratingRes.data.row.rating, gamesPlayed: ratingRes.data.row.games_played, wins: ratingRes.data.row.wins,
        losses: ratingRes.data.row.losses, draws: ratingRes.data.row.draws, provisional: isProvisional(ratingRes.data.row.games_played),
        updatedAt: Date.parse(ratingRes.data.row.updated_at) || 0,
      } : null,
      // Fase 28: la posición ya la trae el bucle (una sola lectura), no se recuenta aquí.
      ladder: loop.competitive ? { position: loop.competitive.position, rankedTotal: loop.competitive.rankedTotal } : null,
      collection: collectionProgress(prog.data.ownedCardIds, CARDS.map((c) => c.id), prog.data.ownedInstances),
      ftue: ftueState({
        packsOpened,
        duelsPlayed: loop.duels.played,
        hasValidDeck: decks.some((d) => d.valid),
        level: level.level,
        unopenedPacks,
      }),
      season: {
        id: pass.season.id, name: pass.season.name, maxLevel: pass.season.maxLevel,
        level: pass.level, xpIntoLevel: pass.xpIntoLevel, xpForNext: pass.xpForNext, progress: pass.progress,
        missionsCompleted,
        durationDays: CURRENT_SEASON.durationDays ?? null,
        // Fase 34: el cierre sale del calendario canónico (`data/seasonCalendar`), con el reloj del servidor.
        endsAt: seasonEntry ? seasonEntry.endsAtMs : null,
      },
    },
  };
}
