/**
 * FIXTURES QA SYNTHETIC · FASE 27 — solo para el arnés `/design-system/fase27` y sus capturas.
 *
 * Construyen `MetaSnapshot`s con la MISMA forma que devuelve `GET /api/game/meta`, sobre contenido
 * REAL (temporada `CURRENT_SEASON`, pool de misiones, catálogo de logros, curva `levelFromXp`) y
 * con cifras inventadas y etiquetadas. Nunca se escriben en ninguna base de datos ni se envían.
 */
import { CURRENT_SEASON } from "@/data/season";
import { trackOf, type PassTrack } from "@/battlepass";
import { ACHIEVEMENTS } from "@/domain/progression/achievements";
import { totalXpForLevel } from "@/domain/progression/levels";
import { accountLevel, ftueState, rewardHistory, sortObjectives, type LedgerLike, type MetaObjective } from "@/domain/progression/meta";
import { expiresAt } from "@/domain/progression/periods";
import type { MetaSnapshot } from "@/server/services/meta";
import type { AchievementView, PassTrackLevelView, ProgressionView } from "@/server/services/progression";
import type { LoopView } from "@/server/services/loop";

export const QA_NOW = Date.UTC(2026, 8, 14, 15, 30); // 2026-09-14 15:30Z, fijo para capturas estables

function track(t: PassTrack, level: number, claimedUpTo: number, open: boolean): PassTrackLevelView[] {
  const tr = trackOf(CURRENT_SEASON, t);
  return Object.keys(tr).map(Number).sort((a, b) => a - b).map((l) => ({
    level: l, reward: tr[l], claimed: l <= claimedUpTo, claimable: open && l <= level && l > claimedUpTo,
  }));
}

function objective(id: string, current: number, claimed = false, assignedAt = QA_NOW - 3 * 3600_000): MetaObjective {
  const def = CURRENT_SEASON.missionPool.find((m) => m.id === id)!;
  return {
    id, label: def.label, kind: def.kind, current: Math.min(current, def.goal), goal: def.goal,
    complete: current >= def.goal, claimed, rewardCredits: def.reward.credits ?? 0, xp: def.xp, metric: def.metric,
    packId: def.reward.packId ?? null, packCount: def.reward.packId ? def.reward.packCount ?? 1 : 0,
    assignedAt, expiresAt: expiresAt(def.kind, assignedAt),
  };
}

function achievement(id: string, current: number, claimed = false, claimedAt: string | null = null): AchievementView {
  const a = ACHIEVEMENTS.find((x) => x.id === id)!;
  return { id, name: a.name, description: a.description, icon: a.icon, reward: a.reward, goal: a.goal, current: Math.min(current, a.goal), complete: current >= a.goal, claimed, claimedAt };
}

const ledgerRow = (i: number, reason: string, ref: string, delta: number, hoursAgo: number): LedgerLike => ({
  id: `qa-ledger-${i}`, reason, ref, delta, created_at: new Date(QA_NOW - hoursAgo * 3600_000).toISOString(),
});

export interface QaProfile {
  xp: number; passXp: number; points: number; packsOpened: number; duelsPlayed: number; duelsWon: number;
  unopenedPacks: number; decks: { total: number; valid: number }; objectives: MetaObjective[]; achievements: AchievementView[];
  ledger: LedgerLike[]; claimedFreeUpTo: number; steps: LoopView["steps"]; pendingPicks: number; rating: MetaSnapshot["rating"];
}

