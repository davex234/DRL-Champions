/**
 * DRAFT GAUNTLET · PRESENTACIÓN (Fase 39) — pura, sin React.
 *
 * Aquí se decide CÓMO se enseña la run, nunca QUÉ es legal: eso lo dice el servidor. Sin veredictos («mejor»,
 * «recomendada»): la comparación enseña números del catálogo lado a lado y el jugador decide.
 */
import type { RoleId } from "@/domain/cards/types";
import type { DraftCardDTO, DraftSnapshot } from "@/domain/draft/snapshot";
import type { DraftRunView, StageNode } from "@/domain/draft/run";
import { DRAFT_OPTIONS, DRAFT_PICKS, GAUNTLET_STAGES, type DraftRunStatus } from "@/domain/draft/rules";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import { ns, td, getIntlLocale } from "@/i18n/runtime";

const t = ns("draft");

export const ROLE_SHORT: Record<RoleId, string> = { Duelista: "DUE", Controlador: "CTRL", Iniciador: "INI", Centinela: "CEN", Flex: "FLEX" };
export const STAT_LABEL = { stronghold: "Stronghold", gamesense: "Gamesense", entryfrag: "Entryfrag" } as const;
export type StatKey = keyof typeof STAT_LABEL;
export const STAT_KEYS: readonly StatKey[] = ["stronghold", "gamesense", "entryfrag"];

/** Lo que dice la cabecera de la sala de guerra. */
export function runHeadline(run: DraftRunView | null): { kicker: string; title: string; detail: string } {
  if (!run) return { kicker: "DRAFT GAUNTLET", title: t("Nueva run"), detail: t("Diez elecciones. Cinco rivales. Sin tu colección.") };
  switch (run.status) {
    case "DRAFTING": return { kicker: "DRAFT GAUNTLET · RUN", title: `PICK ${Math.min(run.pickIndex + 1, DRAFT_PICKS)}/${DRAFT_PICKS}`, detail: run.currentRole ? `ROL ACTUAL: ${run.currentRole.toUpperCase()}` : "" };
    case "READY": return { kicker: "DRAFT GAUNTLET · RUN", title: run.stage === GAUNTLET_STAGES ? "FINAL" : `COMBATE ${run.stage}/${GAUNTLET_STAGES}`, detail: t("Plantilla completa. El rival te espera.") };
    case "IN_MATCH": return { kicker: "DRAFT GAUNTLET · RUN", title: t("EN COMBATE · {stage}/{GAUNTLET_STAGES}", { stage: run.stage, GAUNTLET_STAGES }), detail: t("Tu combate sigue abierto en el servidor.") };
    case "COMPLETED": return { kicker: "DRAFT GAUNTLET", title: "GAUNTLET SUPERADO", detail: t("Cinco rivales, cinco victorias.") };
    case "FAILED": return { kicker: "DRAFT GAUNTLET", title: "RUN TERMINADA", detail: t("Llegaste al combate {stage} de {GAUNTLET_STAGES}.", { stage: run.stage, GAUNTLET_STAGES }) };
    case "ABANDONED": return { kicker: "DRAFT GAUNTLET", title: "RUN ABANDONADA", detail: t("Cobras tus victorias. La entrada no vuelve.") };
  }
}

/** Huecos de la plantilla en el orden de roles de la run: elegido o pendiente. */
export function rosterSlots(run: DraftRunView, cards: Record<string, DraftCardDTO>): { index: number; role: RoleId; card: DraftCardDTO | null; current: boolean }[] {
  return run.roleOrder.map((role, index) => ({
    index, role, card: run.picks[index] ? cards[run.picks[index]] ?? null : null, current: run.status === "DRAFTING" && index === run.pickIndex,
  }));
}

/** Cuántas cartas de cada rol ya tiene la plantilla (siempre sobre 2). */
export function roleProgress(run: DraftRunView, cards: Record<string, DraftCardDTO>): { role: RoleId; have: number; need: number }[] {
  return DUEL_ROLES.map((role) => ({ role, have: run.picks.filter((id) => cards[id]?.role === role).length, need: 2 }));
}

/** Comparación SIN veredicto: la opción frente a lo ya elegido del mismo rol, estadística a estadística. */
export function compareWithRole(option: DraftCardDTO, run: DraftRunView, cards: Record<string, DraftCardDTO>): { against: DraftCardDTO; rows: { stat: StatKey | "ovr"; option: number; picked: number }[] }[] {
  return run.picks.map((id) => cards[id]).filter((c): c is DraftCardDTO => !!c && c.role === option.role).map((against) => ({
    against,
    rows: [
      { stat: "ovr" as const, option: option.ovr, picked: against.ovr },
      ...STAT_KEYS.map((k) => ({ stat: k, option: option.combat?.[k] ?? 0, picked: against.combat?.[k] ?? 0 })),
    ],
  }));
}

/* ───────────────────────────── elección: vista previa → confirmación ───────────────────────────── */

export type PickUi =
  | { phase: "browse" }
  | { phase: "preview"; index: number }
  | { phase: "sending"; index: number };

