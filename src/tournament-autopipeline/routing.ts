/**
 * ROUTING — un WatchEvent → su decisión (acción + motivo) según la política declarativa.
 * Primera regla que encaja gana; sin regla ⇒ defaultAction. Cero interpretación extra.
 */
import type { WatchEvent } from "@/tournament-watcher";
import type { DecisionPolicy, PipelineAction } from "./types";

export interface RoutedDecision {
  action: PipelineAction;
  reason: string;
}

export function routeEvent(event: WatchEvent, policy: DecisionPolicy): RoutedDecision {
  const rule = policy.rules.find((r) => r.kind === event.kind);
  if (!rule) return { action: policy.defaultAction, reason: event.kind };
  return { action: rule.action, reason: rule.reason ?? rule.kind };
}
