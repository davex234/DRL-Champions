/**
 * F89 · CARRERA DEL JUGADOR — dominio puro (estadísticas, rachas, momentos destacados e historial).
 *
 * Fuente canónica ÚNICA: `duel_matches` (las partidas reales de Valorosters), con las MISMAS reglas de desenlace que el
 * competitivo (`outcomeFor` / `letterOf` de la Fase 28):
 *   · cuenta una partida TERMINADA con desenlace: victoria, derrota o empate, incluidos abandono y tiempo agotado (que
 *     el competitivo ya asigna a un bando). Lo que está en curso o sin resolver NO cuenta (ni en el denominador).
 *   · % de victorias = victorias / (victorias + derrotas + empates), entero redondeado (`winrate` de la Fase 28).
 *
 * Modos (los reales de `duel_matches.mode`):
 *   RANKED   = PVP (escalera)              → público (ya lo era en /competitivo)
 *   PVE      = contra la IA (incl. campaña) → público (no involucra a otra persona)
 *   DRAFT    = DRAFT_GAUNTLET               → público
 *   PRIVATE  = PVP_PRIVATE (duelos entre amigos) → SOLO en el perfil propio (como desde la Fase 31)
 *   TOURNAMENT = PVP_PRIVATE enlazada a un cruce de torneo (F86.1, `domain/cups/matchKind`) → categoría PROPIA, nunca
 *              mezclada con los amistosos. Solo en la carrera propia (la historia pública de torneos vive en /copas).
 * El Entrenador (Coach) es entrenamiento y vive en otra tabla: no es una partida de carrera.
 *
 * Sin React, sin red, sin reloj implícito.
 */
import { letterOf, outcomeFor, OUTCOME_LABEL, winrate, type MatchFacts, type MatchOutcome } from "@/domain/pvpLadder/ladder";
import { duelKind } from "@/domain/cups/matchKind";

export type CareerMode = "RANKED" | "PVE" | "DRAFT" | "PRIVATE" | "TOURNAMENT";
export const DB_MODE: Record<CareerMode, string> = { RANKED: "PVP", PVE: "PVE", DRAFT: "DRAFT_GAUNTLET", PRIVATE: "PVP_PRIVATE", TOURNAMENT: "PVP_PRIVATE" };
export const MODE_LABEL: Record<CareerMode, string> = { RANKED: "Ranked", PVE: "Contra la IA", DRAFT: "Draft Gauntlet", PRIVATE: "Duelo privado", TOURNAMENT: "Torneo" };
export const PUBLIC_MODES: readonly CareerMode[] = ["RANKED", "PVE", "DRAFT"];
export const SELF_MODES: readonly CareerMode[] = ["RANKED", "PVE", "DRAFT", "PRIVATE", "TOURNAMENT"];

/** Modo de carrera de una fila: la regla única de `duelKind` (un cruce de torneo NUNCA cuenta como duelo privado). */
export function careerModeOf(dbMode: string, isCupGame = false): CareerMode | null {
  return duelKind(dbMode, isCupGame);
}

/** Una fila ligera de `duel_matches` (sin `state`): lo justo para el desenlace y la fecha. */
export interface CareerMatchFact extends MatchFacts {
  matchId: string;
  mode: CareerMode;
  /** Instante del cierre (updated_at / closed_at), ms. */
  at: number;
}

export interface ModeRecord { played: number; wins: number; losses: number; draws: number; winrate: number | null }

export interface CareerStats {
  total: ModeRecord;
  byMode: Partial<Record<CareerMode, ModeRecord>>;
  /** Racha actual (las más recientes primero): «3 victorias seguidas». `null` sin partidas. */
  currentStreak: { kind: "W" | "L" | "D"; n: number } | null;
  /** Mejor racha de VICTORIAS de la historia contada. 0 sin victorias. */
  bestWinStreak: number;
  /** Modos incluidos en el cálculo (lo dice la API: público ≠ propio). */
  modes: CareerMode[];
  /** Cuántas filas se leyeron y si se llegó al tope (honestidad: si `capped`, los totales son «al menos»). */
  sample: { read: number; capped: boolean };
}

