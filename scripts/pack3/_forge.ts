/** PACK OPENING 3.0 · recetas de sobres de la Forja frente al rebalance (instrumento). */
import { recipeFloor } from "@/domain/crafting/floors";
import { getPack } from "@/data/packs";
import { PACK_STATS } from "@/data/packStats";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/0059_crafting_missions.sql", "utf8");
const ids = ["pack-estandar-premium", "pack-premium-oro", "pack-oro-masters", "pack-masters-champions", "pack-champions-icon"];
const qty: Record<string, number> = { "pack-estandar-premium": 4, "pack-premium-oro": 2, "pack-oro-masters": 2, "pack-masters-champions": 3, "pack-champions-icon": 2 };
for (const id of ids) {
  const [, a, b] = id.match(/^pack-(\w+)-(\w+)$/)!;
  const r = { kind: "PACK" as const, inputPackId: a, outputPackId: b, inputClass: null, outputClass: null };
  const f = recipeFloor(r as never)!;
  const evIn = PACK_STATS[a].meanValue * qty[id], evOut = PACK_STATS[b].meanValue;
  console.log(id.padEnd(24), "qty", qty[id], "floors", JSON.stringify({ byValue: f.byValue, bySalvage: f.bySalvage, byCost: f.byCost, ratio: f.ratio }), "EV in", evIn, "EV out", evOut, evOut > evIn ? "CREA VALOR" : "ok", "cost in", qty[id] * getPack(a)!.price, "out price", getPack(b)!.price);
}
void sql;
