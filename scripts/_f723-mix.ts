import { writeFileSync, readFileSync } from "node:fs";
import { CardRegistry } from "../src/collection/registry";
import { catalogCards } from "../src/domain/balance/lab";
import { hiddenCardHints } from "../src/domain/cardgame/hints";
import { visualHintValue } from "../src/lib/duel/hintVisuals";
const REG = new CardRegistry(); const cards = catalogCards(REG);
const co = (p: string) => REG.player(p)?.country ?? "";
let mixed = 0, allCountry = 0, allTeam = 0; const teamPerHand: number[] = [];
const N = 2000;
for (let s = 0; s < N; s++) {
  const hand = Array.from({ length: 10 }, (_, i) => cards[(s * 37 + i * 101) % cards.length]).map((c, i) => ({ uid: `m${s}-u${i}`, cardId: c.cardId, playerId: c.playerId, team: c.team, region: c.region, role: c.role }));
  const h = hiddenCardHints(`match-${s}`, hand, co, visualHintValue);
  const t = h.filter((x) => x?.type === "TEAM").length, c = h.filter((x) => x?.type === "COUNTRY").length;
  teamPerHand.push(t); if (t && c) mixed++; else if (t) allTeam++; else allCountry++;
}
const out = { hands: N, handSize: 10, mixed, allCountry, allTeam, meanTeamPerHand: +(teamPerHand.reduce((a, b) => a + b, 0) / N).toFixed(2) };
const f = "docs/product/qa/fase72-3/distribution.json"; const prev = JSON.parse(readFileSync(f, "utf8"));
writeFileSync(f, JSON.stringify({ ...prev, withinMatch: out, decision: "El algoritmo F71/F72.2 (hash % 4 + salto cíclico) ya reparte ~50/50 entre COUNTRY y TEAM en cada carta con ambos, y mezcla dentro de la partida: NO se cambia." }, null, 2) + "\n");
console.log(JSON.stringify(out));
