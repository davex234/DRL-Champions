/**
 * FASE 36.1 · PLANIFICADOR DEL REBASE (instrumento `_`, fuera de CI). NO toca la base de datos.
 *
 *   npx tsx scripts/_fase36-1-pack-rebase.ts <export.json> <outDir>
 *
 * Lee la exportación de SOLO LECTURA (`user_pass.state`, `profiles.packs_opened`, `user_game.packs_opened`, `now()`
 * del servidor), aplica la función pura `planPackRebase` y escribe:
 *   f361_plan.json   plan con ids truncados (evidencia)
 *   f361_probe.sql   transacción que aplica el plan y hace ROLLBACK
 *   f361_apply.sql   la misma transacción con COMMIT
 * El SQL aborta si cualquier contador, baseline o versión cambió desde la exportación.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planPackRebase, buildRebaseSql, naiveExposure, type RebaseSourceRow } from "../src/server/services/progressionRebase";

const [exportFile, outDir] = process.argv.slice(2);
if (!exportFile || !outDir) { console.error("uso: <export.json> <outDir>"); process.exit(2); }

const parsed = JSON.parse(readFileSync(exportFile, "utf8")) as { serverNow: number; rows: RebaseSourceRow[] };
const plan = planPackRebase(parsed.rows, parsed.serverNow);
const short = (id: string) => id.slice(0, 8);

console.log(`serverNow=${new Date(parsed.serverNow).toISOString()} · user_pass=${parsed.rows.length}`);
const counts: Record<string, number> = {};
for (const row of plan) {
  for (const r of row.reports) {
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    console.log(`  ${short(row.userId)} legacy=${row.legacy} current=${row.current} · ${r.id} (${r.kind}, goal ${r.goal}, asignada ${new Date(r.assignedAt).toISOString()}) → ${r.outcome} · baseline ${r.fromBaseline}→${r.toBaseline} · conserva=${r.carried ?? "-"} · ingenuo=${r.naive ?? "-"}`);
  }
}
const exposure = naiveExposure(plan);
console.log(`resultados: ${JSON.stringify(counts)}`);
console.log(`exposición sin rebase: ${JSON.stringify(exposure)}`);

writeFileSync(join(outDir, "f361_plan.json"), JSON.stringify({
  serverNow: parsed.serverNow,
  users: plan.map((r) => ({ user: short(r.userId), legacy: r.legacy, current: r.current, reports: r.reports, updates: r.updates })),
  counts, exposure,
}, null, 2));
writeFileSync(join(outDir, "f361_probe.sql"), buildRebaseSql(plan, "probe"));
writeFileSync(join(outDir, "f361_apply.sql"), buildRebaseSql(plan, "apply"));
console.log(`escrito: f361_plan.json, f361_probe.sql, f361_apply.sql en ${outDir}`);
