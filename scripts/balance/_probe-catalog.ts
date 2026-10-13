import { CARDS, getPlayer } from "../../src/data/catalog";
import { getVariant } from "../../src/domain/cards/variants";
const by = new Map<string, typeof CARDS>();
for (const c of CARDS) by.set(c.playerId, [...(by.get(c.playerId) ?? []), c]);
let multi = 0, differ = 0; const ex: string[] = [];
for (const [p, cs] of by) {
  if (cs.length < 2) continue; multi++;
  const keys = new Set(cs.map((c) => `${c.combat!.stronghold}/${c.combat!.gamesense}/${c.combat!.entryfrag}`));
  if (keys.size > 1) { differ++; if (ex.length < 6) ex.push(p + ": " + cs.map((c) => `${c.variantId}(boost ${getVariant(c.variantId).statBoost}, ovr ${c.ovr}) ${c.combat!.stronghold}/${c.combat!.gamesense}/${c.combat!.entryfrag}`).join(" | ")); }
}
console.log({ cards: CARDS.length, players: by.size, multiVariantPlayers: multi, combatDiffersAcrossVariants: differ });
ex.forEach((e) => console.log(e));
const boosts = new Map<string, number>(); for (const c of CARDS) boosts.set(c.variantId, getVariant(c.variantId).statBoost);
console.log("variant boosts:", JSON.stringify(Object.fromEntries(boosts)));
const xs = CARDS.map((c) => c.ovr), ys = CARDS.map((c) => c.combat!.stronghold + c.combat!.gamesense + c.combat!.entryfrag);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length; const mx = mean(xs), my = mean(ys);
const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0), sx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
console.log("corr(printed OVR, SH+GS+EF) =", (cov / sx / sy).toFixed(3), "OVR range", Math.min(...xs), Math.max(...xs), "combatSum range", Math.min(...ys), Math.max(...ys));
const roles: Record<string, number> = {}; for (const c of CARDS) { const r = c.role ?? getPlayer(c.playerId)!.role; roles[r] = (roles[r] ?? 0) + 1; }
console.log("roles", roles, "noCombat", CARDS.filter((c) => !c.combat).length);
