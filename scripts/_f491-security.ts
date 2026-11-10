/** FASE 49.1 · ¿algún botón o ruta concede créditos en producción? (instrumento `_`; no concede nada). */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
for (const f of [".env.local", ".env"]) { const p = join(process.cwd(), f); if (!existsSync(p)) continue; for (const l of readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } }
const creds = JSON.parse(readFileSync(process.argv[2], "utf8"));
const BASE = process.argv[3] ?? "http://localhost:3005";
(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.auth.signInWithPassword(creds);
  const h = { "content-type": "application/json", authorization: `Bearer ${data.session!.access_token}` };
  const get = async () => (await (await fetch(`${BASE}/api/game/credits`, { headers: h })).json()) as { balance: number; purchasesOpen: boolean; sandbox: boolean; products: { credits: number }[] };
  const before = await get();
  const out: unknown[] = [{ antes: { balance: before.balance, purchasesOpen: before.purchasesOpen, sandbox: before.sandbox, cantidades: before.products.map((p) => p.credits) } }];
  for (const productId of ["drlc-starter", "drlc-ultimate"]) {
    const r = await fetch(`${BASE}/api/game/credits`, { method: "POST", headers: h, body: JSON.stringify({ action: "sandboxPurchase", productId, ref: `f491-${Date.now()}` }) });
    out.push({ productId, status: r.status, body: await r.json() });
  }
  const r2 = await fetch(`${BASE}/api/game/credits`, { method: "POST", headers: h, body: JSON.stringify({ action: "sandboxPurchase", productId: "drlc-ultimate", ref: "x", credits: 999999 }) });
  out.push({ manipulado: r2.status });
  const after = await get();
  out.push({ despues: after.balance, igual: after.balance === before.balance });
  console.log(JSON.stringify(out, null, 1));
})();
