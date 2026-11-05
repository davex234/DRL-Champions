/**
 * COLECCIONES · LIQUIDACIÓN SIN ENTRAR EN COLECCIONES (instrumento; SOLO stack de QA aislado, cuentas sintéticas).
 *
 *   BASE_URL=http://127.0.0.1:3027 QA_ANON_KEY=… COLL_PW=… npx tsx scripts/_team-collections-bgsettle.ts
 *
 * Precondición (`team-collections.sh bgsettle`): cuentas reiniciadas y temporada de QA activa. `tcfive` tiene NAVI
 * completo y nada guardado. Inicia sesión en el navegador, abre la portada y el álbum —NUNCA Colecciones— y comprueba por
 * la API que la primera compleción y sus 300 XP ya constan, una sola vez.
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3027";
if (/valorosters\.com|:3005\b/.test(BASE)) throw new Error("solo contra el stack de QA aislado");
const ANON = process.env.QA_ANON_KEY ?? "", PW = process.env.COLL_PW ?? "";
const OUT = join(process.cwd(), process.env.UI_OUT ?? "logs/team-collections-bgsettle");
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} · ${id} — ${d.slice(0, 240)}`); };

async function token(): Promise<string> {
  const j = await (await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: "coll-tcfive@example.invalid", password: PW }) })).json() as { access_token?: string };
  if (!j.access_token) throw new Error("no entra tcfive");
  return j.access_token;
}
const navi = async (t: string) => (await (await fetch(`${BASE}/api/game/team-collections?team=navi`, { headers: { authorization: `Bearer ${t}` } })).json()) as { firstCompletedAt: string | null; xpAwarded: number | null; state: string };

(async () => {
  mkdirSync(OUT, { recursive: true });
  const t = await token();
  const before = await navi(t);
  check("precondición: NAVI completo y nada guardado", before.state === "COMPLETED" && before.firstCompletedAt === null, before);
  const b = await launch({ args: ["--mute-audio", ...(process.env.QA_CHROME_ARGS ? process.env.QA_CHROME_ARGS.split(" ") : [])] });
  const tab = b.tab;
  const visited: string[] = [];
  try {
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/cuenta`, 1200);
    for (let i = 0; i < 120 && !(await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`).catch(() => false)); i++) await sleep(250);
    await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), "coll-tcfive@example.invalid"); set(document.querySelector('input[type="password"]'), ${JSON.stringify(PW)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await sleep(4000);
    for (const p of ["/", "/coleccion"]) { await tab.goto(`${BASE}${p}`, 1500); await sleep(4000); visited.push(p); }
    const calls = await tab.js<string[]>(`performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname).filter((p) => p.startsWith('/api/game/team-collections'))`);
    const path = await tab.js<string>(`location.pathname`);
    check("no se ha abierto Colecciones", visited.every((p) => !p.startsWith("/coleccion/trofeos")) && !path.startsWith("/coleccion/trofeos"), { visitadas: visited, ahora: path });
    check("la app pidió la liquidación en segundo plano", calls.length >= 1, calls);
  } finally { await b.close().catch(() => null); }
  let after = await navi(t);
  for (let i = 0; i < 10 && after.firstCompletedAt === null; i++) { await sleep(1000); after = await navi(t); }
  check("primera compleción guardada sin entrar en Colecciones, con sus 300 XP", !!after.firstCompletedAt && after.xpAwarded === 300, after);
  const again = await (await fetch(`${BASE}/api/game/team-collections`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ action: "settle" }) })).json() as { xpGained: number };
  check("liquidar después no concede nada más", again.xpGained === 0, again);
  const fail = rows.filter((r) => !r.ok).length;
  writeFileSync(join(OUT, "results.json"), JSON.stringify(rows, null, 2));
  console.log(`RESULTADO · ${rows.length - fail} PASS · ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
