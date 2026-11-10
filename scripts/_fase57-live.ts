/**
 * FASE 57 · prueba REAL de la ceremonia contra la BD del VPS (fuera de CI), con la cuenta QA A (nunca la demo).
 *
 *   npx tsx scripts/_fase57-live.ts --creds=<creds.json> [--buy=2]
 *
 * 1. API: la cuenta QA compra `--buy` Sobres Bronce con SUS créditos (economía real de la cuenta QA; no abre).
 * 2. Navegador (Chrome headless, sesión QA): /abrir/estandar →
 *    a) DOBLE CLIC en ABRIR (dos eventos seguidos) → una sola petición (`data-requests`), inventario −1;
 *    b) RECARGA a mitad del acto de apertura → la pantalla recupera el MISMO resultado (resumen), sin abrir otro;
 *    c) «Abrir otro sobre» → otra apertura legítima (inventario −1), gesto por carta (armar → girar → siguiente),
 *       OMITIR → resumen de esas mismas cartas.
 * 3. Cuenta los sobres y las cartas antes/después por `GET /api/game/state` para comprobar exactamente 1 consumo por apertura.
 * Capturas reales en docs/product/qa/fase57-pack-opening/live/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = "http://127.0.0.1:3005";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-pack-opening", "live");
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const DEMO = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const PACK = "estandar";

async function api(token: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
const inventory = async (token: string) => {
  const s = (await api(token, "/api/game/state")).json;
  const packs = s.unopenedPacks ?? s.packs ?? s.state?.unopenedPacks ?? {};
  const cards = (s.ownedCards ?? s.cards ?? s.state?.ownedCards ?? []).length;
  return { pack: typeof packs === "object" && !Array.isArray(packs) ? packs[PACK] ?? 0 : (packs as any[]).find((p) => p.packId === PACK)?.qty ?? 0, cards, credits: s.credits ?? s.state?.credits };
};

(async () => {
  const c = JSON.parse(readFileSync(arg("creds")!, "utf8"));
  if (c.userId === DEMO) throw new Error("nunca la cuenta demo");
  const s = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json();
  const token = s.access_token as string;
  const ev: Record<string, unknown> = { account: c.userId };

  ev.before = await inventory(token);
  const buys = Number(arg("buy") ?? 2);
  ev.buy = [];
  for (let i = 0; i < buys; i++) (ev.buy as unknown[]).push(await api(token, "/api/game/packs", { action: "buy", packId: PACK, ref: `f57-buy-${randomUUID()}` }).then((r) => ({ status: r.status, err: r.json.error })));
  ev.afterBuy = await inventory(token);

  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const shot = (name: string) => t.shot(join(OUT, `${name}.png`));
  const phase = () => t.js<string | null>(`document.querySelector('[data-testid="pack-opening"]')?.getAttribute('data-phase') ?? null`);
  try {
    await t.resize(1440, 900, 1);
    await t.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await t.goto(`${BASE}/design-system`, 800);
    await t.setStorage("sb-127-auth-token", JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3500 }));
    await t.goto(`${BASE}/abrir/${PACK}`, 9000);
    ev.readyPhase = await phase();
    await shot("L1-sealed-real");

    // a) DOBLE CLIC: dos clics seguidos sobre ABRIR → una petición.
    await t.js(`(() => { const b = document.querySelector('[data-testid="pack-open"]'); b?.click(); b?.click(); })()`);
    await sleep(350);
    await shot("L2-anticipation-real");
    ev.requestsAfterDoubleClick = await t.js(`document.querySelector('[data-testid="pack-opening"]')?.getAttribute('data-requests')`);
    // Esperar al acto de apertura (con resultado) y recargar A MITAD.
    for (let i = 0; i < 40 && (await phase()) !== "opening"; i++) await sleep(100);
    ev.phaseBeforeReload = await phase();
    await sleep(700);
    await shot("L3-opening-real");
    const cardsSeen = await t.js<string[]>(`[...document.querySelectorAll('[data-card-back]')].length + ''`);
    ev.backsDuringOpening = cardsSeen;
    await t.send("Page.reload", {});
    await sleep(9000);
    ev.afterReload = { phase: await phase(), cards: await t.js(`document.querySelectorAll('[data-testid="summary-card"]').length`), recovered: await t.js(`document.querySelector('[data-testid="pack-summary"]')?.getAttribute('data-recovered')`) };
    await shot("L4-recovered-summary-real");
    ev.afterFirstOpen = await inventory(token);

    // c) ABRIR OTRO desde el resumen → otra apertura; revelar por gesto y omitir.
    const another = await t.js<boolean>(`(() => { const b = document.querySelector('[data-testid="summary-open-another"]'); if (!b) return false; b.click(); return true; })()`);
    ev.openAnotherButton = another;
    await sleep(1500);
    if ((await phase()) === "ready") await t.js(`document.querySelector('[data-testid="pack-open"]')?.click()`);
    for (let i = 0; i < 60 && (await phase()) !== "hand"; i++) await sleep(100);
    await sleep(900);
    await shot("L5-face-down-real");
    await t.js(`document.querySelector('[data-testid="pack-reveal"]')?.click()`);
    await sleep(700);
    ev.idleArmed = await t.js(`document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-armed')`);
    await shot("L6-card-idle-real");
    await t.js(`document.querySelector('[data-testid="reveal-card"]')?.click()`); // armar
    await sleep(3200);
    ev.firstRevealed = await t.js(`document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-revealed')`);
    ev.firstRarity = await t.js(`document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-rarity')`);
    await shot("L7-card-revealed-real");
    await t.js(`document.querySelector('[data-testid="pack-skip"]')?.click()`);
    await sleep(1500);
    ev.afterSkip = { phase: await phase(), cards: await t.js(`document.querySelectorAll('[data-testid="summary-card"]').length`) };
    await shot("L8-summary-real");
    ev.consoleErrors = t.takeErrors().slice(0, 6);
  } finally { await browser.close(); }
  ev.final = await inventory(token);
  writeFileSync(join(OUT, "live.json"), JSON.stringify({ generated: new Date().toISOString(), ...ev }, null, 2));
  console.log(JSON.stringify(ev, null, 2));
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
