/**
 * NEGOCIACIÓN — no se acepta nada automáticamente (Career Fase 4/7).
 *
 * Oferta inicial → contraoferta → rechazo → aceptación. Intervienen el CLUB (cobra el fee) y
 * el JUGADOR (acepta salario/duración). Todo influye: valor, cláusula, salario exigido, años
 * de contrato, si es pieza clave, estatus (transferible) y la paciencia del director. PURO y
 * DETERMINISTA (Rng sembrado por el llamador). No hay azar oculto.
 */
import type { Rng } from "@/world";
import type { DirectorStance, ListStatus, PlayerOffer, NegotiationRound } from "./types";
import { directorAcceptsSale } from "./director";

export interface BidContext {
  value: number;
  releaseClause: number;
  wageDemand: number;   // salario que exige el jugador
  years: number;        // años de contrato restantes del jugador
  isStarterKey: boolean;
  status: ListStatus;
  stance: DirectorStance;
}

export type BidVerdict =
  | { kind: "accept"; note: string }
  | { kind: "counter"; fee: number; salary: number; years: number; note: string }
  | { kind: "reject"; note: string };

const round5 = (n: number) => Math.round(n / 5) * 5;

/**
 * El vendedor (club + jugador) evalúa una puja. Puede aceptar, contraofertar o rechazar.
 * `bid` = lo que ofrece el comprador (fee al club, salario/años al jugador).
 */
export function evaluateBid(ctx: BidContext, bid: { fee: number; salary: number; years: number }, rng: Rng): BidVerdict {
  // 1) El JUGADOR: ¿le convence el contrato? (salario vs exigencia + duración mínima).
  const wageOk = bid.salary >= ctx.wageDemand * 0.92;
  const yearsOk = bid.years >= 1;
  // 2) El CLUB: ¿le convence el fee?
  const sale = directorAcceptsSale(ctx.stance, ctx.status, ctx.value, ctx.releaseClause, bid.fee, ctx.isStarterKey);

  if (sale.accept && wageOk && yearsOk) return { kind: "accept", note: sale.reason };

  // Puja insultante (muy por debajo) ⇒ rechazo seco.
  const floor = ctx.status === "listed" ? ctx.value * 0.8 : ctx.value * 0.95;
  if (bid.fee < floor * 0.55) return { kind: "reject", note: "La oferta es ridícula; el club se ofende." };

  // Contraoferta: fee mínimo aceptable + salario que pida el jugador.
  const wantFee = round5(Math.max(bid.fee, sale.accept ? bid.fee : floor) * (1 + (ctx.stance.patience / 100) * 0.12));
  const wantSalary = round5(Math.max(bid.salary, ctx.wageDemand));
  const wantYears = Math.max(bid.years, 2);
  const jitter = rng.chance(0.5) ? 0 : round5(ctx.value * 0.03); // ligera variación determinista
  return {
    kind: "counter",
    fee: wantFee + jitter,
    salary: wantSalary,
    years: wantYears,
    note: !sale.accept ? sale.reason : "El jugador pide mejor contrato.",
  };
}

/** Aplica una ronda de negociación a una oferta (inmutable): añade el turno y actualiza estado. */
export function applyRound(offer: PlayerOffer, round: NegotiationRound, status: PlayerOffer["status"]): PlayerOffer {
  return {
    ...offer,
    fee: round.fee,
    salary: round.salary,
    years: round.years,
    status,
    rounds: [...offer.rounds, round],
    note: round.note,
  };
}

/** ¿Puede el comprador permitirse esta operación? (fee al vendedor). */
export function affordable(budget: number, fee: number): boolean {
  return fee <= budget;
}
