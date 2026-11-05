/**
 * CONTEXTO RESUELTO — completa el `OrchestratorCtx` con los mismos defaults que usan los
 * verifies y la app: roster = catálogo vivo (`allPlayers`), identidad vacía, historia vacía.
 * NO construye motores: solo prepara los contextos que sus APIs públicas ya esperan.
 */
import { makeClock, createIdentityResolver, buildRegistry, type ImportCtx } from "@/importer";
import type { TournamentFact } from "@/analyzer";
import type { VlrImportOptions } from "@/importer-vlr";
import type { GeneratorLedger, EditorialOverride } from "@/card-generator";
import { allPlayers } from "@/data/catalog";
import type { Player } from "@/domain/cards/types";
import type { OrchestratorCtx, OrchestratorEvents } from "./types";

export interface ResolvedOrchestratorCtx {
  now: number;
  roster: Player[];
  importCtx: ImportCtx;
  history: TournamentFact[];
  vlr: VlrImportOptions;
  ledger?: GeneratorLedger;
  overrides?: EditorialOverride[];
  aliases?: Record<string, string>;
  season?: number;
  persist?: (players: Player[]) => void;
  events: OrchestratorEvents;
  timer: () => number;
}

const defaultTimer = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function resolveCtx(ctx: OrchestratorCtx = {}): ResolvedOrchestratorCtx {
  const now = ctx.now ?? 0;
  return {
    now,
    roster: ctx.roster ?? allPlayers(),
    importCtx: { clock: makeClock(now), identity: createIdentityResolver(ctx.registry ?? buildRegistry([])) },
    history: ctx.history ?? [],
    vlr: ctx.vlr ?? {},
    ledger: ctx.ledger,
    overrides: ctx.overrides,
    aliases: ctx.aliases,
    season: ctx.season,
    persist: ctx.persist,
    events: ctx.events ?? {},
    timer: ctx.timer ?? defaultTimer,
  };
}
