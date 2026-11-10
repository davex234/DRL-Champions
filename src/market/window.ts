/**
 * VENTANA DE FICHAJES — la participación del USUARIO como director deportivo (Career Fase 4/7).
 *
 * Orquesta el mercado interactivo del club del usuario: ojeo de objetivos (reusa `scoutPlayer`),
 * negociación (oferta→contraoferta→aceptación/rechazo), cesiones, renovaciones, liberaciones,
 * alineación (titulares/suplentes) y estatus de transferibilidad. Mueve rosters de VERDAD (via
 * `apply.ts`). Determinista. Cada acción devuelve `{ window, world?, event? }`; el store persiste.
 */
import type { WorldState, WorldPlayer, WorldTeam } from "@/world";
import { makeRng, seedOf } from "@/world";
import { scoutPlayer, progress, ageBand } from "@/development";
import type { TransferWindow, MarketTarget, PlayerOffer, MarketEvent, ListStatus, LoanTerms, NegotiationRound } from "./types";
import { directorStance, directorReview } from "./director";
import { squadNeeds, needsRole } from "./needs";
import { marketValue, askingFee } from "./value";
import { evaluateBid, applyRound, affordable, type BidContext } from "./negotiate";
import { generateIncomingOffers, generateRumors } from "./clubAI";
import { applySigning, applySale, applyRenewal, applyRelease, applyLoanOut, applyLoanReturn } from "./apply";
import { ns } from "@/i18n/runtime";

const tr = ns("market");

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
type Step = { window: TransferWindow; event: MarketEvent | null; error?: string };
const ok = (window: TransferWindow, event: MarketEvent | null = null): Step => ({ window, event });
const err = (window: TransferWindow, error: string): Step => ({ window, event: null, error });

const isKeyStarter = (team: WorldTeam, playerId: string): boolean => team.roster.slice(0, 5).includes(playerId);

// ─────────────────────────── Objetivos (scouting de mercado) ───────────────────────────

/** Estima el encaje (fit) y química de un objetivo con la plantilla del usuario. Determinista. */
function fitAndChem(p: WorldPlayer, userTeam: WorldTeam, world: WorldState, needs: ReturnType<typeof squadNeeds>): { fit: number; chem: number } {
  const roleNeed = needsRole(needs, p.role);
  const fit = clamp100(45 + roleNeed * 0.3 + (p.innate.workEthic - 50) * 0.4 + (p.innate.potential - 60) * 0.2);
  const starters = userTeam.roster.slice(0, 5).map((id) => world.players[id]).filter((x): x is WorldPlayer => !!x);
  const rng = makeRng(seedOf(p.id, "chem", userTeam.id));
  const amb = starters.length ? starters.reduce((a, s) => a + Math.abs(s.innate.ambition - p.innate.ambition), 0) / starters.length : 20;
  const chem = clamp100(60 - amb * 0.4 + (rng.next() * 10 - 5));
  return { fit, chem };
}

function toTarget(p: WorldPlayer, world: WorldState, userTeam: WorldTeam, needs: ReturnType<typeof squadNeeds>): MarketTarget {
  const team = p.teamId ? world.teams[p.teamId] : null;
  const mv = marketValue(p, team);
  const years = p.contract?.years ?? 0;
  const { fit, chem } = fitAndChem(p, userTeam, world, needs);
  const listed = false;
  return {
    id: p.id, nick: p.nick, region: p.region, role: p.role, teamId: p.teamId, teamName: team?.name ?? tr("Agente libre"),
    rating: Math.round(progress(p.dev)), potential: p.innate.potential, age: p.dev.age, value: mv.value,
    askingFee: p.teamId ? askingFee(mv, years, listed) : 0, wageDemand: mv.wageDemand, releaseClause: mv.releaseClause,
    contractYears: years, status: "normal", fit, chemistry: chem, report: scoutPlayer(p.innate, p.dev),
    rumor: p.contract && p.contract.happiness < 40 ? tr("Descontento en su club") : null,
  };
}

