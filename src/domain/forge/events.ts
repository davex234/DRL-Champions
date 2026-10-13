/**
 * F79 · QUÉ CAMBIÓ CON UNA FORJA (para la analítica). PURO.
 *
 * Como la progresión se DERIVA, no hay un «momento» en que se concede un plano o se sube de nivel: se compara la foto
 * de antes con la de después (la misma evaluación con el asiento nuevo) y se nombra lo que cambió. Solo ids y números:
 * nada personal.
 */
import type { ForgeCore } from "./snapshot";

export type ForgeProgressEvent =
  | { msg: "level_up"; from: number; to: number }
  | { msg: "blueprint_unlock"; blueprintId: string }
  | { msg: "recipe_unlock"; recipeId: string }
  | { msg: "chain_complete"; chainId: string };

export function progressEvents(before: ForgeCore, after: ForgeCore): ForgeProgressEvent[] {
  const out: ForgeProgressEvent[] = [];
  if (after.level.level > before.level.level) out.push({ msg: "level_up", from: before.level.level, to: after.level.level });
  const hadBp = new Set(before.blueprints.filter((b) => b.owned).map((b) => b.id));
  for (const b of after.blueprints) if (b.owned && !hadBp.has(b.id)) out.push({ msg: "blueprint_unlock", blueprintId: b.id });
  const wasLocked = new Set(before.recipes.filter((r) => r.state === "LOCKED").map((r) => r.id));
  for (const r of after.recipes) if (r.state !== "LOCKED" && wasLocked.has(r.id)) out.push({ msg: "recipe_unlock", recipeId: r.id });
  const chainDone = new Set(before.chains.filter((c) => c.completed).map((c) => c.id));
  for (const c of after.chains) if (c.completed && !chainDone.has(c.id)) out.push({ msg: "chain_complete", chainId: c.id });
  return out;
}
