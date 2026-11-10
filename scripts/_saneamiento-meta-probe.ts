/**
 * INSTRUMENTO (no CI) — saneamiento post F47.
 * Reproduce `GET /api/game/meta` llamando a `getMetaSnapshot` en proceso,
 * con la traza completa (la ruta la convierte en «Error de servidor»).
 */
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let userId = process.argv[2];
  if (!userId) {
    const { data, error } = await admin.from("profiles").select("id, created_at").order("created_at", { ascending: false }).limit(5);
    if (error) { console.error("profiles error", error); process.exit(1); }
    console.log("perfiles recientes:", (data ?? []).map((r: { id: string }) => r.id).join(", "));
    userId = ((data ?? [])[0] as { id: string } | undefined)?.id ?? "";
  }
  console.log("userId =", userId);

  const { getMetaSnapshot } = await import("../src/server/services/meta");
  try {
    const r = await getMetaSnapshot(admin, userId);
    console.log("RESULT ok=%s status=%s error=%j", r.ok, r.status, r.error);
    if (r.data) console.log("keys:", Object.keys(r.data).join(", "));
  } catch (e) {
    const err = e as Error;
    console.error("THREW name=%j message=%j", err?.name, err?.message);
    console.error("stack:\n", err?.stack);
    console.error("own props:", JSON.stringify(e, Object.getOwnPropertyNames(Object(e)), 2));
    process.exit(2);
  }
}
main();