export function snapshotFrom(p: QaProfile): MetaSnapshot {
  const passLevel = Math.min(CURRENT_SEASON.maxLevel, Math.floor(p.passXp / CURRENT_SEASON.xpPerLevel));
  const xpInto = p.passXp - passLevel * CURRENT_SEASON.xpPerLevel;
  const competitiveUnlocked = p.points >= (CURRENT_SEASON.competitiveMinPoints ?? Infinity);
  const level = accountLevel(p.xp);
  const claimable = p.objectives.filter((o) => o.complete && !o.claimed).length
    + p.achievements.filter((a) => a.complete && !a.claimed).length
    + track("free", passLevel, p.claimedFreeUpTo, true).filter((l) => l.claimable).length;
  const pass: ProgressionView = {
    serverNow: QA_NOW,
    season: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, maxLevel: CURRENT_SEASON.maxLevel },
    level: passLevel, xp: p.passXp, xpIntoLevel: xpInto, xpForNext: CURRENT_SEASON.xpPerLevel, progress: xpInto / CURRENT_SEASON.xpPerLevel,
    premium: false, competitiveUnlocked, competitiveMinPoints: CURRENT_SEASON.competitiveMinPoints ?? 0, points: p.points,
    equipped: {}, cosmetics: [],
    tracks: {
      free: track("free", passLevel, p.claimedFreeUpTo, true),
      competitive: track("competitive", passLevel, 0, competitiveUnlocked),
      premium: track("premium", passLevel, 0, false),
    },
    missions: p.objectives,
    achievements: p.achievements,
  };
  const loop: LoopView = {
    steps: p.steps,
    rank: { points: p.points, label: "QA", tierId: "bronce", color: "#c08a4f", progress: 0.3, toNext: 50, nextLabel: "Plata", unranked: p.points === 0 },
    circuit: p.pendingPicks > 0 ? { eventId: "qa-event", name: "QA SYNTHETIC · Torneo", isDemo: true, status: "ongoing", liveMatch: null, openQuestions: p.pendingPicks, pendingPicks: p.pendingPicks } : null,
    duels: { played: p.duelsPlayed, won: p.duelsWon },
    progression: { activeObjectives: p.objectives.filter((o) => !o.claimed).length, claimable },
    competitive: p.rating ? { rating: p.rating.rating, gamesPlayed: p.rating.gamesPlayed, provisional: p.rating.provisional, position: 124, rankedTotal: 500 } : null,
  };
  return {
    serverNow: QA_NOW,
    account: { xp: p.xp, credits: 6000, points: p.points, packsOpened: p.packsOpened, region: null, createdAt: new Date(QA_NOW - 20 * 86400_000).toISOString() },
    level,
    pass,
    objectives: sortObjectives(p.objectives),
    loop,
    ledger: p.ledger,
    rewards: rewardHistory(p.ledger, 8),
    unopenedPacks: p.unopenedPacks,
    decks: p.decks,
    duels: { played: p.duelsPlayed, won: p.duelsWon },
    rating: p.rating,
    ladder: p.rating ? { position: 124, rankedTotal: 500 } : null,
    ftue: ftueState({ packsOpened: p.packsOpened, duelsPlayed: p.duelsPlayed, hasValidDeck: p.decks.valid > 0, level: level.level, unopenedPacks: p.unopenedPacks }),
    season: {
      id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, maxLevel: CURRENT_SEASON.maxLevel,
      level: passLevel, xpIntoLevel: xpInto, xpForNext: CURRENT_SEASON.xpPerLevel, progress: xpInto / CURRENT_SEASON.xpPerLevel,
      missionsCompleted: p.objectives.filter((o) => o.claimed).length, durationDays: CURRENT_SEASON.durationDays ?? null, endsAt: null,
    },
  };
}

/* ───────────────────────────── perfiles QA ───────────────────────────── */

const STEP = (id: string, kind: LoopView["steps"][number]["kind"], label: string, detail: string, href: string, priority: number, count?: number, urgent?: boolean) =>
  ({ id, kind, label, detail, href, priority, count, urgent });

/** Cuenta nueva: 6.000 créditos, nivel 1, 0 puntos, 3 sobres iniciales + 1 estándar, sin duelos. */
export const NEW_PLAYER: QaProfile = {
  xp: 0, passXp: 0, points: 0, packsOpened: 0, duelsPlayed: 0, duelsWon: 0, unopenedPacks: 4, decks: { total: 0, valid: 0 },
  objectives: [objective("d-abrir-1", 0), objective("d-duelo-1", 0), objective("d-duelo-win", 0), objective("w-duelos-5", 0), objective("w-sobres-10", 0), objective("s-mazo", 0), objective("s-region", 0), objective("p-coleccion-50", 0)],
  achievements: ACHIEVEMENTS.map((a) => achievement(a.id, 0)),
  ledger: [ledgerRow(1, "starter_grant", "starter:qa", 6000, 0.2)],
  claimedFreeUpTo: 0,
  steps: [STEP("open-packs", "open", "Abre tus sobres", "Tienes 4 sobres de bienvenida. Ábrelos y empieza tu colección.", "/inventario", 0, 4), STEP("build-deck", "build", "Construye tu mazo", "Necesitas diez cartas para competir.", "/inventario", 5)],
  pendingPicks: 0, rating: null,
};

