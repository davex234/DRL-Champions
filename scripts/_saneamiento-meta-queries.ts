/** INSTRUMENTO (no CI) — aísla las 4 consultas de recuento de `windowCounts`. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const userId = process.argv[2];
const iso = new Date(Date.now() - 7 * 864e5).toISOString();

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const cases: Record<string, () => PromiseLike<unknown>> = {
    duels_played: () => admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["COMPLETED", "DRAW", "UNRESOLVED"]).neq("mode", "DRAFT_GAUNTLET").gte("updated_at", iso),
    duels_won: () => admin.from("duel_matches").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("winner", "A").neq("mode", "DRAFT_GAUNTLET").gte("updated_at", iso),
    packs_opened: () => admin.from("economy_ops").select("ref", { count: "exact", head: true })
      .eq("user_id", userId).eq("kind", "open_pack").gte("created_at", iso),
    picks_made: () => admin.from("pickem_answers").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", iso),
  };
  for (const [name, run] of Object.entries(cases)) {
    const r = await run() as { count: number | null; error: unknown; status?: number; statusText?: string };
    console.log("%s -> count=%j status=%j statusText=%j error=%s", name, r.count, r.status, r.statusText, JSON.stringify(r.error));
  }
}
main();
