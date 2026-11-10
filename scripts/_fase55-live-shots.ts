/**
 * FASE 55 · capturas REALES (sesión QA de verdad contra la BD del VPS, fuera de CI). Entra con la cuenta QA A
 * (password grant → sesión en localStorage), fotografía `/competitivo` real, pulsa JUGAR COMPETITIVO, fotografía la
 * búsqueda real (sola en la cola: nadie más busca) y la cancela; después el detalle de la partida E2E y la
 * redirección de `/duelos/competitivo`. Nunca usa la cuenta demo.
 *
 *   npx tsx scripts/_fase55-live-shots.ts --creds=<creds.json> [--match=<uuid>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase55-competitive", "live");
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));

(async () => {
  const c = JSON.parse(readFileSync(arg("creds")!, "utf8"));
  const s = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json();
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const log: Record<string, unknown> = {};
  const full = async (name: string, w: number) => {
    const h = await t.js<number>("Math.ceil(document.documentElement.scrollHeight)");
    const r = await t.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 } });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };
  try {
    await t.resize(1440, 900, 1);
    await t.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await t.goto(`${BASE}/design-system`, 800);
    await t.setStorage("sb-127-auth-token", JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3500 }));
    await t.goto(`${BASE}/competitivo`, 7000);
    log.hub = await t.js(`({ title: document.querySelector('[data-field="rank-title"]')?.textContent, rating: document.querySelector('[data-field="rating"]')?.textContent, gate: document.querySelector('[data-testid="ranked-play"]')?.getAttribute('data-gate'), history: document.querySelectorAll('[data-testid="ranked-history"] li').length, season: document.querySelector('[data-testid="ranked-season"]')?.getAttribute('data-season') })`);
    await full("L1-hub-real-1440", 1440);
    await t.resize(390, 844, 1); await sleep(900); await full("L2-hub-real-390", 390); await t.resize(1440, 900, 1); await sleep(500);
    // JUGAR COMPETITIVO → /duelos/pvp?buscar= → entra en cola sola.
    await t.js(`document.querySelector('[data-testid="ranked-play-cta"]')?.click()`);
    await sleep(6000);
    log.search = await t.js(`({ url: location.pathname + location.search, searching: !!document.querySelector('[data-testid="ranked-searching"]'), truth: document.querySelector('[data-testid="ranked-search-truth"]')?.textContent })`);
    await full("L3-searching-real", 1440);
    await t.js(`document.querySelector('[data-testid="ranked-cancel"]')?.click()`);
    await sleep(3000);
    log.cancelled = await t.js(`({ lobby: !!document.querySelector('[data-testid="pvp-lobby"]'), searching: !!document.querySelector('[data-testid="ranked-searching"]') })`);
    if (arg("match")) {
      await t.goto(`${BASE}/duelos/competitivo/partida/${arg("match")}`, 6000);
      await full("L4-match-detail-real", 1440);
    }
    await t.goto(`${BASE}/duelos/competitivo`, 5000);
    log.legacyRedirect = await t.js("location.pathname");
    await t.goto(`${BASE}/temporada`, 7000);
    log.season = await t.js(`({ link: document.querySelector('[data-testid="season-ranked-link"]')?.getAttribute('href') })`);
    log.errors = t.takeErrors().slice(0, 8);
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "live.json"), JSON.stringify({ generated: new Date().toISOString(), account: "QA 8c326e52", ...log }, null, 2));
  console.log(JSON.stringify(log, null, 2));
})();