export type PickEvent =
  | { type: "select"; index: number }
  | { type: "cancel" }
  | { type: "send" }
  | { type: "settled" };

/** Un toque ELIGE (vista previa); solo CONFIRMAR envía. Nada se envía dos veces mientras hay una elección en vuelo. */
export function pickUiReducer(s: PickUi, e: PickEvent, optionCount: number): PickUi {
  switch (e.type) {
    case "select":
      if (s.phase === "sending" || e.index < 0 || e.index >= optionCount) return s;
      return { phase: "preview", index: e.index };
    case "cancel":
      return s.phase === "preview" ? { phase: "browse" } : s;
    case "send":
      return s.phase === "preview" ? { phase: "sending", index: s.index } : s;
    case "settled":
      return { phase: "browse" };
  }
}

export type KeyIntent = { type: "select"; index: number } | { type: "confirm" } | { type: "cancel" } | null;

/**
 * Teclado: 1/2/3 eligen, Enter confirma SOLO con una vista previa abierta y nunca por repetición de tecla, Escape
 * cancela. Con el foco en un campo de texto o con acciones desactivadas no se interpreta nada.
 */
export function draftKeyIntent(e: { key: string; repeat?: boolean; editable?: boolean }, ui: PickUi, opts: { optionCount: number; disabled: boolean }): KeyIntent {
  if (e.editable || opts.disabled) return null;
  if (/^[1-9]$/.test(e.key)) {
    const index = Number(e.key) - 1;
    return !e.repeat && index < Math.min(opts.optionCount, DRAFT_OPTIONS) && ui.phase !== "sending" ? { type: "select", index } : null;
  }
  if (e.key === "Enter") return !e.repeat && ui.phase === "preview" ? { type: "confirm" } : null;
  if (e.key === "Escape") return ui.phase === "preview" ? { type: "cancel" } : null;
  return null;
}

/* ───────────────────────────── mapa del gauntlet ───────────────────────────── */

export const NODE_STATE_LABEL: Record<StageNode["state"], string> = {
  LOCKED: "Bloqueado", CURRENT: "Siguiente", IN_MATCH: "En combate", WON: "Superado", LOST: "Derrota", DRAW: "Empate", ABANDONED: "Abandonado",
};

/* ───────────────────────────── resultado de un combate ───────────────────────────── */

export interface DraftResultCopy { tone: "win" | "loss" | "draw" | "complete" | "pending"; title: string; line: string; cta: string }

/** Copia del resultado en la arena, SOLO desde la run ya liquidada por el servidor. */
export function draftResultCopy(run: DraftRunView | null, matchId: string): DraftResultCopy {
  const node = run?.stages.find((s) => s.matchId === matchId) ?? null;
  if (!run || !node || !["WON", "LOST", "DRAW"].includes(node.state)) {
    return { tone: "pending", title: t("Registrando el resultado…"), line: t("El servidor está cerrando el combate. Vuelve al gauntlet para verlo."), cta: t("Volver al gauntlet") };
  }
  if (node.state === "WON" && run.status === "COMPLETED") return { tone: "complete", title: "GAUNTLET SUPERADO", line: t("Cinco rivales, cinco victorias. Tu gran premio te espera en el resumen."), cta: t("Ver resumen") };
  if (node.state === "WON") return { tone: "win", title: `COMBATE ${node.label} SUPERADO`, line: t("Siguiente: combate {v}.", { v: run.stage === GAUNTLET_STAGES ? t("FINAL") : run.stage }), cta: t("Volver al gauntlet") };
  if (node.state === "DRAW") return { tone: "draw", title: t("EMPATE · RUN TERMINADA"), line: t("En el gauntlet solo avanza quien gana."), cta: t("Ver resumen") };
  return { tone: "loss", title: "RUN TERMINADA", line: t("Caíste en el combate {label}.", { label: td(node.label) }), cta: t("Ver resumen") };
}

/** ¿Hay acciones posibles? Sin conexión o con una foto «no disponible», todo queda en solo lectura. */
export function actionsDisabled(snapshot: DraftSnapshot | null, offline: boolean): boolean {
  return offline || !snapshot || !snapshot.available;
}

export const isFinal = (s: DraftRunStatus | undefined | null): boolean => s === "COMPLETED" || s === "FAILED" || s === "ABANDONED";

/** F72 · lo que pagó una run terminada, en una línea (datos del servidor; nada se calcula aquí). */
export function rewardSummary(r: NonNullable<DraftRunView["reward"]>): string {
  if (!r.granted) return t("Premio en camino…");
  const parts: string[] = [];
  if (r.credits > 0) parts.push(t("+{credits} créditos", { credits: new Intl.NumberFormat(getIntlLocale(), { useGrouping: "always" } as Intl.NumberFormatOptions).format(r.credits) }));
  if (r.jackpot && r.jackpotPack) parts.push(r.jackpotPack);
  if (r.title) parts.push(t("Campeón del Gauntlet"));
  return parts.length ? parts.join(" · ") : t("Sin premio esta vez");
}
