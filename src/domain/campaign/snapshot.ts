/**
 * READ MODEL · `CampaignSnapshot` (Fase 35). Puro.
 *
 * Lo único que sale del servidor sobre la campaña. Nunca filas crudas: ni `user_id`, ni ids de intento, ni
 * el mazo del rival carta a carta (sería información oculta: en PvE el rival se descubre jugando). Del rival
 * se cuenta QUIÉN es (equipo real), cuántos jugadores son del roster y cuántos refuerzos, y su fuerza total,
 * que es la misma cifra que ya enseña el marcador en partida.
 */
import { BOT_LABEL, CARD_TIER_LABEL, NODE_TYPE_LABEL, TIER_LABEL, botDifficultyOf, cardTierFor } from "./difficulty";
import { campaignRewardTotal } from "./rewards";
import { resolveStatuses, summarize, type CampaignSummary } from "./progression";
import type {
  BotDifficulty, CampaignDefinition, CampaignNodeType, CampaignOutcome, CampaignTier, CardTier, NodeProgress, NodeStatus, OpponentPlan,
} from "./types";

export type CampaignUnavailableReason = "MIGRATION_PENDING" | "BACKEND_ERROR" | "INVALID_DEFINITION";

export interface CampaignOpponentView {
  teamId: string;
  name: string;
  tag: string;
  region: string;
  /** Jugadores del roster actual del equipo; el resto son refuerzos reales de su región. */
  coreCount: number;
  reinforcements: number;
  sumOvr: number | null;
  cardTier: CardTier;
  cardTierLabel: string;
  /** `false` si el catálogo vivo no da un mazo legal para este equipo: el nodo no se puede jugar. */
  playable: boolean;
}

export interface CampaignNodeView {
  id: string;
  chapterId: string;
  chapterOrder: number;
  order: number;
  type: CampaignNodeType;
  typeLabel: string;
  name: string;
  objective: string;
  status: NodeStatus;
  tier: CampaignTier;
  tierLabel: string;
  botDifficulty: BotDifficulty;
  botLabel: string;
  opponent: CampaignOpponentView;
  requirements: string[];
  nextNodes: string[];
  firstClearCredits: number;
  /** La primera victoria ya se consiguió (y con ella su recompensa única). */
  firstClearDone: boolean;
  bestResult: CampaignOutcome | null;
  attempts: number;
  wins: number;
  firstClearedAt: number | null;
  isNext: boolean;
}

export interface CampaignChapterView {
  id: string;
  order: number;
  name: string;
  description: string;
  theme: string;
  completed: number;
  total: number;
  complete: boolean;
  unlocked: boolean;
  nodes: CampaignNodeView[];
}

export interface CampaignAttemptView {
  nodeId: string;
  matchId: string | null;
  status: "STARTED" | "SETTLED" | "ABANDONED";
  result: CampaignOutcome | null;
  firstClear: boolean;
  settledAt: number | null;
}

export interface CampaignSnapshot {
  serverNow: number;
  campaignId: string;
  version: string;
  name: string;
  tagline: string;
  available: boolean;
  unavailableReason: CampaignUnavailableReason | null;
  chapters: CampaignChapterView[];
  summary: CampaignSummary;
  /** Nodo con partida lanzada y sin liquidar (para retomar). */
  activeAttempt: CampaignAttemptView | null;
  /** Último intento liquidado: lo que la pantalla de resultado enseña («NODO COMPLETADO»). */
  lastAttempt: CampaignAttemptView | null;
  economy: { firstClearTotal: number; firstClearEarned: number };
}

export interface SnapshotInput {
  def: CampaignDefinition;
  opponents: ReadonlyMap<string, OpponentPlan>;
  progress: readonly NodeProgress[];
  available: boolean;
  unavailableReason: CampaignUnavailableReason | null;
  activeAttempt?: CampaignAttemptView | null;
  lastAttempt?: CampaignAttemptView | null;
  serverNow: number;
}

