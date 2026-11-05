/**
 * FIXTURES QA SYNTHETIC · FASE 35 — solo para `/design-system/fase35` y sus capturas.
 *
 * Contenido REAL: la definición `rtc-2`, los rivales (equipos verificados y mazos del catálogo, calculados con
 * el mismo `buildOpponentPlan` del servidor) y partidas del motor canónico (`qaSimulate`). Lo INVENTADO: el
 * progreso de cada escena, los equipos del jugador y los objetivos. Misma forma que `GET /api/game/campaign`.
 */
import { ROAD_TO_CHAMPIONS } from "@/data/roadToChampions";
import {
  allNodes, buildOpponentPlan, nodeCardTier, buildCampaignSnapshot,
  type CampaignAttemptView, type CampaignSnapshot, type CampaignUnavailableReason, type NodeProgress,
} from "@/domain/campaign";
import { qaRegistry, qaSnapshot, qaSimulate, qaView } from "@/lib/duel/qaSimulation";
import { toCardDTO } from "@/lib/duel/matchView";
import type { DuelDeckDTO, DuelMatchView } from "@/lib/duel/types";
import { createDuelDeck, validateDuelDeck, makeDeckResolver, ownershipFromList, takeDeckSnapshot, type DuelDeckSnapshot } from "@/domain/cardgame";
import type { DuelMatch } from "@/domain/cardgame/match";
import { snapshotFrom, PROGRESSED, QA_NOW } from "../fase27/fixtures";
import { dailyPveObjectives } from "@/lib/campaign/presentation";

export const DEF = ROAD_TO_CHAMPIONS;
export { QA_NOW };
const D = 86_400_000;

export const PLANS = new Map(allNodes(DEF).map((n) => [n.id, buildOpponentPlan(qaRegistry, n.opponent.teamId, nodeCardTier(DEF, n.id)!)]));

const done = (nodeId: string, o: Partial<NodeProgress> = {}): NodeProgress => ({
  nodeId, version: DEF.version, status: "COMPLETED", bestResult: "WIN", attempts: 2, wins: 1,
  firstClearedAt: QA_NOW - 2 * D, firstClearMatchId: "qa-match", updatedAt: QA_NOW - D, ...o,
});
const tried = (nodeId: string, best: "LOSS" | "DRAW", attempts = 1): NodeProgress => ({
  nodeId, version: DEF.version, status: "ATTEMPTED", bestResult: best, attempts, wins: 0, firstClearedAt: null, firstClearMatchId: null, updatedAt: QA_NOW - 3600_000,
});
const ids = (chapter: number) => DEF.chapters[chapter - 1].nodes.map((n) => n.id);

export const PROGRESS = {
  fresh: [] as NodeProgress[],
  firstLoss: [tried("c1-n1", "LOSS")],
  mid: [...ids(1).map((id) => done(id)), done("c2-n1"), done("c2-n2", { attempts: 3 }), tried("c2-n3", "LOSS", 2)],
  chapter1: ids(1).map((id) => done(id)),
  nearEnd: [...ids(1), ...ids(2), ...ids(3).slice(0, 4)].map((id) => done(id)).concat([tried("c3-n5", "DRAW", 3)]),
  complete: allNodes(DEF).map((n) => done(n.id)),
};

export function campaignSnap(progress: NodeProgress[], o: { available?: boolean; reason?: CampaignUnavailableReason; active?: CampaignAttemptView | null; last?: CampaignAttemptView | null } = {}): CampaignSnapshot {
  const available = o.available ?? true;
  return buildCampaignSnapshot({
    def: DEF, opponents: PLANS, progress, available, unavailableReason: available ? null : (o.reason ?? "MIGRATION_PENDING"),
    activeAttempt: o.active ?? null, lastAttempt: o.last ?? null, serverNow: QA_NOW,
  });
}

/* ─────────────── equipos del jugador (cartas reales, equipo inventado) ─────────────── */

