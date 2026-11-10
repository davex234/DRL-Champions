import { CARDS, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { bucketForRank } from "@/domain/packs/types";
const rows = CARDS.map((c) => { const v = getVariant(c.variantId as any); return { id: c.id, nick: getPlayer(c.playerId)?.nick, ovr: c.ovr, variant: c.variantId, rank: v.rank, bucket: bucketForRank(v.rank), group: v.group }; });
console.log("total", rows.length);
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const ovrs = rows.map((r) => r.ovr);
console.log("OVR min/p10/p25/med/p75/p90/p95/max", pct(ovrs,0), pct(ovrs,.1), pct(ovrs,.25), pct(ovrs,.5), pct(ovrs,.75), pct(ovrs,.9), pct(ovrs,.95), pct(ovrs,1));
const hist: Record<string, number> = {}; for (const r of rows) { const k = `${Math.floor(r.ovr / 5) * 5}-${Math.floor(r.ovr / 5) * 5 + 4}`; hist[k] = (hist[k] ?? 0) + 1; } console.log("OVR bands", hist);
for (const b of ["common","uncommon","rare","epic","legendary"]) { const o = rows.filter((r) => r.bucket === b).map((r) => r.ovr); console.log(b, "n", o.length, "min", Math.min(...o), "med", pct(o,.5), "p90", pct(o,.9), "max", Math.max(...o)); }
const byVar: Record<string, number[]> = {}; for (const r of rows) (byVar[`${r.variant}|${r.bucket}|r${r.rank}`] ??= []).push(r.ovr);
for (const [k, o] of Object.entries(byVar).sort()) console.log(k.padEnd(40), "n", String(o.length).padStart(3), "min", Math.min(...o), "med", pct(o,.5), "max", Math.max(...o));
console.log("top 15:", rows.sort((a, b) => b.ovr - a.ovr).slice(0, 15).map((r) => `${r.nick}/${r.variant}/${r.bucket}/${r.ovr}`).join(", "));
console.log("brawl:", rows.filter((r) => /brawl/i.test(r.nick ?? "")).map((r) => `${r.id} ${r.variant} ${r.bucket} ${r.ovr}`));
console.log("common/uncommon with ovr>=88:", rows.filter((r) => (r.bucket === "common" || r.bucket === "uncommon") && r.ovr >= 88).length);
