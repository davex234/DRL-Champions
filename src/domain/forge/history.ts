/**
 * F79 · HISTORIAL DE LA FORJA — desde el libro mayor del SERVIDOR (nunca desde el navegador). PURO.
 *
 * Fuentes: `economy_ops` (crafteos), `user_project_claims` (proyectos) y los asientos `forge:*` de recompensas.
 * Solo se cuenta lo que se aplicó: un intento rechazado no deja asiento (y el historial no lo inventa).
 */
import { isForgeRecipeId } from "./types";
import type { CraftOpFact } from "./progression";

export type HistoryType = "PACK" | "EXCHANGE" | "ADVANCED" | "PROJECT" | "OBJECTIVE" | "ACHIEVEMENT";
export interface HistoryEntry {
  at: number;
  type: HistoryType;
  /** Receta, proyecto, objetivo o logro. */
  sourceId: string;
  consumed: { cardId?: string; packId?: string; qty: number }[];
  produced: { cardId?: string; packId?: string; qty: number }[];
  status: "COMPLETED";
}

export interface HistoryInput {
  ops: readonly CraftOpFact[];
  projectClaims: readonly { projectId: string; at: number; cardId?: string }[];
  rewardClaims: readonly { ref: string; at: number }[];
}

function collapse(items: CraftOpFact["inputs"]): HistoryEntry["consumed"] {
  const m = new Map<string, { cardId?: string; packId?: string; qty: number }>();
  for (const it of items) {
    const key = it.cardId ? `c:${it.cardId}` : `p:${it.packId}`;
    const q = Number(it.qty ?? 1);
    const cur = m.get(key);
    if (cur) cur.qty += q; else m.set(key, { ...(it.cardId ? { cardId: it.cardId } : { packId: it.packId }), qty: q });
  }
  return [...m.values()];
}

export function forgeHistory(inp: HistoryInput, limit = 50): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const op of inp.ops) out.push({
    at: op.at, type: op.kind === "PACK" ? "PACK" : isForgeRecipeId(op.recipeId) ? "ADVANCED" : "EXCHANGE",
    sourceId: op.recipeId, consumed: collapse(op.inputs), produced: collapse(op.outputs), status: "COMPLETED",
  });
  for (const p of inp.projectClaims) out.push({ at: p.at, type: "PROJECT", sourceId: p.projectId, consumed: [], produced: p.cardId ? [{ cardId: p.cardId, qty: 1 }] : [], status: "COMPLETED" });
  for (const r of inp.rewardClaims) {
    const [, kind, id] = r.ref.split(":");
    if (kind !== "obj" && kind !== "ach") continue;
    out.push({ at: r.at, type: kind === "obj" ? "OBJECTIVE" : "ACHIEVEMENT", sourceId: id ?? "", consumed: [], produced: [], status: "COMPLETED" });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
}
