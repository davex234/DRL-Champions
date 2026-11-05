/**
 * F87.2 · QA EN PRODUCCIÓN — lado del JUGADOR (instrumento, fuera de CI). Cuenta QA EXISTENTE (`L`, qa_f872_*); nunca
 * davex ni ValoRosters (aborta si ve sus ids). Nada se publica ni se activa.
 *
 *   QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… npx tsx scripts/_f872-prod-qa.mts      (cwd = prodqa)
 *
 *   A · API: `eligible:true` falsificado → 400; reclamar el borrador → 404; RPC de elegibilidad/reclamo por REST → sin
 *       acceso; cuenta normal → admin 401/403.
 *   B · ficha del Pick'em con recompensas (FIXTURE por CDP: el Pick'em `qa-f872-ux` no existe en producción): la cuenta
 *       puede participar y ve si cumple o no los requisitos, con texto + símbolo, a 390 / 1024 / 1440.
 *   C · `/duelos/jugar` REAL: FÁCIL · NORMAL · DIFÍCIL sin los textos retirados; reglas la primera vez, después no
 *       (F5 y volver); elegir Difícil y «Comenzar duelo» arranca la partida.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./lib/cdp";
import { scene } from "../src/app/design-system/f87/fixtures";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://valorosters.com";
const SB = process.env.QA_SB!, ANON = process.env.QA_ANON!, DIR = process.env.QA_CREDS_DIR!;
const REAL = ["2f86cbe8", "3befce61", "b7ccff02"];
const OUT = "C:/NEXUS-CENTRAL/DRLCards/docs/product/qa/pickems-2/f872/prod-qa";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : JSON.stringify(detail); rows.push({ id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 220)}`); };
const cred = JSON.parse(readFileSync(join(DIR, "L.json"), "utf8")) as { email: string; password: string; userId: string };
if (REAL.some((p) => cred.userId.startsWith(p))) throw new Error("CUENTA REAL: abortado");
const SPLASH = `!document.querySelector('[class*="z-[100]"][class*="bg-base-900"]')`;

async function main() {
  const tok = (await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: cred.email, password: cred.password }) })).json() as { access_token: string; user: { id: string } });
  if (REAL.some((p) => tok.user.id.startsWith(p))) throw new Error("CUENTA REAL: abortado");
  const H = { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" };
  // ── A · API ──
  const forged = await fetch(`${BASE}/api/game/pickem-brackets`, { method: "POST", headers: H, body: JSON.stringify({ action: "claim", slug: "champions-2026-playoffs", eligible: true }) });
  check("A · `eligible:true` enviado por el cliente → rechazado (400, campo no permitido)", forged.status === 400 && /Campo no permitido/.test(await forged.text()), forged.status);
  const claimDraft = await fetch(`${BASE}/api/game/pickem-brackets`, { method: "POST", headers: H, body: JSON.stringify({ action: "claim", slug: "champions-2026-playoffs" }) });
  check("A · reclamar en el borrador de Champions → 404 (invisible)", claimDraft.status === 404, claimDraft.status);
  for (const fn of ["app_pickem_reward_eligibility", "app_pickem_claim", "app_pickem_eligibility_summary"]) {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...H, apikey: ANON }, body: JSON.stringify({ p_user: tok.user.id, p_bracket: "00000000-0000-0000-0000-000000000000" }) });
    check(`A · REST ${fn} con sesión de jugador → sin acceso`, r.status !== 200, r.status);
  }
  const adm = await fetch(`${BASE}/api/admin/pickems`, { headers: H });
  check("A · cuenta normal → panel admin de Pick'ems 401/403", adm.status === 401 || adm.status === 403, adm.status);
  const admW = await fetch(`${BASE}/api/admin/pickems`, { method: "POST", headers: H, body: JSON.stringify({ action: "rewards", id: "00000000-0000-0000-0000-000000000000", rewardsVersion: 1, rewards: {}, rewardsStatus: "ACTIVE", ack: true }) });
  check("A · cuenta normal → activar recompensas 401/403", admW.status === 401 || admW.status === 403, admW.status);

  // ── B y C · navegador ──
  const b = await launch({ width: 1440, height: 900 });
  const t = b.tab;
  const wait = async (expr: string, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await t.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; };
  try {
    await t.goto(`${BASE}/cuenta`, 3500); await wait(SPLASH, 15000);
    await t.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${JSON.stringify(cred.email)}); set(document.querySelector('input[type="password"]'), ${JSON.stringify(cred.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
    check("login REAL de la cuenta QA", await wait(`!document.querySelector('input[type="password"]')`)); await sleep(1500);

    // B · fixture de la ficha con recompensas activas (solo esta URL; el resto es producción real).
    let current = "playoffs-rewards-matches";
    t.on("Fetch.requestPaused", async (p: any) => {
      const v = { ...scene(current)!.view, slug: "qa-f872-ux", title: "QA F87.2 · elegibilidad (fixture, no publicado)" };
      await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "private, no-store" }], body: Buffer.from(JSON.stringify(v)).toString("base64") }).catch(() => null);
    });
    await t.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/game/pickem-brackets?slug=qa-f872-ux*", requestStage: "Request" }] });
    const cases: [string, string, RegExp][] = [
      ["playoffs-rewards-matches", "false", /Puedes participar, pero esta cuenta todavía no cumple los requisitos para recibir recompensas: te faltan 2 partida/],
      ["groups-ineligible", "false", /Puedes participar, pero esta cuenta todavía no cumple los requisitos/],
      ["playoffs-rewards-eligible", "true", /Tu cuenta cumple los requisitos para recibir recompensas/],
    ];
    for (const w of [1440, 1024, 390]) {
      await t.resize(w, w < 600 ? 844 : w <= 1024 ? 768 : 900, 1);
      for (const [sc, want, re] of cases) {
        current = sc;
        await t.goto(`${BASE}/pickems/cuadro/qa-f872-ux`, 2500); await wait(`!!document.querySelector('[data-testid="pickem-eligibility"]')`, 20000);
        const r = await t.js<{ el: string | null; text: string; sym: string; overflow: number; buttons: number; noReward: boolean }>(`(() => { const e = document.querySelector('[data-testid="pickem-eligibility"]'); return { el: e?.getAttribute('data-eligible') ?? null, text: e?.innerText ?? '', sym: e?.querySelector('[aria-hidden]')?.textContent ?? '', overflow: document.documentElement.scrollWidth - window.innerWidth, buttons: document.querySelectorAll('[data-bracket-mode] button[aria-label^="Elegir "], [data-bracket-mode] button[aria-label^="Quitar "]').length, noReward: !!document.querySelector('[data-testid="pickem-result-no-reward"]') }; })()`);
        const participates = sc === "groups-ineligible" ? r.noReward : r.buttons > 0;
        check(`B · ${w} ${sc}: participa y ve su elegibilidad (texto + símbolo), sin desbordamiento`, r.el === want && re.test(r.text) && !!r.sym && r.overflow <= 0 && participates, { el: r.el, sym: r.sym, overflow: r.overflow, buttons: r.buttons, noReward: r.noReward });
        await t.js(`document.querySelector('[data-testid="pickem-eligibility"]').scrollIntoView({ block: 'center' })`); await sleep(300);
        await t.shot(`${OUT}/eligibility-${sc}-${w}.png`).catch(() => null);
      }
    }
    await t.send("Fetch.disable");

    // C · /duelos/jugar REAL (perfil de navegador nuevo = primera vez de esta cuenta en este dispositivo).
    await t.resize(1440, 900, 1);
    const prematch = async () => { await t.goto(`${BASE}/duelos/jugar`, 3000); await wait(SPLASH, 15000); await wait(`!!document.querySelector('[data-scene="prematch"] [aria-label="Dificultad"]')`, 25000); await sleep(1200); return t.js<{ rules: boolean; shown: string[]; removed: boolean }>(`({ rules: !!document.querySelector('[data-testid="prematch-rules"]'), shown: [...document.querySelectorAll('[aria-label="Dificultad"] button')].map(b => b.innerText.trim()), removed: /Ningún nivel ve|Imprevisible|Exigente/i.test(document.body.innerText) })`); };
    const c1 = await prematch();
    check("C · primera entrada: FÁCIL · NORMAL · DIFÍCIL, sin textos retirados, CON reglas", JSON.stringify(c1.shown) === JSON.stringify(["FÁCIL", "NORMAL", "DIFÍCIL"]) && !c1.removed && c1.rules, c1);
    await t.js(`document.querySelector('[aria-label="Dificultad"]').scrollIntoView({ block: 'start' })`); await sleep(400); await t.shot(`${OUT}/jugar-primera-1440.png`).catch(() => null);
    await t.send("Page.reload", {}); await sleep(3000); await wait(SPLASH, 15000); await wait(`!!document.querySelector('[data-scene="prematch"] [aria-label="Dificultad"]')`, 25000); await sleep(1200);
    check("C · F5: SIN reglas", !(await t.js<boolean>(`!!document.querySelector('[data-testid="prematch-rules"]')`)));
    await t.goto(`${BASE}/duelos`, 2500);
    const c3 = await prematch();
    check("C · salir y volver: SIN reglas, mismo selector", !c3.rules && JSON.stringify(c3.shown) === JSON.stringify(["FÁCIL", "NORMAL", "DIFÍCIL"]), c3);
    await t.js(`document.querySelector('[aria-label="Dificultad"]').scrollIntoView({ block: 'start' })`); await sleep(400); await t.shot(`${OUT}/jugar-siguientes-1440.png`).catch(() => null);
    for (const w of [1024, 390]) {
      await t.resize(w, w < 600 ? 844 : 768, 1); await sleep(800);
      const l = await t.js<{ overflow: number; tops: number; minH: number }>(`(() => { const bs = [...document.querySelectorAll('[aria-label="Dificultad"] button')].map(b => b.getBoundingClientRect()); return { overflow: document.documentElement.scrollWidth - window.innerWidth, tops: new Set(bs.map(r => Math.round(r.top))).size, minH: Math.min(...bs.map(r => r.height)) }; })()`);
      check(`C · ${w}: sin desbordamiento, tres en fila, ≥ 44 px`, l.overflow <= 0 && l.tops === 1 && l.minH >= 44, l);
      await t.js(`document.querySelector('[aria-label="Dificultad"]').scrollIntoView({ block: 'start' })`); await sleep(400); await t.shot(`${OUT}/jugar-siguientes-${w}.png`).catch(() => null);
    }
    await t.resize(1440, 900, 1); await sleep(500);
    await t.js(`document.querySelector('[data-difficulty="HARD"]').click()`); await sleep(300);
    check("C · Difícil seleccionado (aria-pressed)", await t.js<boolean>(`document.querySelector('[data-difficulty="HARD"]').getAttribute('aria-pressed') === 'true'`));
    await t.js(`[...document.querySelectorAll('button')].find(b => /Comenzar duelo/i.test(b.textContent)).click()`);
    check("C · «Comenzar duelo» arranca la partida real", await wait(`!document.querySelector('[data-scene="prematch"]')`, 25000));
    await sleep(2000); await t.shot(`${OUT}/jugar-partida-1440.png`).catch(() => null);
  } finally { await b.close(); }
  writeFileSync(`${OUT}/prod-qa.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, account: cred.userId.slice(0, 8), total: rows.length, pass: rows.filter((r) => r.ok).length, rows }, null, 1));
  console.log(`\nF87.2 PROD QA (jugador): ${rows.filter((r) => r.ok).length}/${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
