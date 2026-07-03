/**
 * IA DE FICHAJES — los 499 clubes NEGOCIAN aunque el usuario no haga nada (Career Fase 4/7).
 *
 * REUTILIZA el mercado autónomo del mundo (`runTransferMarket` — comprar/vender/renovar/liberar/
 * ascender/agentes libres) blindando al club del usuario, y AÑADE la capa nueva: cesiones reales
 * (bounded, auto-limpiadas vía el log `Transfer`), rumores y ofertas ENTRANTES por los jugadores
 * del usuario. Todo DETERMINISTA (Rng sembrado) y O(clubes) por temporada. No duplica el motor.
 */
import type { WorldState, WorldPlayer, WorldTeam, Rng } from "@/world";
import { runTransferMarket, generateRookie, makeRng, seedOf } from "@/world";
import { progress } from "@/development";
import type { ActiveLoan, ListStatus, MarketEvent, MarketRumor, PlayerOffer, DirectorStance } from "./types";
import { applyLoanOut, applyLoanReturn } from "./apply";
import { directorStance } from "./director";
import { squadNeeds, needsRole } from "./needs";
import { marketValue, askingFee } from "./value";

const NOTABLE_FEE = 9000;

/** Devuelve las cesiones IA de la temporada pasada que aún no han vuelto (auto-limpieza por el log). */
function returnDueAiLoans(world: WorldState, userClubId: string, rng: Rng, at: number): MarketEvent[] {
  const events: MarketEvent[] = [];
  // Recorre la cola reciente del log (O(reciente)): loans de season-1 sin loan_return posterior.
  for (let i = world.transfers.length - 1; i >= 0; i--) {
    const t = world.transfers[i];
    if (t.season < world.season - 1) break; // solo la cola reciente
    if (t.kind !== "loan" || t.season !== world.season - 1) continue;
    if (t.from === userClubId || t.to === userClubId) continue; // las del usuario las gestiona la ventana
    const returned = world.transfers.some((r) => r.kind === "loan_return" && r.playerId === t.playerId && r.season >= t.season);
    if (returned || !t.from) continue;
    const loan: ActiveLoan = { playerId: t.playerId, playerNick: t.nick, ownerClub: t.from, loanClub: t.to ?? t.from, startSeason: t.season, endSeason: world.season, terms: { ownerClub: t.from, seasons: 1, wageShare: 0.5, buyOption: null, buyBackClause: null, guaranteedMinutes: 60 } };
    const ev = applyLoanReturn(world, loan, rng, at);
    if (ev) events.push(ev);
  }
  return events;
}

/** Cesiones IA de la temporada: clubes grandes ceden una joven promesa a clubes que la necesitan. */
function runAiLoans(world: WorldState, userClubId: string, rng: Rng, at: number): MarketEvent[] {
  const events: MarketEvent[] = [];
  const teams = Object.values(world.teams).filter((t) => t.id !== userClubId);
  const cap = Math.max(1, Math.floor(teams.length * 0.12));
  const lenders = teams.filter((t) => t.prestige >= 55).sort((a, b) => b.prestige - a.prestige);
  const needy = teams.filter((t) => t.prestige < 55).sort((a, b) => a.prestige - b.prestige);
  let made = 0;
  for (const lender of lenders) {
    if (made >= cap) break;
    const starters = lender.roster.slice(0, 5).map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p);
    // Una joya joven que apenas juega (la más floja del quinteto) sale cedida para foguearse.
    const young = starters.filter((p) => p.dev.age <= 21 && p.innate.potential >= 80).sort((a, b) => a.value - b.value)[0];
    if (!young) continue;
    const dest = needy.find((t) => t.id !== lender.id && t.roster.length <= 6 && needsRole(squadNeeds(t, world.players), young.role) > 0);
    if (!dest) continue;
    const res = applyLoanOut(world, lender.id, dest.id, young.id, { ownerClub: lender.id, seasons: 1, wageShare: 0.5, buyOption: Math.round(young.value * 1.25), buyBackClause: null, guaranteedMinutes: 70 }, rng, at);
    if (res) { events.push(res.event); made++; refillTo5(world, lender, rng); }
  }
  return events;
}

/** Rellena un club por debajo de 5 desde agentes libres o cantera (reusa el criterio del mundo). */
function refillTo5(world: WorldState, team: WorldTeam, rng: Rng): void {
  let guard = 0;
  while (team.roster.length < 5 && guard++ < 6) {
    let fa = world.freeAgents.map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p && p.teamId === null).sort((a, b) => b.value - a.value)[0];
    if (!fa) { fa = generateRookie(world, rng, team.region); world.players[fa.id] = fa; } // último recurso: ascenso de cantera
    world.freeAgents = world.freeAgents.filter((id) => id !== fa!.id);
    team.roster.push(fa.id); fa.teamId = team.id;
    fa.contract = fa.contract ?? { salary: Math.max(200, Math.round(fa.value * 0.12)), years: 2, releaseClause: Math.round(fa.value * 2), happiness: 65, loyalty: 55, ambition: fa.innate.ambition, relCoach: 55, relTeam: 55 };
  }
}

/**
 * Ejecuta el mercado autónomo COMPLETO de la temporada (todos los clubes IA), blindando el club
 * del usuario. Devuelve los eventos notables (para rumores/noticias). El club del usuario lo
 * mueve la ventana interactiva. DETERMINISTA.
 */