const emptyRecord = (): ModeRecord => ({ played: 0, wins: 0, losses: 0, draws: 0, winrate: null });

function add(r: ModeRecord, l: "W" | "L" | "D") {
  r.played++;
  if (l === "W") r.wins++; else if (l === "L") r.losses++; else r.draws++;
  r.winrate = winrate(r.wins, r.losses, r.draws);
}

/** Letra del jugador en una partida contada, o `null` si no cuenta. */
export const letterFor = (m: MatchFacts, userId: string): "W" | "L" | "D" | null => letterOf(outcomeFor(m, userId));

export function careerStats(matches: readonly CareerMatchFact[], userId: string, modes: readonly CareerMode[], sample: { read: number; capped: boolean }): CareerStats {
  const allowed = new Set(modes);
  const counted = matches
    .filter((m) => allowed.has(m.mode))
    .map((m) => ({ m, l: letterFor(m, userId) }))
    .filter((x): x is { m: CareerMatchFact; l: "W" | "L" | "D" } => x.l !== null)
    .sort((a, b) => b.m.at - a.m.at || b.m.matchId.localeCompare(a.m.matchId));
  const total = emptyRecord();
  const byMode: Partial<Record<CareerMode, ModeRecord>> = {};
  for (const { m, l } of counted) {
    add(total, l);
    add((byMode[m.mode] ??= emptyRecord()), l);
  }
  let currentStreak: CareerStats["currentStreak"] = null;
  if (counted.length) {
    const kind = counted[0].l;
    let n = 0;
    while (n < counted.length && counted[n].l === kind) n++;
    currentStreak = { kind, n };
  }
  let best = 0, run = 0;
  for (const { l } of [...counted].reverse()) { run = l === "W" ? run + 1 : 0; best = Math.max(best, run); }
  return { total, byMode, currentStreak, bestWinStreak: best, modes: [...modes], sample };
}

/* ───────────────────────────── momentos destacados ───────────────────────────── */

export const MATCH_MILESTONES = [10, 25, 50, 100, 250, 500, 1000] as const;

export type HighlightKind = "FIRST_MATCH" | "FIRST_WIN" | "MATCH_MILESTONE" | "COLLECTION_COMPLETED";

export interface CareerHighlight { id: string; kind: HighlightKind; at: number; title: string; detail: string; href: string | null; logo: string | null }

/** Día UTC: lo público se fecha al día, nunca a la hora. */
export const dayOfMs = (ms: number): number => Math.floor(ms / 86_400_000) * 86_400_000;

/**
 * Solo hechos REALES y fechados: la primera partida contada, la primera victoria, los hitos de partidas (la partida N
 * cuando se alcanzó, en orden cronológico) y las colecciones completadas (F82, `user_collection_completions`). Si la
 * lectura llegó al tope (`capped`), los «primeros» no son fiables y NO se emiten.
 */
