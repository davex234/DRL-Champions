import { catalogCards } from "../../src/domain/balance/lab";
const pool = catalogCards();
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
for (const s of ["stronghold", "gamesense", "entryfrag"] as const) {
  const v = pool.map((c) => c.combat[s]);
  console.log(s, "mean", (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), "p10/50/90", q(v, .1), q(v, .5), q(v, .9), "min/max", Math.min(...v), Math.max(...v));
}
const peakOf: Record<string, number> = { stronghold: 0, gamesense: 0, entryfrag: 0 };
for (const c of pool) { const e = Object.entries(c.combat).sort((a, b) => b[1] - a[1])[0][0]; peakOf[e]++; }
console.log("peak stat of card", peakOf);
for (const r of ["Duelista", "Controlador", "Iniciador", "Centinela", "Flex"]) {
  const cs = pool.filter((c) => c.role === r); const m = (k: "stronghold" | "gamesense" | "entryfrag") => (cs.reduce((a, c) => a + c.combat[k], 0) / cs.length).toFixed(1);
  console.log(r, "SH", m("stronghold"), "GS", m("gamesense"), "EF", m("entryfrag"));
}
