/**
 * IA · QA EN PRODUCCIÓN DEL FEEDBACK DESDE MI CUENTA (instrumento, fuera de CI y de la release). SOLO cuenta QA.
 *
 *   BASE_URL=https://valorosters.com QA_SESSION_FILE=<sesión QA> QA_USER=<uuid QA> npx tsx scripts/ia/_prod-feedback.ts
 *
 * Mi cuenta → DAR FEEDBACK → formulario real → enviar (desde la UI, como una persona) → la fila llega a `alpha_feedback`
 * ligada a la cuenta QA (lectura SQL de solo lectura). La fila se borra con la limpieza de la cuenta (FK en cascada).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openBrowser, sleep, type Client } from "../_fase68-lib";

const BASE = process.env.BASE_URL!;
const USER = process.env.QA_USER!;
if (["3befce61", "b7ccff02"].some((p) => USER.startsWith(p))) throw new Error("CUENTA REAL: abortado");
const SESSION = readFileSync(process.env.QA_SESSION_FILE!, "utf8");
const sql = (q: string) => execFileSync("ssh", ["nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U supabase_admin -d postgres -Atq"], { input: `begin read only;\n${q}\nrollback;`, encoding: "utf8" }).trim();
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(d)?.slice(0, 300)}`); };
async function waitFor(c: Client, expr: string, ms = 25000) { for (let i = 0; i < ms / 200; i++) { if (await c.tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; }

(async () => {
  const before = Number(sql(`select count(*) from public.alpha_feedback where user_id='${USER}';`));
  const c = await openBrowser("QA", 1440, { label: "ia-feedback" });
  try {
    await c.tab.goto(`${BASE}/robots.txt`, 300);
    await c.tab.setStorage("sb-valorosters-auth-token", SESSION);
    await c.tab.goto(`${BASE}/cuenta`, 2500);
    await waitFor(c, `!!document.querySelector('[data-testid="account-feedback"]')`);
    await c.tab.js(`document.querySelector('[data-testid="account-feedback"]').click()`);
    const form = await waitFor(c, `!!document.querySelector('[data-testid="feedback-form"]') && !document.querySelector('[data-testid="feedback-submit"]').disabled`);
    check("Mi cuenta → Dar feedback abre el formulario real", form);
    await c.tab.js(`(() => { const t = document.querySelector('[data-testid="feedback-comment"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'QA IA 2026-10-07: feedback de prueba desde Mi cuenta (se borra con la cuenta QA).'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(300);
    await c.tab.js(`document.querySelector('[data-testid="feedback-submit"]').click()`);
    const sent = await waitFor(c, `!!document.querySelector('[data-testid="feedback-sent"]')`, 20000);
    const err = await c.tab.js<string>(`document.querySelector('[data-testid="feedback-error"]')?.innerText ?? ''`);
    check("enviar → confirmación «enviado» del sistema real", sent, err);
    await sleep(800);
    const after = Number(sql(`select count(*) from public.alpha_feedback where user_id='${USER}';`));
    const row = sql(`select source||'|'||(comment like 'QA IA 2026-10-07%') from public.alpha_feedback where user_id='${USER}' order by created_at desc limit 1;`);
    check("la respuesta llega a alpha_feedback ligada a la cuenta QA (una fila, origen «menu»)", after === before + 1 && row === "menu|true", { before, after, row });
    await c.tab.shot("docs/product/qa/ia-consolidation/prod/feedback-sent-1440.png");
  } finally { await c.browser.close().catch(() => null); }
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})();
