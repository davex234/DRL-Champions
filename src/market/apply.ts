/**
 * APLICAR MOVIMIENTOS — mueve rosters de VERDAD en el Living World (Career Fase 4/7).
 *
 * REUTILIZA `freshContract` (términos base), `ensurePlayer` del Timeline (detección de stint/
 * fichaje, anti-dup) y el log `Transfer` del mundo (con los tipos nuevos loan/loan_return/swap).
 * NO reimplementa el modelo de datos: escribe sobre el WorldState existente. Determinista.
 * El store clona `{...world}` tras cada operación (mismo patrón que Fase 3).
 */
import type { WorldState, WorldPlayer, WorldTeam, Contract, Rng, TransferKind } from "@/world";
import { freshContract } from "@/world";
import { ensurePlayer } from "@/live/timeline";
import type { LoanTerms, ActiveLoan, MarketEvent, MarketEventType } from "./types";
import { ns, td } from "@/i18n/runtime";

const tr = ns("market");

let evtCounter = 0;
function mkEvent(type: MarketEventType, world: WorldState, p: WorldPlayer, from: string | null, to: string | null, fee: number, detail: string, magnitude: number, at: number): MarketEvent {
  return { id: `mkt:${world.season}:${type}:${p.id}:${evtCounter++}`, type, season: world.season, at, playerId: p.id, playerNick: p.nick, fromClub: from, toClub: to, fee, detail, magnitude };
}

function logTransfer(world: WorldState, p: WorldPlayer, from: string | null, to: string | null, fee: number, kind: TransferKind): void {
  world.transfers.push({ season: world.season, playerId: p.id, nick: p.nick, from, to, fee, kind });
}

/** Construye un contrato honrando los términos negociados (salario/años), base en freshContract. */
function contractFrom(rng: Rng, p: WorldPlayer, salary: number, years: number, releaseClause?: number): Contract {
  const base = freshContract(rng, p.value, p.innate.ambition);
  return {
    ...base,
    salary: Math.max(200, Math.round(salary)),
    years: Math.max(1, Math.round(years)),
    releaseClause: Math.round(releaseClause ?? Math.max(p.value * 2, salary * 8)),
    happiness: 72, // recién fichado: ilusión
  };
}

function removeFromTeam(world: WorldState, playerId: string): void {
  const p = world.players[playerId];
  if (!p?.teamId) return;
  const t = world.teams[p.teamId];
  if (t) t.roster = t.roster.filter((id) => id !== playerId);
  world.freeAgents = world.freeAgents.filter((id) => id !== playerId);
}

/** Coloca a `p` en `team` (append = suplente si ya hay 5; el usuario reordena para elegir titular). */
function addToTeam(world: WorldState, team: WorldTeam, p: WorldPlayer, contract: Contract): void {
  if (!team.roster.includes(p.id)) team.roster.push(p.id);
  p.teamId = team.id;
  p.contract = contract;
  world.freeAgents = world.freeAgents.filter((id) => id !== p.id);
  ensurePlayer(world.timeline, { id: p.id, nick: p.nick }, world.season, team.id); // stint (fichaje)
}

/** FICHAJE: `buyer` compra a `player` por `fee` (paga al vendedor si lo hay). */
export function applySigning(
  world: WorldState, buyerId: string, playerId: string,
  fee: number, salary: number, years: number, releaseClause: number,
  rng: Rng, at: number,
): MarketEvent | null {
  const buyer = world.teams[buyerId];
  const p = world.players[playerId];
  if (!buyer || !p) return null;
  const sellerId = p.teamId;
  const seller = sellerId ? world.teams[sellerId] : null;
  const isFree = !sellerId;

  buyer.budget = Math.max(0, Math.round(buyer.budget - fee));
  if (seller) seller.budget = Math.round(seller.budget + fee);

  removeFromTeam(world, playerId);
  addToTeam(world, buyer, p, contractFrom(rng, p, salary, years, releaseClause));

  const kind: TransferKind = isFree ? "free" : "transfer";
  logTransfer(world, p, sellerId ?? null, buyerId, Math.round(fee), kind);
  const type: MarketEventType = fee >= 22000 ? "bomb" : "signing";
  const detail = isFree
    ? tr("{name} ficha a {nick} como agente libre.", { name: buyer.name, nick: p.nick })
    : tr("{name} ficha a {nick}{v} por {fee}.", { name: buyer.name, nick: p.nick, v: seller ? ` (de ${seller.name})` : "", fee: Math.round(fee) });
  return mkEvent(type, world, p, sellerId ?? null, buyerId, Math.round(fee), detail, Math.min(100, 40 + fee / 800), at);
}

/** VENTA: variante de fichaje vista desde el vendedor (mismo movimiento). */
export function applySale(world: WorldState, sellerId: string, buyerId: string, playerId: string, fee: number, salary: number, years: number, rng: Rng, at: number): MarketEvent | null {
  const p = world.players[playerId];
  if (!p) return null;
  const ev = applySigning(world, buyerId, playerId, fee, salary, years, Math.max(p.value * 2, fee * 1.5), rng, at);
  if (ev) { ev.type = fee >= 22000 ? "bomb" : "sale"; ev.detail = tr("{v} vende a {nick} por {fee}.", { v: td(world.teams[sellerId]?.name) ?? "?", nick: p.nick, fee: Math.round(fee) }); }
  return ev;
}