export function careerHighlights(input: {
  matches: readonly CareerMatchFact[]; userId: string; modes: readonly CareerMode[]; capped: boolean;
  completions: readonly { setId: string; title: string; kind: string; logo: string | null; completedAt: number }[];
  max?: number;
}): CareerHighlight[] {
  const allowed = new Set(input.modes);
  const counted = input.matches.filter((m) => allowed.has(m.mode)).map((m) => ({ m, l: letterFor(m, input.userId) }))
    .filter((x) => x.l !== null).sort((a, b) => a.m.at - b.m.at || a.m.matchId.localeCompare(b.m.matchId));
  const out: CareerHighlight[] = [];
  if (!input.capped && counted.length) {
    const first = counted[0];
    out.push({ id: "first-match", kind: "FIRST_MATCH", at: dayOfMs(first.m.at), title: "Primera partida", detail: MODE_LABEL[first.m.mode], href: null, logo: null });
    const win = counted.find((x) => x.l === "W");
    if (win) out.push({ id: "first-win", kind: "FIRST_WIN", at: dayOfMs(win.m.at), title: "Primera victoria", detail: MODE_LABEL[win.m.mode], href: null, logo: null });
    for (const n of MATCH_MILESTONES) {
      if (counted.length < n) break;
      out.push({ id: `matches-${n}`, kind: "MATCH_MILESTONE", at: dayOfMs(counted[n - 1].m.at), title: `${n} partidas`, detail: "Partidas terminadas en Valorosters", href: null, logo: null });
    }
  }
  for (const c of input.completions) {
    out.push({
      id: `set-${c.setId}`, kind: "COLLECTION_COMPLETED", at: dayOfMs(c.completedAt),
      title: `${c.title} completado`, detail: c.kind === "TEAM" ? "Colección de equipo" : "Colección de edición",
      href: `/coleccion/trofeos/${encodeURIComponent(c.setId)}`, logo: c.logo,
    });
  }
  return out.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, input.max ?? 8);
}

/* ───────────────────────────── historial ───────────────────────────── */

export const HISTORY_PAGE = 10;

export interface HistoryRowFact extends CareerMatchFact {
  scoreA: number;
  scoreB: number;
  difficulty: string | null;
}

export interface HistoryItem {
  matchId: string;
  /** Día del cierre (público) — el detalle exacto vive en la partida. */
  day: number;
  mode: CareerMode;
  modeLabel: string;
  letter: "W" | "L" | "D" | null;
  outcomeLabel: string;
  scoreYou: number;
  scoreRival: number;
  opponent: { kind: "PLAYER"; profileId: string; username: string; avatar: string } | { kind: "AI"; label: string };
  /** Enlace a una vista YA existente y autorizada para quien mira (solo el propio jugador); si no, `null`. */
  href: string | null;
}

/** `duel_matches.difficulty` real: EASY / NORMAL / HARD. */
const AI_LABEL: Record<string, string> = { EASY: "IA · fácil", NORMAL: "IA · normal", HARD: "IA · difícil" };

export function historyItem(r: HistoryRowFact, userId: string, rival: { userId: string; username: string; avatar: string } | null, isSelf: boolean): HistoryItem {
  const o: MatchOutcome = outcomeFor(r, userId);
  const side = r.playerAId === userId ? "A" : "B";
  const human = r.mode === "RANKED" || r.mode === "PRIVATE" || r.mode === "TOURNAMENT";
  return {
    matchId: r.matchId, day: dayOfMs(r.at), mode: r.mode, modeLabel: MODE_LABEL[r.mode], letter: letterOf(o), outcomeLabel: OUTCOME_LABEL[o],
    scoreYou: side === "A" ? r.scoreA : r.scoreB, scoreRival: side === "A" ? r.scoreB : r.scoreA,
    opponent: human
      ? { kind: "PLAYER", profileId: rival?.userId ?? "", username: rival?.username ?? "Jugador", avatar: rival?.avatar ?? "🎮" }
      : { kind: "AI", label: r.mode === "DRAFT" ? "Draft Gauntlet · IA" : AI_LABEL[(r.difficulty ?? "").toUpperCase()] ?? "IA" },
    href: !isSelf ? null : r.mode === "RANKED" ? `/duelos/competitivo/partida/${r.matchId}` : r.mode === "PVE" ? `/duelos/replay/${r.matchId}` : null,
  };
}

/** Cursor de la página siguiente: el instante de la última fila si la página vino llena. */
export const nextCursor = (rows: readonly { at: number }[], pageSize = HISTORY_PAGE): number | null =>
  rows.length >= pageSize ? rows[rows.length - 1].at : null;
