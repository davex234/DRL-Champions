/**
 * F73 FINAL · DERIVA DE ESQUEMA (solo lectura): compara lo que declara 0059_crafting_missions.sql con el catálogo real
 * de Postgres (cuerpo exacto de las RPC por md5 de prosrc, columnas, restricciones, políticas, índices, disparadores).
 *   npx tsx scripts/_f73f-drift.ts <schema.json exportado por f73f-schema.sql>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const db = JSON.parse(readFileSync(process.argv[2], "utf8"));
const sql = readFileSync("supabase/migrations/0059_crafting_missions.sql", "utf8");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const out: Record<string, unknown> = { at: new Date().toISOString(), source: "Postgres del VPS (solo lectura)" };
const res: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { res.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 200)}`); };

// 1. Cuerpo EXACTO de las tres RPC.
for (const fn of ["app_craft_pack", "app_craft_card", "app_mission_apply"]) {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  const body = start >= 0 && open > start && close > open ? sql.slice(open + 2, close) : null;
  const want = body === null ? null : md5(body);
  const got = db.functions?.[fn];
  check(`RPC ${fn}: cuerpo idéntico al SQL`, !!want && got?.md5 === want, `sql=${want} db=${got?.md5}`);
  check(`RPC ${fn}: SECURITY DEFINER con search_path fijo`, got?.secdef === true && JSON.stringify(got?.config ?? []).includes("search_path=public"), JSON.stringify(got?.config));
}
// 2. Cada tabla declarada existe con todas las columnas que nombra el SQL.
for (const t of ["craft_recipes", "content_card_projects", "content_missions", "user_mission_progress", "mission_events", "user_project_claims"]) {
  const i = sql.indexOf(`create table if not exists public.${t} (`);
  const block = i >= 0 ? sql.slice(i, sql.indexOf("\n);", i)) : "";
  const declared = [...block.matchAll(/(?:^\s{2}|,\s*)([a-z_]+)\s+(?:text|uuid|int|integer|bigint|jsonb|timestamptz|boolean|smallint)\b/gm)].map((m) => m[1]);
  const cols = ((db.columns?.[t] ?? []) as string[]).map((c) => c.split(":")[0]);
  const missing = declared.filter((c) => !cols.includes(c));
  const extra = cols.filter((c) => !declared.includes(c));
  check(`TABLA ${t}: columnas = las declaradas`, declared.length > 0 && missing.length === 0 && extra.length === 0, `declaradas=${declared.length} bd=${cols.length} faltan=${missing.join(",")} sobran=${extra.join(",")}`);
}
// 3. Políticas, índices y disparadores que nombra el SQL.
const named = (re: RegExp) => [...sql.matchAll(re)].map((m) => m[1]);
const policies = named(/create policy\s+"([^"]+)"\s+on/gi);
const dbPolicies = (db.policies ?? []) as string[];
check("POLÍTICAS: las del SQL existen (y no hay otras)", policies.length > 0 && policies.every((p) => dbPolicies.some((d) => d.includes(` ${p} SELECT `))) && dbPolicies.length === policies.length, `sql=${policies.join(" | ")} bd=${dbPolicies.length}`);
const indexes = named(/create (?:unique )?index if not exists ([a-z0-9_]+)/gi);
check("ÍNDICES: todos los del SQL existen", indexes.every((x) => (db.indexes ?? []).includes(x)), `sql=${indexes.join(",")}`);
const triggers = named(/create trigger ([a-z0-9_]+)/gi);
const dbTriggers = ((db.triggers ?? []) as string[]).map((x) => x.split(" ")[1]);
check("DISPARADORES: los del SQL y ninguno más", triggers.every((x) => dbTriggers.includes(x)) && dbTriggers.every((x) => triggers.includes(x)), `sql=${triggers.join(",")} bd=${dbTriggers.join(",")}`);
out.results = res; out.counts = db.counts; out.policies = db.policies; out.indexes = db.indexes; out.triggers = db.triggers; out.constraints = db.constraints;
writeFileSync("docs/product/qa/fase73-final/schema.json", JSON.stringify(out, null, 2));
console.log("counts", JSON.stringify(db.counts));
process.exit(res.some((r) => !r.ok) ? 1 : 0);
