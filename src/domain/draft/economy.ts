/**
 * DRAFT GAUNTLET · ECONOMÍA (F72) — PURA. La entrada en créditos y la tabla de recompensas del modo.
 *
 * AISLADA: no toca precios de sobres, recompensas de duelo, starter, desguace ni ninguna otra fuente o sumidero. Solo
 * define lo que cobra y paga ESTE modo, y las claves de idempotencia con las que el servidor lo hace (`draftEconomy`).
 *
 * POR QUÉ ESTOS NÚMEROS (medido con `scripts/_f72-draft-winrates.ts` + `_f72-draft-economy.ts`, motor real):
 *   · Un jugador con la heurística completa del bot (SMART) completa el gauntlet ~67 % de las veces; con la cota
 *     imposible «ve el mazo rival» (ORACLE), ~82 %. La tabla BASE tiene valor esperado NEGATIVO incluso para ORACLE:
 *     ni un bot perfecto imprime créditos repitiendo runs.
 *   · El GRAN PREMIO «tocho» es un Sobre Masters, pero solo en la PRIMERA run completada de cada semana ISO (clave de
 *     idempotencia por semana en el libro mayor). Farmear da, como mucho, un sobre por semana; lo demás es la tabla base.
 *   · El título «Campeón del Gauntlet» es cosmético (sin valor económico) y la PK de `user_cosmetics` lo da una vez.
 *   · Sin pérdida doble: abandonar paga lo mismo que perder en esa etapa (victorias conseguidas); nunca devuelve la
 *     entrada. Empatar termina la run como perder (regla F39).
 */
import { GAUNTLET_STAGES } from "./rules";

export const DRAFT_ECONOMY_VERSION = "draft-econ-1";

/** Entrada, en DRL Credits. Se cobra en el servidor (`app_adjust_credits`, suelo 0, idempotente por run). */
export const DRAFT_ENTRY_FEE = 2_000;

/** Créditos por victorias conseguidas: índice = victorias (0…5). */
export const DRAFT_REWARD_CREDITS: readonly number[] = Object.freeze([0, 200, 500, 1_000, 1_600, 2_100]);

/** Cosmético (familia título) de completar el gauntlet. Una vez en la vida (PK de `user_cosmetics`). */
export const DRAFT_CHAMPION_TITLE = "titulo:campeon-gauntlet";

/** Gran premio: sobre existente de la línea principal, una vez por semana ISO (UTC). */
// `packPrice` solo VALORA el premio en `draftExpectedValue` (a precio de tienda; D16 exige que sea el real). El premio es el sobre.
export const DRAFT_JACKPOT = Object.freeze({ packId: "masters", packName: "Sobre Masters", packCount: 1, packPrice: 20_000, period: "ISO_WEEK" as const }); // F80: 5.000 → 20.000

export interface DraftRewardLine { wins: number; credits: number; title: boolean; jackpot: boolean }

export function draftRewardFor(wins: number): DraftRewardLine {
  const w = Math.max(0, Math.min(GAUNTLET_STAGES, Math.trunc(Number.isFinite(wins) ? wins : 0)));
  const complete = w === GAUNTLET_STAGES;
  return { wins: w, credits: DRAFT_REWARD_CREDITS[w] ?? 0, title: complete, jackpot: complete };
}

/** La tabla entera (para enseñarla antes de entrar y para las pruebas). */
export const draftRewardTable = (): DraftRewardLine[] => Array.from({ length: GAUNTLET_STAGES + 1 }, (_, w) => draftRewardFor(w));

/* ───────────────────────────── claves de idempotencia ───────────────────────────── */

/** Una entrada por run: la clave del cargo en `credit_transactions (user_id, ref)`. */
export const entryRef = (runId: string) => `draft:entry:${runId}`;
/** Una recompensa por run. */
export const rewardRef = (runId: string) => `draft:reward:${runId}`;
/** Un gran premio por jugador y semana: la clave del libro mayor ES el tope. */
export const jackpotRef = (userId: string, week: string) => `draft:jackpot:${userId}:${week}`;
/** Motivo del gran premio: nombra la run que lo ganó (así un reintento sabe si es suyo). */
export const jackpotReason = (runId: string) => `draft_jackpot:${runId}`;
export const entryReason = "draft_entry";
export const rewardReason = (wins: number) => `draft_reward:${wins}W`;

/** Semana ISO-8601 en UTC: «2026-W40». Lunes a domingo. */
export function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* ───────────────────────────── estado persistido en la run ───────────────────────────── */

/** `draft_runs.state.entry` — la entrada de ESTA run. Sin `entry` = run anterior a F72 (gratis, sin recompensa). */
export interface DraftEntryState { fee: number; economyVersion: string; paidAt: string | null }

/** `draft_runs.state.reward` — fijada al TERMINAR la run (en la misma escritura que la cierra). */
export interface DraftRewardState {
  economyVersion: string;
  wins: number;
  credits: number;
  title: boolean;
  /** Semana ISO en que la run terminó completada (candidata al gran premio), o `null`. */
  jackpotWeek: string | null;
  /** `null` mientras no se sabe; `true` si esta run se llevó el sobre de su semana; `false` si ya lo tenía otra. */
  jackpot: boolean | null;
  grantedAt: string | null;
}

export function rewardStateFor(wins: number, completedAtMs: number): DraftRewardState {
  const r = draftRewardFor(wins);
  return {
    economyVersion: DRAFT_ECONOMY_VERSION, wins: r.wins, credits: r.credits, title: r.title,
    jackpotWeek: r.jackpot ? isoWeekKey(completedAtMs) : null, jackpot: r.jackpot ? null : false, grantedAt: null,
  };
}

/* ───────────────────────────── lo que ve el cliente ───────────────────────────── */

export interface DraftEconomyView {
  version: string;
  entryFee: number;
  table: DraftRewardLine[];
  jackpot: { packId: string; packName: string; weekly: true };
  title: string;
}

export const draftEconomyView = (): DraftEconomyView => ({
  version: DRAFT_ECONOMY_VERSION, entryFee: DRAFT_ENTRY_FEE, table: draftRewardTable(),
  jackpot: { packId: DRAFT_JACKPOT.packId, packName: DRAFT_JACKPOT.packName, weekly: true }, title: "Campeón del Gauntlet",
});

/* ───────────────────────────── valor esperado (simulación y pruebas) ───────────────────────────── */

/**
 * Valor esperado de UNA run en créditos-equivalentes: tabla base + (opcional) el sobre semanal a su precio de tienda.
 * `dist[k]` = probabilidad de acabar con k victorias. `jackpotShare` = fracción de completadas que se llevan el sobre
 * (1 = la primera de la semana; 0 = ya cobrado esta semana).
 */
export function draftExpectedValue(dist: readonly number[], jackpotShare = 0): { reward: number; ev: number; evPct: number } {
  const reward = dist.reduce((s, p, k) => s + p * (DRAFT_REWARD_CREDITS[k] ?? 0), 0) + (dist[GAUNTLET_STAGES] ?? 0) * jackpotShare * DRAFT_JACKPOT.packPrice;
  return { reward, ev: reward - DRAFT_ENTRY_FEE, evPct: (reward - DRAFT_ENTRY_FEE) / DRAFT_ENTRY_FEE };
}
