/**
 * ECONOMY ENGINE × NARRATIVE — genera SIGNIFICADO económico (no frases).
 *
 * A partir del historial económico detecta patrones con carga narrativa: cadenas de
 * eco, colapso/remontada económica, force decisivo, bonus ganado, compra perfecta,
 * error económico y milagro económico. No modifica el Narrative Engine: produce
 * eventos estructurados que cualquiera puede consumir.
 */
import type { EconomicEvent, EconomyRoundRecord, TeamSlot } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const BROKEN_AVG = 1150; // < media de medio buy → economía rota

export function detectEconomicEvents(history: EconomyRoundRecord[]): EconomicEvent[] {
  const events: EconomicEvent[] = [];
  if (history.length === 0) return events;

  // Marcador acumulado por ronda (para medir cercanía/leverage).
  const score: { home: number; away: number }[] = [];
  let h = 0, a = 0;
  for (const rec of history) {
    if (rec.winner === "home") h++; else a++;
    score.push({ home: h, away: a });
  }

  for (const team of ["home", "away"] as TeamSlot[]) {
    let ecoRun = 0, ecoStart = 0, brokenAt = -99;

    history.forEach((rec, i) => {
      const tr = rec[team];
      const won = rec.winner === team;
      const isEco = tr.buy === "eco" || tr.buy === "save";
      const avgAfter = tr.creditsAfter / 5;
      const diff = Math.abs(score[i].home - score[i].away);
      const closeness = clamp(1 - diff / 6, 0, 1);

      // Cadena de ecos
      if (isEco) { if (ecoRun === 0) ecoStart = rec.round; ecoRun++; }
      else {
        if (ecoRun >= 2) events.push({ type: "eco_chain", round: ecoStart, team, magnitude: Math.min(100, ecoRun * 30) });
        ecoRun = 0;
      }

      // Colapso económico (entra en rota)
      if (tr.status === "broken" && (i === 0 || history[i - 1][team].status !== "broken")) {
        events.push({ type: "economic_collapse", round: rec.round, team, magnitude: 70 });
      }
      if (tr.status === "broken") brokenAt = i;

      // Remontada económica (full buy poco después de estar rota y ganar)
      if (tr.buy === "full" && tr.status !== "bonus" && brokenAt >= 0 && i - brokenAt <= 3 && won) {
        events.push({ type: "economic_comeback", round: rec.round, team, magnitude: 80 });
        brokenAt = -99;
      }

      // Force decisivo (force ganado, más valor cuanto más cerrado el marcador)
      if (tr.buy === "force" && won) {
        events.push({ type: "decisive_force", round: rec.round, team, magnitude: Math.round(55 + closeness * 40) });
      }

      // Bonus ganado
      if (tr.status === "bonus" && won) {
        events.push({ type: "bonus_won", round: rec.round, team, magnitude: 60 });
      }

      // Compra perfecta (full real ganado)
      if (tr.buy === "full" && tr.status !== "bonus" && won) {
        events.push({ type: "perfect_buy", round: rec.round, team, magnitude: 50 });
      }

      // Milagro económico (ganar jugando eco/save)
      if (isEco && won) {
        events.push({ type: "economic_miracle", round: rec.round, team, magnitude: Math.round(70 + closeness * 30) });
      }

      // Error económico (gastó fuerte, perdió y quedó roto)
      if ((tr.buy === "force" || tr.buy === "full") && tr.status !== "bonus" && !won && avgAfter < BROKEN_AVG) {
        events.push({ type: "economic_error", round: rec.round, team, magnitude: 65 });
      }
    });

    if (ecoRun >= 2) events.push({ type: "eco_chain", round: ecoStart, team, magnitude: Math.min(100, ecoRun * 30) });
  }

  return events.sort((x, y) => x.round - y.round || x.team.localeCompare(y.team));
}
