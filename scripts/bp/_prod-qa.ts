/**
 * BATTLE PASS CLEANUP · QA EN PRODUCCIÓN (instrumento de operador, fuera de CI y de la release). SOLO cuenta QA.
 *
 *   BASE_URL=https://valorosters.com QA_SESSION_FILE=<sesión QA> QA_USER=<uuid> npx tsx scripts/bp/_prod-qa.ts
 *
 * `/temporada/pase` con datos reales de una cuenta QA en nivel 1: cabecera (temporada, nivel, XP, GRATIS, premium
 * «próximamente»), track (30 niveles; DISPONIBLE / BLOQUEADO / premium bloqueado), reclamo REAL desde la UI (saldo y
 * libro mayor exactos, una sola vez, persiste tras recargar), sin objetivos dentro, responsive y movimiento reducido.
 * También: Objetivos con «Objetivos» una sola vez.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL!;
const USER = process.env.QA_USER!;
if (["3befce61", "b7ccff02"].some((p) => USER.startsWith(p))) throw new Error("CUENTA REAL: abortado");
const SESSION = readFileSync(process.env.QA_SESSION_FILE!, "utf8");
const TOKEN = JSON.parse(SESSION).access_token as string;
const OUT = join(process.cwd(), "docs/product/qa/battle-pass/prod");
mkdirSync(OUT, { recursive: true });
const sql = (q: string) => execFileSync("ssh", ["nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U supabase_admin -d postgres -Atq"], { input: `begin read only;\n${q}\nrollback;`, encoding: "utf8" }).trim();
const credits = async () => Number((await (await fetch(`${BASE}/api/game/state`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).credits);
const checks: { id: string; w: number; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, w: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, w, name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} [${id} ${w}] ${name}${ok ? "" : ` ${JSON.stringify(detail)?.slice(0, 300)}`}`); };
async function waitFor(c: Client, expr: string, ms = 25000) { for (let i = 0; i < ms / 200; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }
const PAGE = `(() => { const q = (s) => document.querySelector(s); const t = q('[data-testid="battle-pass"]')?.innerText ?? '';
  const track = q('[data-testid="pass-track"]'); const l1 = q('[data-testid="pass-track"] li[data-level="1"]'); const l12 = q('[data-testid="pass-track"] li[data-level="12"]');
  const cur = q('[data-testid="pass-track"] li[data-current="true"]'); const cr = cur?.getBoundingClientRect(); const tr = track?.getBoundingClientRect();
  return { season: q('[data-testid="pass-season"]')?.innerText, level: q('[data-testid="pass-level"]')?.dataset.level, xp: q('[data-testid="pass-xp"]')?.innerText,
    tier: q('[data-testid="pass-tier"]')?.innerText, offer: q('[data-testid="pass-premium-offer"]')?.innerText ?? null,
    levels: document.querySelectorAll('[data-testid="pass-track"] > li').length,
    l1free: l1?.querySelector('[data-lane="free"]')?.dataset.state, l12free: l12?.querySelector('[data-lane="free"]')?.dataset.state, l12text: l12?.querySelector('[data-lane="free"]')?.innerText,
    premiumLocked: [...document.querySelectorAll('[data-lane="premium"]')].every((e) => e.dataset.state === 'LOCKED'), premiumCount: document.querySelectorAll('[data-lane="premium"]').length,
    claimBtns: document.querySelectorAll('[data-testid="pass-claim"]').length,
    objectives: /Juega un duelo|Gana un duelo|Abre un sobre|Diarias|Semanales/.test(t), buy: /\\bcomprar\\b|checkout|\\bcomprado\\b/i.test(t),
    hScroll: track ? track.scrollWidth > track.clientWidth : null, curVisible: !!cr && !!tr && cr.left >= tr.left - 1 && cr.right <= tr.right + 1,
    pageOver: document.documentElement.scrollWidth - innerWidth, headerH: Math.round(q('[data-testid="pass-header"]')?.getBoundingClientRect().height ?? 0), vh: innerHeight }; })()`;

// `BP_CLAIMED=1`: el reclamo ya se hizo (y verificó) en una pasada anterior; aquí se comprueba que sigue reclamado.
let claimedDone = process.env.BP_CLAIMED === "1";
async function pass(w: number, reduced: boolean) {
  const tag = `${w}${reduced ? "-reduced" : ""}`;
  const c = await openBrowser("QA", w, { reduced, label: `bp-${tag}` });
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300);
    await c.tab.setStorage("sb-valorosters-auth-token", SESSION);
    await c.tab.goto(`${BASE}/temporada/pase`, 2500);
    const ok = await waitFor(c, `!!document.querySelector('[data-testid="pass-track"] li')`);
    await sleep(reduced ? 400 : 1000);
    const m = await c.tab.js<any>(PAGE);
    check("top", w, "cabecera compacta: temporada, NIVEL 1, XP real, GRATIS, premium «próximamente» sin compra", ok && /temporada 1/i.test(m.season ?? "") && m.level === "1" && /450 \/ 1\.000 XP/.test(m.xp ?? "") && /gratis/i.test(m.tier ?? "") && /próximamente/i.test(m.offer ?? "") && !m.buy, m);
    check("top", w, "la cabecera no es un héroe gigante (≤ 45 % del alto de pantalla)", m.headerH > 0 && m.headerH <= m.vh * 0.45, { h: m.headerH, vh: m.vh });
    check("track", w, "track con los 30 niveles; nivel 12 BLOQUEADO con su motivo; premium bloqueado (sin derecho)", m.levels === 30 && m.l12free === "LOCKED" && /nivel 12/i.test(m.l12text ?? "") && m.premiumCount > 0 && m.premiumLocked, m);
    check("track", w, "sin objetivos dentro del pase", !m.objectives, m);
    check("layout", w, w >= 768 ? "escritorio/tablet: el track se desplaza en horizontal y tu nivel está a la vista" : "móvil: filas apiladas (el track no desborda en horizontal)", w >= 768 ? m.hScroll === true && m.curVisible : m.hScroll === false, m);
    check("layout", w, "sin desbordamiento de página", m.pageOver <= 0, m.pageOver);
    await c.tab.shot(join(OUT, `pase-top-${tag}.png`));

    if (!claimedDone && w === 1440 && !reduced) {
      check("claim", w, "nivel 1 DISPONIBLE con su botón RECLAMAR", m.l1free === "AVAILABLE" && m.claimBtns >= 1, m);
      const before = await credits();
      await c.tab.js(`document.querySelector('[data-testid="pass-track"] li[data-level="1"] [data-lane="free"] [data-testid="pass-claim"]').click()`);
      const done = await waitFor(c, `document.querySelector('[data-testid="pass-track"] li[data-level="1"] [data-lane="free"]')?.dataset.state === "CLAIMED"`, 20000);
      await sleep(800);
      const after = await credits();
      const ledger = sql(`select count(*)||'|'||coalesce(sum(delta),0) from public.credit_transactions where user_id='${USER}' and ref like 'pass:nexus-s1:free:1%';`);
      check("claim", w, "RECLAMAR → el servidor concede, la celda pasa a RECLAMADO (✓) con el estado real releído", done, null);
      check("claim", w, "saldo y libro exactos: +260 créditos (recompensa real del nivel 1), un solo asiento", after - before === 260 && ledger === "1|260", { before, after, ledger });
      await c.tab.shot(join(OUT, `pase-claimed-${tag}.png`));
      await c.tab.goto(`${BASE}/temporada/pase`, 2500);
      await waitFor(c, `!!document.querySelector('[data-testid="pass-track"] li')`);
      await sleep(800);
      const again = await c.tab.js<any>(PAGE);
      check("claim", w, "tras recargar sigue RECLAMADO y no queda nada que volver a cobrar", again.l1free === "CLAIMED" && again.claimBtns === 0 && sql(`select count(*) from public.credit_transactions where user_id='${USER}' and ref like 'pass:nexus-s1:free:1%';`) === "1", again);
      claimedDone = true;
    }
    await c.tab.js(`document.querySelector('[data-testid="pass-track"]').scrollIntoView({ block: 'start' })`); await sleep(400);
    await c.tab.shot(join(OUT, `pase-track-${tag}.png`));

    // Objetivos: «Objetivos» una sola vez como encabezado.
    await c.tab.goto(`${BASE}/misiones`, 2000);
    await waitFor(c, `!!document.querySelector('[data-testid="pass-objectives"] #objetivos')`);
    await sleep(500);
    const o = await c.tab.js<any>(`({ heads: [...document.querySelectorAll('main h1, main h2, main h3, [data-testid^="hub-tab-"]')].filter((e) => /^objetivos$/i.test(e.innerText.trim())).length, tabs: document.querySelectorAll('[data-testid^="hub-tab-"]').length, over: document.documentElement.scrollWidth - innerWidth })`);
    check("objetivos", w, "«Objetivos» aparece una sola vez como encabezado (sin pestaña ni encabezado repetidos)", o.heads === 1 && o.tabs === 0 && o.over <= 0, o);
    await c.tab.shot(join(OUT, `objetivos-${tag}.png`));
  } finally { await c.browser.close().catch(() => null); }
}

(async () => {
  for (const w of [1440, 1024, 390]) { await pass(w, false); await pass(w, true); }
  const failed = checks.filter((x) => !x.ok);
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), total: checks.length, failed: failed.length, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})();
