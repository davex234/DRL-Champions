/**
 * FASE 42 · LIVE SERVICE — «¿POR QUÉ ABRO NEXUS HOY?» (dominio PURO).
 *
 * No es un segundo Daily Loop ni un segundo motor de prioridad: son funciones puras que `buildDailyLoop` usa para
 * contar, con los MISMOS hechos del servidor, lo temporal del vestíbulo:
 *
 *   · cuándo se renuevan los objetivos (ventanas UTC de `periods`, nunca el reloj ni la zona del cliente);
 *   · qué caduca de verdad y cuánto le queda (urgencia SOLO con un `endsAt` real);
 *   · objetivos de HOY y de ESTA SEMANA por separado, con recompensa real y estado;
 *   · el contexto de vuelta («de vuelta en NEXUS»), derivado de la última actividad REAL (sin recompensa, sin racha,
 *     sin castigo) y como mucho 3 hechos verdaderos;
 *   · el progreso reciente, de asientos y operaciones fechados por el servidor;
 *   · la razón corta de cada recomendación («¿por qué esto?»).
 *
 * Sin React, sin red, sin `Date.now()`: el reloj (`now`) llega del servidor.
 */
import type { MetaObjective } from "@/domain/progression/meta";
import { liveObjective } from "@/domain/progression/meta";
import { periodWindow } from "@/domain/progression/periods";
import { ns, td } from "@/i18n/runtime";

const t = ns("liveService");

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

/* ───────────────────────────── urgencia ───────────────────────────── */

export type Urgency = "NORMAL" | "SOON" | "VERY_SOON";
/** Umbrales: «muy pronto» ≤ 2 h, «pronto» ≤ 12 h. Derivados, nunca persistidos. */
export const URGENCY_WINDOWS = { VERY_SOON: 2 * HOUR, SOON: 12 * HOUR } as const;

/** Urgencia de algo que termina en `endsAt`. `null` si no hay fin real o ya terminó (nunca urgencia inventada). */
export function urgencyOf(endsAt: number | null | undefined, now: number): Urgency | null {
  if (typeof endsAt !== "number" || !Number.isFinite(endsAt) || endsAt <= now) return null;
  const left = endsAt - now;
  if (left <= URGENCY_WINDOWS.VERY_SOON) return "VERY_SOON";
  if (left <= URGENCY_WINDOWS.SOON) return "SOON";
  return "NORMAL";
}

export const URGENCY_LABEL: Record<Urgency, string> = { NORMAL: "Con tiempo", SOON: "Pronto", VERY_SOON: "Muy pronto" };

