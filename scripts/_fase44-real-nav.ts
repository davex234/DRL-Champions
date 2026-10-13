/**
 * FASE 44 · QA REAL — SOLO NAVEGACIÓN (instrumento `_`, fuera de CI, CERO ESCRITURAS)
 *
 *   npx tsx scripts/_fase44-real-nav.ts <credsFile> [baseUrl]
 *
 * Repite, sin empezar partidas ni comprar nada, los dos pasos cuyo comprobante falló en `_fase44-real-qa.ts` por un
 * defecto del INSTRUMENTO (buscaba «Comenzar duelo» sin `/i` y la interfaz lo pinta en mayúsculas):
 *   A · Home → JUGAR → Partida rápida → preparación          C · Equipos → JUGAR con este equipo → preparación
 * Huella de BD antes/después: debe ser idéntica.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const CREDS = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3005";
const creds = JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string };
const U = creds.userId;
const psql = (sql: string) => execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
const fp = () => psql(`select credits, xp from public.profiles where id = '${U}'; select count(*) from public.duel_matches where user_id = '${U}'; select count(*) from public.credit_transactions where user_id = '${U}';`);
const waitFor = async (tab: Tab, expr: string, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; };
const checks: { label: string; ok: boolean }[] = [];
const check = (label: string, ok: boolean) => { checks.push({ label, ok }); console.log(`  ${ok ? "✓" : "✗"} ${label}`); };

async function main() {
  const f0 = fp();
  const b = await launch({ width: 1440, height: 900, userDataDir: join(CREDS, "..", "f44-real-profile") });
  const tab = b.tab;
  try {
    await tab.goto(`${BASE}/cuenta`, 4000);
    if (await tab.js<boolean>(`!!document.querySelector('input[type="password"]')`)) {
      await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(creds.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    }
    await waitFor(tab, `/cerrar sesión/i.test(document.body.innerText)`, 30000);
    await tab.goto(`${BASE}/`, 5000);
    await waitFor(tab, `!!document.querySelector('[data-testid="shell-play"]')`, 20000);
    await tab.js(`document.querySelector('[data-testid="shell-play"]').click()`);
    check("A · JUGAR → selector de modos", await waitFor(tab, `location.pathname === "/jugar" && !!document.querySelector('[data-testid="mode-cta-QUICK"]')`, 25000));
    await tab.js(`document.querySelector('[data-testid="mode-cta-QUICK"]').click()`);
    check("A · Partida rápida → preparación (Comenzar duelo visible, sin pulsar)", await waitFor(tab, `location.pathname === "/duelos/jugar" && /Comenzar duelo/i.test(document.body.innerText)`, 30000));
    await tab.goto(`${BASE}/duelos/mazos`, 6000);
    await waitFor(tab, `!!document.querySelector('main a[href^="/duelos/jugar?deck="]')`, 25000);
    await tab.js(`document.querySelector('main a[href^="/duelos/jugar?deck="]').click()`);
    check("C · JUGAR con este equipo → preparación (sin pulsar)", await waitFor(tab, `location.pathname === "/duelos/jugar" && /Comenzar duelo/i.test(document.body.innerText)`, 30000));
  } finally {
    await b.close();
  }
  const same = fp() === f0;
  check("cero escrituras (huella idéntica)", same);
  writeFileSync(join(process.cwd(), "docs/product/qa/fase44/real/real-nav.json"), JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2) + "\n");
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}
void main();