/** Ojea objetivos: agentes libres + jugadores comprables de otros clubes, priorizando necesidades. */
export function buildTargets(world: WorldState, clubId: string, seed: number, limit = 12): MarketTarget[] {
  const userTeam = world.teams[clubId];
  if (!userTeam) return [];
  const needs = squadNeeds(userTeam, world.players);
  const rng = makeRng(seedOf(seed, "targets", world.season));
  const pool: WorldPlayer[] = [];
  for (const id of world.freeAgents) { const p = world.players[id]; if (p && p.status === "active" && !p.teamId) pool.push(p); }
  for (const p of Object.values(world.players)) {
    if (p.status !== "active" || !p.teamId || p.teamId === clubId) continue;
    if ((world.teams[p.teamId]?.roster.length ?? 0) < 5) continue; // no dejar al vendedor en cuadro
    pool.push(p);
  }
  const scored = pool.map((p) => {
    const roleNeed = needsRole(needs, p.role);
    const noise = (rng.next() - 0.5) * 20;
    return { p, score: progress(p.dev) + p.innate.potential * 0.5 + roleNeed * 0.8 + noise };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ p }) => toTarget(p, world, userTeam, needs));
}

// ─────────────────────────── Apertura / cierre ───────────────────────────

/** Abre la ventana de fichajes del club del usuario para la temporada. Procesa retornos de cesión. */
export function openTransferWindow(world: WorldState, clubId: string, season: number, seed: number, prevLoans: TransferWindow["loans"] = [], at = 0): { window: TransferWindow; events: MarketEvent[] } {
  const team = world.teams[clubId];
  const stance = team ? directorStance(team) : { philosophy: "long_project" as const, aggression: 50, patience: 60, youthBias: 50, message: "" };
  const events: MarketEvent[] = [];
  const loans: TransferWindow["loans"] = [];
  const rng = makeRng(seedOf(seed, "window", season));

  // Retornos de cesión del usuario cuyo plazo venció.
  for (const loan of prevLoans) {
    if (season >= loan.endSeason) { const ev = applyLoanReturn(world, loan, rng, at); if (ev) events.push(ev); }
    else loans.push(loan);
  }

  const roster = team ? team.roster.map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p) : [];
  const listReco = directorReview(stance, squadNeeds(team!, world.players), roster.map((p) => ({ id: p.id, value: p.value, years: p.contract?.years ?? 0, happiness: p.contract?.happiness ?? 60, age: p.dev.age, potential: p.innate.potential })));
  const targets = buildTargets(world, clubId, seed);
  const incoming = generateIncomingOffers(world, clubId, listReco, season);
  const rumors = generateRumors(world, [], season);

  const window: TransferWindow = {
    clubId, season, seed, open: true, stance,
    offers: incoming, targets, rumors, listStatus: listReco, loans,
    spentThisSeason: 0, earnedThisSeason: 0, log: events.slice(),
  };
  return { window, events };
}

export function closeTransferWindow(window: TransferWindow): TransferWindow {
  return { ...window, open: false };
}

// ─────────────────────────── Utilidades de estado ───────────────────────────

function pushLog(window: TransferWindow, event: MarketEvent | null): TransferWindow {
  return event ? { ...window, log: [event, ...window.log].slice(0, 60) } : window;
}
function accrue(window: TransferWindow, spend: number, earn: number): TransferWindow {
  return { ...window, spentThisSeason: window.spentThisSeason + spend, earnedThisSeason: window.earnedThisSeason + earn };
}

// ─────────────────────────── Alineación / estatus ───────────────────────────

/** Reordena el roster del club para fijar los 5 titulares (los demás quedan de suplentes). */
export function setLineup(world: WorldState, window: TransferWindow, starterIds: string[]): Step {
  const team = world.teams[window.clubId];
  if (!team) return err(window, tr("Sin club."));
  const present = starterIds.filter((id) => team.roster.includes(id));
  const rest = team.roster.filter((id) => !present.includes(id));
  team.roster = [...present.slice(0, 5), ...rest, ...present.slice(5)];
  return ok(window);
}

/** Fija la transferibilidad de un jugador del usuario y regenera pujas entrantes por él. */
export function setListStatus(world: WorldState, window: TransferWindow, playerId: string, status: ListStatus): Step {
  const listStatus = { ...window.listStatus, [playerId]: status };
  const otherOffers = window.offers.filter((o) => o.playerId !== playerId || o.direction !== "incoming");
  const fresh = generateIncomingOffers(world, window.clubId, listStatus, window.season).filter((o) => o.playerId === playerId);
  return ok({ ...window, listStatus, offers: [...otherOffers, ...fresh] });
}

