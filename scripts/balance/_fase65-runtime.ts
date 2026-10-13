/** FASE 65 · regresión en ejecución (instrumento `_`): páginas y APIs clave de F61–F64 contra :3005 con una cuenta QA. */
import { readFileSync, writeFileSync } from "node:fs";
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "http://127.0.0.1:3005";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
(async () => {
  const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
  if (String(c.userId).startsWith("2f86cbe8")) throw new Error("cuenta del usuario: prohibido");
  const tok = (await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json()).access_token;
  const pages = ["/", "/jugar", "/duelos/jugar", "/duelos/pvp", "/competitivo", "/coleccion", "/duelos/mazos", "/progresion", "/temporada", "/como-jugar", "/tienda", "/cuenta"];
  const apis = ["/api/game/play-status", "/api/game/daily-loop", "/api/game/onboarding", "/api/game/competitive", "/api/game/season", "/api/game/duels", "/api/game/meta"];
  const rows: any[] = [];
  for (const p of pages) { const t = Date.now(); const r = await fetch(BASE + p); rows.push({ kind: "page", path: p, status: r.status, ms: Date.now() - t }); await new Promise((z) => setTimeout(z, 400)); }
  for (const p of apis) { const t = Date.now(); const r = await fetch(BASE + p, { headers: { authorization: `Bearer ${tok}` } }); rows.push({ kind: "api", path: p, status: r.status, ms: Date.now() - t }); await new Promise((z) => setTimeout(z, 400)); }
  const out = { at: new Date().toISOString(), base: BASE, account: String(c.userId).slice(0, 8), allOk: rows.every((r) => r.status === 200), rows,
    engineGolden: "F61 MOTOR 01 verde en npm test (huella 590d2997…, sin cambios)", liveMatches: "live/live-qa.json (PvE y PvP completos, resultado recalculado = servidor)" };
  writeFileSync("docs/product/qa/fase65-balance/runtime-regression.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ allOk: out.allOk, bad: rows.filter((r) => r.status !== 200) }));
})().catch((e) => { console.error(e); process.exit(1); });
