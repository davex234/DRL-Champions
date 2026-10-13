/**
 * FASE 57.1 · evidencia de RUNTIME del flujo productivo de apertura (fuera de CI). Cuenta QA, nunca la demo.
 *
 *   npx tsx scripts/_fase57-1-runtime.ts --creds=<creds.json> --motion=reduce|no-preference --out=<carpeta>
 *
 * Recorrido EXACTO del usuario: /tienda → «Comprar Sobre Bronce» → Confirmar (compra real con créditos de la cuenta QA)
 * → «Abrir ahora» (navegación real de la tienda) → pulsar ABRIR → fotogramas cada 250 ms del acto de apertura →
 * REVELAR → gesto sobre la primera carta → resumen (Omitir). Registra la URL, las marcas de F57 montadas y las fases.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = "http://127.0.0.1:3005";
const MOTION = arg("motion") ?? "no-preference";
const OUT = join(process.cwd(), "docs", "product", "qa", "fase57-pack-opening", arg("out") ?? `runtime-${MOTION}`);
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const DEMO = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";

const MARKS = `({
  url: location.pathname,
  phase: document.querySelector('[data-testid="pack-opening"]')?.getAttribute('data-phase') ?? null,
  f57Pack: !!document.querySelector('[data-testid="ceremony-pack"]'),
  f57PackArt: !!document.querySelector('[data-pack-art]'),
  torn: document.querySelector('[data-testid="pack-stage"]')?.getAttribute('data-torn') ?? null,
  tearHalves: document.querySelectorAll('[data-tear-half]').length,
  mouth: !!document.querySelector('[data-pack-mouth]'),
  backs: document.querySelectorAll('[data-card-back]').length,
  reveal: document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-revealed') ?? null,
  armed: document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-armed') ?? null,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
})`;

(async () => {
  const c = JSON.parse(readFileSync(arg("creds")!, "utf8"));
  if (c.userId === DEMO) throw new Error("nunca la cuenta demo");
  const s = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json();
  const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--hide-scrollbars"] });
  const t = browser.tab;
  const log: unknown[] = [];
  const mark = async (label: string) => { const m = await t.js(MARKS); log.push({ label, ...(m as object) }); return m as Record<string, unknown>; };
  const shot = (n: string) => t.shot(join(OUT, `${n}.png`));
  const clickText = (sel: string, re: string) => t.js<boolean>(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => new RegExp(${JSON.stringify(re)}, 'i').test((x.getAttribute('aria-label') || '') + ' | ' + (x.textContent || '').trim())); if (!b) return false; b.click(); return true; })()`);
  try {
    await t.resize(1440, 900, 1);
    await t.setMedia([{ name: "prefers-reduced-motion", value: MOTION }]);
    await t.goto(`${BASE}/design-system`, 800);
    await t.setStorage("sb-127-auth-token", JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3500 }));
    await t.goto(`${BASE}/tienda`, 9000);
    log.push({ label: "tienda", buyButton: await clickText("button", "^Comprar Sobre Bronce \\| ") });
    await sleep(1200);
    log.push({ label: "confirmar", ok: await clickText('[role="dialog"] button', "\\| (Comprar|Confirmar)") });
    await sleep(4000);
    log.push({ label: "abrir-ahora", ok: await clickText('[role="dialog"] button', "Abrir ahora") });
    await sleep(8000);
    await mark("00-llegada");
    await shot("01-sealed-real");
    await t.js(`document.querySelector('[data-testid="pack-open"]')?.click()`);
    for (let i = 0; i < 16; i++) {
      await sleep(250);
      const m = await mark(`f${String(i).padStart(2, "0")}`);
      await shot(`f${String(i).padStart(2, "0")}-${m.phase}${m.torn === "true" ? "-torn" : ""}`);
    }
    await sleep(800);
    await mark("hand");
    await shot("05-card-backs-real");
    await t.js(`document.querySelector('[data-testid="pack-reveal"]')?.click()`);
    await sleep(900);
    await mark("reveal-idle");
    await t.js(`document.querySelector('[data-testid="reveal-card"]')?.click()`);
    await sleep(350);
    await mark("reveal-armed");
    await shot("06a-first-card-charging-real");
    await sleep(2600);
    await mark("reveal-shown");
    await shot("06-first-reveal-real");
    // Recorre el resto: si alguna es especial (épica/legendaria), se captura su revelado.
    for (let k = 1; k < 6; k++) {
      await t.js(`document.querySelector('[data-testid="reveal-card"]')?.click()`); // siguiente
      await sleep(600);
      const rarity = await t.js<string | null>(`document.querySelector('[data-testid="reveal-card"]')?.getAttribute('data-rarity') ?? null`);
      if (!rarity) break;
      await t.js(`document.querySelector('[data-testid="reveal-card"]')?.click()`); // armar
      await sleep(3000);
      if (rarity === "epic" || rarity === "legendary") { await shot(`07-special-reveal-real-${rarity}`); log.push({ label: "special", rarity }); }
    }
    await t.js(`document.querySelector('[data-testid="reveal-card"]')?.click()`);
    await sleep(1500);
    await mark("summary");
    await shot("08-summary-real");
    log.push({ label: "errors", errors: t.takeErrors().slice(0, 5) });
  } finally { await browser.close(); }
  writeFileSync(join(OUT, "runtime.json"), JSON.stringify({ motion: MOTION, account: c.userId, generated: new Date().toISOString(), log }, null, 2));
  console.log(JSON.stringify(log, null, 1));
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