// ─────────────────────────── Negociación saliente (compras) ───────────────────────────

function bidContext(world: WorldState, p: WorldPlayer): BidContext {
  const team = p.teamId ? world.teams[p.teamId] : null;
  const mv = marketValue(p, team);
  return { value: mv.value, releaseClause: mv.releaseClause, wageDemand: mv.wageDemand, years: p.contract?.years ?? 0, isStarterKey: !!team && isKeyStarter(team, p.id), status: window0status(world, p), stance: directorStance(team ?? ({ id: "", prestige: 50, budget: 15000 } as WorldTeam)) };
}
function window0status(world: WorldState, p: WorldPlayer): ListStatus { return p.contract && p.contract.happiness < 40 ? "listed" : "normal"; }

/** El usuario PUJA por un objetivo. Devuelve el resultado inmediato de la IA (accept/counter/reject). */
export function makeOffer(world: WorldState, window: TransferWindow, targetId: string, bid: { fee: number; salary: number; years: number }, at: number): Step {
  const p = world.players[targetId];
  const buyer = world.teams[window.clubId];
  if (!p || !buyer) return err(window, tr("Objetivo o club no válido."));
  if (p.teamId === window.clubId) return err(window, tr("Ya es de tu club."));
  const isFree = !p.teamId;
  const rng = makeRng(seedOf(window.seed, "bid-out", targetId, window.season, window.offers.length));

  let offer: PlayerOffer = {
    id: `offer:out:${targetId}:${window.season}`, season: window.season, playerId: targetId, playerNick: p.nick, role: p.role,
    fromClub: p.teamId ?? "", fromClubName: p.teamId ? world.teams[p.teamId]?.name ?? "?" : tr("Agente libre"),
    toClub: window.clubId, toClubName: buyer.name, initiator: "user", direction: "outgoing", kind: isFree ? "free" : "transfer",
    fee: bid.fee, salary: bid.salary, years: bid.years, bonus: 0, releaseClause: Math.round(marketValue(p, p.teamId ? world.teams[p.teamId] : null).value * 2), loan: null, swapPlayerId: null,
    status: "pending", rounds: [{ by: "user", fee: bid.fee, salary: bid.salary, years: bid.years, note: tr("Oferta inicial.") }], note: "",
  };

  if (isFree) {
    // Agente libre: sin fee; sólo el jugador debe aceptar el contrato.
    const mv = marketValue(p, null);
    if (bid.salary >= mv.wageDemand * 0.92 && bid.years >= 1) {
      const ev = applySigning(world, window.clubId, targetId, 0, bid.salary, bid.years, mv.releaseClause, rng, at);
      offer = applyRound(offer, { by: "ai", fee: 0, salary: bid.salary, years: bid.years, note: tr("El jugador firma.") }, "accepted");
      return finalizeBuy(world, window, offer, ev, 0);
    }
    offer = applyRound(offer, { by: "ai", fee: 0, salary: Math.round(mv.wageDemand), years: Math.max(2, bid.years), note: tr("Pide {wageDemand}/temp.", { wageDemand: Math.round(mv.wageDemand) }) }, "countered");
    return ok(upsertOffer(window, offer));
  }

  const verdict = evaluateBid(bidContext(world, p), bid, rng);
  if (verdict.kind === "accept") {
    if (!affordable(buyer.budget, bid.fee)) { offer = { ...offer, status: "rejected", note: tr("No tienes presupuesto.") }; return err(upsertOffer(window, offer), tr("Presupuesto insuficiente.")); }
    const ev = applySigning(world, window.clubId, targetId, bid.fee, bid.salary, bid.years, offer.releaseClause, rng, at);
    offer = applyRound(offer, { by: "ai", fee: bid.fee, salary: bid.salary, years: bid.years, note: verdict.note }, "accepted");
    return finalizeBuy(world, window, offer, ev, bid.fee);
  }
  if (verdict.kind === "reject") { offer = applyRound(offer, { by: "ai", fee: bid.fee, salary: bid.salary, years: bid.years, note: verdict.note }, "rejected"); return ok(upsertOffer(window, offer)); }
  offer = applyRound(offer, { by: "ai", fee: verdict.fee, salary: verdict.salary, years: verdict.years, note: verdict.note }, "countered");
  return ok(upsertOffer(window, offer));
}

