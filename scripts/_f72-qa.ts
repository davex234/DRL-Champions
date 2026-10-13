/**
 * F72 · QA REAL (fuera de CI) — navegador real contra :3005 y la BD real, SOLO con cuentas QA.
 *
 *   npx tsx scripts/_f72-qa.ts <sección>
 *     shots      capturas 1440 / 1024 / 390 (movimiento normal y reducido) de /duelos y del draft
 *     dbl        doble clic REAL en ENTRAR y en CONFIRMAR (misma tarea) → una run, un cargo
 *     tabs       dos pestañas (dos navegadores, misma cuenta) confirman a la vez → una run, un cargo
 *     retry      reintento de red: misma acción `start` repetida → un cargo
 *     poor       saldo insuficiente: botón desactivado + 402 del servidor, sin run ni asiento
 *     reward     run real: entrar → 10 elecciones → combates por la API del duelo → recompensa del servidor
 *     reconcile  libro mayor ↔ saldo ↔ runs de las cuentas usadas (lectura con service_role)
 *
 * Evidencia en docs/product/qa/fase72/ (JSON sin secretos + capturas en shots/).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { openBrowser, loginUi, goto, sleep, token, api, creds, waitFor, type Client } from "./_fase68-lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
const OUT = join(process.cwd(), "docs/product/qa/fase72");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "").trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const section = process.argv[2] ?? "shots";
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { results.push({ id, ok, detail: detail.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail.slice(0, 220)}`); };

const credits = async (p: string) => Number((await api(await token(p), "/api/game/state")).json?.credits);
const draftOf = async (p: string) => (await api(await token(p), "/api/game/draft-gauntlet")).json;
const ledger = async (userId: string, sinceIso: string) => {
  const { data, error } = await admin.from("credit_transactions").select("ref, reason, delta, balance_after, created_at").eq("user_id", userId).gte("created_at", sinceIso).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { ref: string | null; reason: string; delta: number; balance_after: number; created_at: string }[];
};
const abandonIfActive = async (p: string) => {
  const d = await draftOf(p);
  if (d?.run) await api(await token(p), "/api/game/draft-gauntlet", { action: "abandon", actionId: randomUUID(), expectedVersion: d.run.version, confirm: true });
};
const shot = async (c: Client, name: string) => { await sleep(700); await c.tab.shot(join(SHOTS, `${name}.png`)).catch(() => null); };
const noHScroll = (c: Client) => c.tab.js<boolean>(`document.documentElement.scrollWidth <= innerWidth + 1`);
const inView = (c: Client, sel: string) => c.tab.js<any>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), vh: innerHeight, vw: innerWidth, fits: r.left >= 0 && r.right <= innerWidth }; })()`);
const clipped = (c: Client, sel: string) => c.tab.js<string[]>(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => (e.textContent||'').trim().slice(0,40))`);

async function select(c: Client, id: string) {
  await c.tab.js(`document.querySelector('[data-testid="duel-mode-select-${id}"]')?.click()`);
  await sleep(1100);
}

(async () => {
  try {
    if (section === "shots") {
      for (const reduced of [false, true]) {
        const tag = reduced ? "-reduced" : "";
        // Competitivo clasificado real: persona E (#4). Draft sin run: persona A.
        for (const width of [1440, 1024, 390]) {
          const c = await openBrowser("E", width, { reduced, label: "f72" });
          try {
            await loginUi(c, "E");
            await goto(c, "/duelos", 3500);
            await shot(c, `duelos-${width}${tag}`);
            check(`/duelos ${width}${tag}: sin scroll horizontal`, await noHScroll(c));
            const quick = await inView(c, '[data-testid="duel-mode-cta-QUICK"]');
            check(`/duelos ${width}${tag}: CTA de PARTIDA RÁPIDA visible y grande`, !!quick && quick.h >= 56 && quick.fits && (width !== 390 || quick.bottom <= quick.vh), JSON.stringify(quick));
            await select(c, "RANKED");
            await waitFor(c.tab, `document.querySelector('[data-testid="duel-ranked-inline"]')?.getAttribute('data-state') !== 'loading'`, 12000);
            await sleep(500);
            await c.tab.js(`document.querySelector('[data-testid="duel-mode-RANKED"]')?.scrollIntoView({ block: 'center' })`);
            await shot(c, `duelos-competitivo-${width}${tag}`);
            const r = await c.tab.js<any>(`({ rank: document.querySelector('[data-field="rank"]')?.textContent, rating: document.querySelector('[data-field="rating"]')?.textContent, emblem: !!document.querySelector('[data-testid="duel-ranked-inline"] [data-testid="ladder-emblem"]') })`);
            const cta = await inView(c, '[data-testid="duel-mode-cta-RANKED"]');
            check(`competitivo ${width}${tag}: rango visible (#4 · Rating 915) con emblema y CTA grande`, r.rank === "#4" && r.rating === "Rating 915" && r.emblem && !!cta && cta.h >= 56 && cta.fits, JSON.stringify({ r, cta }));
          } finally { await c.browser.close(); }
          const a = await openBrowser("A", width, { reduced, label: "f72" });
          try {
            await loginUi(a, "A");
            await goto(a, "/duelos?modo=DRAFT_GAUNTLET", 3500);
            await a.tab.js(`document.querySelector('[data-testid="duel-mode-DRAFT_GAUNTLET"]')?.scrollIntoView({ block: 'center' })`);
            await shot(a, `duelos-draft-${width}${tag}`);
            const d = await a.tab.js<any>(`({ fee: document.querySelector('[data-field="entry-fee"]')?.textContent, ladder: document.querySelectorAll('[data-testid="duel-draft-entry"] [data-wins]').length, jackpotArt: !!document.querySelector('.nx-draft-jackpot-art') })`);
            const cta = await inView(a, '[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]');
            const cut = await clipped(a, '[data-testid="duel-mode-DRAFT_GAUNTLET"] *');
            check(`draft ${width}${tag}: coste visible, escalera de 6, arte del sobre, CTA grande, sin textos cortados`, d.fee === "2.000" && d.ladder === 6 && d.jackpotArt && !!cta && cta.h >= 56 && cta.fits && cut.length === 0 && await noHScroll(a), JSON.stringify({ d, cta, cut }));
          } finally { await a.browser.close(); }
        }
      }
      // Sala del draft: persona J entra (paga) y se captura la elección, la carta elegida y 390.
      await abandonIfActive("J");
      for (const [width, reduced] of [[1440, false], [1440, true], [1024, false], [390, false], [390, true]] as const) {
        const tag = `${width}${reduced ? "-reduced" : ""}`;
        const c = await openBrowser("J", width, { reduced, label: "f72" });
        try {
          await loginUi(c, "J");
          if (!(await draftOf("J"))?.run) await api(await token("J"), "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID() });
          await goto(c, "/jugar/draft-gauntlet", 3500);
          await waitFor(c.tab, `document.querySelectorAll('[data-testid="draft-option"]').length === 3`, 15000);
          await sleep(reduced ? 600 : 1600);
          await shot(c, `draft-eleccion-${tag}`);
          await c.tab.js(`document.querySelector('[data-testid="draft-option"] button[aria-label^="Opción 2"]')?.click()`);
          await sleep(1200);
          await shot(c, `draft-seleccionada-${tag}`);
          const st = await c.tab.js<any>(`({ selected: [...document.querySelectorAll('[data-testid="draft-option"]')].map(e => e.getAttribute('data-selected')), sparks: document.querySelectorAll('[data-testid="draft-sparks"]').length })`);
          const confirm = await inView(c, '[data-testid="draft-confirm"]');
          check(`draft ${tag}: 3 opciones, 1 elegida, CONFIRMAR visible dentro de pantalla`, st.selected.filter((x: string) => x === "true").length === 1 && !!confirm && confirm.top >= 0 && confirm.bottom <= confirm.vh && confirm.fits && await noHScroll(c), JSON.stringify({ st, confirm }));
          if (reduced) check(`draft ${tag}: movimiento reducido = sin chispas continuas`, st.sparks === 0, `sparks=${st.sparks}`);
          await c.tab.js(`document.querySelector('[data-testid="draft-cancel"]')?.click()`);
        } finally { await c.browser.close(); }
      }
    }

    if (section === "dbl") {
      const P = "D"; await abandonIfActive(P);
      const since = new Date().toISOString(); const c0 = await credits(P);
      const c = await openBrowser(P, 1440, { label: "f72" });
      try {
        await loginUi(c, P);
        await goto(c, "/duelos?modo=DRAFT_GAUNTLET", 3500);
        await c.tab.js(`(() => { const e = document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]'); e.click(); e.click(); })()`);
        await sleep(400);
        const step = await c.tab.js<string>(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.getAttribute('data-step')`);
        const c1 = await credits(P);
        check("doble clic en ENTRAR: solo abre la confirmación, no cobra", step === "confirm" && c1 === c0, `step=${step} ${c0}→${c1}`);
        await c.tab.js(`(() => { const e = document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]'); e.click(); e.click(); })()`);
        await waitFor(c.tab, `location.pathname === '/jugar/draft-gauntlet'`, 20000);
        await sleep(2000);
      } finally { await c.browser.close(); }
      const rows = (await ledger(creds(P).userId, since)).filter((r) => r.reason === "draft_entry");
      const c2 = await credits(P);
      check("doble clic en CONFIRMAR: UNA run y UN cargo de 2.000", rows.length === 1 && c0 - c2 === 2000 && !!(await draftOf(P))?.run?.entry?.paid, `asientos=${rows.length} ${c0}→${c2}`);
    }

    if (section === "tabs") {
      const P = "F"; await abandonIfActive(P);
      const since = new Date().toISOString(); const c0 = await credits(P);
      const [a, b] = [await openBrowser(P, 1440, { label: "f72a" }), await openBrowser(P, 1440, { label: "f72b" })];
      try {
        await loginUi(a, P); await loginUi(b, P);
        await Promise.all([goto(a, "/duelos?modo=DRAFT_GAUNTLET", 3500), goto(b, "/duelos?modo=DRAFT_GAUNTLET", 3500)]);
        for (const c of [a, b]) await c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.click()`);
        await sleep(500);
        await Promise.all([a, b].map((c) => c.tab.js(`document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.click()`)));
        await Promise.all([a, b].map((c) => waitFor(c.tab, `location.pathname === '/jugar/draft-gauntlet'`, 20000)));
        await sleep(2500);
        const runs = await Promise.all([a, b].map((c) => c.tab.js<string | null>(`document.querySelector('[data-testid="draft-screen"]')?.getAttribute('data-run-status') ?? null`)));
        const { count } = await admin.from("draft_runs").select("id", { count: "exact", head: true }).eq("user_id", creds(P).userId).in("status", ["DRAFTING", "READY", "IN_MATCH"]);
        const rows = (await ledger(creds(P).userId, since)).filter((r) => r.reason === "draft_entry");
        const c1 = await credits(P);
        check("dos pestañas confirman a la vez: UNA run activa, UN cargo, las dos ven la sala", count === 1 && rows.length === 1 && c0 - c1 === 2000 && runs.every((x) => x === "DRAFTING"), `runs activas=${count} asientos=${rows.length} ${c0}→${c1} pestañas=${JSON.stringify(runs)}`);
      } finally { await a.browser.close(); await b.browser.close(); }
    }

    if (section === "retry") {
      const P = "G"; await abandonIfActive(P);
      const since = new Date().toISOString(); const c0 = await credits(P); const t = await token(P);
      const id = randomUUID();
      const rs = [];
      for (let i = 0; i < 3; i++) rs.push((await api(t, "/api/game/draft-gauntlet", { action: "start", actionId: id })).status);
      const par = await Promise.all([0, 1, 2].map(() => api(t, "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID() }, true)));
      const rows = (await ledger(creds(P).userId, since)).filter((r) => r.reason === "draft_entry");
      const c1 = await credits(P);
      check("reintento (misma acción ×3) + 3 entradas en paralelo: UN cargo", rows.length === 1 && c0 - c1 === 2000, `status=${rs.join(",")} paralelo=${par.map((r) => r.status).join(",")} asientos=${rows.length} ${c0}→${c1}`);
      const bad = await api(t, "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID(), reward: 99999 });
      const bad2 = await api(t, "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID(), fee: 0 });
      check("el cliente no puede mandar recompensa ni entrada (400 FIELD_NOT_ALLOWED)", bad.status === 400 && bad2.status === 400, `${bad.status} ${bad.json?.code} / ${bad2.status}`);
      await abandonIfActive(P);
    }

    if (section === "poor") {
      const P = "C"; await abandonIfActive(P);
      const since = new Date().toISOString(); const c0 = await credits(P);
      const c = await openBrowser(P, 390, { label: "f72" });
      try {
        await loginUi(c, P);
        await goto(c, "/duelos?modo=DRAFT_GAUNTLET", 3500);
        await c.tab.js(`document.querySelector('[data-testid="duel-mode-DRAFT_GAUNTLET"]')?.scrollIntoView({ block: 'center' })`);
        await shot(c, "duelos-draft-sin-saldo-390");
        const ui = await c.tab.js<any>(`({ disabled: !!document.querySelector('[data-testid="duel-mode-cta-DRAFT_GAUNTLET"]')?.disabled, short: document.querySelector('[data-testid="duel-draft-short"]')?.textContent })`);
        check("saldo insuficiente: ENTRAR desactivado y dice cuánto falta", ui.disabled && /Te faltan/.test(ui.short ?? ""), JSON.stringify({ ui, c0 }));
      } finally { await c.browser.close(); }
      const r = await api(await token(P), "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID() });
      const rows = await ledger(creds(P).userId, since);
      const { count } = await admin.from("draft_runs").select("id", { count: "exact", head: true }).eq("user_id", creds(P).userId).gte("created_at", since);
      check("saldo insuficiente (API directa): 402, sin run y sin asiento", r.status === 402 && r.json?.code === "INSUFFICIENT_CREDITS" && rows.length === 0 && count === 0 && (await credits(P)) === c0, `status=${r.status} asientos=${rows.length} runs=${count}`);
    }

    if (section === "reward") {
      const P = "H"; await abandonIfActive(P);
      const t = await token(P); const since = new Date().toISOString(); const c0 = await credits(P);
      let s = (await api(t, "/api/game/draft-gauntlet", { action: "start", actionId: randomUUID() })).json;
      for (let i = 0; i < 10; i++) {
        // Elección «de humano con criterio»: la de mayor pico de stat de combate.
        const offer: string[] = s.run.offer; const cards = s.cards;
        const peak = (id: string) => Math.max(...Object.values(cards[id]?.combat ?? { x: 0 }).map(Number));
        const choice = [...offer].sort((x, y) => peak(y) - peak(x))[0];
        s = (await api(t, "/api/game/draft-gauntlet", { action: "pick", actionId: randomUUID(), expectedVersion: s.run.version, choiceId: choice })).json;
      }
      const stages: string[] = [];
      for (let stage = 0; stage < 5; stage++) {
        s = await draftOf(P);
        if (!s?.run || s.run.status !== "READY") break;
        const m = await api(t, "/api/game/draft-gauntlet", { action: "start_match", actionId: randomUUID(), expectedVersion: s.run.version });
        const matchId = m.json?.matchId;
        for (let step = 0; step < 80; step++) {
          const st = await api(t, "/api/game/duel", { action: "state", matchId });
          const v = st.json?.view;
          if (!v || v.status !== "IN_PROGRESS") break;
          const hand = (v.yourHand ?? []) as any[];
          if (!hand.length) { await sleep(400); continue; }
          const stats = ["stronghold", "gamesense", "entryfrag"];
          const best = [...hand].sort((x, y) => Math.max(...stats.map((k) => y.combat[k])) - Math.max(...stats.map((k) => x.combat[k])))[0];
          const body: any = { action: "play", matchId, cardUid: best.uid };
          if (v.youAreAttacker) body.stat = stats.reduce((a2, b2) => (best.combat[b2] > best.combat[a2] ? b2 : a2), stats[0]);
          await api(t, "/api/game/duel", body);
        }
        const after = await draftOf(P);
        const node = after?.run?.stages?.[stage] ?? after?.lastRun?.stages?.[stage];
        stages.push(node?.state ?? "?");
        if (!after?.run) break;
      }
      await sleep(1500);
      const fin = await draftOf(P);
      const last = fin?.lastRun;
      const rows = await ledger(creds(P).userId, since);
      const entry = rows.filter((r) => r.reason === "draft_entry");
      const rew = rows.filter((r) => r.reason.startsWith("draft_reward:"));
      const jack = rows.filter((r) => r.reason.startsWith("draft_jackpot:"));
      const wins = last?.wins ?? -1;
      const expected = [0, 200, 500, 1000, 1600, 2100][wins] ?? NaN;
      const c1 = await credits(P);
      check("run real: una entrada, recompensa del servidor = tabla por victorias, saldo conciliado", entry.length === 1 && (wins === 0 ? rew.length === 0 : rew.length === 1 && rew[0].delta === expected) && c1 - c0 === -2000 + expected && !!last?.reward?.granted,
        `combates=${JSON.stringify(stages)} victorias=${wins} asientos=${JSON.stringify(rows.map((r) => [r.reason, r.delta]))} saldo ${c0}→${c1} reward=${JSON.stringify(last?.reward)}`);
      if (wins === 5) check("run real completada: sobre semanal (Masters) y título", jack.length <= 1, JSON.stringify(jack));
      // Recargar / repetir la lectura no vuelve a pagar.
      for (let i = 0; i < 3; i++) await draftOf(P);
      const rows2 = await ledger(creds(P).userId, since);
      check("releer tras la recompensa (×3) no la duplica", rows2.length === rows.length, `${rows.length}→${rows2.length}`);
    }

    if (section === "reconcile") {
      const out: any[] = [];
      for (const P of ["I", "J", "D", "F", "G", "H", "C", "A", "E"]) {
        const u = creds(P).userId;
        const { data: runs } = await admin.from("draft_runs").select("id, status, stage, state, created_at").eq("user_id", u).gte("created_at", "2026-09-29T00:00:00Z");
        const { data: tx } = await admin.from("credit_transactions").select("ref, reason, delta").eq("user_id", u).like("ref", "draft:%");
        const paid = (runs ?? []).filter((r: any) => r.state?.entry);
        const entryRows = (tx ?? []).filter((t: any) => t.reason === "draft_entry");
        const perRun = paid.map((r: any) => ({ id: String(r.id).slice(0, 8), status: r.status, entries: entryRows.filter((t: any) => t.ref === `draft:entry:${r.id}`).length, paidFlag: !!r.state.entry.paidAt, reward: r.state.reward ? { wins: r.state.reward.wins, credits: r.state.reward.credits, granted: !!r.state.reward.grantedAt } : null, rewardRows: (tx ?? []).filter((t: any) => t.ref === `draft:reward:${r.id}`).length }));
        const orphan = entryRows.filter((t: any) => !paid.some((r: any) => t.ref === `draft:entry:${r.id}`));
        const okRuns = perRun.every((r) => r.entries === (r.paidFlag ? 1 : 0) && r.rewardRows <= 1 && (!r.reward || !r.reward.granted || r.rewardRows === (r.reward.credits > 0 || r.reward.wins === 5 ? 1 : 0)));
        out.push({ persona: P, runs: perRun.length, entryRows: entryRows.length, orphanEntries: orphan.length, ok: okRuns && orphan.length === 0, perRun });
        check(`libro mayor ↔ runs (${P}): una entrada por run pagada, ≤1 premio por run, sin cargos huérfanos`, okRuns && orphan.length === 0, JSON.stringify({ runs: perRun.length, entries: entryRows.length, orphan: orphan.length }));
      }
      writeFileSync(join(OUT, "reconcile-f72.json"), JSON.stringify(out, null, 2) + "\n");
    }
  } catch (e) {
    check("exception", false, String((e as Error)?.stack ?? e));
  } finally {
    const file = join(OUT, `qa-${section}.json`);
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), section, pass: results.filter((r) => r.ok).length, total: results.length, results }, null, 2) + "\n");
    console.log(`${section}: ${results.filter((r) => r.ok).length}/${results.length}`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }
})();