/** RENOVACIÓN: el club renueva a un jugador (nuevo salario/años). Fee 0. */
export function applyRenewal(world: WorldState, playerId: string, salary: number, years: number, rng: Rng, at: number): MarketEvent | null {
  const p = world.players[playerId];
  if (!p || !p.teamId) return null;
  p.contract = contractFrom(rng, p, salary, years, p.contract?.releaseClause);
  p.contract.happiness = Math.min(100, (p.contract.happiness ?? 70) + 8);
  logTransfer(world, p, p.teamId, p.teamId, 0, "renewal");
  return mkEvent("renewal", world, p, p.teamId, p.teamId, 0, `${world.teams[p.teamId]?.name} renueva a ${p.nick} (${years} temporadas).`, 45, at);
}

/** LIBERAR: rescinde y manda al jugador a la agencia libre. Fee 0. */
export function applyRelease(world: WorldState, playerId: string, at: number): MarketEvent | null {
  const p = world.players[playerId];
  if (!p) return null;
  const from = p.teamId;
  removeFromTeam(world, playerId);
  p.teamId = null; p.contract = null;
  if (!world.freeAgents.includes(playerId)) world.freeAgents.push(playerId);
  logTransfer(world, p, from, null, 0, "release");
  return mkEvent("release", world, p, from, null, 0, `${from ? world.teams[from]?.name : "?"} libera a ${p.nick}.`, 35, at);
}

/** CESIÓN (loan out): `player` del `ownerId` se va cedido al `loanClubId`. Devuelve el loan activo. */
export function applyLoanOut(
  world: WorldState, ownerId: string, loanClubId: string, playerId: string, terms: LoanTerms, rng: Rng, at: number,
): { event: MarketEvent; loan: ActiveLoan } | null {
  const owner = world.teams[ownerId];
  const loanClub = world.teams[loanClubId];
  const p = world.players[playerId];
  if (!owner || !loanClub || !p) return null;
  // Físicamente juega en el club cesionario (entra a su roster), pero sigue en propiedad del owner.
  removeFromTeam(world, playerId);
  const c = contractFrom(rng, p, Math.round((p.contract?.salary ?? p.value * 0.12) * terms.wageShare), terms.seasons, p.contract?.releaseClause);
  addToTeam(world, loanClub, p, c);
  logTransfer(world, p, ownerId, loanClubId, 0, "loan");
  const loan: ActiveLoan = {
    playerId, playerNick: p.nick, ownerClub: ownerId, loanClub: loanClubId,
    startSeason: world.season, endSeason: world.season + terms.seasons, terms: { ...terms, ownerClub: ownerId },
  };
  const event = mkEvent("loan_out", world, p, ownerId, loanClubId, 0, `${owner.name} cede a ${p.nick} a ${loanClub.name} (${terms.seasons} temp.).`, 40, at);
  return { event, loan };
}

/** RETORNO de cesión: el jugador vuelve a su club propietario (si hay hueco; si no, al banquillo). */
export function applyLoanReturn(world: WorldState, loan: ActiveLoan, rng: Rng, at: number): MarketEvent | null {
  const owner = world.teams[loan.ownerClub];
  const p = world.players[loan.playerId];
  if (!owner || !p) return null;
  removeFromTeam(world, loan.playerId);
  addToTeam(world, owner, p, contractFrom(rng, p, p.contract?.salary ?? Math.round(p.value * 0.12), Math.max(1, p.contract?.years ?? 2), p.contract?.releaseClause));
  logTransfer(world, p, loan.loanClub, loan.ownerClub, 0, "loan_return");
  return mkEvent("loan_return", world, p, loan.loanClub, loan.ownerClub, 0, tr("{nick} vuelve de su cesión a {name}.", { nick: p.nick, name: owner.name }), 25, at);
}

/** INTERCAMBIO (swap): dos clubes cambian un jugador cada uno (con posible fee de compensación). */
export function applySwap(world: WorldState, clubA: string, playerA: string, clubB: string, playerB: string, cashFromA: number, rng: Rng, at: number): MarketEvent | null {
  const a = world.teams[clubA], b = world.teams[clubB];
  const pa = world.players[playerA], pb = world.players[playerB];
  if (!a || !b || !pa || !pb) return null;
  a.budget = Math.max(0, Math.round(a.budget - cashFromA)); b.budget = Math.round(b.budget + cashFromA);
  removeFromTeam(world, playerA); removeFromTeam(world, playerB);
  addToTeam(world, b, pa, contractFrom(rng, pa, pa.contract?.salary ?? Math.round(pa.value * 0.12), 2, pa.contract?.releaseClause));
  addToTeam(world, a, pb, contractFrom(rng, pb, pb.contract?.salary ?? Math.round(pb.value * 0.12), 2, pb.contract?.releaseClause));
  logTransfer(world, pa, clubA, clubB, cashFromA, "swap");
  logTransfer(world, pb, clubB, clubA, 0, "swap");
  return mkEvent("swap", world, pa, clubA, clubB, cashFromA, tr("Intercambio: {nick} ⇄ {nick2} entre {name} y {name2}.", { nick: pa.nick, nick2: pb.nick, name: a.name, name2: b.name }), 55, at);
}
