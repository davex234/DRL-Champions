/**
 * POLICY — la política de decisión por DEFECTO (contrato de la fase), como datos puros y
 * totalmente sustituible: el orden de las reglas es la prioridad del motivo al fusionar.
 * Nada de aprobar/publicar: las únicas acciones planificables son revisiones editoriales
 * (que después decidirán humanos en Tournament Control).
 */
import type { DecisionPolicy } from "./types";

export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  rules: [
    { kind: "tournament-finished", action: "generate-full-review", reason: "TournamentFinished" },
    { kind: "team-eliminated", action: "generate-review", reason: "TeamEliminated" },
    { kind: "team-qualified", action: "generate-review", reason: "TeamQualified" },
    { kind: "result-changed", action: "generate-review", reason: "ResultChanged" },
    { kind: "statistics-changed", action: "generate-review", reason: "StatisticsChanged" },
    { kind: "match-updated", action: "wait", reason: "MatchUpdated" },
    { kind: "match-added", action: "wait", reason: "MatchAdded" },
    { kind: "map-added", action: "wait", reason: "MapAdded" },
    { kind: "roster-changed", action: "wait", reason: "RosterChanged" },
    { kind: "bracket-changed", action: "wait", reason: "BracketChanged" },
    { kind: "tournament-created", action: "wait", reason: "TournamentCreated" },
    { kind: "tournament-updated", action: "wait", reason: "TournamentUpdated" },
    { kind: "tournament-removed", action: "ignore", reason: "TournamentRemoved" },
  ],
  defaultAction: "ignore",
};

/** Índice de prioridad del motivo (menor = más prioritario; -1 si no hay regla). */
export function rulePriority(policy: DecisionPolicy, reason: string): number {
  const i = policy.rules.findIndex((r) => (r.reason ?? r.kind) === reason);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}
