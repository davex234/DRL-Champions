/** CORE LOOP · instrumento: ¿desde qué OVR del mazo el rival PvE se separa en combate? Mazos OVR_MAX de colecciones de N cartas al azar. */
import { catalogCards, labSnapshot, playMatch, pveOpponentDeck, scoredDeck, STRATEGIES, combatSum, isLegalDeck } from "../../src/domain/balance/lab";
const pool = catalogCards(); const card = new Map(pool.map((c) => [c.cardId, c]));
const sumOvr = (ids: string[]) => ids.reduce((s, id) => s + card.get(id)!.ovr, 0);
const sumC = (ids: string[]) => ids.reduce((s, id) => s + combatSum(card.get(id)!), 0);
const buckets = new Map<number, { n: number; w: number; dC: number }>();
let seq = 0;
for (let k = 0; k < 6000; k++) {
  const size = [40, 80, 160, 250, 331][k % 5];
  const sub = [...pool].sort(() => Math.random() - 0.5).slice(0, size);
  let ids: string[]; try { ids = scoredDeck(sub, STRATEGIES.OVR_MAX).cardIds; } catch { continue; }
  if (ids.length !== 10 || !isLegalDeck(ids).valid) continue;
  const o = pveOpponentDeck(sumOvr(ids), pool);
  const m = playMatch(labSnapshot(ids, `p${seq}`), labSnapshot(o, `b${seq++}`), "SMART", "HARD", k % 2 ? "A" : "B", (k * 2654435761 + 7) >>> 0 || 1);
  const b = Math.floor(sumOvr(ids) / 20) * 20; const e = buckets.get(b) ?? { n: 0, w: 0, dC: 0 };
  e.n++; e.w += m.winner === "A" ? 1 : 0; e.dC += sumC(o) - sumC(ids); buckets.set(b, e);
}
for (const [b, e] of [...buckets].sort((a, z) => a[0] - z[0])) if (e.n >= 30) console.log(`OVR ${b}-${b + 19}: n ${e.n} SMART vs HARD ${(e.w / e.n * 100).toFixed(1)}% Δcomb ${(e.dC / e.n).toFixed(1)}`);
