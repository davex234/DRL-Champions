// F72.2b · auditoría de SOLO LECTURA de logos en la BD real (teams, events, assets, Storage). Fuera de CI.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const t = await sb.from("teams").select("id, name, tag, region, logo").limit(1000);
  const rows = (t.data ?? []) as any[];
  console.log("teams:", t.error?.message ?? rows.length, "con logo:", rows.filter((r) => r.logo).length);
  const hosts: Record<string, number> = {};
  for (const r of rows.filter((r) => r.logo)) { try { const h = new URL(r.logo).host; hosts[h] = (hosts[h] ?? 0) + 1; } catch { hosts["(rel) " + String(r.logo).slice(0, 20)] = (hosts["(rel) " + String(r.logo).slice(0, 20)] ?? 0) + 1; } }
  console.log("hosts:", JSON.stringify(hosts));
  console.log("muestra:", JSON.stringify(rows.filter((r) => r.logo).slice(0, 8).map((r) => [r.id, r.name, r.tag, r.logo])));
  const e = await sb.from("events").select("id, logo").limit(200);
  console.log("events con logo:", ((e.data ?? []) as any[]).filter((r) => r.logo).map((r) => [r.id, String(r.logo).slice(0, 80)]));
  const a = await sb.from("assets").select("id", { count: "exact", head: true });
  console.log("assets:", a.count, a.error?.message ?? "");
  const b = await sb.storage.listBuckets();
  console.log("buckets:", JSON.stringify((b.data ?? []).map((x) => x.name)), b.error?.message ?? "");
  for (const bk of b.data ?? []) {
    const l = await sb.storage.from(bk.name).list("", { limit: 100 });
    console.log(" ", bk.name, "→", JSON.stringify((l.data ?? []).map((x) => x.name).slice(0, 30)));
  }
})();
