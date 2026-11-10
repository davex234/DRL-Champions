/**
 * PROGRESIÓN DE CAMPAÑA (Fase 35). Pura.
 *
 * Estados de un nodo, DERIVADOS (no se guardan):
 *   COMPLETED → hay progreso `COMPLETED` para ese id (se conserva aunque cambie la versión: nunca se resetea en silencio).
 *   AVAILABLE → todos sus requisitos están completados.
 *   LOCKED    → le falta algún requisito. Sin nivel de cuenta, sin pago, sin energía: solo jugar el anterior.
 *
 * Resultado de una partida:
 *   WIN  → completa el nodo (primera vez = «primera victoria»).
 *   LOSS → cuenta el intento; el nodo sigue disponible.
 *   DRAW → cuenta el intento; NO completa (`DRAW_COMPLETES_NODE = false`). Un empate no es superar un nodo.
 */
import { allNodes } from "./definition";
import type { CampaignDefinition, CampaignOutcome, NodeProgress, NodeStatus } from "./types";

export const DRAW_COMPLETES_NODE = false;

const OUTCOME_RANK: Record<CampaignOutcome, number> = { LOSS: 1, DRAW: 2, WIN: 3 };

/** Resultado del bando del jugador (A) a partir del resultado autoritativo del motor. */
export function outcomeForHuman(result: { winner: "A" | "B" | null; isDraw: boolean }): CampaignOutcome {
  if (result.isDraw || result.winner === null) return "DRAW";
  return result.winner === "A" ? "WIN" : "LOSS";
}

export function bestOutcome(a: CampaignOutcome | null, b: CampaignOutcome | null): CampaignOutcome | null {
  if (!a) return b;
  if (!b) return a;
  return OUTCOME_RANK[b] > OUTCOME_RANK[a] ? b : a;
}

export function completesNode(outcome: CampaignOutcome): boolean {
  return outcome === "WIN" || (outcome === "DRAW" && DRAW_COMPLETES_NODE);
}

export function resolveStatuses(def: CampaignDefinition, progress: readonly NodeProgress[]): Map<string, NodeStatus> {
  const done = new Set(progress.filter((p) => p.status === "COMPLETED").map((p) => p.nodeId));
  const out = new Map<string, NodeStatus>();
  for (const n of allNodes(def)) {
    if (done.has(n.id)) out.set(n.id, "COMPLETED");
    else out.set(n.id, n.requirements.completed.every((r) => done.has(r)) ? "AVAILABLE" : "LOCKED");
  }
  return out;
}

export type StartCheck = { ok: true } | { ok: false; code: "UNKNOWN_NODE" | "LOCKED" };

/** ¿Se puede lanzar este nodo? Completado también se puede (rejugar). */
export function canStartNode(def: CampaignDefinition, progress: readonly NodeProgress[], nodeId: string): StartCheck {
  const status = resolveStatuses(def, progress).get(nodeId);
  if (!status) return { ok: false, code: "UNKNOWN_NODE" };
  if (status === "LOCKED") return { ok: false, code: "LOCKED" };
  return { ok: true };
}

export interface OutcomeApplied {
  next: NodeProgress;
  /** Primera vez que este usuario completa el nodo. Es lo único que puede pagar. */
  firstClear: boolean;
}

/**
 * Aplica UN resultado ya liquidado. La idempotencia no vive aquí: el servicio solo llama una vez por intento
 * (transición condicional `STARTED → SETTLED`), y el pago tiene además su clave única en el libro mayor.
 */
export function applyOutcome(
  prev: NodeProgress | null,
  input: { nodeId: string; version: string; outcome: CampaignOutcome; matchId: string; at: number },
): OutcomeApplied {
  const wasCompleted = prev?.status === "COMPLETED";
  const completes = completesNode(input.outcome);
  const firstClear = completes && !wasCompleted;
  const next: NodeProgress = {
    nodeId: input.nodeId,
    version: input.version,
    status: wasCompleted || completes ? "COMPLETED" : "ATTEMPTED",
    bestResult: bestOutcome(prev?.bestResult ?? null, input.outcome),
    attempts: (prev?.attempts ?? 0) + 1,
    wins: (prev?.wins ?? 0) + (input.outcome === "WIN" ? 1 : 0),
    firstClearedAt: prev?.firstClearedAt ?? (firstClear ? input.at : null),
    firstClearMatchId: prev?.firstClearMatchId ?? (firstClear ? input.matchId : null),
    updatedAt: input.at,
  };
  return { next, firstClear };
}

export interface ChapterSummary { id: string; order: number; name: string; completed: number; total: number; complete: boolean; unlocked: boolean }

export interface CampaignSummary {
  completed: number;
  total: number;
  chapters: ChapterSummary[];
  chaptersComplete: number;
  chaptersTotal: number;
  complete: boolean;
  /** El siguiente nodo por jugar (primero DISPONIBLE en orden). `null` si no queda ninguno. */
  nextNodeId: string | null;
}

export function summarize(def: CampaignDefinition, statuses: Map<string, NodeStatus>): CampaignSummary {
  const chapters = [...def.chapters].sort((a, b) => a.order - b.order).map((c) => {
    const st = c.nodes.map((n) => statuses.get(n.id) ?? "LOCKED");
    const completed = st.filter((s) => s === "COMPLETED").length;
    return { id: c.id, order: c.order, name: c.name, completed, total: c.nodes.length, complete: completed === c.nodes.length, unlocked: st.some((s) => s !== "LOCKED") };
  });
  const nodes = allNodes(def);
  const completed = nodes.filter((n) => statuses.get(n.id) === "COMPLETED").length;
  return {
    completed, total: nodes.length, chapters,
    chaptersComplete: chapters.filter((c) => c.complete).length, chaptersTotal: chapters.length,
    complete: completed === nodes.length && nodes.length > 0,
    nextNodeId: nodes.find((n) => statuses.get(n.id) === "AVAILABLE")?.id ?? null,
  };
}

/** ¿Este nodo recién completado cierra su capítulo? (Para «CAPÍTULO COMPLETADO» y su telemetría.) */
export function closesChapter(def: CampaignDefinition, statuses: Map<string, NodeStatus>, nodeId: string): string | null {
  const chapter = def.chapters.find((c) => c.nodes.some((n) => n.id === nodeId));
  if (!chapter) return null;
  return chapter.nodes.every((n) => statuses.get(n.id) === "COMPLETED") ? chapter.id : null;
}