/** «2 h 14 min», «45 min», «3 d 4 h». Solo formato; `null` si no queda tiempo. */
export function remainingText(endsAt: number | null | undefined, now: number): string | null {
  if (typeof endsAt !== "number" || endsAt <= now) return null;
  const ms = endsAt - now;
  const d = Math.floor(ms / DAY); const h = Math.floor((ms % DAY) / HOUR); const m = Math.floor((ms % HOUR) / 60_000);
  if (d >= 1) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h >= 1) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${Math.max(1, m)} min`;
}

/** «Se renueva en 6 h 12 min» (cuenta atrás hacia un reset real del servidor). */
export const resetText = (endsAt: number, now: number) => {
  const r = remainingText(endsAt, now);
  return r ? t("Se renueva en {r}", { r: td(r) }) : t("Renovándose ahora");
};

/* ───────────────────────────── resets ───────────────────────────── */

export interface ResetWindows { dailyStartsAt: number; dailyEndsAt: number; weeklyStartsAt: number; weeklyEndsAt: number }

/** Ventanas vigentes (UTC; diaria 00:00Z, semanal lunes 00:00Z). */
export function resetWindows(now: number): ResetWindows {
  const d = periodWindow("daily", now)!; const w = periodWindow("weekly", now)!;
  return { dailyStartsAt: d.startsAt, dailyEndsAt: d.endsAt, weeklyStartsAt: w.startsAt, weeklyEndsAt: w.endsAt };
}

/** Cuántos resets de ese tipo han ocurrido entre `from` y `to` (límites UTC cruzados). */
export function resetsBetween(kind: "daily" | "weekly", from: number, to: number): number {
  if (to <= from) return 0;
  const a = periodWindow(kind, from)!.startsAt; const b = periodWindow(kind, to)!.startsAt;
  return Math.round((b - a) / (kind === "daily" ? DAY : 7 * DAY));
}

/* ───────────────────────────── objetivos de hoy y de la semana ───────────────────────────── */

export type ObjectiveStatus = "CLAIMABLE" | "CLAIMED" | "IN_PROGRESS";

export interface ObjectiveCard {
  id: string;
  kind: "daily" | "weekly";
  label: string;
  metric: string;
  current: number;
  goal: number;
  status: ObjectiveStatus;
  /** Recompensa REAL de su definición («250 créditos · 200 XP del pase»). */
  reward: string;
  endsAt: number | null;
  progressLabel: string;
}

export function rewardText(o: Pick<MetaObjective, "rewardCredits" | "xp" | "packId" | "packCount">, packName: (id: string) => string = (id) => id): string {
  const parts: string[] = [];
  if (o.rewardCredits > 0) parts.push(`${o.rewardCredits} créditos`);
  if (o.packId) parts.push(`${o.packCount > 1 ? `${o.packCount} × ` : ""}${packName(o.packId)}`);
  if (o.xp > 0) parts.push(t("{xp} XP del pase", { xp: o.xp }));
  return parts.join(" · ") || t("Sin recompensa");
}

/** Objetivos vivos de un tipo, en orden estable: reclamables, en progreso (más avanzados primero), cobrados. */
export function objectiveCards(list: readonly MetaObjective[], kind: "daily" | "weekly", now: number, packName?: (id: string) => string): ObjectiveCard[] {
  const rank: Record<ObjectiveStatus, number> = { CLAIMABLE: 0, IN_PROGRESS: 1, CLAIMED: 2 };
  return list
    .filter((o) => o.kind === kind && o.goal > 0 && liveObjective(o, now))
    .map((o): ObjectiveCard => {
      const status: ObjectiveStatus = o.claimed ? "CLAIMED" : o.complete ? "CLAIMABLE" : "IN_PROGRESS";
      const current = Math.min(o.current, o.goal);
      return { id: o.id, kind, label: o.label, metric: o.metric, current, goal: o.goal, status, reward: rewardText(o, packName), endsAt: o.expiresAt, progressLabel: `${current} / ${o.goal}` };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.current / b.goal) - (a.current / a.goal) || a.id.localeCompare(b.id));
}

/** ¿Toda la tanda está hecha (cobrada)? Una tanda vacía no está «hecha». */
export const allDone = (cards: readonly ObjectiveCard[]) => cards.length > 0 && cards.every((c) => c.status === "CLAIMED");

/* ───────────────────────────── caducidades reales ───────────────────────────── */

export interface ExpiringItem {
  id: string;
  label: string;
  detail: string;
  endsAt: number;
  urgency: Urgency;
  href: string;
  source: "pickems" | "objective" | "claim" | "season" | "challenge";
}

export interface ExpiringInput {
  now: number;
  pickem: { eventName: string | null; pending: number; nextLockAt: number | null } | null;
  today: readonly ObjectiveCard[];
  thisWeek: readonly ObjectiveCard[];
  seasonEndsAt: number | null;
  routes: { pickems: string; claims: string; objective: (metric: string) => string; season: string };
}

/**
 * Lo que termina DE VERDAD, del más cercano al más lejano (máx. `max`). Solo con `endsAt` real: un Pick'em con
 * preguntas pendientes y cierre conocido, un objetivo cobrable antes del reset, un objetivo en progreso que se
 * renueva «muy pronto» y la temporada en su última semana. Nada más. Fase 42 (QA real): lo que cierra con holgura
 * (> 12 h, NORMAL) no entra en «Termina pronto» — un Pick'em a 7 días no es «pronto»; sigue en sus acciones.
 */
export function expiringItems(i: ExpiringInput, max = 3): ExpiringItem[] {
  const out: ExpiringItem[] = [];
  const push = (x: Omit<ExpiringItem, "urgency">) => { const u = urgencyOf(x.endsAt, i.now); if (u && u !== "NORMAL") out.push({ ...x, urgency: u }); };
  if (i.pickem && i.pickem.pending > 0 && i.pickem.nextLockAt !== null) {
    push({ id: "pickem", label: i.pickem.eventName ? t("Pick'em · {eventName}", { eventName: td(i.pickem.eventName) }) : t("Pick'em"), detail: t("{pending} {v} · cierra en {nextLockAt}", { pending: i.pickem.pending, v: i.pickem.pending === 1 ? t("predicción pendiente") : t("predicciones pendientes"), nextLockAt: remainingText(i.pickem.nextLockAt, i.now) }), endsAt: i.pickem.nextLockAt, href: i.routes.pickems, source: "pickems" });
  }
  for (const c of [...i.today, ...i.thisWeek]) {
    if (c.endsAt === null) continue;
    if (c.status === "CLAIMABLE") push({ id: `claim:${c.id}`, label: c.label, detail: t("Completado · recógelo antes de que se renueve ({endsAt})", { endsAt: remainingText(c.endsAt, i.now) }), endsAt: c.endsAt, href: i.routes.claims, source: "claim" });
    else if (c.status === "IN_PROGRESS" && urgencyOf(c.endsAt, i.now) === "VERY_SOON" && c.current > 0) push({ id: `objective:${c.id}`, label: c.label, detail: t("{progressLabel} · se renueva en {endsAt}", { progressLabel: td(c.progressLabel), endsAt: remainingText(c.endsAt, i.now) }), endsAt: c.endsAt, href: i.routes.objective(c.metric), source: "objective" });
  }
  if (i.seasonEndsAt !== null && i.seasonEndsAt - i.now <= 7 * DAY && i.seasonEndsAt > i.now) {
    out.push({ id: "season", label: t("La temporada termina"), detail: t("Quedan {seasonEndsAt}", { seasonEndsAt: remainingText(i.seasonEndsAt, i.now) }), endsAt: i.seasonEndsAt, urgency: urgencyOf(i.seasonEndsAt, i.now) ?? "NORMAL", href: i.routes.season, source: "season" });
  }
  return out.sort((a, b) => a.endsAt - b.endsAt || a.id.localeCompare(b.id)).slice(0, max);
}

/* ───────────────────────────── vuelta y progreso reciente ───────────────────────────── */

export interface RecentFact { id: string; label: string; at: number }

export interface ReturningInput {
  now: number;
  lastActivityAt: number | null;
  today: readonly ObjectiveCard[];
  thisWeek: readonly ObjectiveCard[];
  activeMatch: boolean;
  draftRun: { status: string; stage: number } | null;
  pickem: { eventName: string | null; pending: number; nextLockAt: number | null } | null;
  liveEventName: string | null;
  claimable: number;
  seasonEndsAt: number | null;
}

export interface ReturningContext {
  daysAway: number;
  lastActivityAt: number;
  dailyResets: number;
  weeklyResets: number;
  /** Como mucho 3 hechos, todos verdaderos AHORA. Sin «has perdido», sin rachas. */
  facts: string[];
}

export const RETURNING_MIN_DAYS = 1;
export const RETURNING_MAX_FACTS = 3;

/**
 * Contexto de vuelta: SOLO si la última actividad real fue hace ≥ 1 día. Ninguna recompensa, ninguna racha, ninguna
 * lista de lo perdido: qué importa AHORA, priorizando lo que sigue abierto.
 */
export function returningContext(i: ReturningInput): ReturningContext | null {
  if (i.lastActivityAt === null || i.now - i.lastActivityAt < RETURNING_MIN_DAYS * DAY) return null;
  const facts: string[] = [];
  if (i.activeMatch) facts.push(t("Tu partida sigue abierta: puedes continuarla."));
  if (i.draftRun) facts.push(t("Tu Draft Gauntlet sigue en curso (fase {stage} de 5).", { stage: i.draftRun.stage }));
  if (i.pickem && i.pickem.pending > 0 && i.pickem.nextLockAt !== null && i.pickem.nextLockAt > i.now) {
    facts.push(t("{v} cierra en {nextLockAt}.", { v: i.pickem.eventName ? t("El Pick'em de {eventName}", { eventName: i.pickem.eventName }) : t("Un Pick'em"), nextLockAt: remainingText(i.pickem.nextLockAt, i.now) }));
  }
  if (i.claimable > 0) facts.push(t("Tienes {claimable} {v} por reclamar.", { claimable: i.claimable, v: i.claimable === 1 ? t("recompensa") : t("recompensas") }));
  const dailyResets = resetsBetween("daily", i.lastActivityAt, i.now);
  const weeklyResets = resetsBetween("weekly", i.lastActivityAt, i.now);
  const weeklyActive = i.thisWeek.find((c) => c.status === "IN_PROGRESS" && c.current > 0);
  if (weeklyResets === 0 && weeklyActive) facts.push(t("Tu objetivo semanal «{label}» sigue activo ({progressLabel}).", { label: td(weeklyActive.label), progressLabel: td(weeklyActive.progressLabel) }));
  if (dailyResets > 0 && i.today.length > 0) facts.push(t("Hay objetivos diarios nuevos."));
  if (weeklyResets > 0 && i.thisWeek.length > 0) facts.push(t("Hay objetivos semanales nuevos."));
  if (i.liveEventName) facts.push(t("{liveEventName} está en directo.", { liveEventName: td(i.liveEventName) }));
  if (i.seasonEndsAt !== null && i.seasonEndsAt > i.now) facts.push(t("La temporada termina en {seasonEndsAt}.", { seasonEndsAt: remainingText(i.seasonEndsAt, i.now) }));
  return {
    daysAway: Math.floor((i.now - i.lastActivityAt) / DAY), lastActivityAt: i.lastActivityAt, dailyResets, weeklyResets,
    facts: facts.slice(0, RETURNING_MAX_FACTS),
  };
}

/** Motivos del libro mayor → frase de progreso reciente (solo importes reales). `null` = no se cuenta. */
export function ledgerRecent(r: { reason: string; delta: number; created_at: string }, i: number, packName: (id: string) => string = (id) => id): RecentFact | null {
  const at = Date.parse(r.created_at);
  if (!Number.isFinite(at)) return null;
  const plus = r.delta > 0 ? t(" (+{delta} créditos)", { delta: r.delta }) : "";
  const id = `ledger:${i}`;
  if (r.reason === "duel_win") return { id, label: t("Victoria en partida rápida{plus}", { plus: td(plus) }), at };
  if (r.reason === "duel_draw") return { id, label: t("Empate en partida rápida{plus}", { plus: td(plus) }), at };
  if (r.reason === "duel_loss") return { id, label: t("Partida rápida jugada{plus}", { plus: td(plus) }), at };
  if (r.reason.startsWith("duel_capped_")) return { id, label: t("Partida jugada (tope diario de recompensas alcanzado)"), at };
  if (r.reason === "mission_reward") return { id, label: t("Objetivo cobrado{plus}", { plus: td(plus) }), at };
  if (r.reason === "achievement") return { id, label: t("Logro cobrado{plus}", { plus: td(plus) }), at };
  if (r.reason === "pass_reward") return { id, label: t("Nivel del pase cobrado{plus}", { plus: td(plus) }), at };
  if (r.reason === "campaign_first_clear") return { id, label: t("Primera victoria en Road to Champions{plus}", { plus: td(plus) }), at };
  if (r.reason.startsWith("pickem_reward")) return { id, label: t("Recompensa de Pick'em{plus}", { plus: td(plus) }), at };
  if (r.reason.startsWith("event_challenge")) return { id, label: t("Desafío de evento completado{plus}", { plus: td(plus) }), at };
  if (r.reason.startsWith("buy_pack:")) return { id, label: t("Conseguiste un {v}", { v: packName(r.reason.slice("buy_pack:".length)) }), at };
  return null;
}

/** Progreso reciente acotado (máx. 3), del más nuevo al más viejo. */
export function recentProgress(facts: readonly RecentFact[], max = 3): RecentFact[] {
  return [...facts].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, max);
}