/** El usuario mejora su puja sobre una negociación en curso. */
export function counterOffer(world: WorldState, window: TransferWindow, offerId: string, bid: { fee: number; salary: number; years: number }, at: number): Step {
  const existing = window.offers.find((o) => o.id === offerId && o.direction === "outgoing");
  if (!existing) return err(window, tr("Negociación no encontrada."));
  if (existing.rounds.length >= 8) return err(window, tr("Negociación agotada."));
  const p = world.players[existing.playerId];
  const buyer = world.teams[window.clubId];
  if (!p || !buyer) return err(window, tr("Datos no válidos."));
  const rng = makeRng(seedOf(window.seed, "bid-out", existing.playerId, window.season, existing.rounds.length));
  let offer = applyRound(existing, { by: "user", fee: bid.fee, salary: bid.salary, years: bid.years, note: tr("Mejora la puja.") }, "pending");
  const verdict = evaluateBid(bidContext(world, p), bid, rng);
  if (verdict.kind === "accept") {
    if (!affordable(buyer.budget, bid.fee)) return err(window, tr("Presupuesto insuficiente."));
    const ev = applySigning(world, window.clubId, existing.playerId, bid.fee, bid.salary, bid.years, offer.releaseClause, rng, at);
    offer = applyRound(offer, { by: "ai", fee: bid.fee, salary: bid.salary, years: bid.years, note: verdict.note }, "accepted");
    return finalizeBuy(world, window, offer, ev, bid.fee);
  }
  if (verdict.kind === "reject") { offer = applyRound(offer, { by: "ai", fee: bid.fee, salary: bid.salary, years: bid.years, note: verdict.note }, "rejected"); return ok(upsertOffer(window, offer)); }
  offer = applyRound(offer, { by: "ai", fee: verdict.fee, salary: verdict.salary, years: verdict.years, note: verdict.note }, "countered");
  return ok(upsertOffer(window, offer));
}

/** El usuario ACEPTA la contraoferta de la IA (paga lo que pide el vendedor). */
export function acceptCounter(world: WorldState, window: TransferWindow, offerId: string, at: number): Step {
  const offer = window.offers.find((o) => o.id === offerId && o.direction === "outgoing");
  if (!offer || offer.status !== "countered") return err(window, tr("No hay contraoferta que aceptar."));
  const buyer = world.teams[window.clubId];
  if (!buyer) return err(window, tr("Sin club."));
  if (!affordable(buyer.budget, offer.fee)) return err(window, tr("Presupuesto insuficiente."));
  const rng = makeRng(seedOf(window.seed, "accept", offer.playerId, window.season));
  const ev = offer.kind === "free"
    ? applySigning(world, window.clubId, offer.playerId, 0, offer.salary, offer.years, offer.releaseClause, rng, at)
    : applySigning(world, window.clubId, offer.playerId, offer.fee, offer.salary, offer.years, offer.releaseClause, rng, at);
  const done = applyRound(offer, { by: "user", fee: offer.fee, salary: offer.salary, years: offer.years, note: tr("Acepta la contraoferta.") }, "accepted");
  return finalizeBuy(world, window, done, ev, offer.kind === "free" ? 0 : offer.fee);
}

function finalizeBuy(world: WorldState, window: TransferWindow, offer: PlayerOffer, ev: MarketEvent | null, fee: number): Step {
  let w = upsertOffer(window, offer);
  w = accrue(w, fee, 0);
  w = pushLog(w, ev);
  // Quita el objetivo ya fichado de la lista.
  w = { ...w, targets: w.targets.filter((t) => t.id !== offer.playerId) };
  return ok(w, ev);
}

function upsertOffer(window: TransferWindow, offer: PlayerOffer): TransferWindow {
  const rest = window.offers.filter((o) => o.id !== offer.id);
  return { ...window, offers: [offer, ...rest].slice(0, 30) };
}

// ─────────────────────────── Ofertas entrantes (ventas) ───────────────────────────

