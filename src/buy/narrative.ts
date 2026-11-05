/**
 * BUY PHASE × NARRATIVE — significado de compra (sin frases).
 *
 * A partir de los loadouts por ronda y el resultado detecta: compra perfecta,
 * arriesgada, heroica, error de compra, equipo mal equipado y milagro económico.
 * No modifica el Narrative Engine: produce eventos estructurados.
 */
import type { BuyEvent, TeamLoadoutSummary } from "./types";

export interface BuyNarrativeRound {
  round: number;
  winner: "home" | "away";
  home: TeamLoadoutSummary;
  away: TeamLoadoutSummary;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function detectBuyEvents(rounds: BuyNarrativeRound[]): BuyEvent[] {
  const events: BuyEvent[] = [];
  for (const r of rounds) {
    for (const team of ["home", "away"] as const) {
      const me = r[team];
      const opp = team === "home" ? r.away : r.home;
      const won = r.winner === team;
      const fpRatio = me.firepower / Math.max(1, opp.firepower);
      const lowBuy = me.buy === "eco" || me.buy === "save";

      if (me.buy === "full") events.push({ type: "perfect_buy", round: r.round, team, magnitude: 45 });
      if (me.buy === "force") events.push({ type: "risky_buy", round: r.round, team, magnitude: 60 });
      if (fpRatio < 0.6) events.push({ type: "underequipped", round: r.round, team, magnitude: Math.round(clamp((0.6 - fpRatio) * 150, 30, 100)) });
      if (won && fpRatio < 0.7) events.push({ type: "heroic_buy", round: r.round, team, magnitude: Math.round(clamp((0.7 - fpRatio) * 130 + 40, 50, 100)) });
      if (!won && me.buy === "full" && fpRatio > 1.2) events.push({ type: "buy_error", round: r.round, team, magnitude: 65 });
      if (won && lowBuy) events.push({ type: "economic_miracle", round: r.round, team, magnitude: 90 });
    }
  }
  return events.sort((a, b) => a.round - b.round || a.team.localeCompare(b.team));
}
