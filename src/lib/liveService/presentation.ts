/**
 * FASE 42 · LIVE SERVICE — PRESENTACIÓN PURA del vestíbulo y del «después de jugar».
 *
 * Traduce `snap.service` (decidido en el servidor) a modelos de pantalla. No decide prioridades, no lee el reloj del
 * cliente (recibe `now` estimado desde `serverNow`), no calcula recompensas: las copia.
 */
import type { DailyAction, DailyLoopSnapshot } from "@/domain/dailyLoop";
import type { ObjectiveCard, Urgency } from "@/domain/liveService";
import { remainingText, resetText, URGENCY_LABEL, urgencyOf } from "@/domain/liveService";
import { ns } from "@/i18n/runtime";

const t = ns("liveService");

export interface DeadlineChip { label: string; urgency: Urgency; aria: string }

/** Chip de plazo SOLO con fin real: texto + nivel (nunca color solo). */
export function deadlineChip(endsAt: number | null | undefined, now: number, verb = t("Cierra en")): DeadlineChip | null {
  const u = urgencyOf(endsAt ?? null, now);
  const left = remainingText(endsAt ?? null, now);
  if (!u || !left) return null;
  return { label: `${verb} ${left}`, urgency: u, aria: `${verb} ${left} · ${URGENCY_LABEL[u]}` };
}

export interface ObjectiveRow extends ObjectiveCard { statusLabel: string; pct: number; href: string }

const STATUS_LABEL: Record<ObjectiveCard["status"], string> = { CLAIMABLE: "Reclamar", CLAIMED: "Conseguido", IN_PROGRESS: "En progreso" };

export function objectiveRows(cards: readonly ObjectiveCard[], routes: { claims: string; objective: (metric: string) => string }): ObjectiveRow[] {
  return cards.map((c) => ({
    ...c, statusLabel: STATUS_LABEL[c.status], pct: c.goal > 0 ? Math.min(100, (c.current / c.goal) * 100) : 0,
    href: c.status === "CLAIMABLE" ? routes.claims : routes.objective(c.metric),
  }));
}

export interface ObjectiveSection { title: string; kicker: string; reset: string; rows: ObjectiveRow[]; done: boolean; empty: string }

export function objectiveSections(snap: DailyLoopSnapshot, now: number, routes: { claims: string; objective: (metric: string) => string }): ObjectiveSection[] | null {
  const s = snap.service;
  if (!s) return null;
  return [
    { kicker: t("Hoy"), title: t("Objetivos de hoy"), reset: resetText(s.resets.dailyEndsAt, now), rows: objectiveRows(s.today, routes), done: s.dailyDone, empty: t("No hay objetivos diarios activos.") },
    { kicker: t("Esta semana"), title: t("Objetivos de la semana"), reset: resetText(s.resets.weeklyEndsAt, now), rows: objectiveRows(s.thisWeek, routes), done: s.weeklyDone, empty: t("No hay objetivos semanales activos.") },
  ];
}

/* ───────────────────────────── vuelta ───────────────────────────── */

export interface ReturningModel { title: string; subtitle: string; facts: string[] }

export function returningModel(snap: DailyLoopSnapshot): ReturningModel | null {
  const r = snap.service?.returning;
  if (!r || r.facts.length === 0) return null;
  const subtitle = r.daysAway >= 2 ? t("Tu última actividad fue hace {daysAway} días.", { daysAway: r.daysAway }) : t("Tu última actividad fue ayer o antes.");
  return { title: t("De vuelta en NEXUS"), subtitle, facts: r.facts.slice(0, 3) };
}

/* ───────────────────────────── después de jugar ───────────────────────────── */

export type AfterContext = "match" | "campaign" | "ranked" | "private" | "draft" | "pack";

const CONTEXT_METRICS: Record<AfterContext, RegExp | null> = {
  match: /^duels_/, campaign: /^duels_/, ranked: /^duels_/, private: /^duels_/, pack: /^(packs_opened|distinct_cards)$/, draft: null,
};

export interface AfterModel {
  progress: { id: string; label: string; line: string; progressLabel: string; pct: number; claimable: boolean }[];
  next: { label: string; href: string; reason: string } | null;
  draft: string | null;
  lobbyHref: string;
}

const noun = (metric: string, n: number) =>
  metric === "duels_won" ? (n === 1 ? t("victoria") : t("victorias"))
    : metric === "duels_played" ? (n === 1 ? t("partida") : t("partidas"))
      : metric === "packs_opened" ? (n === 1 ? t("sobre") : t("sobres"))
        : metric === "distinct_cards" ? (n === 1 ? t("carta nueva") : t("cartas nuevas")) : t("más");

/**
 * «Una más»: objetivos RELACIONADOS con lo que se acaba de hacer (sin extra de recompensa) y la siguiente acción que
 * ya eligió el servidor. Draft Gauntlet no avanza objetivos (0 economía): solo su fase. Siempre hay vuelta al lobby.
 */
export function afterActivityModel(snap: DailyLoopSnapshot | null, context: AfterContext, currentPath: string | null = null): AfterModel {
  const base: AfterModel = { progress: [], next: null, draft: null, lobbyHref: "/" };
  if (!snap || !snap.signedIn) return base;
  const re = CONTEXT_METRICS[context];
  const cards = [...(snap.service?.today ?? []), ...(snap.service?.thisWeek ?? [])].filter((c) => re && re.test(c.metric) && c.status !== "CLAIMED");
  const progress = cards
    .sort((a, b) => (a.status === "CLAIMABLE" ? -1 : 0) - (b.status === "CLAIMABLE" ? -1 : 0) || (a.goal - a.current) - (b.goal - b.current))
    .slice(0, 2)
    .map((c) => {
      const missing = c.goal - c.current;
      const line = c.status === "CLAIMABLE" ? t("Completado · recógelo en Logros") : t("{missing} {metric} más para completarlo", { missing, metric: noun(c.metric, missing) });
      return { id: c.id, label: c.label, line, progressLabel: c.progressLabel, pct: c.goal > 0 ? (c.current / c.goal) * 100 : 0, claimable: c.status === "CLAIMABLE" };
    });
  const p: DailyAction = snap.primaryAction;
  const next = currentPath !== null && p.href === currentPath ? null : { label: p.cta, href: p.href, reason: p.reason ?? p.detail };
  const run = snap.service?.draftRun ?? null;
  const draft = context === "draft" && run ? (run.status === "DRAFTING" ? t("Tu draft sigue a medias.") : t("Siguiente: fase {stage} de 5.", { stage: run.stage })) : null;
  return { progress, next, draft, lobbyHref: "/" };
}
