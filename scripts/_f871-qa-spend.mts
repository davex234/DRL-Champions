/**
 * F87.1 · una QA nueva tiene el saldo de alta (6.000) = el de la demo, y F81.2 no podría distinguir real de demo.
 * Gasto REAL de jugador: compra UN sobre Estándar por la tienda (sin abrirlo) → saldo ≠ demo y un sobre por abrir.
 *   QA_CREDS_DIR=… QA_SB=… QA_ANON=… BASE_URL=… npx tsx scripts/_f871-qa-spend.mts G
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.BASE_URL!, SB = process.env.QA_SB!, ANON = process.env.QA_ANON!, DIR = process.env.QA_CREDS_DIR!;
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
for (const p of process.argv.slice(2)) {
  const c = JSON.parse(readFileSync(join(DIR, `${p}.json`), "utf8")) as { email: string; password: string };
  const j = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify(c) })).json() as { access_token: string; user: { id: string } };
  if (REAL.some((x) => j.user.id.startsWith(x))) throw new Error("CUENTA REAL: abortado");
  const r = await fetch(`${BASE}/api/game/packs`, { method: "POST", headers: { authorization: `Bearer ${j.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "buy", packId: "estandar", ref: `f871-spend-${j.user.id.slice(0, 8)}` }) });
  const s = await (await fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${j.access_token}` } })).json() as { credits?: number; unopenedPacks?: Record<string, number> };
  console.log(`${p}: compra ${r.status} · saldo ${s.credits} · por abrir ${JSON.stringify(s.unopenedPacks)}`);
}
