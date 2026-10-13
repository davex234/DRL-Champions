/**
 * FASE 64 · REGRESIÓN F62 REAL (instrumento `_`): con una cuenta QA, «Reclamar todo» en /progresion por la interfaz y la
 * foto del servidor antes/después (XP de temporada, créditos, pendientes). Nunca la cuenta del usuario.
 *   npx tsx scripts/_fase64-regress.ts <credsFile>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";

for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs/product/qa/fase64-game-feel/regression");
mkdirSync(OUT, { recursive: true });
const esc = (s: string) => JSON.stringify(s);

async function main() {
  const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data } = await anon.auth.signInWithPassword({ email: c.email, password: c.password });
  const t = data.session!.access_token;
  const meta = async () => {
    const [m, s] = await Promise.all([
      fetch(`${BASE}/api/game/meta`, { headers: { authorization: `Bearer ${t}` } }).then((r) => r.json()),
      fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${t}` } }).then((r) => r.json()),
    ]);
    const p = m.progression ?? m;
    return { seasonLevel: p.level ?? p.pass?.level ?? null, seasonXp: p.xp ?? p.pass?.xp ?? null, credits: s.credits, xp: s.xp, raw: Object.keys(m).slice(0, 12) };
  };
  const before = await meta();
  const b = await launch({ args: ["--mute-audio", "--hide-scrollbars"] });
  const ev: Record<string, any> = { at: new Date().toISOString(), account: c.userId.slice(0, 8), before };
  try {
    await b.tab.resize(1440, 900, 1);
    await b.tab.goto(`${BASE}/cuenta`, 3000);
    await b.tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(document.querySelector('input[type="email"]'), ${esc(c.email)}); set(document.querySelector('input[type="password"]'), ${esc(c.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    await sleep(4000);
    await b.tab.goto(`${BASE}/progresion`, 5000);
    ev.claimCountBefore = await b.tab.js<number>(`Number(document.querySelector('[data-testid="claim-center"]')?.getAttribute('data-count') ?? -1)`);
    await b.tab.shot(join(OUT, "f62-progresion-before.png"));
    b.tab.takeErrors();
    ev.clicked = await b.tab.js<boolean>(`(() => { const x = document.querySelector('[data-testid="claim-all"]'); if (!x) return false; x.click(); return true; })()`);
    for (let i = 0; i < 60; i++) {
      const n = await b.tab.js<number>(`Number(document.querySelector('[data-testid="claim-center"]')?.getAttribute('data-count') ?? -1)`);
      if (n === 0) break;
      await sleep(500);
    }
    await sleep(1500);
    ev.claimCountAfter = await b.tab.js<number>(`Number(document.querySelector('[data-testid="claim-center"]')?.getAttribute('data-count') ?? -1)`);
    ev.toastOrMoment = await b.tab.js<string>(`(document.querySelector('[data-testid="game-toast"], [data-testid="game-moment"]')?.textContent || '').slice(0, 120)`);
    ev.errors = b.tab.takeErrors();
    await b.tab.shot(join(OUT, "f62-progresion-after.png"));
    // Otra vez: nada que reclamar, nada que pagar.
    ev.clickedAgain = await b.tab.js<boolean>(`(() => { const x = document.querySelector('[data-testid="claim-all"]'); if (!x) return false; x.click(); return true; })()`);
    await sleep(2000);
  } finally { await b.close(); }
  ev.after = await meta();
  ev.creditsDelta = ev.after.credits - before.credits;
  writeFileSync(join(OUT, "f62-claim-live.json"), JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
