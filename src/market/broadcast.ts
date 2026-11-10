/**
 * BROADCAST DE MERCADO — proyección de solo lectura para el dashboard (Career Fase 4/7).
 *
 * Compone la plantilla (titulares/suplentes/cedidos), su valor/masa salarial/química (reusa
 * `freshRelationship`+`teamChemistry` del Player Development) y todo el estado de la ventana
 * (objetivos, ofertas, rumores, finanzas) en un DTO plano. La UI SOLO pinta. PURO.
 */
import type { WorldState, WorldPlayer, WorldTeam } from "@/world";
import { progress, ageBand, freshRelationship, teamChemistry, type Relationship } from "@/development";
import type { SquadView, SquadPlayerView, TransferWindow, ListStatus, SquadSlot } from "./types";
import { squadNeeds } from "./needs";
import { marketValue } from "./value";
import { ns, td } from "@/i18n/runtime";

const t = ns("market");

function toSquadPlayer(p: WorldPlayer, team: WorldTeam, slot: SquadSlot, status: ListStatus, loanInfo: string | null): SquadPlayerView {
  const mv = marketValue(p, team);
  return {
    id: p.id, nick: p.nick, role: p.role, age: p.dev.age, rating: Math.round(progress(p.dev)), potential: p.innate.potential,
    value: mv.value, wage: p.contract?.salary ?? 0, contractYears: p.contract?.years ?? 0, happiness: p.contract?.happiness ?? 60,
    slot, status, band: ageBand(p.dev.age, p.innate), form: Math.round(p.dev.condition.form), loanInfo,
  };
}

/** Química del quinteto titular reutilizando el motor de química (relaciones deterministas). */
function starterChemistry(starters: WorldPlayer[]): number {
  const rels: Record<string, Relationship> = {};
  for (let i = 0; i < starters.length; i++)
    for (let j = i + 1; j < starters.length; j++) {
      const r = freshRelationship(starters[i].id, starters[j].id, starters[i].innate.ambition, starters[j].innate.ambition);
      rels[`${r.a}|${r.b}`] = r;
    }
  return teamChemistry(rels, starters.map((p) => p.id));
}

/** Vista completa de la plantilla del club del usuario. */
export function squadView(world: WorldState, clubId: string, listStatus: Record<string, ListStatus>, loans: TransferWindow["loans"] = []): SquadView | null {
  const team = world.teams[clubId];
  if (!team) return null;
  const players = team.roster.map((id) => world.players[id]).filter((p): p is WorldPlayer => !!p && p.status === "active");
  const startersP = players.slice(0, 5);
  const benchP = players.slice(5);
  const starters = startersP.map((p) => toSquadPlayer(p, team, "starter", listStatus[p.id] ?? "normal", null));
  const bench = benchP.map((p) => toSquadPlayer(p, team, "bench", listStatus[p.id] ?? "normal", null));
  const loanedOut = loans.map((l) => {
    const p = world.players[l.playerId];
    return p ? toSquadPlayer(p, team, "loaned_out", "loan_listed", t("Cedido a {v} hasta T{endSeason}", { v: td(world.teams[l.loanClub]?.name) ?? "?", endSeason: l.endSeason })) : null;
  }).filter((x): x is SquadPlayerView => !!x);

  const all = [...starters, ...bench];
  const squadValue = all.reduce((a, p) => a + p.value, 0);
  const wageBill = all.reduce((a, p) => a + p.wage, 0);
  const avgAge = all.length ? all.reduce((a, p) => a + p.age, 0) / all.length : 0;

  return {
    clubId, clubName: team.name, starters, bench, loanedOut,
    squadValue, wageBill, chemistry: starterChemistry(startersP),
    avgAge: Math.round(avgAge * 10) / 10, needs: squadNeeds(team, world.players),
  };
}

export interface MarketDashboard {
  season: number;
  open: boolean;
  clubName: string;
  budget: number;
  stance: TransferWindow["stance"];
  squad: SquadView | null;
  targets: TransferWindow["targets"];
  outgoing: TransferWindow["offers"];
  incoming: TransferWindow["offers"];
  rumors: TransferWindow["rumors"];
  loans: TransferWindow["loans"];
  spent: number;
  earned: number;
  log: TransferWindow["log"];
}

/** DTO del dashboard profesional de fichajes. */
export function marketBroadcast(window: TransferWindow, world: WorldState): MarketDashboard {
  const team = world.teams[window.clubId];
  return {
    season: window.season,
    open: window.open,
    clubName: team?.name ?? "—",
    budget: team?.budget ?? 0,
    stance: window.stance,
    squad: squadView(world, window.clubId, window.listStatus, window.loans),
    targets: window.targets,
    outgoing: window.offers.filter((o) => o.direction === "outgoing"),
    incoming: window.offers.filter((o) => o.direction === "incoming"),
    rumors: window.rumors,
    loans: window.loans,
    spent: window.spentThisSeason,
    earned: window.earnedThisSeason,
    log: window.log,
  };
}