export function runAiMarket(world: WorldState, userClubId: string | null, at: number): MarketEvent[] {
  const rng = makeRng(seedOf(world.seed, "ai-market", world.season));
  const protect = userClubId ?? undefined;
  const before = world.transfers.length;

  const events: MarketEvent[] = [];
  events.push(...returnDueAiLoans(world, userClubId ?? "", rng, at));
  runTransferMarket(world, { protectTeamId: protect });         // ← REUTILIZA el mercado del mundo
  events.push(...runAiLoans(world, userClubId ?? "", rng, at)); // ← capa nueva: cesiones
  // Fallback: el club del usuario está blindado de la IA; si quedó corto (jubilaciones), se
  // completa a 5 para poder competir (fichaje de emergencia; el usuario decide en su ventana).
  if (userClubId && world.teams[userClubId]) refillTo5(world, world.teams[userClubId], rng);

  // Eventos notables desde el log de esta temporada (traspasos caros) para rumores/prensa.
  for (let i = before; i < world.transfers.length; i++) {
    const t = world.transfers[i];
    if (t.kind === "transfer" && t.fee >= NOTABLE_FEE) {
      const p = world.players[t.playerId];
      events.push({ id: `mkt:${t.season}:signing:${t.playerId}:${i}`, type: t.fee >= 22000 ? "bomb" : "signing", season: t.season, at, playerId: t.playerId, playerNick: t.nick, fromClub: t.from, toClub: t.to, fee: t.fee, detail: `${t.to ? world.teams[t.to]?.name : "?"} ficha a ${t.nick} por ${t.fee}.`, magnitude: Math.min(100, 40 + t.fee / 800) });
    }
  }
  return events;
}

/**
 * Ofertas ENTRANTES: clubes IA pujan por los jugadores del club del usuario (según sus
 * necesidades, presupuesto y el estatus que el usuario les dio). Determinista. `max` limita.
 */
export function generateIncomingOffers(
  world: WorldState, userClubId: string, listStatus: Record<string, ListStatus>, season: number, max = 5,
): PlayerOffer[] {
  const userTeam = world.teams[userClubId];
  if (!userTeam) return [];
  const userName = userTeam.name;
  const offers: PlayerOffer[] = [];
  const suitors = Object.values(world.teams).filter((t) => t.id !== userClubId && t.budget > 6000);

  for (const pid of userTeam.roster) {
    const p = world.players[pid];
    if (!p || p.status !== "active") continue;
    const status = listStatus[pid] ?? "normal";
    if (status === "protected") continue; // intransferible: nadie recibe respuesta
    const mv = marketValue(p, userTeam);
    const rating = progress(p.dev);
    // Un club IA puja si NECESITA el rol y puede pagar; los "listed" atraen más pujas.
    for (const club of suitors) {
      const rng = makeRng(seedOf(world.seed, "bid", club.id, pid, season));
      const need = needsRole(squadNeeds(club, world.players), p.role);
      const wants = (status === "listed" ? 45 : 0) + need + (rating > 72 ? 25 : 0) + (club.prestige - 50);
      if (wants < 55 || !rng.chance(Math.min(0.9, wants / 120))) continue;
      const fee = Math.round(askingFee(mv, p.contract?.years ?? 1, status === "listed") * (status === "listed" ? 0.85 : 0.7));
      if (fee > club.budget) continue;
      const stance = directorStance(club);
      offers.push(mkIncoming(p.id, p.nick, p.role, club.id, club.name, userClubId, userName, fee, mv.wageDemand, season, stance));
      break; // un pretendiente por jugador y temporada
    }
    if (offers.length >= max) break;
  }
  return offers.sort((a, b) => b.fee - a.fee).slice(0, max);
}

function mkIncoming(playerId: string, nick: string, role: WorldPlayer["role"], fromClubId: string, fromClubName: string, toClub: string, toClubName: string, fee: number, salary: number, season: number, stance: DirectorStance): PlayerOffer {
  // NB: en una oferta ENTRANTE, el "comprador" es el club IA (fromClubId es su id) y el usuario vende.
  return {
    id: `offer:in:${fromClubId}:${playerId}:${season}`,
    season, playerId, playerNick: nick, role,
    fromClub: toClub, fromClubName: toClubName,   // vendedor = club del usuario
    toClub: fromClubId, toClubName: fromClubName,  // comprador = club IA
    initiator: "ai", direction: "incoming", kind: "transfer",
    fee, salary, years: 3, bonus: 0, releaseClause: Math.round(fee * 1.8), loan: null, swapPlayerId: null,
    status: "pending", rounds: [{ by: "ai", fee, salary, years: 3, note: `${fromClubName} ofrece ${fee} por tu jugador.` }],
    note: `${fromClubName} (${stance.philosophy}) puja por ${nick}.`,
  };
}

/** Rumores de mercado a partir de los eventos notables + descontentos del vestuario. */
export function generateRumors(world: WorldState, events: MarketEvent[], season: number): MarketRumor[] {
  const rumors: MarketRumor[] = [];
  for (const e of events.slice(0, 8)) {
    rumors.push({ id: `rumor:${e.id}`, season, text: e.detail, playerId: e.playerId, clubId: e.toClub, heat: e.magnitude });
  }
  // Estrellas descontentas ⇒ rumor de salida.
  const unhappy = Object.values(world.players).filter((p) => p.teamId && p.contract && p.contract.happiness < 38 && progress(p.dev) > 70).slice(0, 4);
  for (const p of unhappy) {
    rumors.push({ id: `rumor:unhappy:${p.id}:${season}`, season, text: `${p.nick} estaría descontento en ${world.teams[p.teamId!]?.name} y podría salir.`, playerId: p.id, clubId: p.teamId, heat: 70 });
  }
  return rumors.sort((a, b) => b.heat - a.heat).slice(0, 10);
}
