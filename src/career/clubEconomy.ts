/**
 * MANAGER CAREER ENGINE · Fase 3 — economía del club (P&L de temporada).
 *
 * NO es la economía de partido (`src/economy`, créditos por ronda) ni el pricing de cartas
 * (`src/domain/economy`): es la CONTABILIDAD del club — ingresos (patrocinios/premios/
 * merchandising/entradas/eventos/ventas) y gastos (sueldos/instalaciones/academia/viajes/
 * scouting/staff/compras). Cifras CALCULADAS, nunca ficticias. Determinista. Puro.
 */
import type { ClubView, ClubManagement, SeasonLedger, SeasonOutcome } from "./types";
import { sponsorIncome } from "./sponsors";
import { staffSalaries, staffEffects } from "./staff";
import { facilitiesUpkeep, facilityEffects } from "./facilities";

/** Satisfacción media de los patrocinadores (0..1). Sin datos ⇒ 0.7 neutro. */
function avgSponsorSatisfaction(mgmt: ClubManagement): number {
  if (mgmt.sponsors.length === 0) return 0.7;
  return mgmt.sponsors.reduce((a, s) => a + (s.satisfaction ?? 70), 0) / mgmt.sponsors.length / 100;
}

/** Premio por resultado deportivo (por posición + plus de campeón/finalista). */
function prizeMoney(o: SeasonOutcome, club: ClubView): number {
  const fieldBonus = Math.max(0, (club.totalTeams - o.placement + 1)) * 300;
  const champ = o.champion ? 12000 : o.finalist ? 5000 : 0;
  const tierMult = o.tier === "global" ? 2.4 : o.tier === "continental" ? 1.6 : 1;
  return Math.round((fieldBonus + champ) * tierMult);
}

/**
 * Calcula el balance de UNA temporada (no muta nada). `playerWages` y `sales`/`purchases`
 * los aporta el llamador (vienen del roster real del mundo). Reusa instalaciones/staff/sponsors.
 */
export function computeSeasonFinances(
  club: ClubView,
  mgmt: ClubManagement,
  o: SeasonOutcome,
  extra: { playerWages: number; sales: number; purchases: number },
): SeasonLedger {
  const fx = facilityEffects(mgmt.facilities);
  const sx = staffEffects(mgmt.staff);
  const commercialMult = 1 + fx.incomeBonus + sx.commercialBoost + sx.marketingBoost * 0.5;
  const satFactor = 0.7 + 0.3 * avgSponsorSatisfaction(mgmt); // patrocinadores contentos pagan más

  const income = {
    sponsors: Math.round(sponsorIncome(mgmt.sponsors) * commercialMult * satFactor),
    prizes: prizeMoney(o, club),
    merchandising: Math.round(club.fanbase * 6 * commercialMult * (1 + fx.fanEngagement)),
    tickets: Math.round(club.fanbase * (1 + club.prestige / 100) * 4),
    events: Math.round(club.prestige * 80 * commercialMult),
    sales: Math.max(0, Math.round(extra.sales)),
    // ── Career Fase 5 ──
    streaming: Math.round(club.fanbase * (0.4 + fx.contentReach) * (1 + sx.contentBoost) * 2.5),
    content: Math.round((fx.contentReach * 6000 + sx.contentBoost * 5000) * (1 + club.fanbase / 4000)),
    rights: Math.round(club.prestige * 120 + club.titles * 400), // derechos de emisión de la liga
  };
  const expenses = {
    salaries: Math.max(0, Math.round(extra.playerWages)),
    facilities: facilitiesUpkeep(mgmt.facilities),
    academy: mgmt.academy.length * 400 + mgmt.facilities.academy * 800,
    travel: Math.round(2000 + club.prestige * 40),
    scouting: mgmt.facilities.scouting * 700,
    staff: staffSalaries(mgmt.staff),
    purchases: Math.max(0, Math.round(extra.purchases)),
    // ── Career Fase 5 ──
    marketing: Math.round(1500 + club.fanbase * 1.5 + sx.marketingBoost * 4000),
    bootcamps: Math.round(1200 + (mgmt.facilities.training_center + mgmt.facilities.gaming_house) * 600),
    taxes: 0, // preparado para futuras fases (fiscalidad por región/ingresos)
  };

  const totalIncome = Object.values(income).reduce((a, b) => a + b, 0);
  // Impuestos: preparado — leva nominal sobre el ingreso bruto (tuneable en futuras fases).
  expenses.taxes = Math.round(totalIncome * 0.04);
  const totalExpense = Object.values(expenses).reduce((a, b) => a + b, 0);
  const net = totalIncome - totalExpense;
  return { season: o.placement ? club.position : 0, income, expenses, net, balanceEnd: mgmt.balance + net };
}

export function ledgerTotals(l: SeasonLedger): { income: number; expense: number } {
  return {
    income: Object.values(l.income).reduce((a, b) => a + b, 0),
    expense: Object.values(l.expenses).reduce((a, b) => a + b, 0),
  };
}
