/**
 * DRAFT GAUNTLET · FOTO PARA EL CLIENTE (Fase 39) — pura.
 *
 * Lo único que sale del servidor: la run redactada (`toRunView`: sin semilla ni mazos rivales), las cartas que el
 * jugador YA puede ver (la oferta actual y sus elecciones, con datos públicos del catálogo), un historial mínimo y la
 * economía del modo (entrada y tabla, F72). Nunca: la semilla, las ofertas futuras, las cartas del rival ni ids internos de BD.
 */
import type { CardDef, Player } from "@/domain/cards/types";
import { canonicalCardTeam } from "@/data/teamIdentities";
import {
  DRAFT_MODE_NAME, DRAFT_MODE_TAGLINE, DRAFT_OPTIONS, DRAFT_PICKS, DRAFT_RULES_VERSION, GAUNTLET_STAGES,
  type DraftRunStatus,
} from "./rules";
import { draftEconomyView, type DraftEconomyView } from "./economy";
import type { DraftRunView } from "./run";

export interface DraftCardDTO {
  cardId: string;
  playerId: string;
  nick: string;
  team: string;
  teamTag: string;
  country: string;
  role: Player["role"];
  region: Player["region"];
  variantId: CardDef["variantId"];
  ovr: number;
  combat: NonNullable<CardDef["combat"]> | null;
}

export interface DraftHistoryItem {
  runId: string;
  status: DraftRunStatus;
  wins: number;
  stage: number;
  createdAt: string;
  completedAt: string | null;
}

export type DraftUnavailableReason = "MIGRATION_PENDING" | "POOL_UNAVAILABLE";

export interface DraftSnapshot {
  available: boolean;
  unavailableReason: DraftUnavailableReason | null;
  mode: { name: string; tagline: string; rulesVersion: string; picks: number; options: number; stages: number };
  run: DraftRunView | null;
  /** Sin run activa: la última run terminada (resumen de COMPLETADA / FALLIDA / ABANDONADA). */
  lastRun: DraftRunView | null;
  cards: Record<string, DraftCardDTO>;
  history: DraftHistoryItem[];
  /** F72 · entrada y tabla de recompensas del modo (las mismas que aplica el servidor). */
  economy: DraftEconomyView;
  serverNow: number;
}

export interface CardResolver {
  card(cardId: string): CardDef | undefined;
  player(playerId: string): Player | undefined;
}

export function draftCardDTO(cardId: string, r: CardResolver): DraftCardDTO | null {
  const c = r.card(cardId);
  const p = c ? r.player(c.playerId) : undefined;
  if (!c || !p) return null;
  return {
    cardId: c.id, playerId: c.playerId, nick: p.nick, team: canonicalCardTeam(c, p).label, teamTag: c.team ?? p.teamTag, country: p.country,
    role: c.role ?? p.role, region: p.region, variantId: c.variantId, ovr: c.ovr, combat: c.combat ?? null,
  };
}

/** Victorias de una run terminada, sin leer sus combates: completada = 5; si no, las etapas superadas. */
export function winsOf(status: DraftRunStatus, stage: number): number {
  return status === "COMPLETED" ? GAUNTLET_STAGES : Math.max(0, stage - 1);
}

export function buildDraftSnapshot(input: {
  run: DraftRunView | null;
  lastRun?: DraftRunView | null;
  history: DraftHistoryItem[];
  resolver: CardResolver;
  serverNow: number;
  available?: boolean;
  unavailableReason?: DraftUnavailableReason | null;
}): DraftSnapshot {
  const cards: Record<string, DraftCardDTO> = {};
  const lastRun = input.run ? null : input.lastRun ?? null;
  for (const id of [...(input.run?.offer ?? []), ...(input.run?.picks ?? []), ...(lastRun?.picks ?? [])]) {
    const dto = draftCardDTO(id, input.resolver);
    if (dto) cards[id] = dto;
  }
  return {
    available: input.available ?? true,
    unavailableReason: input.unavailableReason ?? null,
    mode: { name: DRAFT_MODE_NAME, tagline: DRAFT_MODE_TAGLINE, rulesVersion: DRAFT_RULES_VERSION, picks: DRAFT_PICKS, options: DRAFT_OPTIONS, stages: GAUNTLET_STAGES },
    run: input.run,
    lastRun,
    cards,
    history: input.history,
    economy: draftEconomyView(),
    serverNow: input.serverNow,
  };
}
