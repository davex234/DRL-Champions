import { createHash } from "node:crypto";
import { qaSnapshot, qaSimulate } from "@/lib/duel/qaSimulation";
const mine = qaSnapshot(0, "qa-you", "A");
const rival = qaSnapshot(1, "qa-rival", "B");
const rows: unknown[] = [];
const tally: Record<string, number> = {};
for (let seed = 1; seed <= 120; seed++) {
  const m = qaSimulate(mine, rival, 10, seed % 2 ? "A" : "B", seed);
  const c = m.result!.combat;
  rows.push([seed, c.scoreA, c.scoreB, c.decidedBy, c.winner, c.tiedEncounters, c.statTotalA, c.statTotalB, c.encounters.map((e) => `${e.a.stat[0]}${e.a.value}${e.b.stat[0]}${e.b.value}${e.outcome}`).join(",")]);
  tally[c.decidedBy] = (tally[c.decidedBy] ?? 0) + 1;
}
console.log(JSON.stringify({ digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), tally, first: rows[0] }));
