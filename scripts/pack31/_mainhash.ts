import { createHash } from "node:crypto";
import { PACK_STATS } from "@/data/packStats";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v);
const omit = (o: object, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
const main = Object.fromEntries(MAIN_PACK_LINE.map((id) => [id, omit(omit(PACK_STATS[id], "price"), "costPerRarity")]));
console.log("mainMeasured", createHash("sha256").update(JSON.stringify(stable(main))).digest("hex"));
