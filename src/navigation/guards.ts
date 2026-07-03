/**
 * SCREEN GUARDS + VALIDACIÓN (Render/UI Fase 2/7).
 *
 * La navegación NUNCA evalúa lógica de juego: un guard es un id booleano que el BORDE resuelve (auth,
 * hydrated, feature-flag…) y pasa como `guardContext`. Aquí solo se comprueba que los guards requeridos
 * por la pantalla estén satisfechos. Puro y determinista.
 */
import type { ScreenRegistry } from "./registry";
import type { NavValidation, NavIssue } from "./types";

/** Contexto de guards resuelto por el borde: guardId → cumplido. */
export type GuardContext = Record<string, boolean>;

/** ¿Se puede entrar a la pantalla con este contexto de guards? */
export function validateNavigation(registry: ScreenRegistry, screenId: string, guards: GuardContext = {}): NavValidation {
  const issues: NavIssue[] = [];
  const d = registry.get(screenId);
  if (!d) { issues.push({ code: "UNKNOWN_SCREEN", message: `Pantalla inexistente: ${screenId}` }); return { ok: false, issues }; }
  for (const g of d.guards ?? []) if (guards[g] !== true) issues.push({ code: "GUARD_BLOCKED", message: `Guard no cumplido: ${g}` });
  return { ok: issues.length === 0, issues };
}
