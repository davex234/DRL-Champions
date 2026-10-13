/* F73 · cierre — suelo seguro de cada receta semilla (PURO, solo lectura) para elegir un valor que el servidor DEBE rechazar. */
import { readFileSync } from "node:fs";
import { recipeFloor } from "../src/domain/crafting/floors";
const sql = readFileSync("supabase/migrations/0059_crafting_missions.sql", "utf8");
for (const m of sql.matchAll(/\('((?:pack|card)-[a-z-]+)',\s*'(PACK|CARD)',\s*'[^']*',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+)/g)) {
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  const r: any = { id: m[1], kind: m[2], inputPackId: v(m[3]), outputPackId: v(m[4]), inputClass: v(m[5]), outputClass: v(m[6]), inputQty: Number(m[7]) };
  const f = recipeFloor(r);
  console.log(r.id, "qty", r.inputQty, "floor", f?.ratio, "viable", f?.viable);
}
