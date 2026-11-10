// F72 · sonda de solo lectura: ¿existen en la BD real las RPC que usa la economía del draft y las ejecuta service_role?
// Usuario inexistente ⇒ la función lanza «Perfil inexistente» ANTES de escribir nada. Fuera de CI.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ghost = randomUUID();
(async () => {
  const a = await sb.rpc("app_adjust_credits", { p_user: ghost, p_delta: -1, p_reason: "f72_probe", p_ref: `f72-probe:${ghost}` });
  console.log("app_adjust_credits:", a.error ? `${a.error.code} ${a.error.message}` : `data=${a.data}`);
  const g = await sb.rpc("app_grant_reward", { p_user: ghost, p_ref: `f72-probe:${ghost}`, p_reason: "f72_probe", p_credits: 0 });
  console.log("app_grant_reward:", g.error ? `${g.error.code} ${g.error.message}` : JSON.stringify(g.data));
  const t = await sb.from("credit_transactions").select("id", { count: "exact", head: true }).like("ref", "f72-probe:%");
  console.log("asientos f72-probe en el libro:", t.count, t.error?.message ?? "");
  const d = await sb.from("draft_runs").select("id", { count: "exact", head: true });
  console.log("draft_runs accesible:", d.error ? d.error.message : `sí (${d.count} filas)`);
})();
