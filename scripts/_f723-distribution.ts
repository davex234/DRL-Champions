/**
 * F72.3 · DISTRIBUCIÓN DE PISTAS (fuera de CI). Cada una de las 331 cartas × N claves de partida, con el resolvedor
 * visual REAL del servidor (`hintForCard` + `visualHintValue`). Mide el reparto por tipo, el reparto entre los tipos
 * DISPONIBLES de cada carta (¿TEAM queda arrinconado por COUNTRY?) y cartas sin pista.
 *   npx tsx scripts/_f723-distribution.ts <etiqueta> [partidas=2000]
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "../src/collection/registry";
import { catalogCards } from "../src/domain/balance/lab";
import { hintForCard, HINT_TYPES } from "../src/domain/cardgame/hints";
import { visualHintValue } from "../src/lib/duel/hintVisuals";

const label = process.argv[2] ?? "run";
const N = Number(process.argv[3] ?? 2000);
const REG = new CardRegistry();
const cards = catalogCards(REG);
const countryOf = (pid: string) => REG.player(pid)?.country ?? "";
const tally: Record<string, number> = { COUNTRY: 0, REGION: 0, TEAM: 0, ROLE: 0, NONE: 0 };
let withTeam = 0; const teamShare: number[] = [];
for (const c of cards) {
  const src = { uid: `u:${c.cardId}`, cardId: c.cardId, playerId: c.playerId, team: c.team, region: c.region, role: c.role };
  const avail = HINT_TYPES.filter((t) => visualHintValue(t, t === "COUNTRY" ? countryOf(c.playerId) : t === "TEAM" ? c.team : t === "REGION" ? c.region : c.role, src) !== null);
  let team = 0;
  for (let s = 0; s < N; s++) {
    const h = hintForCard(`qa-seed-${s}`, src, countryOf, visualHintValue);
    tally[h ? h.type : "NONE"]++;
    if (h?.type === "TEAM") team++;
  }
  if (avail.includes("TEAM") && avail.includes("COUNTRY")) { withTeam++; teamShare.push(team / N); }
}
const total = cards.length * N;
const pct = (n: number) => +(100 * n / total).toFixed(2);
const out = {
  label, cards: cards.length, seeds: N,
  byType: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, { n: v, pct: pct(v) }])),
  cardsWithCountryAndTeam: withTeam,
  teamShareAmongThose: teamShare.length ? { min: Math.min(...teamShare), mean: +(teamShare.reduce((a, b) => a + b, 0) / teamShare.length).toFixed(3), max: Math.max(...teamShare) } : null,
};
const dir = join(process.cwd(), "docs/product/qa/fase72-3"); mkdirSync(dir, { recursive: true });
const f = join(dir, "distribution.json");
const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
writeFileSync(f, JSON.stringify({ ...prev, [label]: out }, null, 2) + "\n");
console.log(JSON.stringify(out));
