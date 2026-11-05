/**
 * FASE 39 · FIXTURES SINTÉTICAS DE DRAFT GAUNTLET — para el arnés `/design-system/fase39` y las pruebas de render.
 *
 * No son datos inventados: cada foto se construye con el DOMINIO real (pool del catálogo del código, semilla fija,
 * `createRunState` / `applyPick` / `toRunView` / `buildDraftSnapshot`). Lo único sintético es el ESTADO en el que se
 * congela la run (p. ej. «combate 3 en curso»), que en producción solo alcanza el servidor.
 */
import { CardRegistry } from "@/collection/registry";
import { buildDraftPool, eligibleDataVersion } from "@/domain/draft/generate";
import {
  applyPick, createRunState, currentOffer, isDraftComplete, toRunView,
  type DraftMatchFact, type DraftRunRow, type DraftRunState,
} from "@/domain/draft/run";
import { buildDraftSnapshot, type DraftHistoryItem, type DraftSnapshot } from "@/domain/draft/snapshot";
import type { DraftRunStatus, StageOutcome } from "@/domain/draft/rules";
import { draftResultCopy, type DraftResultCopy, type PickUi } from "@/lib/draft/presentation";

export const FASE39_STATES = [
  "landing", "landing-history", "new-run", "pick-1", "pick-5", "pick-10", "preview", "compare", "confirm", "loading-pick",
  "stale", "offline", "draft-complete", "gauntlet-map", "stage-1", "stage-2", "stage-3", "stage-4", "final", "in-match",
  "recovery", "win", "loss", "draw", "completed", "failed", "abandoned", "abandon-confirm", "art-failure", "long-names",
  "unavailable", "loading", "error",
] as const;
export type Fase39State = (typeof FASE39_STATES)[number];

export interface Fase39Fixture {
  snapshot: DraftSnapshot | null;
  ui: PickUi;
  busy?: boolean;
  offline?: boolean;
  loading?: boolean;
  notice?: { tone: "info" | "warn" | "error"; text: string } | null;
  abandonOpen?: boolean;
  forceArtFallback?: boolean;
  /** Estados de la arena: el banner de resultado que se enseña dentro del `ResultScreen` canónico. */
  result?: DraftResultCopy | null;
  note: string;
}

const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const POOL = buildDraftPool(INPUT, eligibleDataVersion(INPUT) ?? "");
const SEED = 1939;
const RUN_ID = "39393939-0000-4000-8000-000000000039";
const CREATED = "2026-09-16T10:00:00.000Z";

