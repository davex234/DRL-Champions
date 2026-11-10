/* valorosters · RLS vía el dominio público con la sesión de la cuenta QA nueva: solo filas propias. */
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const c = JSON.parse(readFileSync("C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/e88fb0db-4a77-407d-b7de-e71fef2b9658/scratchpad/vr-qa-V.json", "utf8"));
(async () => {
  const B = "https://valorosters.com", ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const tok = (await (await fetch(`${B}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json()).access_token;
  for (const t of ["user_cards?select=user_id", "economy_ops?select=user_id", "user_packs?select=user_id", "user_mission_progress?select=user_id", "profiles?select=id,is_admin,credits"]) {
    const r = await fetch(`${B}/rest/v1/${t}&limit=50`, { headers: { apikey: ANON, authorization: `Bearer ${tok}` } }); const j: any = await r.json().catch(() => null);
    const rows = Array.isArray(j) ? j : [];
    const foreign = rows.filter((x: any) => (x.user_id ?? x.id) !== c.userId).length;
    console.log(t.split("?")[0].padEnd(24), r.status, "filas", rows.length, "ajenas", foreign, Array.isArray(j) ? "" : JSON.stringify(j).slice(0, 80));
  }
})();
