/**
 * FASE 24.7 · SYNC CONTROLADO DE UN EVENTO CONTRA LA BD REAL (instrumento `_`, fuera de CI)
 *
 *   npx tsx scripts/_fase24-7-live-target.ts <vlrEventId> --event <nexusEventId> [--write] [--pickems]
 *
 * Sin `--write` es DRY RUN por el core (`runEsportsSync`, modo manual, objetivo explícito): descarga,
 * normaliza, compara e informa. Con `--write` ejecuta el MISMO core escribiendo (sin Pick'ems salvo
 * `--pickems`). Antes y después cuenta filas de las tablas sensibles para demostrar «cero escrituras»
 * en dry run e idempotencia en la segunda pasada. No inserta fixtures: solo la fuente real.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEsportsAutoSyncConfig } from "@/lib/esports/autosync/config";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { formatRunReport } from "@/lib/esports/autosync/report";
import { createConsoleLogger } from "@/lib/esports/autosync/log";
import { sourceRefFromInput } from "@/lib/esports/autosync/sourceRef";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const args = process.argv.slice(2);
const vlrId = args.find((a) => /^\d+$/.test(a));
const eventId = args[args.indexOf("--event") + 1];
const write = args.includes("--write");
const pickems = args.includes("--pickems");
if (!vlrId || !eventId || args.indexOf("--event") < 0) { console.error("uso: <vlrEventId> --event <id> [--write] [--pickems]"); process.exit(2); }
if (eventId === "demo-masters-madrid-2026") { console.error("evento protegido"); process.exit(2); }

const TABLES = ["events", "matches", "teams", "players", "stages", "match_maps", "map_player_stats", "player_stats", "pickem_events", "pickem_questions", "pickem_submissions", "pickem_answers", "pickem_scores", "profiles", "credit_transactions", "sync_state", "notifications", "standings"];

async function counts(sb: SupabaseClient): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    out[t] = error ? `ERR ${error.message}` : (count ?? 0);
  }
  const { data: st } = await sb.from("sync_state").select("id, status, updated_at").order("updated_at", { ascending: false }).limit(3);
  out["sync_state.latest"] = JSON.stringify(st ?? []);
  const { data: prog } = await sb.from("matches").select("id", { count: "exact", head: true }).not("winner_to_match_id", "is", null);
  void prog;
  const { count: edges } = await sb.from("matches").select("id", { count: "exact", head: true }).not("winner_to_match_id", "is", null);
  const { count: qual } = await sb.from("matches").select("id", { count: "exact", head: true }).not("winner_qualifies", "is", null);
  out["matches.with_winner_to"] = edges ?? 0;
  out["matches.with_qualifies"] = qual ?? 0;
  const { data: pts } = await sb.from("profiles").select("points");
  out["profiles.points_sum"] = ((pts ?? []) as { points: number }[]).reduce((n, p) => n + (p.points ?? 0), 0);
  return out;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("sin Supabase");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ref = sourceRefFromInput(eventId, vlrId!)!;
  const cfg = getEsportsAutoSyncConfig(process.env);
  console.log(`${write ? "WRITE" : "DRY RUN"} · ${ref.url} → evento «${ref.eventId}» · pickems=${pickems} · db=${url}`);
  const before = await counts(sb);
  const t0 = Date.now();
  const r = await runEsportsSync({ sb, cfg, logger: createConsoleLogger() }, { mode: "manual", dryRun: !write, targets: [ref], pickems });
  console.log(formatRunReport(r));
  const after = await counts(sb);
  console.log("\n── FILAS ANTES → DESPUÉS ──");
  for (const k of Object.keys(before)) {
    const a = before[k]; const b = after[k];
    console.log(`  ${(a === b ? "=" : "Δ").padEnd(2)} ${k.padEnd(26)} ${String(a).slice(0, 60)}${a === b ? "" : `  →  ${String(b).slice(0, 60)}`}`);
  }
  console.log(`\nduración total ${Date.now() - t0} ms · errores ${r.errors.length}`);
  process.exitCode = r.errors.length ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