/** Jugador con progreso: nivel 5, objetivos a medias, un logro pendiente de recoger, recompensas reales. */
export const PROGRESSED: QaProfile = {
  xp: totalXpForLevel(5) + 311, passXp: 7_400, points: 214, packsOpened: 41, duelsPlayed: 27, duelsWon: 15, unopenedPacks: 2, decks: { total: 2, valid: 1 },
  objectives: [
    objective("d-duelo-win", 1), objective("d-abrir-1", 0), objective("d-pickem-1", 1, true),
    objective("w-duelos-5", 3), objective("w-victorias", 1), objective("s-duelos-25", 25), objective("s-mazo", 1, true),
    objective("s-region", 0), objective("p-coleccion-50", 38), objective("p-puntos-400", 214),
  ],
  achievements: [
    achievement("sobres-100", 41), achievement("sobres-1000", 41), achievement("primer-mvp", 1), achievement("primer-icon", 0),
    achievement("coleccionista", 40, true, new Date(QA_NOW - 5 * 86400_000).toISOString()), achievement("completa-heretics", 3), achievement("completa-emea", 0),
  ],
  ledger: [
    ledgerRow(1, "duel_win", "duel:qa-1", 220, 1), ledgerRow(2, "mission_reward", "mission:nexus-s1:d-pickem-1:1:0", 200, 3),
    ledgerRow(3, "pass_reward", "pass:nexus-s1:free:5", 600, 20), ledgerRow(4, "achievement", "achievement:coleccionista", 4000, 120),
    ledgerRow(5, "pickem_reward:acertante", "pickem:00000000-0000-4000-8000-000000000001:acertante", 1500, 200),
    ledgerRow(6, "buy_pack:estandar", "buy:qa", -800, 210), ledgerRow(7, "duel_capped_loss", "duel:qa-2", 0, 260),
    ledgerRow(8, "starter_grant", "starter:qa", 6000, 480),
  ],
  claimedFreeUpTo: 5,
  steps: [
    STEP("claim", "claim", "Reclama lo tuyo", "2 niveles del pase · 1 misión · 1 logro sin reclamar.", "/logros", 3, 4),
    STEP("predict", "predict", "Haz tus predicciones", "3 partidos abiertos en QA SYNTHETIC · Torneo.", "/pickems", 2, 3, true),
    STEP("open-packs", "open", "Abre tus sobres", "Tienes 2 sobres sin abrir.", "/inventario", 4, 2),
    STEP("play-duel", "play", "Juega un duelo", "Ganar en normal suma 14 puntos hacia Plata.", "/duelos/jugar", 6),
    STEP("circuit", "explore", "Sigue el circuito", "QA SYNTHETIC · Torneo", "/torneos/qa-event", 7),
  ],
  pendingPicks: 3, rating: { rating: 1024, gamesPlayed: 6, wins: 4, losses: 2, draws: 0, provisional: true, updatedAt: QA_NOW - 3600_000 },
};

/** A un paso del nivel 6 (faltan 12 XP). */
export const NEAR_LEVEL_UP: QaProfile = { ...PROGRESSED, xp: totalXpForLevel(6) - 12 };
/** Acaba de subir al nivel 6 (lectura «después»). */
export const JUST_LEVELED: QaProfile = { ...PROGRESSED, xp: totalXpForLevel(6) + 40 };
/** Sin recompensas todavía y sin objetivos activos. */
export const NO_REWARDS: QaProfile = { ...NEW_PLAYER, packsOpened: 2, unopenedPacks: 0, ledger: [], objectives: [], steps: [STEP("play-duel", "play", "Juega un duelo", "Gana tu primer duelo y entra en la escalera de rango.", "/duelos/jugar", 6)] };
/** Jugador que vuelve tras días: recompensas pendientes, tanda nueva, un sobre. */
export const RETURNING: QaProfile = { ...PROGRESSED, objectives: PROGRESSED.objectives.map((o) => ({ ...o, assignedAt: QA_NOW - 20 * 60_000, expiresAt: expiresAt(o.kind as never, QA_NOW - 20 * 60_000) })) };