/** El usuario responde a una puja de un club IA por uno de sus jugadores. */
export function respondIncoming(world: WorldState, window: TransferWindow, offerId: string, action: "accept" | "reject" | "counter", counterFee = 0, at = 0): Step {
  const offer = window.offers.find((o) => o.id === offerId && o.direction === "incoming");
  if (!offer || offer.status === "accepted") return err(window, tr("Oferta no válida."));
  const rng = makeRng(seedOf(window.seed, "sell", offer.playerId, window.season, offer.rounds.length));
  if (action === "reject") return ok(upsertOffer(window, { ...offer, status: "rejected", note: tr("Rechazada por el club.") }));
  if (action === "counter") {
    // El usuario pide más; el club IA acepta si la mejora es razonable (≤ 25% sobre su puja).
    const accept = counterFee <= offer.fee * 1.25 && rng.chance(0.7);
    if (accept) return executeSale(world, window, { ...offer, fee: Math.round(counterFee) }, at);
    return ok(upsertOffer(window, applyRound(offer, { by: "ai", fee: offer.fee, salary: offer.salary, years: offer.years, note: tr("El club comprador no sube más.") }, "countered")));
  }
  return executeSale(world, window, offer, at); // accept
}

function executeSale(world: WorldState, window: TransferWindow, offer: PlayerOffer, at: number): Step {
  const rng = makeRng(seedOf(window.seed, "exec-sell", offer.playerId, window.season));
  const ev = applySale(world, window.clubId, offer.toClub, offer.playerId, offer.fee, offer.salary, offer.years, rng, at);
  let w = upsertOffer(window, { ...offer, status: "accepted", note: tr("Vendido.") });
  w = accrue(w, 0, offer.fee);
  w = pushLog(w, ev);
  return ok(w, ev);
}

// ─────────────────────────── Renovar / liberar / ceder ───────────────────────────

export function renewPlayer(world: WorldState, window: TransferWindow, playerId: string, salary: number, years: number, at: number): Step {
  const p = world.players[playerId];
  if (!p || p.teamId !== window.clubId) return err(window, tr("No es de tu club."));
  const rng = makeRng(seedOf(window.seed, "renew", playerId, window.season));
  const ev = applyRenewal(world, playerId, salary, years, rng, at);
  return ok(pushLog(window, ev), ev);
}

export function releasePlayer(world: WorldState, window: TransferWindow, playerId: string, at: number): Step {
  const p = world.players[playerId];
  if (!p || p.teamId !== window.clubId) return err(window, tr("No es de tu club."));
  const ev = applyRelease(world, playerId, at);
  const listStatus = { ...window.listStatus }; delete listStatus[playerId];
  return ok(pushLog({ ...window, listStatus }, ev), ev);
}

/** Cede a un jugador del usuario a un club que lo necesite (préstamo real y persistente). */
export function loanOutPlayer(world: WorldState, window: TransferWindow, playerId: string, loanClubId: string, terms: Omit<LoanTerms, "ownerClub">, at: number): Step {
  const p = world.players[playerId];
  if (!p || p.teamId !== window.clubId) return err(window, tr("No es de tu club."));
  const rng = makeRng(seedOf(window.seed, "loan-out", playerId, window.season));
  const res = applyLoanOut(world, window.clubId, loanClubId, playerId, { ...terms, ownerClub: window.clubId }, rng, at);
  if (!res) return err(window, tr("No se pudo formalizar la cesión."));
  return ok(pushLog({ ...window, loans: [...window.loans, res.loan] }, res.event), res.event);
}

/** Candidatos a recibir una cesión: clubes que necesitan el rol del jugador. */
export function loanDestinations(world: WorldState, window: TransferWindow, playerId: string): { id: string; name: string; need: number }[] {
  const p = world.players[playerId];
  if (!p) return [];
  return Object.values(world.teams)
    .filter((t) => t.id !== window.clubId && t.roster.length <= 6)
    .map((t) => ({ id: t.id, name: t.name, need: needsRole(squadNeeds(t, world.players), p.role) }))
    .filter((t) => t.need > 0).sort((a, b) => b.need - a.need).slice(0, 6);
}

/** Refresca objetivos/rumores/pujas entrantes sin cerrar la ventana (p. ej. tras varias acciones). */
export function refreshWindow(world: WorldState, window: TransferWindow): TransferWindow {
  const targets = buildTargets(world, window.clubId, window.seed);
  const rumors = generateRumors(world, window.log, window.season);
  const outgoing = window.offers.filter((o) => o.direction === "outgoing");
  const incoming = generateIncomingOffers(world, window.clubId, window.listStatus, window.season);
  return { ...window, targets, rumors, offers: [...outgoing, ...incoming].slice(0, 30) };
}
