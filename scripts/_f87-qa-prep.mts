/**
 * F87 · PREPARA CUENTAS QA NUEVAS como un jugador real (instrumento, fuera de CI): abre los sobres del alta, pide la
 * asistencia de primer equipo SOLO si el servidor la concede (Sobre Inicial gratis por la compra normal) y crea el
 * primer equipo por el onboarding (`first-team`: ordena cartas que ya son suyas). Ninguna concesión de operador.
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… BASE_URL=https://valorosters.com npx tsx scripts/_f87-qa-prep.mts A B C
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL!, SB = process.env.QA_SB!, ANON = process.env.QA_ANON!, DIR = process.env.QA_CREDS_DIR!;
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(p: string): Promise<{ id: string; t: string }> {
  const c = JSON.parse(readFileSync(join(DIR, `${p}.json`), "utf8")) as { email: string; password: string };
  const j = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify(c) })).json() as { access_token: string; user: { id: string } };
  if (REAL.some((x) => j.user.id.startsWith(x))) throw new Error("CUENTA REAL: abortado");
  return { id: j.user.id, t: j.access_token };
}
const call = async (t: string, path: string, body?: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) as Record<string, unknown> | null };
};

for (const p of process.argv.slice(2)) {
  const { id, t } = await token(p);
  let opened = 0;
  for (let guard = 0; guard < 12; guard++) {
    const st = await call(t, "/api/game/state");
    const unopened = (st.json?.unopenedPacks ?? {}) as Record<string, number>;
    const next = Object.entries(unopened).find(([, q]) => q > 0)?.[0];
    if (!next) break;
    const o = await call(t, "/api/game/packs", { action: "open", packId: next });
    if (o.status !== 200) { console.log(`${p}: abrir ${next} → ${o.status} ${JSON.stringify(o.json).slice(0, 120)}`); break; }
    opened++; await sleep(400);
  }
  const assist = await call(t, "/api/game/starter");
  if (assist.json?.eligible === true || assist.json?.grant === true) {
    const b = await call(t, "/api/game/packs", { action: "buy_and_open", packId: "inicial", ref: `f87-assist-${id.slice(0, 8)}-${Date.now()}` });
    console.log(`${p}: asistencia de primer equipo → ${b.status}`);
  }
  await call(t, "/api/game/onboarding", { action: "start" });
  const ft = await call(t, "/api/game/onboarding", { action: "first-team" });
  console.log(`${p}: ${id.slice(0, 8)} · sobres abiertos ${opened} · first-team ${ft.status} ${JSON.stringify(ft.json?.team ?? ft.json?.error ?? null).slice(0, 140)}`);
}