function stateAfter(picks: number, choose = 1): DraftRunState {
  let s = createRunState(POOL, SEED);
  for (let i = 0; i < picks && !isDraftComplete(s); i++) {
    const offer = currentOffer(s);
    const r = applyPick(s, POOL, SEED, offer[Math.min(choose, offer.length - 1)]);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

function row(state: DraftRunState, status: DraftRunStatus, stage = 1, matchId: string | null = null): DraftRunRow {
  const final = status === "COMPLETED" || status === "FAILED" || status === "ABANDONED";
  return {
    id: RUN_ID, status, stage, version: state.picks.length + 1 + (stage - 1) * 2, rules_version: state.rulesVersion,
    data_version: state.dataVersion, state, current_match_id: matchId, created_at: CREATED, completed_at: final ? "2026-09-16T10:40:00.000Z" : null,
  };
}

const settled = (stage: number, result: StageOutcome, you = 6, rival = 4): DraftMatchFact => ({ stage, status: "SETTLED", result, matchId: `m-${stage}`, scoreYou: you, scoreRival: rival });
const wins = (n: number) => Array.from({ length: n }, (_, i) => settled(i + 1, "WIN", 6 + (i % 2), 4 - (i % 2)));

const HISTORY: DraftHistoryItem[] = [
  { runId: "h1", status: "FAILED", stage: 3, wins: 2, createdAt: "2026-09-15T18:00:00.000Z", completedAt: "2026-09-15T18:35:00.000Z" },
  { runId: "h2", status: "COMPLETED", stage: 5, wins: 5, createdAt: "2026-09-14T20:00:00.000Z", completedAt: "2026-09-14T21:10:00.000Z" },
  { runId: "h3", status: "ABANDONED", stage: 1, wins: 0, createdAt: "2026-09-13T12:00:00.000Z", completedAt: "2026-09-13T12:05:00.000Z" },
];

function snap(r: DraftRunRow | null, matches: DraftMatchFact[] = [], opts: { last?: { row: DraftRunRow; matches: DraftMatchFact[] } | null; history?: DraftHistoryItem[] } = {}): DraftSnapshot {
  return buildDraftSnapshot({
    run: r ? toRunView(r, matches) : null,
    lastRun: opts.last ? toRunView(opts.last.row, opts.last.matches) : null,
    history: opts.history ?? [], resolver: REG, serverNow: Date.parse("2026-09-16T11:00:00.000Z"),
  });
}

const browse: PickUi = { phase: "browse" };
const full = stateAfter(10);

export function fase39Fixture(state: Fase39State): Fase39Fixture {
  switch (state) {
    case "landing": return { snapshot: snap(null), ui: browse, note: "Sin runs: portada del modo." };
    case "landing-history": return { snapshot: snap(null, [], { last: { row: row(full, "FAILED", 3), matches: [...wins(2), settled(3, "LOSS", 3, 7)] }, history: HISTORY }), ui: browse, note: "Portada con última run e historial." };
    case "new-run": case "pick-1": return { snapshot: snap(row(stateAfter(0), "DRAFTING")), ui: browse, note: "Primera elección de una run nueva." };
    case "pick-5": return { snapshot: snap(row(stateAfter(4), "DRAFTING")), ui: browse, note: "Quinta elección." };
    case "pick-10": return { snapshot: snap(row(stateAfter(9), "DRAFTING")), ui: browse, note: "Última elección." };
    case "preview": return { snapshot: snap(row(stateAfter(4), "DRAFTING")), ui: { phase: "preview", index: 1 }, note: "Vista previa de la opción 2." };
    case "compare": return { snapshot: snap(row(stateAfter(9), "DRAFTING")), ui: { phase: "preview", index: 0 }, note: "Comparación con el ya elegido del mismo rol." };
    case "confirm": return { snapshot: snap(row(stateAfter(6), "DRAFTING")), ui: { phase: "preview", index: 2 }, note: "Listo para CONFIRMAR ELECCIÓN." };
    case "loading-pick": return { snapshot: snap(row(stateAfter(6), "DRAFTING")), ui: { phase: "sending", index: 2 }, busy: true, note: "Elección en vuelo: todo bloqueado." };
    case "stale": return { snapshot: snap(row(stateAfter(5), "DRAFTING")), ui: browse, notice: { tone: "warn", text: "La run cambió en otra pestaña. Se ha actualizado." }, note: "409 STALE_VERSION resincronizado." };
    case "offline": return { snapshot: snap(row(stateAfter(3), "DRAFTING")), ui: browse, offline: true, note: "Sin conexión: última foto, acciones desactivadas." };
    case "draft-complete": return { snapshot: snap(row(full, "READY", 1)), ui: browse, note: "PLANTILLA COMPLETA." };
    case "gauntlet-map": case "stage-1": return { snapshot: snap(row(full, "READY", 1)), ui: browse, note: "Mapa: combate 01 siguiente." };
    case "stage-2": return { snapshot: snap(row(full, "READY", 2), wins(1)), ui: browse, note: "Combate 02." };
    case "stage-3": return { snapshot: snap(row(full, "READY", 3), wins(2)), ui: browse, note: "Combate 03." };
    case "stage-4": return { snapshot: snap(row(full, "READY", 4), wins(3)), ui: browse, note: "Combate 04." };
    case "final": return { snapshot: snap(row(full, "READY", 5), wins(4)), ui: browse, note: "FINAL." };
    case "in-match": return { snapshot: snap(row(full, "IN_MATCH", 3, "m-3"), [...wins(2), { stage: 3, status: "STARTED", result: null, matchId: "m-3", scoreYou: null, scoreRival: null }]), ui: browse, note: "Combate abierto en el servidor." };
    case "recovery": return { snapshot: snap(row(full, "IN_MATCH", 2, "m-2"), [...wins(1), { stage: 2, status: "STARTED", result: null, matchId: "m-2", scoreYou: null, scoreRival: null }]), ui: browse, notice: { tone: "info", text: "Run recuperada desde el servidor: tu combate 02 sigue abierto." }, note: "Recuperación tras recargar." };
    case "win": {
      const r = row(full, "READY", 3);
      const m = wins(2);
      return { snapshot: snap(r, m), ui: browse, result: draftResultCopy(toRunView(r, m), "m-2"), note: "Resultado: combate 02 superado." };
    }
    case "loss": {
      const r = row(full, "FAILED", 4); const m = [...wins(3), settled(4, "LOSS", 4, 6)];
      return { snapshot: snap(null, [], { last: { row: r, matches: m }, history: HISTORY }), ui: browse, result: draftResultCopy(toRunView(r, m), "m-4"), note: "Resultado: derrota en el 04." };
    }
    case "draw": {
      const r = row(full, "FAILED", 2); const m = [...wins(1), settled(2, "DRAW", 5, 5)];
      return { snapshot: snap(null, [], { last: { row: r, matches: m } }), ui: browse, result: draftResultCopy(toRunView(r, m), "m-2"), note: "Resultado: empate en el 02 (run terminada)." };
    }
    case "completed": {
      const r = row(full, "COMPLETED", 5); const m = wins(5);
      return { snapshot: snap(null, [], { last: { row: r, matches: m }, history: HISTORY }), ui: browse, result: draftResultCopy(toRunView(r, m), "m-5"), note: "Gauntlet superado." };
    }
    case "failed": return { snapshot: snap(null, [], { last: { row: row(full, "FAILED", 2), matches: [...wins(1), settled(2, "LOSS", 2, 8)] }, history: HISTORY }), ui: browse, note: "Run terminada." };
    case "abandoned": return { snapshot: snap(null, [], { last: { row: row(stateAfter(4), "ABANDONED", 1), matches: [] }, history: HISTORY }), ui: browse, note: "Run abandonada." };
    case "abandon-confirm": return { snapshot: snap(row(stateAfter(7), "DRAFTING")), ui: browse, abandonOpen: true, note: "Confirmación de abandono." };
    case "art-failure": return { snapshot: snap(row(stateAfter(2), "DRAFTING")), ui: { phase: "preview", index: 0 }, forceArtFallback: true, note: "Arte no disponible: cara de texto." };
    case "long-names": {
      const s = snap(row(stateAfter(3), "DRAFTING"));
      const offer = s.run!.offer;
      const cards = { ...s.cards };
      offer.forEach((id, i) => { cards[id] = { ...cards[id], nick: ["Supercalifragilisticoespialidoso", "Nombre-De-Jugador-Extremadamente-Largo", "X"][i] ?? cards[id].nick, team: "Equipo Internacional de Nombre Larguísimo Esports Club" }; });
      return { snapshot: { ...s, cards }, ui: { phase: "preview", index: 1 }, note: "Nombres y equipos muy largos." };
    }
    case "unavailable": return { snapshot: buildDraftSnapshot({ run: null, history: [], resolver: REG, serverNow: 0, available: false, unavailableReason: "MIGRATION_PENDING" }), ui: browse, note: "0053 sin aplicar." };
    case "loading": return { snapshot: null, ui: browse, loading: true, note: "Cargando." };
    case "error": return { snapshot: null, ui: browse, note: "Error de lectura." };
  }
}
