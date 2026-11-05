/* CATÁLOGO DISEÑADO · estado de la cuenta QA (instrumento `_`, fuera de CI, SOLO LECTURA: un GET). */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of (existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const creds = JSON.parse(readFileSync(process.argv[2], "utf8")) as { email: string; password: string };
(async () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword(creds);
  if (error || !data.session) throw new Error(error?.message);
  const r = await fetch("http://127.0.0.1:3005/api/game/state", { headers: { authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
  const j = await r.json() as any;
  console.log(r.status, JSON.stringify({ credits: j.credits ?? j.profile?.credits, unopened: j.unopenedPacks, owned: (j.ownedCards ?? []).length, keys: Object.keys(j) }));
})().catch((e) => { console.error(e); process.exit(1); });
