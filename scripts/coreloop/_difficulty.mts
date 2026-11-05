/** CORE LOOP · instrumento (fuera de CI): % de victoria por dificultad con mazos REALISTAS (bienvenida real + meta), jugador NORMAL/HARD/SMART. */
import { catalogCards, labSnapshot, playMatch, pveOpponentDeck, scoredDeck, STRATEGIES, isLegalDeck, wilson, combatSum, type Policy } from "../../src/domain/balance/lab";
import { simulateStarter, dbDistribution } from "../../src/domain/onboarding/starterMath";
const pool = catalogCards(); const card = new Map(pool.map((c) => [c.cardId, c]));
const sumOvr = (ids: string[]) => ids.reduce((s, id) => s + card.get(id)!.ovr, 0);
const sumC = (ids: string[]) => ids.reduce((s, id) => s + combatSum(card.get(id)!), 0);
const N = Number(process.argv[2] ?? 3000);
const dist = dbDistribution();
const starters: string[][] = [];
for (let k = 0; starters.length < 200 && k < 400; k++) { const r = simulateStarter(65000 + k * 7919, "guide", dist); if (r.deckCardIds.length === 10 && isLegalDeck(r.deckCardIds).valid) starters.push(r.deckCardIds); }
const meta = scoredDeck(pool, STRATEGIES.OVR_MAX).cardIds;
const decks: Record<string, () => string[]> = { STARTER: () => starters[Math.floor(Math.random() * starters.length)], META_OVR: () => meta };
let seq = 0;
for (const [dk, g] of Object.entries(decks)) for (const pl of ["NORMAL", "HARD", "SMART"] as Policy[]) {
  const row: string[] = [];
  for (const bot of ["EASY", "NORMAL", "HARD"] as Policy[]) {
    let w = 0, d = 0, gapO = 0, gapC = 0;
    for (let i = 0; i < N; i++) { const ids = g(); const o = pveOpponentDeck(sumOvr(ids), pool); gapO += sumOvr(o) - sumOvr(ids); gapC += sumC(o) - sumC(ids);
      const m = playMatch(labSnapshot(ids, `p${seq}`), labSnapshot(o, `b${seq++}`), pl, bot, i % 2 ? "A" : "B", (i * 2654435761 + seq) >>> 0 || 1);
      if (m.winner === "A") w++; else if (!m.winner) d++; }
    const ci = wilson(w, N); row.push(`${bot} ${(ci.p * 100).toFixed(1)}% [${(ci.lo * 100).toFixed(1)}–${(ci.hi * 100).toFixed(1)}] draw ${(d / N * 100).toFixed(1)}% ΔOVR ${(gapO / N).toFixed(1)} Δcomb ${(gapC / N).toFixed(1)}`);
  }
  console.log(`${dk} jugador ${pl}: ${row.join(" | ")}`);
}
console.log("starter OVR medio", (starters.reduce((s, x) => s + sumOvr(x), 0) / starters.length).toFixed(1), "meta", sumOvr(meta), "n starters", starters.length);
