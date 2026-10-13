/** Instrumento ICON-ODDS: huellas que fija f80.packPrices.test (misma función `stable`/sha). */
import { createHash } from "node:crypto";
import { PACKS } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { MAIN_PACK_LINE, MAIN_PACK_PLAN } from "@/domain/packs/packClass";
import { packOddsFor } from "@/domain/packs/odds";
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
const omit = (o: object, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
console.log("defs", sha(PACKS.map((p) => omit(p, "price"))));
console.log("plan", sha(MAIN_PACK_PLAN));
console.log("odds", sha(Object.fromEntries(PACKS.map((p) => [p.id, packOddsFor(p, PACK_STATS[p.id] ?? null)]))));
console.log("measured", sha(Object.fromEntries(Object.entries(PACK_STATS).map(([id, s]) => [id, omit(omit(s, "price"), "costPerRarity")]))));
console.log("main", sha(Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, omit(omit(PACK_STATS[id], "price"), "costPerRarity")]))));
console.log("nonMain", sha(Object.fromEntries(Object.entries(PACK_STATS).filter(([id]) => !(id in MAIN_PACK_PLAN)).map(([id, s]) => [id, omit(omit(s, "price"), "costPerRarity")]))));
