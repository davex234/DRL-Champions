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
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const users = process.argv.slice(2);
async function main() {
  for (const u of users) {
    const a = await admin.from("pickem_answers").select("id, pickem_submissions!inner(user_id)", { count: "exact", head: true }).eq("pickem_submissions.user_id", u);
    const b = await admin.from("pickem_answers").select("id, pickem_submissions!inner(user_id)", { count: "exact", head: true }).eq("pickem_submissions.user_id", u).gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
    const subs = await admin.from("pickem_submissions").select("id").eq("user_id", u);
    const ids = ((subs.data ?? []) as { id: string }[]).map((r) => r.id);
    const c = ids.length ? await admin.from("pickem_answers").select("id", { count: "exact", head: true }).in("submission_id", ids) : { count: 0, error: null };
    console.log("%s embed=%j err=%s window30=%j twoStep=%j subs=%d", u.slice(0, 8), a.count, JSON.stringify(a.error), b.count, c.count, ids.length);
  }
}
main();