function deckDTO(s: DuelDeckSnapshot, id: string, name: string): DuelDeckDTO {
  const cards = s.cards.map((c) => toCardDTO(c, qaRegistry));
  const roleCounts = { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 };
  for (const c of cards) roleCounts[c.role] += 1;
  return {
    id, name, cardUids: cards.map((c) => c.uid), cards, valid: true, status: "READY_FOR_DUEL", roleCounts,
    missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 0, Flex: 0 }, errors: [],
    sumOvr: cards.reduce((a, c) => a + c.ovr, 0), updatedAt: QA_NOW,
  };
}

const MINE = qaSnapshot(0, "qa-you", "QA SYNTHETIC · Mi equipo");
export const DECK_READY = deckDTO(MINE, "00000000-0000-4000-8000-0000000000a1", "QA · Mi equipo");
export const DECK_INVALID: DuelDeckDTO = (() => {
  const cards = DECK_READY.cards.slice(0, 7);
  return {
    ...DECK_READY, id: "00000000-0000-4000-8000-0000000000a2", name: "QA · A medias", cards, cardUids: cards.map((c) => c.uid), valid: false,
    status: "INCOMPLETE" as unknown as DuelDeckDTO["status"],
    missingByRole: { Duelista: 0, Controlador: 0, Iniciador: 0, Centinela: 2, Flex: 1 },
    errors: [],
    sumOvr: cards.reduce((a, c) => a + c.ovr, 0),
  };
})();

/* ─────────────── partidas del motor canónico ─────────────── */

/** El mazo REAL del rival del nodo, por el validador y el snapshot canónicos (igual que `fixedOpponentDeck`). */
export function planSnapshot(nodeId: string): DuelDeckSnapshot {
  const plan = PLANS.get(nodeId);
  if (!plan || !plan.ok) throw new Error(`rival no disponible para ${nodeId}`);
  const owned = plan.cards.map((c, i) => ({ uid: `bot-rtc-${nodeId}-${i}`, cardId: c.cardId, obtainedAt: 0 }));
  const deck = createDuelDeck({ id: `bot-rtc-${nodeId}`, name: plan.teamName, cards: owned.map((o) => o.uid), now: 0 });
  const validation = validateDuelDeck(deck, makeDeckResolver(qaRegistry, ownershipFromList(owned)));
  return takeDeckSnapshot(deck, validation, 0)!;
}

function find(rival: DuelDeckSnapshot, pred: (m: DuelMatch) => boolean): DuelMatch | null {
  for (let seed = 1; seed <= 400; seed++) {
    const m = qaSimulate(MINE, rival, 10, seed % 2 ? "A" : "B", seed);
    if (m.result && pred(m)) return m;
  }
  return null;
}

export function resultViews(nodeId: string): { win: DuelMatchView | null; loss: DuelMatchView | null; draw: DuelMatchView | null; drawMirror: boolean; board: DuelMatchView } {
  const rival = planSnapshot(nodeId);
  const label = rival.deckName;
  const v = (m: DuelMatch | null) => (m ? qaView(m, "A", "PVE", label) : null);
  // Un empate real es raro contra un rival distinto; si las semillas no lo dan, se usa un empate REAL del motor
  // en espejo (mismo mazo a ambos lados) y la escena lo declara.
  const realDraw = find(rival, (m) => m.result!.isDraw);
  const mirrorDraw = realDraw ? null : find(qaSnapshot(0, "qa-mirror", "QA · Espejo"), (m) => m.result!.isDraw);
  return {
    win: v(find(rival, (m) => m.result!.winner === "A")),
    loss: v(find(rival, (m) => m.result!.winner === "B")),
    draw: v(realDraw ?? mirrorDraw),
    drawMirror: !realDraw && !!mirrorDraw,
    board: qaView(qaSimulate(MINE, rival, 4, "A", 7), "A", "PVE", label),
  };
}

export const settled = (nodeId: string, matchId: string, result: "WIN" | "LOSS" | "DRAW", firstClear: boolean): CampaignAttemptView =>
  ({ nodeId, matchId, status: "SETTLED", result, firstClear, settledAt: QA_NOW });

/* ─────────────── meta (objetivos diarios reales del pool, progreso inventado) ─────────────── */

export const META = snapshotFrom(PROGRESSED);
export const DAILY = dailyPveObjectives(META.objectives);