export function buildCampaignSnapshot(i: SnapshotInput): CampaignSnapshot {
  const { def } = i;
  const derived = resolveStatuses(def, i.progress);
  // Sin campaña disponible no se ofrece jugar nada: el mapa es vista previa, todo bloqueado.
  const statuses = new Map([...derived].map(([id, s]) => [id, i.available ? s : (s === "COMPLETED" ? s : "LOCKED")] as const));
  const summary = summarize(def, statuses);
  const byNode = new Map(i.progress.map((p) => [p.nodeId, p]));

  const chapters = [...def.chapters].sort((a, b) => a.order - b.order).map((c) => {
    const nodes = [...c.nodes].sort((a, b) => a.order - b.order).map((n): CampaignNodeView => {
      const plan = i.opponents.get(n.id);
      const tier = cardTierFor(c.order, n.type);
      const p = byNode.get(n.id) ?? null;
      const status = statuses.get(n.id) ?? "LOCKED";
      return {
        id: n.id, chapterId: c.id, chapterOrder: c.order, order: n.order, type: n.type, typeLabel: NODE_TYPE_LABEL[n.type],
        name: n.name, objective: n.objective, status,
        tier: n.difficulty, tierLabel: TIER_LABEL[n.difficulty],
        botDifficulty: botDifficultyOf(n.difficulty), botLabel: BOT_LABEL[botDifficultyOf(n.difficulty)],
        opponent: plan && plan.ok
          ? { teamId: plan.teamId, name: plan.teamName, tag: plan.tag, region: plan.region, coreCount: plan.coreCount, reinforcements: plan.cards.length - plan.coreCount, sumOvr: plan.sumOvr, cardTier: tier, cardTierLabel: CARD_TIER_LABEL[tier], playable: true }
          : { teamId: n.opponent.teamId, name: n.opponent.teamId, tag: "", region: "", coreCount: 0, reinforcements: 0, sumOvr: null, cardTier: tier, cardTierLabel: CARD_TIER_LABEL[tier], playable: false },
        requirements: [...n.requirements.completed], nextNodes: [...n.nextNodes],
        firstClearCredits: n.rewards.firstClear.credits,
        firstClearDone: p?.status === "COMPLETED",
        bestResult: p?.bestResult ?? null, attempts: p?.attempts ?? 0, wins: p?.wins ?? 0, firstClearedAt: p?.firstClearedAt ?? null,
        isNext: summary.nextNodeId === n.id,
      };
    });
    const ch = summary.chapters.find((x) => x.id === c.id)!;
    return { id: c.id, order: c.order, name: c.name, description: c.description, theme: c.theme, completed: ch.completed, total: ch.total, complete: ch.complete, unlocked: ch.unlocked, nodes };
  });

  const firstClearEarned = chapters.flatMap((c) => c.nodes).filter((n) => n.firstClearDone).reduce((s, n) => s + n.firstClearCredits, 0);

  return {
    serverNow: i.serverNow, campaignId: def.campaignId, version: def.version, name: def.name, tagline: def.tagline,
    available: i.available, unavailableReason: i.available ? null : i.unavailableReason,
    chapters, summary,
    activeAttempt: i.available ? i.activeAttempt ?? null : null,
    lastAttempt: i.available ? i.lastAttempt ?? null : null,
    economy: { firstClearTotal: campaignRewardTotal(def), firstClearEarned },
  };
}

export function findNodeView(s: CampaignSnapshot, nodeId: string): CampaignNodeView | null {
  for (const c of s.chapters) for (const n of c.nodes) if (n.id === nodeId) return n;
  return null;
}

/** «7/15 NODOS». Nada de puntuaciones globales inventadas. */
export const progressLabel = (s: Pick<CampaignSummary, "completed" | "total">): string => `${s.completed}/${s.total} nodos`;
